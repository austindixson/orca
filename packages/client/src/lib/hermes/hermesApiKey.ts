/**
 * Hermes gateway: resolve the Bearer token in this priority order:
 *
 *   1. UI-stored key (Settings → Integrations → Hermes API key)
 *   2. Z.AI provider key (when base host is `api.z.ai`)
 *   3. `~/.hermes/.env` via Tauri `resolve_hermes_api_server_key` (in Tauri only)
 *   4. No Authorization header (open local gateway / remote unknown)
 *
 * The UI-stored key always wins so operators can override the file on-the-fly.
 * Junk tool JSON (`api_key: null`) must not become the literal string "null".
 */

import { describeBearerForLog, hermesDebug } from './hermesDebugLog'

export type HermesResolvedAuthMode =
  | 'ui_key'
  | 'zai_provider'
  | 'env_hermes_dotenv'
  | 'none_local_gateway'
  | 'none_remote_host'

export type HermesResolvedAuthStatus = {
  mode: HermesResolvedAuthMode
  /** Bearer token that would be sent, if any. */
  bearer: string | undefined
  label: string
  detail: string
}

/** Any api.z.ai host uses the Z.AI Coding / PaaS key — never ~/.hermes `API_SERVER_KEY`. */
function urlHostIsZaiApi(raw: string | undefined): boolean {
  if (!raw?.trim()) return false
  try {
    return new URL(raw.trim()).hostname === 'api.z.ai'
  } catch {
    return false
  }
}

function urlLooksLikeLocalGateway(raw: string | undefined): boolean {
  if (!raw?.trim()) return true
  try {
    const h = new URL(raw.trim()).hostname
    return h === '127.0.0.1' || h === 'localhost'
  } catch {
    return false
  }
}

/** Returns a non-empty bearer token, or undefined (omit Authorization). */
export function effectiveHermesBearerKey(raw: string | undefined): string | undefined {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t) return undefined
  const lower = t.toLowerCase()
  if (lower === 'null' || lower === 'undefined') return undefined
  return t
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    '__TAURI_IPC__' in window
  )
}

/** Per-session memo of the Tauri-side env lookup. `null` = looked up but absent. */
type EnvKeyCache = { value: string | null } | undefined
let envKeyCache: EnvKeyCache = undefined
let envKeyPromise: Promise<string | null> | null = null

async function readHermesEnvKeyOnce(): Promise<string | null> {
  if (envKeyCache) return envKeyCache.value
  if (envKeyPromise) return envKeyPromise
  if (!isTauriRuntime()) {
    envKeyCache = { value: null }
    return null
  }
  envKeyPromise = (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const raw = await invoke<string | null | undefined>('resolve_hermes_api_server_key')
      const t = typeof raw === 'string' ? raw.trim() : ''
      const value = t && t.toLowerCase() !== 'null' && t.toLowerCase() !== 'undefined' ? t : null
      envKeyCache = { value }
      return value
    } catch {
      envKeyCache = { value: null }
      return null
    } finally {
      envKeyPromise = null
    }
  })()
  return envKeyPromise
}

/** Drop the cached `~/.hermes/.env` result so the next resolve re-reads from disk. */
export function clearHermesEnvKeyCache(): void {
  envKeyCache = undefined
  envKeyPromise = null
}

async function resolveHermesAuthStatusInternal(
  uiStored: string | undefined,
  apiBaseUrl?: string
): Promise<HermesResolvedAuthStatus> {
  const direct = effectiveHermesBearerKey(uiStored)
  if (direct) {
    return {
      mode: 'ui_key',
      bearer: direct,
      label: 'Bearer from Hermes API key field',
      detail: 'Orca will send Authorization using the exact key saved in Integrations → Hermes API.',
    }
  }

  if (urlHostIsZaiApi(apiBaseUrl)) {
    const { resolveApiKey } = await import('../llmCredentials')
    const { useSettingsStore } = await import('../../store/settingsStore')
    const zaiUi = useSettingsStore.getState().getProviderConfig('zai').apiKey
    const k = await resolveApiKey('zai', zaiUi)
    const out = effectiveHermesBearerKey(k)
    if (out) {
      return {
        mode: 'zai_provider',
        bearer: out,
        label: 'Bearer from Z.AI provider settings',
        detail: 'Hermes key is empty, so Orca will reuse the Z.AI provider key for Coding Plan requests.',
      }
    }
    return {
      mode: 'zai_provider',
      bearer: undefined,
      label: 'No resolved Z.AI key',
      detail: 'Hermes key is empty and Orca could not resolve a Z.AI provider key, so no Authorization header will be sent.',
    }
  }

  const envKey = await readHermesEnvKeyOnce()
  if (envKey) {
    return {
      mode: 'env_hermes_dotenv',
      bearer: envKey,
      label: 'Bearer from ~/.hermes/.env',
      detail:
        'Hermes key field is empty, so Orca auto-read `API_SERVER_KEY` from `~/.hermes/.env`. Paste a value into Integrations → Hermes API key to override.',
    }
  }

  if (apiBaseUrl?.trim() && !urlLooksLikeLocalGateway(apiBaseUrl)) {
    return {
      mode: 'none_remote_host',
      bearer: undefined,
      label: 'No Bearer for remote host',
      detail:
        'Hermes key is empty, no `~/.hermes/.env` entry, and Orca does not auto-inject a secret for non-local, non-Z.AI hosts.',
    }
  }

  return {
    mode: 'none_local_gateway',
    bearer: undefined,
    label: 'No Bearer to local gateway',
    detail:
      'Hermes key is empty and no `API_SERVER_KEY` was found in `~/.hermes/.env`, so Orca will send no Authorization header (open local gateway).',
  }
}

export async function resolveHermesAuthStatusAsync(
  uiStored: string | undefined,
  apiBaseUrl?: string
): Promise<HermesResolvedAuthStatus> {
  const status = await resolveHermesAuthStatusInternal(uiStored, apiBaseUrl)
  hermesDebug.authResolution({
    path: status.mode,
    apiBaseUrl: apiBaseUrl ?? '',
    bearer: describeBearerForLog(status.bearer),
  })
  return status
}

/**
 * Resolve a Bearer token the same way the chat client does:
 *   UI key > Z.AI provider > `~/.hermes/.env` (Tauri) > none
 */
export async function resolveEffectiveHermesBearerKeyAsync(
  uiStored: string | undefined,
  apiBaseUrl?: string
): Promise<string | undefined> {
  const status = await resolveHermesAuthStatusAsync(uiStored, apiBaseUrl)
  return status.bearer
}

/** Normalize persisted / tool / user input before saving to settings. */
export function sanitizeHermesApiKeyForStorage(raw: unknown): string {
  if (raw == null) return ''
  const t = String(raw).trim()
  if (!t) return ''
  const lower = t.toLowerCase()
  if (lower === 'null' || lower === 'undefined') return ''
  return t
}

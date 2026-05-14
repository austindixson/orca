import {
  OPENROUTER_DEFAULT_BASE,
  OPENAI_CODEX_DEFAULT_BASE,
  XAI_DEFAULT_BASE,
  ZAI_DEFAULT_BASE,
  migrateZaiBaseUrlToCoding,
  LLAMACPP_DEFAULT_BASE,
  MISTRAL_DEFAULT_BASE,
  GITHUB_COPILOT_DEFAULT_BASE,
  GOOGLE_VERTEX_OPENAI_DEFAULT_BASE,
  type Provider,
} from '../store/settingsStore'

export * from './piProviderCatalog'

import { providerToTauriCredentialId } from './piProviderCatalog'

function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window || '__TAURI_IPC__' in window)
  )
}

function emitDebugLog(
  runId: string,
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  fetch('http://127.0.0.1:7696/ingest/d871edbc-ff39-4d74-96b8-887cea450cfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'eaa681' },
    body: JSON.stringify({
      sessionId: 'eaa681',
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}

/** Vite dev-only: prefixed with VITE_. Z.AI: ZAI_API_KEY first (official Python SDK), then Hermes/OpenClaw aliases. */
const VITE_API_KEY_NAMES: Record<Provider, readonly string[]> = {
  openai: ['OPENAI_API_KEY'],
  openaiCodex: [],
  /** Pi / Claude Max OAuth bearer — same precedence as Pi's `env-api-keys` (before plain API key). */
  anthropic: ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  /** Pi `env-api-keys.ts` uses `GEMINI_API_KEY` for `google`; we also accept `GOOGLE_API_KEY`. */
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  xai: ['XAI_API_KEY'],
  zai: ['ZAI_API_KEY', 'ZHIPU_API_KEY', 'GLM_API_KEY'],
  ollama: [],
  llamacpp: [],
  mistral: ['MISTRAL_API_KEY'],
  azureOpenai: ['AZURE_OPENAI_API_KEY'],
  githubCopilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
  googleVertex: ['GOOGLE_CLOUD_ACCESS_TOKEN', 'GOOGLE_API_KEY'],
  bedrock: ['AWS_ACCESS_KEY_ID'],
  hermes: ['API_SERVER_KEY', 'HERMES_API_KEY'],
}

const VITE_BASE_URL_NAMES: Record<Provider, readonly string[]> = {
  openai: ['OPENAI_BASE_URL'],
  openaiCodex: ['OPENAI_CODEX_BASE_URL'],
  anthropic: ['ANTHROPIC_BASE_URL'],
  google: ['GOOGLE_GENAI_BASE_URL', 'GEMINI_BASE_URL'],
  openrouter: ['OPENROUTER_BASE_URL'],
  xai: ['XAI_BASE_URL'],
  // Prefer explicit coding endpoint; Hermes often sets ZAI_BASE_URL to general PaaS — migrate in normalizeZaiBaseUrl.
  zai: ['ZAI_CODING_BASE_URL', 'ZAI_BASE_URL', 'ZHIPU_BASE_URL', 'GLM_BASE_URL'],
  ollama: ['OLLAMA_HOST', 'OLLAMA_BASE_URL'],
  llamacpp: ['LLAMACPP_HOST', 'LLAMACPP_BASE_URL', 'LLAMA_SERVER_URL'],
  mistral: ['MISTRAL_BASE_URL'],
  azureOpenai: ['AZURE_OPENAI_ENDPOINT'],
  githubCopilot: ['GITHUB_COPILOT_HOST'],
  googleVertex: ['VERTEX_AI_BASE_URL', 'GOOGLE_VERTEX_BASE_URL'],
  bedrock: ['AWS_REGION'],
  hermes: ['HERMES_API_BASE_URL'],
}

function viteEnv(name: string): string | undefined {
  if (typeof import.meta === 'undefined') return undefined
  const env = import.meta.env
  if (!env) return undefined
  const v = env[`VITE_${name}` as keyof ImportMetaEnv]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** Normalize Z.AI base URL — migrate general `/api/paas/v4` → Coding Plan when applicable. */
function normalizeZaiBaseUrl(url: string): string {
  return migrateZaiBaseUrlToCoding(url)
}

/** Anthropic Console / API billing keys (`sk-ant-api…`). */
function isAnthropicClassicApiKey(s: string): boolean {
  return s.startsWith('sk-ant-api')
}

/**
 * Resolve API key:
 * 1) Settings UI (explicit per-provider override), with an Anthropic + desktop exception so Pi
 *    OAuth is not overridden by a stale non-API value in the key field.
 * 2) Tauri shell env/files (`~/.pi/agent/auth.json`, `~/.hermes/.env`, …)
 * 3) Vite `VITE_*` env values
 */
export async function resolveApiKey(
  provider: Provider,
  uiStored?: string
): Promise<string | undefined> {
  const runId = 'oauth-claude-auth-flow'
  const ui = uiStored?.trim() ?? ''

  if (provider === 'hermes') {
    const { resolveEffectiveHermesBearerKeyAsync } = await import('../lib/hermes/hermesApiKey')
    const { useSettingsStore } = await import('../store/settingsStore')
    const combined = ui || useSettingsStore.getState().hermesApiKey?.trim() || ''
    const fromHermes = await resolveEffectiveHermesBearerKeyAsync(combined)
    if (fromHermes) return fromHermes
    for (const name of VITE_API_KEY_NAMES.hermes) {
      const v = viteEnv(name)
      if (v) return v
    }
    return undefined
  }

  if (provider === 'anthropic' && isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const fromShell = await invoke<string | null>('resolve_llm_api_key', {
      provider: providerToTauriCredentialId(provider),
    })
    const shell = fromShell?.trim() ?? ''
    // #region agent log
    emitDebugLog(runId, 'H1', 'llmCredentials.ts:116', 'Anthropic credential candidates evaluated', {
      provider,
      uiPresent: ui.length > 0,
      uiLooksLikeClassicApiKey: isAnthropicClassicApiKey(ui),
      shellPresent: shell.length > 0,
      shellLength: shell.length,
    })
    // #endregion

    // Explicit Console API key in Settings — user chose API-key billing; always wins.
    if (ui && isAnthropicClassicApiKey(ui)) {
      // #region agent log
      emitDebugLog(runId, 'H1', 'llmCredentials.ts:126', 'Anthropic credential source selected', {
        source: 'uiClassicApiKey',
      })
      // #endregion
      return ui
    }

    // `resolve_llm_api_key` returns refreshed OAuth from `auth.json` or env. Prefer it over *any*
    // non-Console text in Settings (OAuth access tokens are not always `sk-ant-oat…`; matching only
    // that prefix left stale UI keys winning over valid OAuth).
    if (shell) {
      // #region agent log
      emitDebugLog(runId, 'H1', 'llmCredentials.ts:134', 'Anthropic credential source selected', {
        source: 'piShellOrOauth',
      })
      // #endregion
      return shell
    }

    if (ui) {
      // #region agent log
      emitDebugLog(runId, 'H1', 'llmCredentials.ts:142', 'Anthropic credential source selected', {
        source: 'uiFallbackNonClassic',
      })
      // #endregion
      return ui
    }
  } else if ((provider === 'openai' || provider === 'openaiCodex') && isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const fromShell = await invoke<string | null>('resolve_llm_api_key', {
      provider: providerToTauriCredentialId(provider),
    })
    const shell = fromShell?.trim() ?? ''
    if (provider === 'openaiCodex') {
      if (shell) return shell
      if (ui) return ui
    } else {
      const { useSettingsStore } = await import('../store/settingsStore')
      const authMode = useSettingsStore.getState().providers.openai.authMode ?? 'oauth'
      const codexOnly = await hasOpenAiCodexOAuthOnly()

      if (authMode === 'apiKey') {
        if (ui) return ui
        if (shell && !codexOnly) return shell
      } else {
        // Desktop OpenAI Auth / Codex OAuth should win over any stale restricted key saved in Settings.
        if (shell) {
          return shell
        }
        if (!codexOnly && ui) return ui
      }

      if (ui) return ui
    }
  } else {
    if (ui) return ui
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      const fromShell = await invoke<string | null>('resolve_llm_api_key', {
        provider: providerToTauriCredentialId(provider),
      })
      if (fromShell?.trim()) return fromShell.trim()
    }
  }

  for (const name of VITE_API_KEY_NAMES[provider]) {
    const v = viteEnv(name)
    if (v) return v
  }
  return undefined
}

/** Pi Mono `~/.pi/agent/auth.json` top-level keys (Orca can add OAuth via `piOauthLogin*`; refresh in Tauri). */
export type PiRegistryKeyStatus = { key: string; present: boolean }

export async function getPiOAuthRegistryStatus(): Promise<PiRegistryKeyStatus[] | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<PiRegistryKeyStatus[]>('pi_oauth_registry_status')
}

/**
 * True when the desktop only has ChatGPT/Codex OAuth (`openai-codex`) and no plain `openai`
 * API-key entry in Pi auth. Those sessions can browse/account-auth successfully but may not
 * carry OpenAI API `api.responses.write`, so Orca should avoid forcing `/v1/responses`.
 */
export async function hasOpenAiCodexOAuthOnly(): Promise<boolean> {
  const status = await getPiOAuthRegistryStatus()
  if (!status) return false
  const present = new Set(status.filter((item) => item.present).map((item) => item.key))
  return present.has('openai-codex') && !present.has('openai')
}

/** Browser + localhost OAuth (Pi-compatible `~/.pi/agent/auth.json`). Desktop only. */
export async function piOauthLoginAnthropic(): Promise<void> {
  if (!isTauri()) throw new Error('Anthropic OAuth requires the Orca desktop app.')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke<void>('pi_oauth_login_anthropic')
}

export async function piOauthLoginOpenaiCodex(): Promise<void> {
  if (!isTauri()) throw new Error('OpenAI Codex OAuth requires the Orca desktop app.')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke<void>('pi_oauth_login_openai_codex')
}

/** Google account OAuth for Pi’s Gemini CLI / Cloud Code Assist entry. */
export async function piOauthLoginGoogleGeminiCli(): Promise<void> {
  if (!isTauri()) throw new Error('Google Gemini CLI OAuth requires the Orca desktop app.')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke<void>('pi_oauth_login_google_gemini_cli')
}

/**
 * Optional base URL override.
 * Priority mirrors `resolveApiKey`: Settings UI first, then shell env/files, then Vite env.
 */
export async function resolveBaseUrl(
  provider: Provider,
  uiStored?: string
): Promise<string | undefined> {
  let resolved: string | undefined = uiStored?.trim()

  // Policy: OpenRouter uses app defaults unless user explicitly edits Settings.
  if (provider === 'openrouter') {
    return (resolved || OPENROUTER_DEFAULT_BASE).replace(/\/$/, '')
  }
  if (provider === 'xai') {
    return (resolved || XAI_DEFAULT_BASE).replace(/\/$/, '')
  }
  if (provider === 'zai') {
    let z = uiStored?.trim()
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      const fromShell = await invoke<string | null>('resolve_llm_base_url', {
        provider: providerToTauriCredentialId('zai'),
      })
      if (!z && fromShell?.trim()) z = fromShell.trim()
    }
    if (!z) {
      for (const name of VITE_BASE_URL_NAMES.zai) {
        const v = viteEnv(name)
        if (v) {
          z = v
          break
        }
      }
    }
    return normalizeZaiBaseUrl(z || ZAI_DEFAULT_BASE)
  }
  // llama.cpp local server — allow env override for port/host customization
  if (provider === 'llamacpp' && !resolved) {
    // Check env vars before falling back to default
    for (const name of VITE_BASE_URL_NAMES.llamacpp) {
      const v = viteEnv(name)
      if (v) return v.replace(/\/$/, '')
    }
    return LLAMACPP_DEFAULT_BASE
  }

  if (provider === 'mistral') {
    return (resolved || MISTRAL_DEFAULT_BASE).replace(/\/$/, '')
  }

  if (provider === 'openaiCodex') {
    return (resolved || OPENAI_CODEX_DEFAULT_BASE).replace(/\/$/, '')
  }

  if (provider === 'githubCopilot') {
    return (resolved || GITHUB_COPILOT_DEFAULT_BASE).replace(/\/$/, '')
  }

  if (provider === 'googleVertex') {
    return (resolved || GOOGLE_VERTEX_OPENAI_DEFAULT_BASE).replace(/\/$/, '')
  }

  if (provider === 'azureOpenai') {
    if (resolved?.trim()) return resolved.replace(/\/$/, '')
    return undefined
  }

  if (provider === 'bedrock') {
    if (resolved?.trim()) return resolved.trim()
    return 'us-east-1'
  }

  if (provider === 'hermes') {
    const { useSettingsStore, normalizeHermesApiBaseUrl, HERMES_API_DEFAULT_BASE } = await import(
      '../store/settingsStore'
    )
    const s = useSettingsStore.getState()
    const fromUi = resolved?.trim()
    const fromIntegrations = s.hermesApiBaseUrl?.trim()
    return normalizeHermesApiBaseUrl(fromUi || fromIntegrations || HERMES_API_DEFAULT_BASE)
  }

  // Pi `google.ts` uses @google/genai; orchestrator uses the OpenAI-compatible surface (see piProviderCatalog).
  const googleOpenAiCompatBase = 'https://generativelanguage.googleapis.com/v1beta/openai'

  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const fromShell = await invoke<string | null>('resolve_llm_base_url', {
      provider: providerToTauriCredentialId(provider),
    })
    if (!resolved && fromShell?.trim()) resolved = fromShell.trim()
  }
  if (!resolved) {
    for (const name of VITE_BASE_URL_NAMES[provider]) {
      const v = viteEnv(name)
      if (v) {
        resolved = v
        break
      }
    }
  }
  if (provider === 'google' && !resolved?.trim()) {
    resolved = googleOpenAiCompatBase
  }
  if (resolved) {
    resolved = resolved.replace(/\/$/, '')
  }
  return resolved
}

/**
 * Hermes / Z.AI tile debugging — structured console output, never full tokens (length + last 4 only).
 *
 * Enable (opt-in):
 * - `localStorage.setItem('orca.debug.hermes', '1')` then reload
 * - Build with `VITE_ORCA_DEBUG_HERMES=1` or `true`
 */

import { agentFetch, resolveAgentFetchUrl } from '../agentFetch'
import { recordTelemetry } from '../../store/unifiedTelemetryStore'

export const HERMES_DEBUG_STORAGE_KEY = 'orca.debug.hermes'

const PREFIX = '[Orca Hermes]'

export function isHermesDebugEnabled(): boolean {
  const vite = typeof import.meta !== 'undefined' ? import.meta.env : undefined
  if (vite?.VITE_ORCA_DEBUG_HERMES === '1' || vite?.VITE_ORCA_DEBUG_HERMES === 'true') {
    return true
  }
  if (typeof localStorage === 'undefined') return false
  try {
    const v = localStorage.getItem(HERMES_DEBUG_STORAGE_KEY)
    return v === '1' || v === 'true' || v === 'on'
  } catch {
    return false
  }
}

function readAuthorizationFromInit(init?: RequestInit): string {
  if (!init?.headers) return ''
  const h = init.headers
  if (typeof h === 'object' && 'get' in h && typeof (h as Headers).get === 'function') {
    return (h as Headers).get('Authorization')?.trim() ?? ''
  }
  if (Array.isArray(h)) {
    const row = h.find(([k]) => k.toLowerCase() === 'authorization')
    return row?.[1]?.trim() ?? ''
  }
  const rec = h as Record<string, string>
  return (rec.Authorization ?? rec.authorization ?? '').trim()
}

/** Safe summary for logs (length + last 4 chars). Never logs full tokens. */
export function describeBearerForLog(key: string | undefined): {
  present: boolean
  length: number
  preview: string
} {
  const t = typeof key === 'string' ? key.trim() : ''
  if (!t) return { present: false, length: 0, preview: '(no Bearer)' }
  const len = t.length
  const tail = len <= 4 ? '****' : `…${t.slice(-4)}`
  return { present: true, length: len, preview: `${len} chars, ends ${tail}` }
}

function log(level: 'log' | 'info' | 'warn', event: string, payload: Record<string, unknown>): void {
  if (!isHermesDebugEnabled()) return
  const line = { event, t: new Date().toISOString(), ...payload }
  console[level](PREFIX, line)
}

export const hermesDebug = {
  authResolution(payload: Record<string, unknown>): void {
    log('info', 'auth_resolution', payload)
  },

  probeStart(payload: Record<string, unknown>): void {
    log('info', 'probe_start', payload)
  },

  probeResult(payload: Record<string, unknown>): void {
    log('info', 'probe_result', payload)
  },

  chatStart(payload: Record<string, unknown>): void {
    log('info', 'chat_start', payload)
  },

  chatDone(payload: Record<string, unknown>): void {
    log('info', 'chat_done', payload)
  },

  chatError(payload: Record<string, unknown>): void {
    log('warn', 'chat_error', payload)
    try {
      const text = JSON.stringify(payload)
      recordTelemetry({
        category: 'error',
        source: 'hermes',
        level: 'error',
        title: 'Hermes chat_error',
        text: text.length > 16_000 ? `${text.slice(0, 16_000)}…` : text,
        payloadJson: text.length > 120_000 ? `${text.slice(0, 120_000)}…` : text,
      })
    } catch {
      /* ignore */
    }
  },

  tileLifecycle(payload: Record<string, unknown>): void {
    log('info', 'tile', payload)
  },

  fetchError(payload: Record<string, unknown>): void {
    log('warn', 'fetch_error', payload)
  },
}

/**
 * Logs logical + resolved URL (Vite proxy), method, then response status. Gated by {@link isHermesDebugEnabled}.
 */
export async function hermesInstrumentedFetch(
  traceId: string,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const resolvedUrl = resolveAgentFetchUrl(url)
  const authHeader = readAuthorizationFromInit(init)
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined
  const hasAuth = Boolean(bearerSecret)

  log('info', 'fetch', {
    traceId,
    method,
    logicalUrl: url,
    resolvedUrl,
    hasAuthorizationHeader: hasAuth,
    bearer: describeBearerForLog(bearerSecret),
  })

  try {
    const res = await agentFetch(url, init)
    log('info', 'fetch_response', {
      traceId,
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get('content-type') ?? '',
    })
    return res
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    hermesDebug.fetchError({ traceId, logicalUrl: url, resolvedUrl, error: msg.slice(0, 500) })
    throw e
  }
}

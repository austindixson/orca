/**
 * Shared URL normalization and safety checks for agent_browser / browser_* tools.
 * Kept separate from orchestrator executeTools so the Agent Browser tile can reuse the same rules.
 */

import { useCanvasStore } from '../../store/canvasStore'

function getLatestTerminalServeLocalUrlForRequestedPort(requestedPort: string): string | null {
  let latestUrl: string | null = null
  let latestTs = -1
  for (const t of useCanvasStore.getState().tiles.values()) {
    if (t.type !== 'terminal') continue
    const meta = (t.meta ?? {}) as Record<string, unknown>
    const url = typeof meta.lastServeLocalUrl === 'string' ? meta.lastServeLocalUrl.trim() : ''
    const requested = typeof meta.lastServeRequestedPort === 'string' ? meta.lastServeRequestedPort : ''
    const ts = Number(meta.lastServeDetectedAt)
    if (!url || !requested || requested !== requestedPort || !Number.isFinite(ts)) continue
    if (ts > latestTs) {
      latestTs = ts
      latestUrl = url
    }
  }
  return latestUrl
}

/**
 * Deterministic localhost preview routing:
 * If a terminal requested localhost:<port> but actually bound another localhost
 * port, force browser updates for that requested port to the live bound URL.
 */
export function coerceBrowserLocalUrlToLatestTerminal(url: string): string {
  const raw = url.trim()
  if (!raw) return raw
  const normalizeLoopbackHost = (host: string) =>
    host.toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1')
  let parsedIncoming: URL
  try {
    parsedIncoming = new URL(raw)
  } catch {
    return raw
  }
  const incomingHost = normalizeLoopbackHost(parsedIncoming.hostname)
  if (incomingHost !== 'localhost' && incomingHost !== '127.0.0.1' && incomingHost !== '::1') {
    return raw
  }
  const incomingPort = parsedIncoming.port || (parsedIncoming.protocol === 'https:' ? '443' : '80')
  const latest = getLatestTerminalServeLocalUrlForRequestedPort(incomingPort)
  if (!latest) return raw
  try {
    const parsedLatest = new URL(latest)
    const latestHost = normalizeLoopbackHost(parsedLatest.hostname)
    if (latestHost !== 'localhost' && latestHost !== '127.0.0.1' && latestHost !== '::1') {
      return raw
    }
    const latestPort = parsedLatest.port || (parsedLatest.protocol === 'https:' ? '443' : '80')
    if (incomingPort === latestPort) return raw
    parsedLatest.hostname = 'localhost'
    return parsedLatest.toString()
  } catch {
    return raw
  }
}

export function normalizeAndValidateAgentBrowserUrl(rawUrl: string): string {
  const requested = rawUrl.trim()
  const normalized = coerceBrowserLocalUrlToLatestTerminal(requested)
  if (!normalized) {
    throw new Error('Agent browser URL cannot be empty')
  }
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('Agent browser URL must be a valid absolute URL (http/https)')
  }
  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Agent browser URL must use http:// or https:// (file:// is not supported)')
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'example.com' || host.endsWith('.example.com')) {
    throw new Error('Agent browser URL cannot be example.com (placeholder)')
  }
  if (host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    throw new Error('Use http://localhost:<port> for local previews (not 127.0.0.1/::1)')
  }
  const isLoopbackHost = host === 'localhost'
  if (isLoopbackHost && typeof window !== 'undefined') {
    const appUrl = (() => {
      try {
        return new URL(window.location.href)
      } catch {
        return null
      }
    })()
    if (appUrl) {
      const appHost = appUrl.hostname.toLowerCase().replace(/\.$/, '')
      const appIsLoopback =
        appHost === 'localhost' || appHost === '127.0.0.1' || appHost === '::1' || appHost === '[::1]'
      const incomingPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
      const appPort = appUrl.port || (appUrl.protocol === 'https:' ? '443' : '80')
      if (appIsLoopback && incomingPort === appPort) {
        throw new Error(
          `Agent browser URL points at Orca's own app origin (port ${appPort}). Choose a different preview port via find_available_port and run your project dev server there.`
        )
      }
    }
  }
  return normalized
}

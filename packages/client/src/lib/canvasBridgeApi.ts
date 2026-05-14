/**
 * HTTP helpers for the companion canvas bridge (`packages/server`, default :3001).
 * In Vite dev, `/api/*` is proxied to the bridge; in Tauri production builds, call 127.0.0.1:3001.
 */

export function getCanvasBridgeHttpOrigin(): string {
  if (import.meta.env.DEV) return ''
  return 'http://127.0.0.1:3001'
}

/** Same Authorization rule as POST /api/canvas/execute when CANVAS_BRIDGE_TOKEN is set on the server. */
export function getCanvasBridgeAuthHeaders(): Record<string, string> {
  const t = (import.meta.env.VITE_CANVAS_BRIDGE_TOKEN as string | undefined)?.trim()
  if (t) return { Authorization: `Bearer ${t}` }
  return {}
}

export interface CanvasBridgeStatus {
  uiClients: number
  tokenRequired: boolean
  /** Present when a recent `POST /api/canvas/execute` included `X-Orca-External-Agent` (e.g. hermes). */
  externalOrchestrator?: { id: string; lastSeenMs: number } | null
}

export async function fetchCanvasBridgeStatus(): Promise<CanvasBridgeStatus> {
  const base = getCanvasBridgeHttpOrigin()
  const url = `${base}/api/canvas/bridge-status`
  const res = await fetch(url, { headers: getCanvasBridgeAuthHeaders() })
  if (!res.ok) {
    throw new Error(`bridge-status ${res.status}`)
  }
  return res.json() as Promise<CanvasBridgeStatus>
}

export async function fetchOrcaHealth(): Promise<{ status?: string }> {
  const base = getCanvasBridgeHttpOrigin()
  const res = await fetch(`${base}/api/health`, { headers: getCanvasBridgeAuthHeaders() })
  if (!res.ok) throw new Error(`health ${res.status}`)
  return res.json() as Promise<{ status?: string }>
}

export interface OrcaGatewayStatus {
  telegram: { running: boolean }
  uiClients: number
}

export async function fetchOrcaGatewayStatus(): Promise<OrcaGatewayStatus> {
  const base = getCanvasBridgeHttpOrigin()
  const res = await fetch(`${base}/api/gateway/status`, { headers: getCanvasBridgeAuthHeaders() })
  if (!res.ok) throw new Error(`gateway status ${res.status}`)
  return res.json() as Promise<OrcaGatewayStatus>
}

/** POST /api/gateway/telegram/start — token optional; server uses ORCA_TELEGRAM_BOT_TOKEN when body token is empty. */
export type StartOrcaTelegramGatewayResult = {
  ok: boolean
  skipped?: boolean
  message?: string
  telegram: { running: boolean }
}

export async function startOrcaNativeTelegramGateway(body: {
  token?: string
  allowedUserIds?: number[]
}): Promise<StartOrcaTelegramGatewayResult> {
  const base = getCanvasBridgeHttpOrigin()
  const res = await fetch(`${base}/api/gateway/telegram/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getCanvasBridgeAuthHeaders() },
    body: JSON.stringify({
      token: body.token ?? '',
      ...(body.allowedUserIds?.length ? { allowedUserIds: body.allowedUserIds } : {}),
    }),
  })
  const j = (await res.json().catch(() => ({}))) as StartOrcaTelegramGatewayResult & { error?: string }
  if (!res.ok) {
    throw new Error(j.error || `start gateway ${res.status}`)
  }
  return j
}

export async function stopOrcaNativeTelegramGateway(): Promise<void> {
  const base = getCanvasBridgeHttpOrigin()
  const res = await fetch(`${base}/api/gateway/telegram/stop`, {
    method: 'POST',
    headers: getCanvasBridgeAuthHeaders(),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `stop gateway ${res.status}`)
  }
}

/** POST /api/gateway/telegram/bot-info — resolves bot username via getMe; `openUrl` is safe for QR (no token). */
export type TelegramBotInfoResult = {
  ok: boolean
  username?: string
  openUrl?: string
  error?: string
}

export async function fetchTelegramBotInfo(body: { token?: string }): Promise<TelegramBotInfoResult> {
  const base = getCanvasBridgeHttpOrigin()
  const res = await fetch(`${base}/api/gateway/telegram/bot-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getCanvasBridgeAuthHeaders() },
    body: JSON.stringify({ token: body.token ?? '' }),
  })
  const j = (await res.json().catch(() => ({}))) as TelegramBotInfoResult
  return j
}

export function canvasBridgeEndpoints(origin: string) {
  const o = origin.replace(/\/$/, '')
  return {
    health: `${o}/api/health`,
    bridgeStatus: `${o}/api/canvas/bridge-status`,
    tools: `${o}/api/canvas/tools`,
    execute: `${o}/api/canvas/execute`,
    ws: o.replace(/^http/, 'ws') + '/ws',
  }
}

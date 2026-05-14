/**
 * Client for the Node dev telemetry API (`packages/server`, default PORT=3002 via `npm run dev:telemetry:node`).
 * In Vite dev, `/api/dev/telemetry` is proxied to 3002; other `/api` routes go to the Rust server on 3001.
 * In Tauri / static builds, set `VITE_DEV_TELEMETRY_URL` or rely on default `http://127.0.0.1:3002`.
 */

export interface DevTelemetryEvent {
  id: string
  ts: string
  kind: string
  sessionId?: string
  runId?: string
  source?: string
  level?: 'debug' | 'info' | 'warn' | 'error'
  provider?: string
  model?: string
  payload: Record<string, unknown>
}

export interface DevTelemetrySessionSummary {
  sessionId: string
  firstTs: string
  lastTs: string
  eventCount: number
  lastKind?: string
  lastSource?: string
}

export function getTelemetryApiRoot(): string {
  try {
    const custom = sessionStorage.getItem('devTelemetry.apiRoot')?.trim()
    if (custom) return custom.replace(/\/$/, '')
  } catch {
    /* private mode */
  }
  const env = import.meta.env?.VITE_DEV_TELEMETRY_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  if (import.meta.env?.DEV) return ''
  return 'http://127.0.0.1:3002'
}

function apiPath(path: string): string {
  const root = getTelemetryApiRoot()
  const p = path.startsWith('/') ? path : `/${path}`
  return root ? `${root}${p}` : p
}

export async function fetchTelemetryHealth(): Promise<{ ok: boolean; stats?: Record<string, unknown> }> {
  const res = await fetch(apiPath('/api/dev/telemetry/health'))
  if (!res.ok) throw new Error(`Health ${res.status}`)
  return res.json() as Promise<{ ok: boolean; stats?: Record<string, unknown> }>
}

export function getTelemetryToken(): string | null {
  try {
    return sessionStorage.getItem('devTelemetry.token')
  } catch {
    return null
  }
}

export async function fetchTelemetryEvents(params: {
  limit?: number
  since?: string
  until?: string
  sessionId?: string
  kind?: string
  source?: string
  provider?: string
  level?: string
  token?: string | null
}): Promise<{ events: DevTelemetryEvent[]; stats?: Record<string, unknown> }> {
  const token = params.token ?? getTelemetryToken()
  const q = new URLSearchParams()
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.since) q.set('since', params.since)
  if (params.until) q.set('until', params.until)
  if (params.sessionId) q.set('sessionId', params.sessionId)
  if (params.kind) q.set('kind', params.kind)
  if (params.source) q.set('source', params.source)
  if (params.provider) q.set('provider', params.provider)
  if (params.level) q.set('level', params.level)
  if (token) q.set('token', token)
  const res = await fetch(`${apiPath('/api/dev/telemetry/events')}?${q}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) throw new Error(`Events ${res.status}`)
  return res.json() as Promise<{ events: DevTelemetryEvent[]; stats?: Record<string, unknown> }>
}

export async function fetchTelemetrySessions(token?: string | null): Promise<{ sessions: DevTelemetrySessionSummary[] }> {
  const t = token ?? getTelemetryToken()
  const q = t ? `?token=${encodeURIComponent(t)}` : ''
  const res = await fetch(`${apiPath('/api/dev/telemetry/sessions')}${q}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : undefined,
  })
  if (!res.ok) throw new Error(`Sessions ${res.status}`)
  return res.json() as Promise<{ sessions: DevTelemetrySessionSummary[] }>
}

export async function clearTelemetryEvents(token?: string | null): Promise<void> {
  const t = token ?? getTelemetryToken()
  const res = await fetch(apiPath('/api/dev/telemetry/events'), {
    method: 'DELETE',
    headers: t ? { Authorization: `Bearer ${t}` } : undefined,
  })
  if (!res.ok) throw new Error(`Clear ${res.status}`)
}

export async function ingestTelemetryEvents(
  events: Array<Record<string, unknown>>,
  token?: string | null
): Promise<{ ok: boolean; count?: number }> {
  const t = token ?? getTelemetryToken()
  const res = await fetch(apiPath('/api/dev/telemetry/events'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: JSON.stringify({ events }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `Ingest ${res.status}`)
  }
  return res.json() as Promise<{ ok: boolean; count?: number }>
}

export function openTelemetryEventStream(opts?: { token?: string | null }): EventSource {
  const token = opts?.token ?? getTelemetryToken()
  const q = token ? `?token=${encodeURIComponent(token)}` : ''
  return new EventSource(`${apiPath('/api/dev/telemetry/stream')}${q}`)
}

function telemetryExportQuery(params: {
  since?: string
  until?: string
  sessionId?: string
  token?: string | null
}): string {
  const token = params.token ?? getTelemetryToken()
  const q = new URLSearchParams()
  if (params.since) q.set('since', params.since)
  if (params.until) q.set('until', params.until)
  if (params.sessionId) q.set('sessionId', params.sessionId)
  if (token) q.set('token', token)
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

/** Browser download: flat CSV (optional filters). */
export async function downloadTelemetryCsvExport(params?: {
  since?: string
  until?: string
  sessionId?: string
  token?: string | null
  filename?: string
}): Promise<void> {
  const t = params?.token ?? getTelemetryToken()
  const qs = telemetryExportQuery({
    since: params?.since,
    until: params?.until,
    sessionId: params?.sessionId,
    token: t,
  })
  const res = await fetch(`${apiPath('/api/dev/telemetry/export.csv')}${qs}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : undefined,
  })
  if (!res.ok) throw new Error(`Export CSV ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = params?.filename ?? 'telemetry-export.csv'
    a.rel = 'noopener'
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Browser download: ZIP with one CSV per session (optional time range). */
export async function downloadTelemetryZipBySession(params?: {
  since?: string
  until?: string
  token?: string | null
  filename?: string
}): Promise<void> {
  const t = params?.token ?? getTelemetryToken()
  const qs = telemetryExportQuery({
    since: params?.since,
    until: params?.until,
    token: t,
  })
  const res = await fetch(`${apiPath('/api/dev/telemetry/export/by-session.zip')}${qs}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : undefined,
  })
  if (!res.ok) throw new Error(`Export ZIP ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = params?.filename ?? 'telemetry-by-session.zip'
    a.rel = 'noopener'
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

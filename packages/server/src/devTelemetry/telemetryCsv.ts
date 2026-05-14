import type { DevTelemetryEvent } from './types.js'

export const TELEMETRY_CSV_HEADER =
  'id,ts,kind,session_id,run_id,source,level,provider,model,payload_json'

function escapeCsvCell(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function eventToCsvLine(ev: DevTelemetryEvent): string {
  const cells = [
    ev.id,
    ev.ts,
    ev.kind,
    ev.sessionId ?? '',
    ev.runId ?? '',
    ev.source ?? '',
    ev.level ?? '',
    ev.provider ?? '',
    ev.model ?? '',
    JSON.stringify(ev.payload ?? {}),
  ]
  return cells.map(escapeCsvCell).join(',')
}

/** Windows-friendly newlines for Excel. */
export function eventsToCsv(events: DevTelemetryEvent[]): string {
  const lines = [TELEMETRY_CSV_HEADER, ...events.map(eventToCsvLine)]
  return `${lines.join('\r\n')}\r\n`
}

export function safeZipEntryName(sessionId: string): string {
  const s = sessionId.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 180)
  return s || 'session'
}

/**
 * RFC 4180 CSV export for unified telemetry records (client-side download).
 */

import type { TelemetryRecord } from '../../store/unifiedTelemetryStore'

/** Escape a field per RFC 4180: wrap if needed, double internal quotes. */
export function toCsvField(value: string | undefined | null): string {
  const s = value == null ? '' : String(value)
  const needsQuote = /[",\r\n]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return needsQuote ? `"${escaped}"` : escaped
}

export function toCsvRow(cols: string[]): string {
  return cols.map(toCsvField).join(',')
}

const CSV_HEADER = toCsvRow([
  'ts_iso',
  'category',
  'source',
  'level',
  'tile_id',
  'session_id',
  'provider',
  'model',
  'title',
  'text',
  'payload_json',
])

type ExportContext = {
  settingsJson?: string
}

function tsIso(ms: number): string {
  try {
    return new Date(ms).toISOString()
  } catch {
    return ''
  }
}

export function recordsToCsvString(records: TelemetryRecord[], context?: ExportContext): string {
  const lines = [CSV_HEADER]
  if (context?.settingsJson) {
    lines.push(
      toCsvRow([
        tsIso(Date.now()),
        'log',
        'settings',
        'info',
        '',
        '',
        '',
        '',
        'settings_snapshot',
        'Settings snapshot at telemetry export',
        context.settingsJson,
      ])
    )
  }
  for (const r of records) {
    lines.push(
      toCsvRow([
        tsIso(r.tsMs),
        r.category,
        r.source,
        r.level ?? '',
        r.tileId ?? '',
        r.sessionId ?? '',
        r.provider ?? '',
        r.model ?? '',
        r.title ?? '',
        r.text,
        r.payloadJson ?? '',
      ])
    )
  }
  return lines.join('\r\n') + (lines.length > 1 ? '\r\n' : '')
}

function defaultFilename(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const min = pad(d.getMinutes())
  const sec = pad(d.getSeconds())
  return `orca-telemetry-${y}${m}${day}-${h}${min}${sec}.csv`
}

/**
 * Trigger browser download of unified telemetry as CSV (Tauri webview compatible).
 */
export function exportUnifiedTelemetryCsv(
  records: TelemetryRecord[],
  filename: string = defaultFilename(),
  context?: ExportContext
): void {
  const body = recordsToCsvString(records, context)
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200) || 'orca-telemetry.csv'
    a.rel = 'noopener'
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

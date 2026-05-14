/**
 * Aggregate metrics for dev telemetry CSV/ZIP exports (local troubleshooting baselines).
 */

export type TelemetryExportSummary = {
  generatedAt: string
  timeRange: { since?: string; until?: string }
  totals: {
    events: number
    distinctSessions: number
    unassignedSessionEvents: number
    unassignedSessionRatio: number
  }
  /** Top kinds by volume (sorted desc, capped). */
  countsByKind: Array<{ kind: string; count: number }>
  /** Top sources by volume (sorted desc, capped). */
  countsBySource: Array<{ source: string; count: number }>
  issueSignals: {
    terminalConnectionTimedOut: number
    terminalFailures: number
    terminalFailuresByKind: Array<{ kind: string; count: number }>
    stillWaiting: number
    rateLimitedOrQuota: number
    scriptError: number
    cancelledOrAborted: number
  }
}

export function buildExportSummaryFromRows(
  rows: Array<{
    kind: string
    session_id: string | null
    source: string | null
    payload_json: string
  }>,
  q: { since?: string; until?: string }
): TelemetryExportSummary {
  const kindMap = new Map<string, number>()
  const sourceMap = new Map<string, number>()
  let unassigned = 0
  let terminalT = 0
  let terminalFailures = 0
  let stillW = 0
  let rateL = 0
  let scriptE = 0
  let cancelA = 0
  const sessions = new Set<string>()
  const terminalFailureKinds = new Map<string, number>()

  for (const r of rows) {
    const k = r.kind || ''
    kindMap.set(k, (kindMap.get(k) ?? 0) + 1)
    const src = r.source ?? ''
    if (src) sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1)
    if (r.session_id) sessions.add(r.session_id)
    else unassigned += 1

    const p = r.payload_json ?? ''
    const parsed = parsePayloadJson(p)
    const terminalDiagnostic = getTerminalDiagnostic(parsed)
    if (terminalDiagnostic && terminalDiagnostic.severity !== 'warning') {
      terminalFailures += 1
      const kind = terminalDiagnostic.kind || 'generic'
      terminalFailureKinds.set(kind, (terminalFailureKinds.get(kind) ?? 0) + 1)
      if (kind === 'connect_timeout') {
        terminalT += 1
      }
    } else if (p.includes('Terminal connection timed out') || p.includes('[Terminal connection timed out]')) {
      terminalT += 1
    }
    if (p.includes('Still waiting')) stillW += 1
    if (
      p.includes('Rate limited') ||
      p.includes('quota exceeded') ||
      p.includes('API quota exceeded') ||
      /Retry\s+\d+\/\d+/i.test(p)
    ) {
      rateL += 1
    }
    if (p.includes('Script error')) scriptE += 1
    if (p.includes('[Cancelled]') || p.includes('Run failed: Aborted') || p.includes('Aborted')) {
      cancelA += 1
    }
  }

  const total = rows.length
  const byKind = [...kindMap.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40)
  const bySource = [...sourceMap.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40)
  const byTerminalFailureKind = [...terminalFailureKinds.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  return {
    generatedAt: new Date().toISOString(),
    timeRange: { since: q.since, until: q.until },
    totals: {
      events: total,
      distinctSessions: sessions.size,
      unassignedSessionEvents: unassigned,
      unassignedSessionRatio: total > 0 ? Math.round((unassigned / total) * 10_000) / 10_000 : 0,
    },
    countsByKind: byKind,
    countsBySource: bySource,
    issueSignals: {
      terminalConnectionTimedOut: terminalT,
      terminalFailures,
      terminalFailuresByKind: byTerminalFailureKind,
      stillWaiting: stillW,
      rateLimitedOrQuota: rateL,
      scriptError: scriptE,
      cancelledOrAborted: cancelA,
    },
  }
}

function parsePayloadJson(payloadJson: string): Record<string, unknown> | null {
  if (!payloadJson) return null
  try {
    const parsed = JSON.parse(payloadJson) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function getTerminalDiagnostic(
  payload: Record<string, unknown> | null
): { kind?: string; severity?: string } | null {
  if (!payload) return null
  const direct = payload.terminalDiagnostic
  if (direct && typeof direct === 'object') {
    return direct as { kind?: string; severity?: string }
  }
  const nestedPayloadJson = payload.payloadJson
  if (typeof nestedPayloadJson === 'string') {
    try {
      const nested = JSON.parse(nestedPayloadJson) as unknown
      if (nested && typeof nested === 'object' && 'terminalDiagnostic' in nested) {
        const diag = (nested as { terminalDiagnostic?: unknown }).terminalDiagnostic
        if (diag && typeof diag === 'object') {
          return diag as { kind?: string; severity?: string }
        }
      }
    } catch {
      return null
    }
  }
  return null
}

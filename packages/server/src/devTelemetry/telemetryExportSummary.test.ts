import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExportSummaryFromRows } from './telemetryExportSummary.js'

describe('telemetryExportSummary', () => {
  test('aggregates issue signals and unassigned ratio', () => {
    const rows = [
      {
        kind: 'output',
        session_id: 's1',
        source: 'terminal',
        payload_json: JSON.stringify({ text: '[Terminal connection timed out]' }),
      },
      {
        kind: 'log',
        session_id: null,
        source: 'orchestrator_ui',
        payload_json: JSON.stringify({ line: '[30s] Still waiting — hint' }),
      },
      {
        kind: 'log',
        session_id: null,
        source: 'orchestrator',
        payload_json: JSON.stringify({
          line: '[Rate limited on Z.AI] Retry 1/8 in 3s — API quota exceeded',
        }),
      },
    ]
    const s = buildExportSummaryFromRows(rows, {})
    assert.equal(s.totals.events, 3)
    assert.equal(s.totals.unassignedSessionEvents, 2)
    assert.ok(s.totals.unassignedSessionRatio > 0.5)
    assert.equal(s.issueSignals.terminalConnectionTimedOut, 1)
    assert.equal(s.issueSignals.terminalFailures, 0)
    assert.equal(s.issueSignals.stillWaiting, 1)
    assert.equal(s.issueSignals.rateLimitedOrQuota, 1)
  })

  test('counts structured terminal failure kinds from payloads', () => {
    const rows = [
      {
        kind: 'error',
        session_id: 's1',
        source: 'terminal',
        payload_json: JSON.stringify({
          terminalDiagnostic: {
            severity: 'error',
            kind: 'dependency_missing',
          },
        }),
      },
      {
        kind: 'error',
        session_id: 's1',
        source: 'terminal',
        payload_json: JSON.stringify({
          text: 'failed line',
          payloadJson: JSON.stringify({
            terminalDiagnostic: {
              severity: 'error',
              kind: 'package_resolve',
            },
          }),
        }),
      },
      {
        kind: 'log',
        session_id: 's1',
        source: 'terminal',
        payload_json: JSON.stringify({
          terminalDiagnostic: {
            severity: 'warning',
            kind: 'websocket_disconnect',
          },
        }),
      },
    ]
    const s = buildExportSummaryFromRows(rows, {})
    assert.equal(s.issueSignals.terminalFailures, 2)
    assert.deepEqual(s.issueSignals.terminalFailuresByKind, [
      { kind: 'dependency_missing', count: 1 },
      { kind: 'package_resolve', count: 1 },
    ])
  })
})

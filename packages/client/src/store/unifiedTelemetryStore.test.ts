import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  UNIFIED_TELEMETRY_MAX,
  clearUnifiedTelemetry,
  recordTelemetry,
  useUnifiedTelemetryStore,
} from './unifiedTelemetryStore'

describe('unifiedTelemetryStore', () => {
  beforeEach(() => {
    clearUnifiedTelemetry()
  })

  it('recordTelemetry appends and respects ring capacity', () => {
    const extra = 50
    for (let i = 0; i < UNIFIED_TELEMETRY_MAX + extra; i++) {
      recordTelemetry({
        category: 'log',
        source: 'console',
        text: `line-${i}`,
      })
    }
    const { records } = useUnifiedTelemetryStore.getState()
    assert.equal(records.length, UNIFIED_TELEMETRY_MAX)
    assert.ok(records[records.length - 1]!.text.includes(`line-${UNIFIED_TELEMETRY_MAX + extra - 1}`))
    assert.ok(records[0]!.text.includes(`line-${extra}`))
  })

  it('recordTelemetry accepts explicit id and category', () => {
    const r = recordTelemetry({
      id: 'fixed-id',
      category: 'trace',
      source: 'orchestrator',
      text: 't',
    })
    assert.equal(r.id, 'fixed-id')
    assert.equal(r.category, 'trace')
  })
})

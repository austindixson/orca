import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toCsvField, toCsvRow, recordsToCsvString } from './exportUnifiedTelemetryCsv'
import type { TelemetryRecord } from '../../store/unifiedTelemetryStore'

describe('exportUnifiedTelemetryCsv', () => {
  it('toCsvField quotes commas and newlines', () => {
    assert.equal(toCsvField('a,b'), '"a,b"')
    assert.equal(toCsvField('line1\nline2'), '"line1\nline2"')
    assert.equal(toCsvField('plain'), 'plain')
  })

  it('toCsvField escapes embedded double quotes (RFC 4180)', () => {
    assert.equal(toCsvField('say "hello"'), '"say ""hello"""')
  })

  it('toCsvRow joins fields', () => {
    assert.equal(toCsvRow(['a', 'b,c']), 'a,"b,c"')
  })

  it('recordsToCsvString includes header and rows', () => {
    const rec: TelemetryRecord = {
      id: '1',
      tsMs: 0,
      category: 'error',
      source: 'window',
      text: 'x',
    }
    const csv = recordsToCsvString([rec])
    assert.ok(csv.includes('ts_iso'))
    assert.ok(csv.includes('error'))
    assert.ok(csv.includes('window'))
    assert.ok(csv.includes('x'))
  })

  it('recordsToCsvString includes settings snapshot row when provided', () => {
    const csv = recordsToCsvString([], { settingsJson: '{"selectedModel":"zai:GLM-4.7"}' })
    assert.ok(csv.includes('settings_snapshot'))
    assert.ok(csv.includes('Settings snapshot at telemetry export'))
    // RFC 4180: JSON in field is wrapped and internal " → ""
    assert.ok(csv.includes('"{""selectedModel"":""zai:GLM-4.7""}"'))
  })
})

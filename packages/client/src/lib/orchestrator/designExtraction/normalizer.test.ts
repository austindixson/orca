import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeAndParseJson, repairDesignExtractionShape } from './normalizer'

describe('designExtraction/normalizer', () => {
  it('parses fenced JSON', () => {
    const raw = '```json\n{"version":1,"mode":"full","rationale":"ok","data":{}}\n```'
    const out = normalizeAndParseJson(raw)

    assert.notEqual(out.parsed, null)
    assert.equal(out.didRepair, true)
  })

  it('repairs loose JSON syntax', () => {
    const raw = "note: {version: 1, mode: 'scoped', rationale: 'r', data: {scope: 'weather_season', weather: 'snow', season: 'winter', preserve: ['subject'],},}"
    const out = normalizeAndParseJson(raw)

    assert.notEqual(out.parsed, null)
    assert.equal(typeof out.normalizedText, 'string')
    assert.ok(out.normalizedText.includes('"mode": "scoped"'))
  })

  it('repairs non-canonical shape for full mode', () => {
    const repaired = repairDesignExtractionShape(
      {
        overallDescription: 'x',
        visualStyle: ['x'],
        colorPalette: ['x'],
        composition: 'x',
        lighting: 'x',
        cameraAngle: 'x',
        perspective: 'x',
        weather: 'x',
        season: 'x',
        keyElements: ['x'],
        negativeConstraints: [],
      },
      { mode: 'full' }
    ) as Record<string, unknown>

    assert.equal(repaired.mode, 'full')
    assert.equal(repaired.version, 1)
    assert.equal(typeof repaired.rationale, 'string')
  })

  it('repairs non-canonical shape for scoped mode', () => {
    const repaired = repairDesignExtractionShape(
      {
        weather: 'rain',
        season: 'spring',
        preserve: ['subject'],
      },
      { mode: 'scoped', scope: 'weather_season' }
    ) as Record<string, unknown>

    const data = repaired.data as Record<string, unknown>
    assert.equal(repaired.mode, 'scoped')
    assert.equal(data.scope, 'weather_season')
    assert.equal(data.weather, 'rain')
  })
})

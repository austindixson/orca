import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateDesignExtractionResponse, assertDesignExtractionResponse } from './schema'

describe('designExtraction/schema', () => {
  it('validates full extraction payload', () => {
    const payload = {
      version: 1,
      mode: 'full',
      rationale: 'Captured all major visual attributes.',
      data: {
        overallDescription: 'Coastal house with warm morning light.',
        visualStyle: ['cinematic', 'realistic'],
        colorPalette: ['warm beige', 'muted blue'],
        composition: 'Rule of thirds framing with house on right.',
        lighting: 'Soft directional sunlight.',
        cameraAngle: 'Eye-level',
        perspective: 'Three-quarter',
        weather: 'Clear',
        season: 'Summer',
        keyElements: ['house', 'ocean', 'wood deck'],
        negativeConstraints: ['no people'],
      },
    }

    const result = validateDesignExtractionResponse(payload)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.mode, 'full')
    }
  })

  it('rejects unexpected keys in strict schema', () => {
    const payload = {
      version: 1,
      mode: 'full',
      rationale: 'x',
      data: {
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
        extra: true,
      },
      ignored: 'nope',
    }

    const result = validateDesignExtractionResponse(payload)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.path === '$.ignored'))
      assert.ok(result.issues.some((issue) => issue.path === 'data.extra'))
    }
  })

  it('validates scoped camera angle/perspective payload', () => {
    const payload = {
      version: 1,
      mode: 'scoped',
      rationale: 'Only camera framing should change.',
      data: {
        scope: 'camera_angle_perspective',
        cameraAngle: 'Low angle',
        perspective: 'Wide perspective',
        preserve: ['subject identity', 'weather'],
      },
    }

    const validated = assertDesignExtractionResponse(payload)
    assert.equal(validated.mode, 'scoped')
    assert.equal(validated.data.scope, 'camera_angle_perspective')
  })

  it('rejects invalid scoped payload', () => {
    assert.throws(
      () =>
        assertDesignExtractionResponse({
          version: 1,
          mode: 'scoped',
          rationale: 'x',
          data: {
            scope: 'weather_season',
            weather: '',
            season: 'winter',
            preserve: [],
          },
        }),
      /Invalid design extraction payload/
    )
  })
})

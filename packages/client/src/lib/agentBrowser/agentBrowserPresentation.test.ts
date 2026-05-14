import { describe, expect, it } from 'vitest'
import {
  clickFeedbackDurationMs,
  dwellBeforeClickMs,
  euclideanDistance,
  moveDurationMs,
  PRESENTATION_MAX_MOVE_MS,
  PRESENTATION_MIN_MOVE_MS,
} from './agentBrowserPresentation'

describe('agentBrowserPresentation', () => {
  it('euclideanDistance', () => {
    expect(euclideanDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(euclideanDistance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0)
  })

  it('moveDurationMs clamps and scales with distance', () => {
    const a = { x: 0, y: 0 }
    const same = moveDurationMs(a, a, { reducedMotion: false })
    expect(same).toBeGreaterThanOrEqual(PRESENTATION_MIN_MOVE_MS)
    expect(same).toBeLessThanOrEqual(PRESENTATION_MAX_MOVE_MS)

    const long = moveDurationMs({ x: 0, y: 0 }, { x: 10000, y: 0 }, { reducedMotion: false })
    expect(long).toBe(PRESENTATION_MAX_MOVE_MS)
  })

  it('moveDurationMs is 0 when reduced motion', () => {
    expect(
      moveDurationMs({ x: 0, y: 0 }, { x: 5000, y: 0 }, { reducedMotion: true })
    ).toBe(0)
  })

  it('dwell and click feedback respect reduced motion', () => {
    expect(dwellBeforeClickMs({ reducedMotion: true })).toBe(0)
    expect(clickFeedbackDurationMs({ reducedMotion: true })).toBe(120)
    expect(dwellBeforeClickMs({ reducedMotion: false })).toBeGreaterThan(0)
    expect(clickFeedbackDurationMs({ reducedMotion: false })).toBeGreaterThan(120)
  })
})

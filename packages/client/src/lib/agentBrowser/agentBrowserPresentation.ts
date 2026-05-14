/**
 * Pure timing helpers for agent browser “physical use” cursor presentation.
 * Move duration scales with pointer travel distance; click feedback is a fixed band.
 */

export interface Point2D {
  x: number
  y: number
}

export const PRESENTATION_MS_PER_PX = 0.22
export const PRESENTATION_BASE_MOVE_MS = 90
export const PRESENTATION_MIN_MOVE_MS = 140
export const PRESENTATION_MAX_MOVE_MS = 1400
export const PRESENTATION_DWELL_MS = 100
export const PRESENTATION_CLICK_FEEDBACK_MS = 720
export const PRESENTATION_DEFAULT_TRANSITION_MS = 160

/** Subtle default when distance is unknown (e.g. first show). */
export const PRESENTATION_AMBIGUOUS_MOVE_MS = 320

export function euclideanDistance(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * How long the cursor should take to move from `from` to `to` (device pixels).
 * Short hops stay snappy; long sweeps read as deliberate.
 */
export function moveDurationMs(
  from: Point2D,
  to: Point2D,
  options: { reducedMotion: boolean }
): number {
  if (options.reducedMotion) {
    return 0
  }
  const dist = euclideanDistance(from, to)
  if (!Number.isFinite(dist) || dist < 1) {
    return PRESENTATION_MIN_MOVE_MS
  }
  const raw = PRESENTATION_BASE_MOVE_MS + PRESENTATION_MS_PER_PX * dist
  return Math.round(Math.min(PRESENTATION_MAX_MOVE_MS, Math.max(PRESENTATION_MIN_MOVE_MS, raw)))
}

export function dwellBeforeClickMs(options: { reducedMotion: boolean }): number {
  return options.reducedMotion ? 0 : PRESENTATION_DWELL_MS
}

/** Length of post-click ripple / pulse animation (and hold isClicking visual). */
export function clickFeedbackDurationMs(options: { reducedMotion: boolean }): number {
  return options.reducedMotion ? 120 : PRESENTATION_CLICK_FEEDBACK_MS
}

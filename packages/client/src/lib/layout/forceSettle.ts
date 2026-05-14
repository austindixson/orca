import type { TileData } from '../../store/canvasStore'
import type { TileLayoutUpdate } from '../layoutPresets'

/**
 * Lightweight Verlet-style force settle for tile layouts.
 *
 * Why not d3-force? d3-force treats nodes as points with equal radii; tiles
 * are rectangles with wildly different aspect ratios. This implementation
 * computes the AABB minimum-translation vector between each pair of rects
 * (like the `repulsion.ts` cascade) and applies it as a velocity impulse
 * that decays over `iterations`. That gives the same "settle animation"
 * feel of d3-force while respecting real tile bounds.
 *
 * This is intended to run for a handful of frames after a multi-tile spawn
 * (e.g. a team fan-out) so sibling tiles drift apart smoothly instead of
 * snapping via the cascade. For single-spawn overlap cleanup, keep using
 * `resolveOverlapsAround` — it's cheaper and deterministic.
 *
 * Pure function: does not mutate the input map, returns the set of tile
 * position updates (same shape as `resolveOverlapsAround`). Does nothing
 * and returns an empty list when `strength <= 0`.
 *
 * @param tiles      Current tile map (world coords).
 * @param options.strength      Global multiplier for repulsion velocity
 *                              (0 = off, 1 = match `resolveOverlapsAround`).
 * @param options.iterations    How many relaxation steps to run.
 * @param options.padding       Minimum gap to enforce.
 * @param options.frozenIds     Tile ids that never move.
 * @param options.damping       Per-iteration velocity decay (0..1).
 */
export interface ForceSettleOptions {
  strength?: number
  iterations?: number
  padding?: number
  frozenIds?: Set<string>
  damping?: number
}

export function forceSettle(
  tiles: Map<string, TileData>,
  options: ForceSettleOptions = {}
): TileLayoutUpdate[] {
  const strength = options.strength ?? 1
  if (strength <= 0) return []
  const iterations = Math.max(1, options.iterations ?? 6)
  const pad = options.padding ?? 5
  const damping = Math.min(0.99, Math.max(0, options.damping ?? 0.72))
  const frozen = options.frozenIds ?? new Set<string>()

  type Working = { x: number; y: number; w: number; h: number; vx: number; vy: number }
  const work = new Map<string, Working>()
  const original = new Map<string, { x: number; y: number }>()
  for (const [id, t] of tiles) {
    work.set(id, { x: t.x, y: t.y, w: t.w, h: t.h, vx: 0, vy: 0 })
    original.set(id, { x: t.x, y: t.y })
  }

  const ids = Array.from(work.keys())

  for (let iter = 0; iter < iterations; iter++) {
    // Accumulate pair-wise repulsion impulses.
    for (let i = 0; i < ids.length; i++) {
      const aid = ids[i]
      const a = work.get(aid)!
      for (let j = i + 1; j < ids.length; j++) {
        const bid = ids[j]
        const b = work.get(bid)!
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox + pad <= 0 || oy + pad <= 0) continue
        // Separation along minimum-translation axis.
        const dx =
          a.x + a.w / 2 >= b.x + b.w / 2 ? ox + pad : -(ox + pad)
        const dy =
          a.y + a.h / 2 >= b.y + b.h / 2 ? oy + pad : -(oy + pad)
        const useX = Math.abs(ox) < Math.abs(oy)
        const ix = useX ? dx * 0.5 * strength : 0
        const iy = useX ? 0 : dy * 0.5 * strength

        if (!frozen.has(aid)) {
          a.vx += ix
          a.vy += iy
        }
        if (!frozen.has(bid)) {
          b.vx -= ix
          b.vy -= iy
        }
      }
    }

    // Integrate + damp.
    for (const [id, w] of work) {
      if (frozen.has(id)) {
        w.vx = 0
        w.vy = 0
        continue
      }
      w.x += w.vx
      w.y += w.vy
      w.vx *= damping
      w.vy *= damping
    }
  }

  const updates: TileLayoutUpdate[] = []
  for (const [id, w] of work) {
    const o = original.get(id)!
    if (Math.abs(w.x - o.x) < 0.5 && Math.abs(w.y - o.y) < 0.5) continue
    updates.push({ id, x: w.x, y: w.y, w: w.w, h: w.h })
  }
  return updates
}

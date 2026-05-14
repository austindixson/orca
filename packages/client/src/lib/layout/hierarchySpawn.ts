import type { TileData } from '../../store/canvasStore'

/**
 * Radial spawn helper for delegated sub-agents.
 *
 * Places a new tile on a radial arc around a parent tile at a stable index so
 * a lead's team members fan out in predictable directions instead of
 * colliding on the same spot. Does NOT perform overlap resolution — callers
 * should still pass the returned (x, y) through `findNonOverlappingPosition`
 * (or let `addTile` do so) before committing.
 *
 * The arc is in the half-plane to the **right** of the parent (from
 * `-Math.PI / 2` at the top, through `0` on the right, to `Math.PI / 2` at the
 * bottom) so children don't land on top of the orchestrator hub which is
 * typically to the left/above.
 *
 * @param parent       Parent tile whose center the arc is anchored on.
 * @param newW         Width of the child tile.
 * @param newH         Height of the child tile.
 * @param siblingIndex 0-based index of this child among its siblings of the
 *                     same parent. Children with the same index land in the
 *                     same spot (deterministic).
 * @param siblingCount Total number of siblings expected. When unknown,
 *                     defaults to `siblingIndex + 1`.
 * @param radius       Base radius from parent center (world units).
 */
export function hierarchySpawn(args: {
  parent: Pick<TileData, 'x' | 'y' | 'w' | 'h'>
  newW: number
  newH: number
  siblingIndex: number
  siblingCount?: number
  radius?: number
}): { x: number; y: number } {
  const { parent, newW, newH, siblingIndex } = args
  const siblingCount = Math.max(1, args.siblingCount ?? siblingIndex + 1)
  const baseRadius =
    args.radius ??
    Math.max(parent.w, parent.h) * 0.85 + Math.max(newW, newH) * 0.55

  const cx = parent.x + parent.w / 2
  const cy = parent.y + parent.h / 2

  const arcStart = -Math.PI / 2
  const arcEnd = Math.PI / 2
  const span = arcEnd - arcStart

  // Spread siblings evenly across the right half-plane, with a tiny
  // radial ring bump every 6 tiles so densely populated leads don't wrap
  // on top of each other.
  const ringStride = 6
  const ring = Math.floor(siblingIndex / ringStride)
  const inRingIdx = siblingIndex % ringStride
  const denom = Math.max(1, Math.min(siblingCount, ringStride))
  const theta = arcStart + ((inRingIdx + 0.5) / denom) * span
  const radius = baseRadius + ring * Math.max(newW, newH) * 0.6

  const tx = cx + Math.cos(theta) * radius - newW / 2
  const ty = cy + Math.sin(theta) * radius - newH / 2
  return { x: tx, y: ty }
}

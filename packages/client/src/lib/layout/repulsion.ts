import type { TileData } from '../../store/canvasStore'
import type { LayoutRect } from '../layoutPresets'
import type { TileLayoutUpdate } from '../layoutPresets'

export interface ResolveOptions {
  padding?: number
  cascade?: boolean
  maxIterations?: number
  frozenIds?: Set<string>
  viewport?: LayoutRect | null
}

/**
 * Minimum gap (px) enforced between any two tile edges. Tiles never stack or
 * touch — if they're within this distance, the repel pass pushes them apart.
 */
export const TILE_MIN_GAP = 5

/**
 * Maximum gap (px) the repel pass will leave between a pushed tile and the
 * tile that pushed it. Because `pushOverlapperFromAnchor` translates a mover
 * by exactly `overlap + padding`, the resulting gap on the push axis equals
 * `padding`. Keeping the default padding at `TILE_MIN_GAP` means every pushed
 * tile ends up within this cluster distance of at least one neighbor, which
 * preserves a tight, bird's-eye-readable layout.
 */
export const TILE_MAX_CLUSTER_GAP = 30

function overlaps(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  pad: number
): boolean {
  return ax < bx + bw + pad && ax + aw + pad > bx && ay < by + bh + pad && ay + ah + pad > by
}

type Rect = { x: number; y: number; w: number; h: number }

/**
 * Push tile `mover` away from `anchor` using minimum translation on the shallower overlap axis.
 */
function pushOverlapperFromAnchor(
  anchor: Rect,
  mover: Rect,
  pad: number,
  viewport: LayoutRect | null
): Rect {
  const ox = Math.min(anchor.x + anchor.w, mover.x + mover.w) - Math.max(anchor.x, mover.x)
  const oy = Math.min(anchor.y + anchor.h, mover.y + mover.h) - Math.max(anchor.y, mover.y)
  if (ox <= 0 || oy <= 0) return mover

  let nx = mover.x
  let ny = mover.y
  const sep = pad

  if (ox < oy) {
    const cxA = anchor.x + anchor.w / 2
    const cxB = mover.x + mover.w / 2
    const dir = cxB >= cxA ? 1 : -1
    nx = mover.x + dir * (ox + sep)
  } else {
    const cyA = anchor.y + anchor.h / 2
    const cyB = mover.y + mover.h / 2
    const dir = cyB >= cyA ? 1 : -1
    ny = mover.y + dir * (oy + sep)
  }

  let out = { ...mover, x: nx, y: ny }

  if (viewport) {
    if (out.x + out.w > viewport.x + viewport.w) {
      out = { ...out, x: viewport.x + viewport.w - out.w }
    }
    if (out.x < viewport.x) {
      out = { ...out, x: viewport.x }
    }
    if (out.y + out.h > viewport.y + viewport.h) {
      out = { ...out, y: viewport.y + viewport.h - out.h }
    }
    if (out.y < viewport.y) {
      out = { ...out, y: viewport.y }
    }
  }

  return out
}

/**
 * Resolve overlaps by pushing tiles away from `rootId` in a cascading BFS-like pass.
 */
export function resolveOverlapsAround(
  tiles: Map<string, TileData>,
  rootId: string,
  options?: ResolveOptions
): TileLayoutUpdate[] {
  const pad = options?.padding ?? TILE_MIN_GAP
  const maxIter = options?.maxIterations ?? 64
  const frozen = options?.frozenIds ?? new Set<string>()
  const viewport = options?.viewport ?? null
  const cascade = options?.cascade ?? true

  const work = new Map<string, Rect>()
  for (const [id, t] of tiles) {
    work.set(id, { x: t.x, y: t.y, w: t.w, h: t.h })
  }

  const out: TileLayoutUpdate[] = []
  const queue: string[] = [rootId]
  let iterations = 0

  while (queue.length > 0 && iterations < maxIter) {
    iterations++
    const id = queue.shift()!
    const cur = work.get(id)
    if (!cur) continue

    for (const [oid, o] of work) {
      if (oid === id) continue
      if (frozen.has(oid)) continue
      if (!overlaps(cur.x, cur.y, cur.w, cur.h, o.x, o.y, o.w, o.h, pad)) continue

      const pushed = pushOverlapperFromAnchor(cur, o, pad, viewport)
      if (pushed.x !== o.x || pushed.y !== o.y) {
        work.set(oid, pushed)
        const td = tiles.get(oid)
        if (td) {
          out.push({ id: oid, x: pushed.x, y: pushed.y, w: pushed.w, h: pushed.h })
        }
        if (cascade) queue.push(oid)
      }
    }
  }

  const byId = new Map<string, TileLayoutUpdate>()
  for (const u of out) {
    byId.set(u.id, u)
  }
  return Array.from(byId.values())
}

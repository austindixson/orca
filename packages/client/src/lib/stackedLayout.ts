import type { TileData } from '../store/canvasStore'
import type { LayoutRect } from './layoutPresets'

/** Zone-aware placement (anchor + snap regions). Prefer `computeIntelligentPosition` from `layout/anchorLayout`. */
export { computeIntelligentPosition as findZonePosition } from './layout/anchorLayout'

const RIGHT_INSET = 24
const TOP_INSET = 20
/** Vertical overlap between stacked cards (Orca-style column). */
const STACK_OVERLAP = 32

/**
 * Places new tiles in a right-hand column inside the viewport, overlapping slightly
 * like stacked cards. Falls back when viewport rect is unavailable.
 */
export function findStackedPosition(
  tiles: Map<string, TileData>,
  newW: number,
  newH: number,
  viewport: LayoutRect | null
): { x: number; y: number } | null {
  if (!viewport) return null

  const columnLeft = viewport.x + viewport.w - newW - RIGHT_INSET
  const minY = viewport.y + TOP_INSET
  const maxBottom = viewport.y + viewport.h - TOP_INSET

  const inColumn = (t: TileData): boolean => {
    const colSlack = 48
    return t.x + t.w >= columnLeft - colSlack && t.x <= columnLeft + colSlack
  }

  const columnTiles = Array.from(tiles.values())
    .filter(inColumn)
    .sort((a, b) => a.y - b.y)

  let y = minY
  if (columnTiles.length > 0) {
    const bottomMost = columnTiles[columnTiles.length - 1]
    y = bottomMost.y + bottomMost.h - STACK_OVERLAP
  }

  if (y + newH > maxBottom) {
    y = Math.max(minY, maxBottom - newH)
  }

  const x = columnLeft
  return { x, y }
}

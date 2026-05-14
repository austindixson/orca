import type { TileData } from '../store/canvasStore'
import type { LayoutRect, TileLayoutUpdate } from './layoutPresets'
import { sortTilesForLayout } from './layoutPresets'

/** Inner padding from viewport edges for Smart Collapse layout. */
export const SMART_COLLAPSE_MARGIN = 14
const MARGIN = SMART_COLLAPSE_MARGIN
export const SMART_COLLAPSE_GAP = 10
/** @deprecated use SMART_COLLAPSE_GAP */
const GAP = SMART_COLLAPSE_GAP
/**
 * Matches collapsed Tile header (icon + single-line title + actions).
 * Never shrink rows below this in layout — smaller heights clip `overflow-hidden` tiles.
 */
export const SMART_COLLAPSE_TITLE_H = 44
/** Minimum row height when splitting vertical space among many side tiles. */
const SMART_COLLAPSE_MIN_SIDE_ROW_H = 40
/** Default share of inner width for the main tile (rest is the accordion column). ~60/40 split. */
export const SMART_COLLAPSE_DEFAULT_MAIN_RATIO = 0.6
const MIN_SIDE_W = 160

function inset(r: LayoutRect, m: number): LayoutRect {
  return { x: r.x + m, y: r.y + m, w: r.w - 2 * m, h: r.h - 2 * m }
}

/**
 * Main tile fills left portion; side tiles stack in a column on the right.
 * When `expandedSideId` is null, every side tile is title-height only.
 * When set, that tile gets the remaining vertical space; others stay title-height.
 */
export function computeSmartCollapseLayout(
  area: LayoutRect,
  mainId: string,
  allTiles: TileData[],
  expandedSideId: string | null,
  mainWidthRatio: number = SMART_COLLAPSE_DEFAULT_MAIN_RATIO
): TileLayoutUpdate[] {
  const main = allTiles.find((t) => t.id === mainId)
  if (!main) return []

  const sideTiles = sortTilesForLayout(allTiles.filter((t) => t.id !== mainId))
  if (sideTiles.length === 0) return []

  const inner = inset(area, MARGIN)
  if (inner.w < 400 || inner.h < SMART_COLLAPSE_TITLE_H + 40) return []

  const r = Math.max(0.5, Math.min(0.92, mainWidthRatio))
  const sideW = Math.max(MIN_SIDE_W, inner.w * (1 - r) - GAP * 0.5)
  const mainW = inner.w - sideW - GAP

  const updates: TileLayoutUpdate[] = []

  updates.push({
    id: mainId,
    x: inner.x,
    y: inner.y,
    w: mainW,
    h: inner.h,
  })

  const sideX = inner.x + mainW + GAP
  const nSide = sideTiles.length

  if (expandedSideId == null) {
    const gapsTotal = (nSide - 1) * GAP
    let titleH = SMART_COLLAPSE_TITLE_H
    if (nSide * titleH + gapsTotal > inner.h) {
      // Equal split of available height, but never squash below readable header height
      // (old 26px floor clipped icons/titles). If the stack is taller than the viewport,
      // rows stay at min height and extend below — user pans the canvas.
      titleH = Math.max(
        SMART_COLLAPSE_MIN_SIDE_ROW_H,
        Math.floor((inner.h - gapsTotal) / nSide)
      )
    }
    let y = inner.y
    for (const t of sideTiles) {
      updates.push({ id: t.id, x: sideX, y, w: sideW, h: titleH })
      y += titleH + GAP
    }
  } else {
    const hExp = Math.max(
      120,
      inner.h - (nSide - 1) * SMART_COLLAPSE_TITLE_H - (nSide - 1) * GAP
    )
    let y = inner.y
    for (const t of sideTiles) {
      const h = t.id === expandedSideId ? hExp : SMART_COLLAPSE_TITLE_H
      updates.push({ id: t.id, x: sideX, y, w: sideW, h })
      y += h + GAP
    }
  }

  return updates
}

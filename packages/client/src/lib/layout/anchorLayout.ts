import type { TileData, TileType } from '../../store/canvasStore'
import { findStackedPosition } from '../stackedLayout'
import { findNonOverlappingPosition } from './placement'
import { getZoneForTile } from './tileDomains'
import type { WorkspaceContext } from './workspaceContext'
import { getLayoutStrategyForContext } from './workspaceContext'
import type { LayoutRect } from '../layoutPresets'

const ZONE_GAP = 16
const STACK_OVERLAP = 28
const FLOAT_TOP = 24
const FLOAT_RIGHT = 24

/**
 * Preferred top-left for a new tile (world space) before overlap resolution.
 */
export function computeIntelligentPosition(args: {
  type: TileType
  newW: number
  newH: number
  tiles: Map<string, TileData>
  pan: { x: number; y: number }
  zoom: number
  viewport: LayoutRect | null
  workspaceContext: WorkspaceContext
  anchorTileId: string | null
  anchorSizeRatio: number
  autoDetectAnchor: boolean
}): { x: number; y: number; w: number; h: number; setAsAnchor: boolean } {
  const {
    type,
    newW,
    newH,
    tiles,
    pan,
    zoom,
    viewport,
    workspaceContext,
    anchorTileId,
    anchorSizeRatio,
    autoDetectAnchor,
  } = args

  const strategy = getLayoutStrategyForContext(workspaceContext, anchorSizeRatio)
  const zone = getZoneForTile(type, workspaceContext)

  if (zone === 'dock') {
    const stacked = findStackedPosition(tiles, newW, newH, viewport)
    const preferredX =
      stacked?.x ??
      (-pan.x + (typeof window !== 'undefined' ? window.innerWidth / 2 : 400)) / zoom - newW / 2
    const preferredY =
      stacked?.y ??
      (-pan.y + (typeof window !== 'undefined' ? window.innerHeight / 2 : 300)) / zoom - newH / 2
    const placed = findNonOverlappingPosition(tiles, newW, newH, preferredX, preferredY)
    return { ...placed, w: newW, h: newH, setAsAnchor: false }
  }

  let anchor: TileData | null = null
  if (anchorTileId) {
    anchor = tiles.get(anchorTileId) ?? null
  }

  const shouldBecomeAnchor =
    autoDetectAnchor &&
    !anchor &&
    strategy.anchorTileType === type &&
    (zone === 'anchor' || strategy.anchorTileType === type)

  let outW = newW
  let outH = newH

  if (shouldBecomeAnchor && viewport) {
    const r = strategy.anchorViewportRatio
    outW = Math.min(viewport.w * r, viewport.w - 32)
    outH = Math.min(viewport.h * r, viewport.h - 32)
    const cx = viewport.x + viewport.w / 2
    const cy = viewport.y + viewport.h / 2
    const x = cx - outW / 2
    const y = cy - outH / 2
    const placed = findNonOverlappingPosition(tiles, outW, outH, x, y)
    return { ...placed, w: outW, h: outH, setAsAnchor: true }
  }

  if (!anchor || !viewport) {
    const cx = viewport
      ? viewport.x + viewport.w / 2 - newW / 2
      : (-pan.x + (typeof window !== 'undefined' ? window.innerWidth / 2 : 400)) / zoom - newW / 2
    const cy = viewport
      ? viewport.y + viewport.h / 2 - newH / 2
      : (-pan.y + (typeof window !== 'undefined' ? window.innerHeight / 2 : 300)) / zoom - newH / 2
    const placed = findNonOverlappingPosition(tiles, newW, newH, cx, cy)
    return { ...placed, w: newW, h: newH, setAsAnchor: false }
  }

  // Anchor exists: place in zone
  const pref = zonePositionForZone(anchor, viewport, zone, tiles, newW, newH, type)
  const placed = findNonOverlappingPosition(tiles, newW, newH, pref.x, pref.y)
  return { ...placed, w: newW, h: newH, setAsAnchor: false }
}

function zonePositionForZone(
  anchor: TileData,
  viewport: LayoutRect,
  zone: ReturnType<typeof getZoneForTile>,
  tiles: Map<string, TileData>,
  newW: number,
  newH: number,
  type: TileType
): { x: number; y: number } {
  const ax = anchor.x
  const ay = anchor.y
  const aw = anchor.w
  const ah = anchor.h

  if (zone === 'floating-topright') {
    return {
      x: viewport.x + viewport.w - newW - FLOAT_RIGHT,
      y: viewport.y + FLOAT_TOP,
    }
  }

  if (zone === 'left') {
    const x = Math.max(viewport.x + 8, ax - ZONE_GAP - newW)
    const columnTiles = tilesInColumn(tiles, x, newW, type, anchor.id)
    let y = ay
    if (columnTiles.length > 0) {
      const bottom = columnTiles[columnTiles.length - 1]
      y = bottom.y + bottom.h - STACK_OVERLAP
    }
    y = Math.min(y, viewport.y + viewport.h - newH - 8)
    y = Math.max(viewport.y + 8, y)
    return { x, y }
  }

  if (zone === 'right') {
    const x = Math.min(viewport.x + viewport.w - newW - 8, ax + aw + ZONE_GAP)
    const columnTiles = tilesInColumn(tiles, x, newW, type, anchor.id)
    let y = ay
    if (columnTiles.length > 0) {
      const bottom = columnTiles[columnTiles.length - 1]
      y = bottom.y + bottom.h - STACK_OVERLAP
    }
    y = Math.min(y, viewport.y + viewport.h - newH - 8)
    y = Math.max(viewport.y + 8, y)
    return { x, y }
  }

  if (zone === 'bottom') {
    const y = Math.min(viewport.y + viewport.h - newH - 8, ay + ah + ZONE_GAP)
    const rowTiles = tilesInRow(tiles, y, newH, anchor.id)
    let x = ax
    if (rowTiles.length > 0) {
      const right = rowTiles[rowTiles.length - 1]
      x = right.x + right.w + ZONE_GAP - STACK_OVERLAP
    }
    x = Math.min(x, viewport.x + viewport.w - newW - 8)
    x = Math.max(viewport.x + 8, x)
    return { x, y }
  }

  // center-free / dock: near anchor bottom-right
  return {
    x: ax + aw + ZONE_GAP,
    y: ay + 40,
  }
}

function tilesInColumn(
  tiles: Map<string, TileData>,
  columnX: number,
  newW: number,
  type: TileType,
  anchorId: string
): TileData[] {
  const slack = 40
  const list = Array.from(tiles.values()).filter(
    (t) =>
      t.id !== anchorId &&
      t.type === type &&
      t.x + t.w >= columnX - slack &&
      t.x <= columnX + newW + slack
  )
  return list.sort((a, b) => a.y - b.y)
}

function tilesInRow(tiles: Map<string, TileData>, rowY: number, newH: number, anchorId: string): TileData[] {
  const slack = 40
  const list = Array.from(tiles.values()).filter(
    (t) =>
      t.id !== anchorId &&
      t.y + t.h >= rowY - slack &&
      t.y <= rowY + newH + slack
  )
  return list.sort((a, b) => a.x - b.x)
}

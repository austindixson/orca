import type { TileData } from '../store/canvasStore'
import { useCanvasStore } from '../store/canvasStore'
import { useFocusStore } from '../store/focusStore'
import { computePanZoomToFitTiles } from './layoutPresets'

const VISIBLE_THRESHOLD = 0.28
const PAN_MS = 320

function getCanvasRect(): DOMRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector('[data-testid="infinite-canvas"]')
  return el?.getBoundingClientRect() ?? null
}

function visibleAreaFraction(
  tile: { x: number; y: number; w: number; h: number },
  pan: { x: number; y: number },
  zoom: number
): number {
  const r = getCanvasRect()
  if (!r) return 0
  const left = r.left + pan.x + tile.x * zoom
  const top = r.top + pan.y + tile.y * zoom
  const right = left + tile.w * zoom
  const bottom = top + tile.h * zoom
  const iw = Math.max(0, Math.min(right, r.left + r.width) - Math.max(left, r.left))
  const ih = Math.max(0, Math.min(bottom, r.top + r.height) - Math.max(top, r.top))
  const intersect = iw * ih
  const tileArea = tile.w * tile.h * zoom * zoom
  if (tileArea <= 0) return 0
  return intersect / tileArea
}

export type ActivateModuleIntent = 'default' | 'user_sidebar'

/** Pan so the tile is reasonably in view (same idea as orchestrator reveal). */
function ensureTileVisibleIfNeeded(tileId: string): void {
  const { tiles, pan, zoom, animatePanTo } = useCanvasStore.getState()
  const tile = tiles.get(tileId)
  if (!tile) return
  if (useFocusStore.getState().isActive) return
  if (visibleAreaFraction(tile, pan, zoom) >= VISIBLE_THRESHOLD) return
  const r = getCanvasRect()
  if (!r) return
  const cx = tile.x + tile.w / 2
  const cy = tile.y + tile.h / 2
  const newPanX = r.width / 2 - cx * zoom
  const newPanY = r.height / 2 - cy * zoom
  animatePanTo({ x: newPanX, y: newPanY }, PAN_MS)
}

/** Sidebar (and similar): always pan+zoom so the module is clearly framed. */
function ensureTileVisibleStrong(tileId: string): void {
  const { tiles, setPan, setZoom } = useCanvasStore.getState()
  const tile = tiles.get(tileId)
  if (!tile) return
  if (useFocusStore.getState().isActive) return
  const fitted = computePanZoomToFitTiles([tile], { minZoom: 0.25, maxZoom: 1 })
  if (fitted) {
    setPan(fitted.pan)
    setZoom(fitted.zoom)
  }
}

function centerOf(t: TileData): { cx: number; cy: number } {
  return { cx: t.x + t.w / 2, cy: t.y + t.h / 2 }
}

function dist2(a: { cx: number; cy: number }, b: { cx: number; cy: number }): number {
  const dx = a.cx - b.cx
  const dy = a.cy - b.cy
  return dx * dx + dy * dy
}

/** Nearest tile above/below by world-space center (for Shift+↑ / Shift+↓). */
export function findSpatialNeighbor(
  pool: TileData[],
  currentId: string,
  dir: 'up' | 'down'
): TileData | null {
  const current = pool.find((t) => t.id === currentId)
  if (!current || pool.length <= 1) return null
  const c = centerOf(current)
  const others = pool.filter((t) => t.id !== currentId)
  const filtered =
    dir === 'up'
      ? others.filter((t) => centerOf(t).cy < c.cy - 1e-6)
      : others.filter((t) => centerOf(t).cy > c.cy + 1e-6)
  if (filtered.length === 0) return null
  return filtered.reduce((best, t) => {
    const tc = centerOf(t)
    const d = dist2(c, tc)
    const db = dist2(c, centerOf(best))
    if (d < db) return t
    if (d > db) return best
    return t.id.localeCompare(best.id) < 0 ? t : best
  })
}

/** Sort for Shift+← / Shift+→: back-to-front (ascending z), stable by id. */
export function sortTilesSequential(tiles: TileData[]): TileData[] {
  return [...tiles].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
}

function topmostTileId(tiles: Map<string, TileData>): string | null {
  let best: TileData | null = null
  for (const t of tiles.values()) {
    if (!best || t.zIndex > best.zIndex || (t.zIndex === best.zIndex && t.id < best.id)) {
      best = t
    }
  }
  return best?.id ?? null
}

/** Resolve which tile is "current" for navigation. */
export function resolveCurrentModuleId(): string | null {
  const { tiles, activeInteractionTileId } = useCanvasStore.getState()
  const focus = useFocusStore.getState()
  if (tiles.size === 0) return null
  if (focus.isActive && focus.focusedTileIds.length > 0) {
    return focus.focusedTileIds[0]
  }
  if (activeInteractionTileId && tiles.has(activeInteractionTileId)) {
    return activeInteractionTileId
  }
  return topmostTileId(tiles)
}

/** Activate a tile on the canvas (not focus mode): bring to front, arm scroll, pan if needed. */
export function activateModuleOnCanvas(
  tileId: string,
  options?: { intent?: ActivateModuleIntent }
): void {
  const { bringToFront, setActiveInteractionTile } = useCanvasStore.getState()
  bringToFront(tileId)
  setActiveInteractionTile(tileId)
  if (options?.intent === 'user_sidebar') {
    ensureTileVisibleStrong(tileId)
  } else {
    ensureTileVisibleIfNeeded(tileId)
  }
}

/** Cycle primary in focus mode: Shift+← / Shift+→ */
export function rotateFocusedOrder(direction: 'left' | 'right'): void {
  const { focusedTileIds } = useFocusStore.getState()
  if (focusedTileIds.length <= 1) return
  const rotated =
    direction === 'right'
      ? [...focusedTileIds.slice(1), focusedTileIds[0]]
      : [focusedTileIds[focusedTileIds.length - 1], ...focusedTileIds.slice(0, -1)]
  useFocusStore.getState().enterFocus(rotated)
}

/** Make `tileId` primary in focus mode, keeping other focused tiles. */
export function focusPrimaryTile(tileId: string): void {
  const { focusedTileIds } = useFocusStore.getState()
  if (!focusedTileIds.includes(tileId)) return
  const rest = focusedTileIds.filter((id) => id !== tileId)
  useFocusStore.getState().enterFocus([tileId, ...rest])
}

function getPoolTiles(): TileData[] {
  const { tiles } = useCanvasStore.getState()
  const focus = useFocusStore.getState()
  if (focus.isActive && focus.focusedTileIds.length > 0) {
    return focus.focusedTileIds
      .map((id) => tiles.get(id))
      .filter((t): t is TileData => t != null)
  }
  return Array.from(tiles.values())
}

/**
 * Shift+Arrow module navigation. Returns true if the shortcut was handled (caller should preventDefault).
 */
export function handleShiftArrowNavigation(dir: 'left' | 'right' | 'up' | 'down'): boolean {
  if (useFocusStore.getState().isSelectionMode) return false
  if (useFocusStore.getState().isDeleteSelectionMode) return false
  if (useCanvasStore.getState().missionScatterPickMode) return false
  if (useCanvasStore.getState().smartCollapsePicking) return false

  const pool = getPoolTiles()
  if (pool.length === 0) return false

  const currentId = resolveCurrentModuleId()
  if (!currentId) return false

  const focus = useFocusStore.getState()

  if (focus.isActive && focus.focusedTileIds.length > 0) {
    if (dir === 'left' || dir === 'right') {
      rotateFocusedOrder(dir === 'right' ? 'right' : 'left')
      return true
    }
    const neighbor = findSpatialNeighbor(pool, currentId, dir === 'up' ? 'up' : 'down')
    if (neighbor) focusPrimaryTile(neighbor.id)
    return true
  }

  const sorted = sortTilesSequential(pool)
  let curIdx = sorted.findIndex((t) => t.id === currentId)
  if (curIdx < 0) curIdx = 0

  if (dir === 'left' || dir === 'right') {
    const n = sorted.length
    const nextIdx = dir === 'right' ? (curIdx + 1) % n : (curIdx - 1 + n) % n
    activateModuleOnCanvas(sorted[nextIdx].id)
    return true
  }

  const neighbor = findSpatialNeighbor(pool, currentId, dir === 'up' ? 'up' : 'down')
  if (neighbor) activateModuleOnCanvas(neighbor.id)
  return true
}

import type { TileData } from '../store/canvasStore'
import { getOrchestratorAutoFocusAnchorY } from './orchestrator/orchestratorAutoFocusAnchor'

const MARGIN = 14
const GAP = 10
const MIN_W = 200
const MIN_H = 140
/** Allow auto-layout/repulsion to place tiles slightly under the left sidebar instead of hard-clamping. */
const LEFT_SIDEBAR_OVERFLOW_ALLOWANCE_PX = 320

export interface LayoutRect {
  x: number
  y: number
  w: number
  h: number
}

export type PresetId =
  | 'fill'
  | 'scatter'
  | 'split-h'
  | 'split-v'
  | 'three-cols'
  | 'three-rows'
  | 'main-side'
  | 'grid-2'
  | 'row-4'
  | 'grid-auto'
  | 'row-all'
  | 'col-all'

export interface TileLayoutUpdate {
  id: string
  x: number
  y: number
  w: number
  h: number
}

function inset(r: LayoutRect, m: number): LayoutRect {
  return { x: r.x + m, y: r.y + m, w: r.w - 2 * m, h: r.h - 2 * m }
}

function clampSize(w: number, h: number): { w: number; h: number } {
  return { w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) }
}

/** Stable order: lower z first (back), so front tiles get later slots in row-major layouts. */
export function sortTilesForLayout(tiles: TileData[]): TileData[] {
  return [...tiles].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
}

function layoutFill(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const inner = inset(area, MARGIN)
  const t = tiles[0]
  const { w, h } = clampSize(inner.w, inner.h)
  return [{ id: t.id, x: inner.x, y: inner.y, w, h }]
}

/** Edge-to-edge gap between neighboring tiles in scatter (px). */
const SCATTER_GAP = 20

/**
 * Mission Control–style overview: preserve each tile's width and height (including orchestrator)
 * so scatter never shrinks a tall chat/activity tile.
 *
 * Uses row-major packing so adjacent tiles stay ~{@link SCATTER_GAP}px apart on shared sides instead of
 * centering each tile in a uniform max-sized cell (which pushed mismatched sizes far apart).
 */
function layoutScatter(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const inner = inset(area, 10)
  const n = tiles.length
  if (n === 0) return []
  const gap = SCATTER_GAP
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.ceil(n / cols)

  const rowHeights: number[] = []
  const rowWidths: number[] = []
  for (let row = 0; row < rows; row++) {
    const start = row * cols
    const end = Math.min(n, start + cols)
    const slice = tiles.slice(start, end)
    const rh = Math.max(1, ...slice.map((t) => t.h))
    const rw = slice.reduce((sum, t) => sum + t.w, 0) + (slice.length - 1) * gap
    rowHeights.push(rh)
    rowWidths.push(rw)
  }

  const totalH =
    rowHeights.reduce((a, b) => a + b, 0) + (rows > 1 ? (rows - 1) * gap : 0)
  const maxRowW = Math.max(1, ...rowWidths)
  const originX = inner.x + Math.max(0, (inner.w - maxRowW) / 2)
  const originY = inner.y + Math.max(0, (inner.h - totalH) / 2)

  const updates: TileLayoutUpdate[] = []
  let y = originY
  for (let row = 0; row < rows; row++) {
    const start = row * cols
    const end = Math.min(n, start + cols)
    const slice = tiles.slice(start, end)
    const rowH = rowHeights[row]!
    const rowW = rowWidths[row]!
    let x = originX + Math.max(0, (maxRowW - rowW) / 2)
    for (const t of slice) {
      updates.push({
        id: t.id,
        x,
        y: y + (rowH - t.h) / 2,
        w: t.w,
        h: t.h,
      })
      x += t.w + gap
    }
    y += rowH + gap
  }
  return updates
}

function layoutSplitH(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const inner = inset(area, MARGIN)
  const [a, b] = tiles
  const half = (inner.w - GAP) / 2
  return [
    { id: a.id, x: inner.x, y: inner.y, w: half, h: inner.h },
    { id: b.id, x: inner.x + half + GAP, y: inner.y, w: half, h: inner.h },
  ]
}

function layoutSplitV(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const inner = inset(area, MARGIN)
  const [a, b] = tiles
  const half = (inner.h - GAP) / 2
  return [
    { id: a.id, x: inner.x, y: inner.y, w: inner.w, h: half },
    { id: b.id, x: inner.x, y: inner.y + half + GAP, w: inner.w, h: half },
  ]
}

function layoutThreeCols(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const inner = inset(area, MARGIN)
  const tw = (inner.w - 2 * GAP) / 3
  return tiles.slice(0, 3).map((t, i) => ({
    id: t.id,
    x: inner.x + i * (tw + GAP),
    y: inner.y,
    w: tw,
    h: inner.h,
  }))
}

function layoutThreeRows(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const inner = inset(area, MARGIN)
  const th = (inner.h - 2 * GAP) / 3
  return tiles.slice(0, 3).map((t, i) => ({
    id: t.id,
    x: inner.x,
    y: inner.y + i * (th + GAP),
    w: inner.w,
    h: th,
  }))
}

/** One large left (~58%), two stacked on the right. */
function layoutMainSide(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const inner = inset(area, MARGIN)
  const [main, s1, s2] = tiles
  const split = 0.58
  const leftW = inner.w * split - GAP / 2
  const rightW = inner.w * (1 - split) - GAP / 2
  const rightX = inner.x + leftW + GAP
  const rh = (inner.h - GAP) / 2
  return [
    { id: main.id, x: inner.x, y: inner.y, w: leftW, h: inner.h },
    { id: s1.id, x: rightX, y: inner.y, w: rightW, h: rh },
    { id: s2.id, x: rightX, y: inner.y + rh + GAP, w: rightW, h: rh },
  ]
}

function layoutGrid2(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const inner = inset(area, MARGIN)
  const w = (inner.w - GAP) / 2
  const h = (inner.h - GAP) / 2
  const order = tiles.slice(0, 4)
  const pos = [
    { x: inner.x, y: inner.y },
    { x: inner.x + w + GAP, y: inner.y },
    { x: inner.x, y: inner.y + h + GAP },
    { x: inner.x + w + GAP, y: inner.y + h + GAP },
  ]
  return order.map((t, i) => ({ id: t.id, ...pos[i], w, h }))
}

function layoutRow4(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const inner = inset(area, MARGIN)
  const tw = (inner.w - 3 * GAP) / 4
  return tiles.slice(0, 4).map((t, i) => ({
    id: t.id,
    x: inner.x + i * (tw + GAP),
    y: inner.y,
    w: tw,
    h: inner.h,
  }))
}

function layoutGridAuto(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const n = tiles.length
  if (n === 0) return []
  const inner = inset(area, MARGIN)
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const w = (inner.w - (cols - 1) * GAP) / cols
  const h = (inner.h - (rows - 1) * GAP) / rows
  const out: TileLayoutUpdate[] = []
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    out.push({
      id: tiles[i].id,
      x: inner.x + col * (w + GAP),
      y: inner.y + row * (h + GAP),
      w,
      h,
    })
  }
  return out
}

function layoutRowAll(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const n = tiles.length
  const inner = inset(area, MARGIN)
  const tw = (inner.w - (n - 1) * GAP) / n
  return tiles.map((t, i) => ({
    id: t.id,
    x: inner.x + i * (tw + GAP),
    y: inner.y,
    w: tw,
    h: inner.h,
  }))
}

function layoutColAll(tiles: TileData[], area: LayoutRect): TileLayoutUpdate[] {
  const n = tiles.length
  const inner = inset(area, MARGIN)
  const th = (inner.h - (n - 1) * GAP) / n
  return tiles.map((t, i) => ({
    id: t.id,
    x: inner.x,
    y: inner.y + i * (th + GAP),
    w: inner.w,
    h: th,
  }))
}

/** Visible canvas region in world space (for arranging tiles into the current view). */
export interface PanZoomToFitOptions {
  /**
   * Floor for zoom when fitting content (Mission Control). Prevents unreadable ~5–8% zoom when
   * the bounding box is huge; user can still pan to see edges.
   */
  minZoom?: number
  /** Cap zoom when fitting (e.g. sidebar reveal should not over-zoom). */
  maxZoom?: number
  /** Vertical anchor mode for fit operations (default: viewport center). */
  anchorY?: 'center' | 'orchestrator-hud'
}

/**
 * Pan/zoom so every tile rect fits in the canvas viewport (for Mission Control overview).
 * Does not resize tiles — only adjusts camera.
 */
export function computePanZoomToFitTiles(
  tiles: TileData[],
  opts?: PanZoomToFitOptions
): { pan: { x: number; y: number }; zoom: number } | null {
  if (tiles.length === 0 || typeof document === 'undefined') return null
  const el = document.querySelector('[data-testid="infinite-canvas"]')
  if (!el) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const t of tiles) {
    minX = Math.min(minX, t.x)
    minY = Math.min(minY, t.y)
    maxX = Math.max(maxX, t.x + t.w)
    maxY = Math.max(maxY, t.y + t.h)
  }
  const padding = 40
  minX -= padding
  minY -= padding
  maxX += padding
  maxY += padding
  const contentWidth = maxX - minX
  const contentHeight = maxY - minY
  if (contentWidth <= 0 || contentHeight <= 0) return null
  const viewportRect = el.getBoundingClientRect()
  const viewportWidth = viewportRect.width
  const viewportHeight = viewportRect.height
  const zoomX = viewportWidth / contentWidth
  const zoomY = viewportHeight / contentHeight
  let fitZoom = Math.min(zoomX, zoomY, 1) * 0.9
  const minZ = opts?.minZoom
  let zoom = minZ != null ? Math.max(fitZoom, minZ) : fitZoom
  if (opts?.maxZoom != null) {
    zoom = Math.min(zoom, opts.maxZoom)
  }
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  return {
    pan: {
      x: viewportWidth / 2 - centerX * zoom,
      y:
        (opts?.anchorY === 'orchestrator-hud'
          ? getOrchestratorAutoFocusAnchorY(viewportRect)
          : viewportHeight / 2) - centerY * zoom,
    },
    zoom,
  }
}

export function getViewportLayoutRect(
  pan: { x: number; y: number },
  zoom: number
): LayoutRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector('[data-testid="infinite-canvas"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const x = -pan.x / zoom - LEFT_SIDEBAR_OVERFLOW_ALLOWANCE_PX / zoom
  const y = -pan.y / zoom
  const w = r.width / zoom + LEFT_SIDEBAR_OVERFLOW_ALLOWANCE_PX / zoom
  const h = r.height / zoom
  const bottomChrome = 96 / zoom
  return {
    x,
    y,
    w,
    h: Math.max(MIN_H + 40, h - bottomChrome),
  }
}

export function computePresetLayout(
  preset: PresetId,
  tilesSorted: TileData[],
  area: LayoutRect
): TileLayoutUpdate[] {
  const n = tilesSorted.length
  if (n === 0 || area.w < MIN_W || area.h < MIN_H) return []

  switch (preset) {
    case 'fill':
      return n >= 1 ? layoutFill(tilesSorted, area) : []
    case 'scatter':
      return n >= 2 ? layoutScatter(tilesSorted, area) : []
    case 'split-h':
      return n >= 2 ? layoutSplitH(tilesSorted.slice(0, 2), area) : []
    case 'split-v':
      return n >= 2 ? layoutSplitV(tilesSorted.slice(0, 2), area) : []
    case 'three-cols':
      return n >= 3 ? layoutThreeCols(tilesSorted.slice(0, 3), area) : []
    case 'three-rows':
      return n >= 3 ? layoutThreeRows(tilesSorted.slice(0, 3), area) : []
    case 'main-side':
      return n >= 3 ? layoutMainSide(tilesSorted.slice(0, 3), area) : []
    case 'grid-2':
      return n >= 4 ? layoutGrid2(tilesSorted.slice(0, 4), area) : []
    case 'row-4':
      return n >= 4 ? layoutRow4(tilesSorted.slice(0, 4), area) : []
    case 'grid-auto':
      return layoutGridAuto(tilesSorted, area)
    case 'row-all':
      return layoutRowAll(tilesSorted, area)
    case 'col-all':
      return layoutColAll(tilesSorted, area)
    default:
      return []
  }
}

export interface PresetButtonSpec {
  id: PresetId
  label: string
  title: string
}

/** Which presets to show for a given tile count. */
export function presetButtonsForCount(n: number): PresetButtonSpec[] {
  if (n <= 0) return []
  if (n === 1) {
    return [{ id: 'fill', label: 'Fill', title: 'Fill the viewport with this tile' }]
  }
  if (n === 2) {
    return [
      { id: 'scatter', label: 'Scatter', title: 'Mission Control-style overview' },
      { id: 'split-h', label: 'Side by side', title: 'Two columns' },
      { id: 'split-v', label: 'Stacked', title: 'Two rows' },
    ]
  }
  if (n === 3) {
    return [
      { id: 'scatter', label: 'Scatter', title: 'Mission Control-style overview' },
      { id: 'three-cols', label: '3 columns', title: 'Equal width columns' },
      { id: 'three-rows', label: '3 rows', title: 'Equal height rows' },
      { id: 'main-side', label: 'Main + side', title: 'Large panel left, two stacked right' },
    ]
  }
  if (n === 4) {
    return [
      { id: 'scatter', label: 'Scatter', title: 'Mission Control-style overview' },
      { id: 'grid-2', label: '2×2 grid', title: 'Four equal quadrants' },
      { id: 'row-4', label: 'Single row', title: 'Four tiles in one row' },
      { id: 'grid-auto', label: 'Smart grid', title: 'Balanced rows and columns' },
    ]
  }
  return [
    { id: 'scatter', label: 'Scatter', title: `Mission Control overview for ${n} tiles` },
    { id: 'grid-auto', label: 'Smart grid', title: `Arrange ${n} tiles in a balanced grid` },
    { id: 'row-all', label: 'One row', title: 'All tiles in a single row' },
    { id: 'col-all', label: 'One column', title: 'All tiles in a single column' },
  ]
}

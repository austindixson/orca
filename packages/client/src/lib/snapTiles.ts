import type { TileData } from '../store/canvasStore'

/** Screen-space snap proximity (px); converted to canvas units via `snapThresholdCanvas`. */
export const SNAP_THRESHOLD_SCREEN_PX = 12

/** Canvas-space grid step; matches layout anchor from first tile (see `layoutAnchor`). */
export const CANVAS_GRID_STEP = 24

const GRID_SNAP_ID = '__grid__'

/** Origin + step for snapping edges to invisible grid lines (anchored to first tile placement). */
export interface GridSnapContext {
  originX: number
  originY: number
  step: number
}

export function snapThresholdCanvas(zoom: number): number {
  return SNAP_THRESHOLD_SCREEN_PX / zoom
}

type XSide = 'left' | 'right'
type YSide = 'top' | 'bottom'

interface XEdge {
  coord: number
  tileId: string
  side: XSide
}

interface YEdge {
  coord: number
  tileId: string
  side: YSide
}

function bestXSnap(
  rawX: number,
  w: number,
  targets: XEdge[],
  threshold: number
): { delta: number; alignAt: number | null; draggedSide: XSide | null; target: XEdge | null } {
  const dragged: { coord: number; side: XSide }[] = [
    { coord: rawX, side: 'left' },
    { coord: rawX + w, side: 'right' },
  ]
  let bestDelta = 0
  let minAbs = Infinity
  let alignAt: number | null = null
  let draggedSide: XSide | null = null
  let target: XEdge | null = null

  for (const d of dragged) {
    for (const t of targets) {
      const delta = t.coord - d.coord
      const a = Math.abs(delta)
      if (a <= threshold && a < minAbs) {
        minAbs = a
        bestDelta = delta
        alignAt = t.coord
        draggedSide = d.side
        target = t
      }
    }
  }
  return minAbs <= threshold
    ? { delta: bestDelta, alignAt, draggedSide, target }
    : { delta: 0, alignAt: null, draggedSide: null, target: null }
}

function gridVerticalEdges(ox: number, step: number, e0: number, e1: number, thr: number): XEdge[] {
  const lo = Math.min(e0, e1) - thr
  const hi = Math.max(e0, e1) + thr
  const k0 = Math.floor((lo - ox) / step)
  const k1 = Math.ceil((hi - ox) / step)
  const out: XEdge[] = []
  for (let k = k0; k <= k1; k++) {
    out.push({ coord: ox + k * step, tileId: GRID_SNAP_ID, side: 'left' })
  }
  return out
}

function gridHorizontalEdges(oy: number, step: number, e0: number, e1: number, thr: number): YEdge[] {
  const lo = Math.min(e0, e1) - thr
  const hi = Math.max(e0, e1) + thr
  const k0 = Math.floor((lo - oy) / step)
  const k1 = Math.ceil((hi - oy) / step)
  const out: YEdge[] = []
  for (let k = k0; k <= k1; k++) {
    out.push({ coord: oy + k * step, tileId: GRID_SNAP_ID, side: 'top' })
  }
  return out
}

function bestYSnap(
  rawY: number,
  h: number,
  targets: YEdge[],
  threshold: number
): { delta: number; alignAt: number | null; draggedSide: YSide | null; target: YEdge | null } {
  const dragged: { coord: number; side: YSide }[] = [
    { coord: rawY, side: 'top' },
    { coord: rawY + h, side: 'bottom' },
  ]
  let bestDelta = 0
  let minAbs = Infinity
  let alignAt: number | null = null
  let draggedSide: YSide | null = null
  let target: YEdge | null = null

  for (const d of dragged) {
    for (const t of targets) {
      const delta = t.coord - d.coord
      const a = Math.abs(delta)
      if (a <= threshold && a < minAbs) {
        minAbs = a
        bestDelta = delta
        alignAt = t.coord
        draggedSide = d.side
        target = t
      }
    }
  }
  return minAbs <= threshold
    ? { delta: bestDelta, alignAt, draggedSide, target }
    : { delta: 0, alignAt: null, draggedSide: null, target: null }
}

export interface SnapGuides {
  verticalX: number | null
  horizontalY: number | null
}

export interface SnapResizeResult {
  x: number
  y: number
  w: number
  h: number
  guides: SnapGuides
  /** Neighbor tiles involved in this snap (for preview highlights). */
  targetTileIds: string[]
}

/**
 * Snap position and optionally resize the dragged tile to match the neighbor tile along the snap edge
 * (side-by-side → same height & top; stacked → same width & left).
 */
export function snapTileToOthers(
  rawX: number,
  rawY: number,
  w: number,
  h: number,
  draggedId: string,
  tiles: Map<string, TileData>,
  thresholdCanvas: number,
  gridContext: GridSnapContext | null = null
): SnapResizeResult {
  const targetsX: XEdge[] = []
  const targetsY: YEdge[] = []
  for (const t of tiles.values()) {
    if (t.id === draggedId) continue
    targetsX.push({ coord: t.x, tileId: t.id, side: 'left' })
    targetsX.push({ coord: t.x + t.w, tileId: t.id, side: 'right' })
    targetsY.push({ coord: t.y, tileId: t.id, side: 'top' })
    targetsY.push({ coord: t.y + t.h, tileId: t.id, side: 'bottom' })
  }

  if (gridContext) {
    const { originX: ox, originY: oy, step } = gridContext
    targetsX.push(...gridVerticalEdges(ox, step, rawX, rawX + w, thresholdCanvas))
    targetsY.push(...gridHorizontalEdges(oy, step, rawY, rawY + h, thresholdCanvas))
  }

  if (targetsX.length === 0 && targetsY.length === 0) {
    return {
      x: rawX,
      y: rawY,
      w,
      h,
      guides: { verticalX: null, horizontalY: null },
      targetTileIds: [],
    }
  }

  const xSnap = bestXSnap(rawX, w, targetsX, thresholdCanvas)
  const ySnap = bestYSnap(rawY, h, targetsY, thresholdCanvas)

  let nx = rawX + xSnap.delta
  let ny = rawY + ySnap.delta
  let nw = w
  let nh = h
  let xResizeTargetIds: string[] = []
  let yResizeTargetIds: string[] = []

  const tileById = (id: string) => tiles.get(id)
  const intervalOverlap = (a0: number, a1: number, b0: number, b1: number): number =>
    Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

  /**
   * If a seam has two vertically stacked neighbors and the dragged tile spans both,
   * prefer matching the combined column height (double-height snap).
   */
  const findDoubleHeightStackForXSeam = (
    seamCoord: number,
    seamSide: XSide
  ): [TileData, TileData] | null => {
    const seamTiles = Array.from(tiles.values())
      .filter((t) => t.id !== draggedId)
      .filter((t) =>
        seamSide === 'left'
          ? Math.abs(t.x - seamCoord) <= thresholdCanvas
          : Math.abs(t.x + t.w - seamCoord) <= thresholdCanvas
      )
      .sort((a, b) => a.y - b.y)

    if (seamTiles.length < 2) return null

    const rawTop = rawY
    const rawBottom = rawY + h
    let best: { pair: [TileData, TileData]; score: number } | null = null

    for (let i = 0; i < seamTiles.length - 1; i++) {
      const a = seamTiles[i]
      const b = seamTiles[i + 1]
      const seamGap = b.y - (a.y + a.h)
      if (Math.abs(seamGap) > thresholdCanvas * 1.5) continue

      const oa = intervalOverlap(rawTop, rawBottom, a.y, a.y + a.h)
      const ob = intervalOverlap(rawTop, rawBottom, b.y, b.y + b.h)
      if (oa <= 0 || ob <= 0) continue

      const score = oa + ob - Math.abs(seamGap)
      if (!best || score > best.score) {
        best = { pair: [a, b], score }
      }
    }

    return best?.pair ?? null
  }

  /** Vertical seam (x alignment): match neighbor height & top. */
  const applyXResize = () => {
    if (!xSnap.target || !xSnap.draggedSide) return
    if (xSnap.target.tileId === GRID_SNAP_ID) return
    const T = tileById(xSnap.target.tileId)
    if (!T) return
    const pair =
      (xSnap.draggedSide === 'left' && xSnap.target.side === 'right') ||
      (xSnap.draggedSide === 'right' && xSnap.target.side === 'left') ||
      (xSnap.draggedSide === 'left' && xSnap.target.side === 'left') ||
      (xSnap.draggedSide === 'right' && xSnap.target.side === 'right')
    if (!pair) return

    const stackPair = findDoubleHeightStackForXSeam(xSnap.target.coord, xSnap.target.side)
    if (stackPair) {
      const [a, b] = stackPair
      const top = Math.min(a.y, b.y)
      const bottom = Math.max(a.y + a.h, b.y + b.h)
      ny = top
      nh = bottom - top
      xResizeTargetIds = [a.id, b.id]
      return
    }

    nh = T.h
    ny = T.y
    xResizeTargetIds = [T.id]
  }

  /** Horizontal seam (y alignment): match neighbor width & left. */
  const applyYResize = () => {
    if (!ySnap.target || !ySnap.draggedSide) return
    if (ySnap.target.tileId === GRID_SNAP_ID) return
    const T = tileById(ySnap.target.tileId)
    if (!T) return
    const pair =
      (ySnap.draggedSide === 'top' && ySnap.target.side === 'bottom') ||
      (ySnap.draggedSide === 'bottom' && ySnap.target.side === 'top') ||
      (ySnap.draggedSide === 'top' && ySnap.target.side === 'top') ||
      (ySnap.draggedSide === 'bottom' && ySnap.target.side === 'bottom')
    if (!pair) return
    nw = T.w
    nx = T.x
    yResizeTargetIds = [T.id]
  }

  const xResizeEligible =
    xSnap.delta !== 0 &&
    xSnap.target &&
    xSnap.target.tileId !== GRID_SNAP_ID &&
    xSnap.draggedSide &&
    (() => {
      const T = tileById(xSnap.target!.tileId)
      if (!T) return false
      const pair =
        (xSnap.draggedSide === 'left' && xSnap.target!.side === 'right') ||
        (xSnap.draggedSide === 'right' && xSnap.target!.side === 'left') ||
        (xSnap.draggedSide === 'left' && xSnap.target!.side === 'left') ||
        (xSnap.draggedSide === 'right' && xSnap.target!.side === 'right')
      return pair
    })()

  const yResizeEligible =
    ySnap.delta !== 0 &&
    ySnap.target &&
    ySnap.target.tileId !== GRID_SNAP_ID &&
    ySnap.draggedSide &&
    (() => {
      const T = tileById(ySnap.target!.tileId)
      if (!T) return false
      const pair =
        (ySnap.draggedSide === 'top' && ySnap.target!.side === 'bottom') ||
        (ySnap.draggedSide === 'bottom' && ySnap.target!.side === 'top') ||
        (ySnap.draggedSide === 'top' && ySnap.target!.side === 'top') ||
        (ySnap.draggedSide === 'bottom' && ySnap.target!.side === 'bottom')
      return pair
    })()

  /**
   * Applying both axis resizes can collapse the dragged rect onto the neighbor (full overlap).
   * Prefer a single axis resize — the tighter snap wins (smaller |delta|).
   */
  if (xResizeEligible && yResizeEligible) {
    if (Math.abs(xSnap.delta) <= Math.abs(ySnap.delta)) {
      applyXResize()
    } else {
      applyYResize()
    }
  } else {
    if (xSnap.delta !== 0) applyXResize()
    if (ySnap.delta !== 0) applyYResize()
  }

  /** Minimum gap between tiles — nudge away from overlap after snap. */
  const MIN_GAP = 8
  const overlapsOther = (x: number, y: number, tw: number, th: number): boolean => {
    for (const t of tiles.values()) {
      if (t.id === draggedId) continue
      if (
        x + tw <= t.x + MIN_GAP ||
        t.x + t.w + MIN_GAP <= x ||
        y + th <= t.y + MIN_GAP ||
        t.y + t.h + MIN_GAP <= y
      ) {
        continue
      }
      return true
    }
    return false
  }

  const minSeparationStep = (
    ox: number,
    oy: number,
    tw: number,
    th: number,
    t: TileData
  ): { dx: number; dy: number } | null => {
    const sepX = ox + tw <= t.x + MIN_GAP || t.x + t.w + MIN_GAP <= ox
    const sepY = oy + th <= t.y + MIN_GAP || t.y + t.h + MIN_GAP <= oy
    if (sepX || sepY) return null
    const candidates: { dx: number; dy: number }[] = [
      { dx: t.x + t.w + MIN_GAP - ox, dy: 0 },
      { dx: t.x - tw - MIN_GAP - ox, dy: 0 },
      { dx: 0, dy: t.y + t.h + MIN_GAP - oy },
      { dx: 0, dy: t.y - th - MIN_GAP - oy },
    ]
    let best: { dx: number; dy: number } | null = null
    let bestMag = Infinity
    for (const c of candidates) {
      const m = Math.abs(c.dx) + Math.abs(c.dy)
      if (m > 0 && m < bestMag) {
        bestMag = m
        best = c
      }
    }
    return best
  }

  if (overlapsOther(nx, ny, nw, nh)) {
    let ox = nx
    let oy = ny
    for (let pass = 0; pass < 12; pass++) {
      let moved = false
      for (const t of tiles.values()) {
        if (t.id === draggedId) continue
        const step = minSeparationStep(ox, oy, nw, nh, t)
        if (step) {
          ox += step.dx
          oy += step.dy
          moved = true
        }
      }
      if (!moved) break
    }
    nx = ox
    ny = oy
  }

  const targetTileIds: string[] = []
  if (xResizeTargetIds.length > 0) {
    targetTileIds.push(...xResizeTargetIds)
  } else if (xSnap.delta !== 0 && xSnap.target && xSnap.target.tileId !== GRID_SNAP_ID) {
    targetTileIds.push(xSnap.target.tileId)
  }
  if (yResizeTargetIds.length > 0) {
    targetTileIds.push(...yResizeTargetIds)
  } else if (ySnap.delta !== 0 && ySnap.target && ySnap.target.tileId !== GRID_SNAP_ID) {
    targetTileIds.push(ySnap.target.tileId)
  }

  return {
    x: nx,
    y: ny,
    w: nw,
    h: nh,
    guides: {
      verticalX: xSnap.alignAt,
      horizontalY: ySnap.alignAt,
    },
    targetTileIds: [...new Set(targetTileIds)],
  }
}

export interface SnapOverlayState {
  guides: SnapGuides
  previewRect: { x: number; y: number; w: number; h: number }
  targetTileIds: string[]
}

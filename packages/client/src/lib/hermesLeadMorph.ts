export interface MorphPoint {
  x: number
  y: number
}

export interface MorphRect {
  left: number
  top: number
  width: number
  height: number
}

export interface NodeToFocusMorphInput {
  node: MorphPoint
  graphRect: MorphRect
  focusRect: MorphRect
  viewBox: {
    width: number
    height: number
  }
}

export interface NodeToFocusMorphOutput {
  fromX: number
  fromY: number
  toX: number
  toY: number
  deltaX: number
  deltaY: number
  distance: number
  durationMs: number
}

export interface CardShellMorphInput {
  node: MorphPoint & { radius: number }
  graphRect: MorphRect
  focusRect: MorphRect
  viewBox: {
    width: number
    height: number
  }
}

export interface CardShellMorphOutput {
  from: { left: number; top: number; width: number; height: number; radius: number }
  to: { left: number; top: number; width: number; height: number; radius: number }
  deltaX: number
  deltaY: number
  scaleX: number
  scaleY: number
  distance: number
  durationMs: number
}

export interface TileFrameHandoffInput {
  tile: { x: number; y: number; w: number; h: number }
  pan: { x: number; y: number }
  zoom: number
  rootRect: MorphRect
  hostRect: MorphRect
  focusRect: MorphRect
}

export interface TileFrameHandoffOutput {
  from: { left: number; top: number; width: number; height: number }
  to: { left: number; top: number; width: number; height: number }
  durationMs: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function computeNodeToFocusMorph(input: NodeToFocusMorphInput): NodeToFocusMorphOutput {
  const fromX = input.graphRect.left + (input.node.x / Math.max(1, input.viewBox.width)) * input.graphRect.width
  const fromY = input.graphRect.top + (input.node.y / Math.max(1, input.viewBox.height)) * input.graphRect.height
  const toX = input.focusRect.left + input.focusRect.width / 2
  const toY = input.focusRect.top + input.focusRect.height / 2
  const deltaX = toX - fromX
  const deltaY = toY - fromY
  const distance = Math.hypot(deltaX, deltaY)

  return {
    fromX,
    fromY,
    toX,
    toY,
    deltaX,
    deltaY,
    distance,
    durationMs: Math.round(clamp(180 + distance * 0.22, 180, 420)),
  }
}

export function computeCardShellMorph(input: CardShellMorphInput): CardShellMorphOutput {
  const centerMorph = computeNodeToFocusMorph(input)
  const fromWidth = Math.max(20, input.node.radius * 2.6)
  const fromHeight = Math.max(20, input.node.radius * 2.6)

  const fromLeft = centerMorph.fromX - fromWidth / 2
  const fromTop = centerMorph.fromY - fromHeight / 2
  const toLeft = input.focusRect.left
  const toTop = input.focusRect.top

  return {
    from: {
      left: fromLeft,
      top: fromTop,
      width: fromWidth,
      height: fromHeight,
      radius: Math.max(8, input.node.radius),
    },
    to: {
      left: toLeft,
      top: toTop,
      width: input.focusRect.width,
      height: input.focusRect.height,
      radius: 12,
    },
    deltaX: toLeft - fromLeft,
    deltaY: toTop - fromTop,
    scaleX: input.focusRect.width / fromWidth,
    scaleY: input.focusRect.height / fromHeight,
    distance: centerMorph.distance,
    durationMs: Math.round(clamp(220 + centerMorph.distance * 0.2, 220, 480)),
  }
}

export function computeTileFrameHandoff(input: TileFrameHandoffInput): TileFrameHandoffOutput {
  const zoom = Math.max(0.05, input.zoom)
  const tileLeftInViewport = input.hostRect.left + input.pan.x + input.tile.x * zoom
  const tileTopInViewport = input.hostRect.top + input.pan.y + input.tile.y * zoom
  const tileWidthInViewport = Math.max(16, input.tile.w * zoom)
  const tileHeightInViewport = Math.max(16, input.tile.h * zoom)

  const fromLeft = input.focusRect.left - input.rootRect.left
  const fromTop = input.focusRect.top - input.rootRect.top
  const toLeft = tileLeftInViewport - input.rootRect.left
  const toTop = tileTopInViewport - input.rootRect.top

  const centerDx = toLeft + tileWidthInViewport / 2 - (fromLeft + input.focusRect.width / 2)
  const centerDy = toTop + tileHeightInViewport / 2 - (fromTop + input.focusRect.height / 2)
  const distance = Math.hypot(centerDx, centerDy)

  return {
    from: {
      left: fromLeft,
      top: fromTop,
      width: input.focusRect.width,
      height: input.focusRect.height,
    },
    to: {
      left: toLeft,
      top: toTop,
      width: tileWidthInViewport,
      height: tileHeightInViewport,
    },
    durationMs: Math.round(clamp(220 + distance * 0.16, 220, 420)),
  }
}

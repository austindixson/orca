import type { TileData } from '../store/canvasStore'

export function clientToCanvasPoint(
  clientX: number,
  clientY: number,
  pan: { x: number; y: number },
  zoom: number
): { x: number; y: number } | null {
  const el = document.querySelector('[data-testid="infinite-canvas"]')
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return {
    x: (clientX - rect.left - pan.x) / zoom,
    y: (clientY - rect.top - pan.y) / zoom,
  }
}

/** Topmost tile under point (by z-index), excluding `excludeId`. */
export function topTileIdAtCanvasPoint(
  tiles: Map<string, TileData>,
  cx: number,
  cy: number,
  excludeId: string
): string | null {
  const list = Array.from(tiles.values())
    .filter((t) => t.id !== excludeId)
    .sort((a, b) => b.zIndex - a.zIndex)

  for (const t of list) {
    if (cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h) {
      return t.id
    }
  }
  return null
}

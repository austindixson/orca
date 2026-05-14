import type { TileData } from '../../store/canvasStore'

/**
 * Nudge a new tile so it doesn't overlap existing tiles (world space).
 * Exported for anchor zone placement and canvas spawn.
 */
export function findNonOverlappingPosition(
  tiles: Map<string, TileData>,
  newWidth: number,
  newHeight: number,
  preferredX: number,
  preferredY: number
): { x: number; y: number } {
  const tilesArray = Array.from(tiles.values())

  const overlaps = (x: number, y: number, w: number, h: number): boolean => {
    const padding = 20
    return tilesArray.some(
      (tile) =>
        x < tile.x + tile.w + padding &&
        x + w + padding > tile.x &&
        y < tile.y + tile.h + padding &&
        y + h + padding > tile.y
    )
  }

  if (!overlaps(preferredX, preferredY, newWidth, newHeight)) {
    return { x: preferredX, y: preferredY }
  }

  const offsets = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: -1, dy: -1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },
  ]

  const step = 50
  for (let distance = step; distance < 2000; distance += step) {
    for (const { dx, dy } of offsets) {
      const testX = preferredX + dx * distance
      const testY = preferredY + dy * distance
      if (!overlaps(testX, testY, newWidth, newHeight)) {
        return { x: testX, y: testY }
      }
    }
  }

  return { x: preferredX + 100, y: preferredY + 100 }
}

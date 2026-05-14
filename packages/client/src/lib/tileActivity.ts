/**
 * Shared activity ledger for the idle-tile reaper. Kept in its own module so
 * `canvasStore` can poke activity timestamps without pulling in the reaper's
 * scheduling logic (which imports from `canvasStore`, creating a cycle).
 */

const lastActivityAt = new Map<string, number>()

/** Record user-visible activity for a tile. */
export function markTileActivity(tileId: string, at: number = Date.now()): void {
  lastActivityAt.set(tileId, at)
}

/** Forget any tracked activity for a tile (tile removed, or test reset). */
export function forgetTileActivity(tileId: string): void {
  lastActivityAt.delete(tileId)
}

/** Current timestamp for a tile, or undefined if never marked. */
export function getTileLastActivityAt(tileId: string): number | undefined {
  return lastActivityAt.get(tileId)
}

/** All tile ids with recorded activity. */
export function listTrackedTileIds(): string[] {
  return Array.from(lastActivityAt.keys())
}

/** Seed activity timestamps for all currently-active tiles. */
export function seedActivityForIds(ids: Iterable<string>, now: number = Date.now()): void {
  for (const id of ids) lastActivityAt.set(id, now)
}

/** Drop every entry (tests / reaper stop). */
export function clearAllTileActivity(): void {
  lastActivityAt.clear()
}

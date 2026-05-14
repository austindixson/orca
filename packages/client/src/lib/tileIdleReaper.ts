/**
 * Idle-tile reaper. When an `active` tile has not been interacted with for the
 * configured idle window, demote it back to `placeholder` so its heavy content
 * unmounts (freeing memory, closing streams, pausing renderers). The user can
 * re-activate it with a click — `TilePlaceholder` / `activateTileManually` in
 * `workspaceRebuilder` already know how to promote a single tile on demand.
 *
 * Tiles that own long-running side effects whose state would be lost on silent
 * collapse are exempt (terminal PTY, live browser page, active agent turn, etc).
 */

import { useCanvasStore, type TileData, type TileType } from '../store/canvasStore'
import { clearTileAck } from '../hooks/useTileMountAck'
import { isCanvasPersistenceHydrating } from './canvasStatePersistence'
import { useWorkspaceRebuildStore } from '../store/workspaceRebuildStore'
import {
  clearAllTileActivity,
  forgetTileActivity,
  getTileLastActivityAt,
  listTrackedTileIds,
  seedActivityForIds,
} from './tileActivity'

export const TILE_IDLE_CLOSE_MS = 10_000
const REAPER_TICK_MS = 2_000

/** Tile types that keep their own side-effects; silent collapse is confusing here. */
const IDLE_EXEMPT_TYPES: ReadonlySet<TileType> = new Set<TileType>([
  'terminal',
  'browser',
  'agent',
  'agent_team',
  'hermes_agent',
  'orchestrator',
  'remotion',
])

function shouldCollapseTile(
  tile: TileData,
  now: number,
  activeInteractionTileId: string | null,
): boolean {
  if (tile.hydrationStage !== 'active') return false
  if (tile.id === activeInteractionTileId) return false
  if (IDLE_EXEMPT_TYPES.has(tile.type)) return false
  const last = getTileLastActivityAt(tile.id) ?? now
  return now - last >= TILE_IDLE_CLOSE_MS
}

function reap(): void {
  if (isCanvasPersistenceHydrating()) return

  const rebuild = useWorkspaceRebuildStore.getState()
  if (rebuild.phase === 'running' || rebuild.phase === 'paused' || rebuild.phase === 'queued') {
    return
  }

  const canvas = useCanvasStore.getState()
  const now = Date.now()
  const toCollapse: string[] = []
  for (const tile of canvas.tiles.values()) {
    if (shouldCollapseTile(tile, now, canvas.activeInteractionTileId)) {
      toCollapse.push(tile.id)
    }
  }
  if (toCollapse.length === 0) return

  for (const id of toCollapse) {
    clearTileAck(id)
    canvas.markTilePlaceholder(id)
    forgetTileActivity(id)
  }
}

let tickHandle: ReturnType<typeof setInterval> | null = null
let unsubCanvas: (() => void) | null = null

/** Start the idle-tile reaper. Safe to call multiple times (dedupes). Returns a stop fn. */
export function startTileIdleReaper(): () => void {
  if (tickHandle !== null) return stopTileIdleReaper
  const now = Date.now()
  const activeIds: string[] = []
  for (const tile of useCanvasStore.getState().tiles.values()) {
    if (tile.hydrationStage === 'active') activeIds.push(tile.id)
  }
  seedActivityForIds(activeIds, now)

  // Prune activity entries for tiles that disappeared between ticks.
  unsubCanvas = useCanvasStore.subscribe((state, prev) => {
    if (state.tiles === prev.tiles) return
    for (const id of listTrackedTileIds()) {
      if (!state.tiles.has(id)) forgetTileActivity(id)
    }
  })

  tickHandle = setInterval(reap, REAPER_TICK_MS)
  return stopTileIdleReaper
}

export function stopTileIdleReaper(): void {
  if (tickHandle !== null) {
    clearInterval(tickHandle)
    tickHandle = null
  }
  if (unsubCanvas) {
    unsubCanvas()
    unsubCanvas = null
  }
}

/** Test hook. */
export function __resetTileIdleReaperForTests(): void {
  stopTileIdleReaper()
  clearAllTileActivity()
}

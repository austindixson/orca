/**
 * Workspace rebuild scheduler.
 * Coordinates adaptive tile activation with pacing, backpressure, and user controls.
 */

import { useCanvasStore, type SerializedCanvasState } from '../store/canvasStore'
import {
  useWorkspaceRebuildStore,
  type RebuildMode,
} from '../store/workspaceRebuildStore'
import {
  getTileCost,
  sortTileIdsByCost,
  isHeavyTile,
  CLASS_MIN_GAP_MS,
  CLASS_MAX_WAIT_MS,
  type TileCostClass,
} from './tileLoadProfile'
import {
  waitForTileMountAck,
  clearAllTileAcks,
} from '../hooks/useTileMountAck'

export interface RebuildWorkspaceOptions {
  mode: RebuildMode
  isCurrent: () => boolean
  /**
   * Large tile counts: only auto-activate light tiles; medium/heavy require a click.
   * @see MEGA_WORKSPACE_TILE_THRESHOLD in tileLoadProfile
   */
  megaWorkspace?: boolean
}

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number
      totalJSHeapSize: number
      jsHeapSizeLimit: number
    }
  }
}

let lastHeapSize = 0

function getHeapSize(): number {
  return performance.memory?.usedJSHeapSize ?? 0
}

function hasMemoryPressure(): boolean {
  const current = getHeapSize()
  if (lastHeapSize === 0) {
    lastHeapSize = current
    return false
  }
  const growth = (current - lastHeapSize) / lastHeapSize
  lastHeapSize = current
  return growth > 0.25
}

function requestIdleCallbackPolyfill(
  callback: () => void,
  options?: { timeout?: number }
): number {
  if (typeof requestIdleCallback !== 'undefined') {
    return requestIdleCallback(callback, options)
  }
  return window.setTimeout(callback, options?.timeout ?? 50) as unknown as number
}

function waitForIdle(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    requestIdleCallbackPolyfill(resolve, { timeout: timeoutMs })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wait for two animation frames so React commits AND paints before we proceed.
 * Critical between `markTileActive` calls: otherwise multiple heavy mounts can
 * stack up on a single frame and lock the main thread.
 */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'undefined') {
      setTimeout(resolve, 16)
      return
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

/**
 * Wait for a tile to be ready before proceeding to the next.
 * Combines mount-ack, requestIdleCallback, and memory probing.
 */
async function waitForTileReady(
  tileId: string,
  cost: TileCostClass,
  isCurrent: () => boolean
): Promise<void> {
  const maxWait = CLASS_MAX_WAIT_MS[cost]
  const minGap = CLASS_MIN_GAP_MS[cost]

  const start = Date.now()

  await Promise.race([
    waitForTileMountAck(tileId, maxWait),
    waitForIdle(maxWait),
  ])

  if (!isCurrent()) return

  const elapsed = Date.now() - start
  const remainingGap = Math.max(0, minGap - elapsed)

  let actualGap = remainingGap
  if (hasMemoryPressure() && cost !== 'light') {
    actualGap = Math.min(remainingGap * 2, 1000)
  }

  if (actualGap > 0) {
    await sleep(actualGap)
  }
}

/**
 * Sort tiles for rebuild queue.
 * Order: light → medium → heavy, with viewport-visible tiles first within each class.
 */
function buildRebuildQueue(
  tileIds: string[],
  mode: RebuildMode,
  megaWorkspace: boolean
): string[] {
  const canvasStore = useCanvasStore.getState()
  const tiles = canvasStore.tiles

  const getTileType = (id: string) => tiles.get(id)?.type

  let sortedIds = sortTileIdsByCost(tileIds, getTileType)

  if (megaWorkspace) {
    return sortedIds.filter((id) => {
      const tile = tiles.get(id)
      if (!tile) return false
      // Keep orchestration available immediately on reopen even in huge layouts.
      return getTileCost(tile.type) === 'light' || tile.type === 'orchestrator'
    })
  }

  if (mode === 'safe') {
    sortedIds = sortedIds.filter((id) => {
      const tile = tiles.get(id)
      return tile && !isHeavyTile(tile.type)
    })
  }

  return sortedIds
}

/**
 * Tiles that stay as placeholders until the user clicks Activate.
 * - Safe mode (incomplete last rebuild): heavy only.
 * - Mega workspace: medium + heavy (too many tiles to auto-mount semi-heavy surfaces).
 */
function getParkedPlaceholderIds(
  tileIds: string[],
  mode: RebuildMode,
  megaWorkspace: boolean
): string[] {
  const canvasStore = useCanvasStore.getState()
  const tiles = canvasStore.tiles

  if (megaWorkspace) {
    return tileIds.filter((id) => {
      const tile = tiles.get(id)
      if (!tile) return false
      // Orchestrator remains eagerly mounted; other non-light tiles stay parked.
      return getTileCost(tile.type) !== 'light' && tile.type !== 'orchestrator'
    })
  }

  if (mode !== 'safe') return []

  return tileIds.filter((id) => {
    const tile = tiles.get(id)
    return tile && isHeavyTile(tile.type)
  })
}

/**
 * Main workspace rebuild function.
 * Phase 1: Insert all tiles as placeholders synchronously.
 * Phase 2: Activate tiles one-by-one with adaptive pacing.
 */
export async function rebuildWorkspace(
  snapshot: SerializedCanvasState,
  opts: RebuildWorkspaceOptions
): Promise<void> {
  const { mode, isCurrent, megaWorkspace = false } = opts
  const canvasStore = useCanvasStore.getState()
  const rebuildStore = useWorkspaceRebuildStore.getState()

  clearAllTileAcks()
  lastHeapSize = getHeapSize()

  canvasStore.hydrateFromPersistenceAsPlaceholders(snapshot)

  if (!isCurrent()) return

  const allTileIds = snapshot.tiles.map((t) => t.id)
  const orchestratorIds = snapshot.tiles
    .filter((t) => t.type === 'orchestrator')
    .map((t) => t.id)

  // Eagerly activate orchestrator surfaces so reopen always restores the primary control plane
  // immediately, regardless of mega-workspace gating or slower tile mount-ack pacing.
  for (const id of orchestratorIds) {
    canvasStore.markTileActive(id)
  }

  const orchestratorSet = new Set(orchestratorIds)
  const queue = buildRebuildQueue(allTileIds, mode, megaWorkspace).filter(
    (id) => !orchestratorSet.has(id)
  )
  const parkedHeavy = getParkedPlaceholderIds(allTileIds, mode, megaWorkspace)

  rebuildStore.startRebuild(queue, mode)

  if (parkedHeavy.length > 0) {
    useWorkspaceRebuildStore.setState({ parkedHeavyIds: parkedHeavy })
  }

  // Let the browser paint the placeholder layout before we start flipping tiles
  // to active. Without this, React batches the placeholder commit with the first
  // few `markTileActive` mounts, which locks the main thread for the full cost
  // of every heavy tile — the "open project freezes" symptom.
  await waitForPaint()

  const tiles = canvasStore.tiles

  for (const tileId of queue) {
    if (!isCurrent()) {
      rebuildStore.reset()
      return
    }

    const { phase } = useWorkspaceRebuildStore.getState()

    if (phase === 'paused') {
      await rebuildStore.waitForResume()
      if (!isCurrent()) {
        rebuildStore.reset()
        return
      }
    }

    const currentPhase = useWorkspaceRebuildStore.getState().phase
    if (currentPhase === 'safe') {
      const tile = tiles.get(tileId)
      if (tile && isHeavyTile(tile.type)) {
        continue
      }
    }

    rebuildStore.setCurrentTile(tileId)

    canvasStore.markTileActive(tileId)

    // Paint before we race mount-ack/idle — guarantees the tile actually starts
    // mounting instead of being batched with the next placeholder flip.
    await waitForPaint()

    const tile = tiles.get(tileId)
    const cost = tile ? getTileCost(tile.type) : 'medium'

    await waitForTileReady(tileId, cost, isCurrent)

    if (!isCurrent()) {
      rebuildStore.reset()
      return
    }

    rebuildStore.markTileCompleted(tileId)
  }

  rebuildStore.finishRebuild()
}

/**
 * Activate a single tile manually (from placeholder click).
 * Used when user clicks "Activate" on a parked/paused tile.
 */
export async function activateTileManually(tileId: string): Promise<void> {
  const canvasStore = useCanvasStore.getState()
  const rebuildStore = useWorkspaceRebuildStore.getState()

  rebuildStore.unpark(tileId)

  canvasStore.markTileActive(tileId)
  await waitForPaint()

  const tile = canvasStore.tiles.get(tileId)
  const cost = tile ? getTileCost(tile.type) : 'medium'

  await waitForTileReady(tileId, cost, () => true)
}

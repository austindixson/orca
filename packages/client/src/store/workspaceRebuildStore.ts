/**
 * Store for workspace rebuild scheduler state.
 * Drives the progress banner and coordinates tile activation pacing.
 */

import { create } from 'zustand'
import { useCanvasStore } from './canvasStore'
import { isHeavyTile } from '../lib/tileLoadProfile'
import { ingestOrchestratorStructuredEvent } from '../lib/devTelemetryIngest'

export type RebuildPhase = 'idle' | 'queued' | 'running' | 'paused' | 'safe' | 'done'
export type RebuildMode = 'hybrid' | 'safe'

export type CanvasSafeModeReason = 'incomplete_previous_rebuild'

interface WorkspaceRebuildState {
  /** Current rebuild phase. 'idle' when no rebuild active, 'done' when complete. */
  phase: RebuildPhase
  /** Rebuild mode: 'hybrid' auto-activates all, 'safe' leaves heavy tiles paused. */
  mode: RebuildMode
  /** Total number of tiles being rebuilt. */
  total: number
  /** Number of tiles that have been activated so far. */
  completed: number
  /** ID of the tile currently being activated (null if none). */
  currentTileId: string | null
  /** Remaining tile IDs in the queue. */
  queue: string[]
  /** IDs of heavy tiles that are parked (in safe mode or after pause). */
  parkedHeavyIds: string[]
  /** Promise resolver to signal resume from pause. */
  _resumeResolver: (() => void) | null

  /**
   * Set when canvas persistence detects an incomplete previous rebuild (Safe Mode).
   * Cleared by user recovery action or when all parked heavy tiles are activated.
   */
  canvasSafeModeDiagnostics: {
    reason: CanvasSafeModeReason
    enteredAt: number
    megaWorkspace: boolean
  } | null

  /** Start a rebuild with the given queue. */
  startRebuild: (tileIds: string[], mode: RebuildMode) => void
  /** Pause the rebuild (waits after current tile). */
  pause: () => void
  /** Resume from pause. */
  resume: () => void
  /** Enter safe mode: park all remaining heavy tiles as placeholders. */
  enterSafeMode: () => void
  /** Manually activate a single tile (from placeholder click). */
  activateTile: (id: string) => void
  /** Called by scheduler when it starts activating a tile. */
  setCurrentTile: (id: string | null) => void
  /** Called by scheduler when a tile activation completes. */
  markTileCompleted: (id: string) => void
  /** Called by scheduler when rebuild finishes. */
  finishRebuild: () => void
  /** Reset to idle state. */
  reset: () => void
  /** Record Safe Mode entry (canvas persistence). */
  setCanvasSafeModeDiagnostics: (d: {
    reason: CanvasSafeModeReason
    enteredAt: number
    megaWorkspace: boolean
  }) => void
  /** Clear Safe Mode banner after user recovery. */
  clearCanvasSafeModeDiagnostics: () => void
  /** Force-drain the queue, activating all remaining tiles immediately. */
  activateAllNow: () => void
  /** Returns a promise that resolves when resumed (for pause handling). */
  waitForResume: () => Promise<void>
  /** Remove a tile from parked list (when manually activated). */
  unpark: (id: string) => void
}

export const useWorkspaceRebuildStore = create<WorkspaceRebuildState>((set, get) => ({
  phase: 'idle',
  mode: 'hybrid',
  total: 0,
  completed: 0,
  currentTileId: null,
  queue: [],
  parkedHeavyIds: [],
  _resumeResolver: null,
  canvasSafeModeDiagnostics: null,

  startRebuild: (tileIds, mode) => {
    set({
      phase: 'queued',
      mode,
      total: tileIds.length,
      completed: 0,
      currentTileId: null,
      queue: [...tileIds],
      parkedHeavyIds: [],
      _resumeResolver: null,
    })
  },

  pause: () => {
    const { phase } = get()
    if (phase === 'running' || phase === 'queued') {
      set({ phase: 'paused' })
    }
  },

  resume: () => {
    const { phase, _resumeResolver } = get()
    if (phase === 'paused') {
      set({ phase: 'running', _resumeResolver: null })
      _resumeResolver?.()
    }
  },

  enterSafeMode: () => {
    const { queue } = get()
    const canvasStore = useCanvasStore.getState()
    const tiles = canvasStore.tiles

    const parked: string[] = []
    const remainingQueue: string[] = []

    for (const id of queue) {
      const tile = tiles.get(id)
      if (tile && isHeavyTile(tile.type)) {
        parked.push(id)
      } else {
        remainingQueue.push(id)
      }
    }

    set({
      phase: 'safe',
      queue: remainingQueue,
      parkedHeavyIds: parked,
    })
  },

  activateTile: (id) => {
    const { parkedHeavyIds, completed, canvasSafeModeDiagnostics } = get()
    const canvasStore = useCanvasStore.getState()

    canvasStore.markTileActive(id)

    const newParked = parkedHeavyIds.filter((pid) => pid !== id)
    const shouldClearSafeBanner = newParked.length === 0 && canvasSafeModeDiagnostics != null
    set({
      parkedHeavyIds: newParked,
      completed: completed + 1,
      canvasSafeModeDiagnostics: shouldClearSafeBanner ? null : canvasSafeModeDiagnostics,
    })
    if (shouldClearSafeBanner) {
      ingestOrchestratorStructuredEvent({
        kind: 'canvas_safe_mode_recover',
        source: 'canvas_persistence',
        level: 'info',
        payload: { via: 'per_tile_activation' },
      })
    }
  },

  setCurrentTile: (id) => {
    const { phase } = get()
    if (phase === 'queued') {
      set({ phase: 'running', currentTileId: id })
    } else {
      set({ currentTileId: id })
    }
  },

  markTileCompleted: (id) => {
    const { queue, completed } = get()
    const newQueue = queue.filter((qid) => qid !== id)
    set({
      queue: newQueue,
      completed: completed + 1,
      currentTileId: null,
    })
  },

  finishRebuild: () => {
    set({ phase: 'done', currentTileId: null })
  },

  reset: () => {
    set({
      phase: 'idle',
      mode: 'hybrid',
      total: 0,
      completed: 0,
      currentTileId: null,
      queue: [],
      parkedHeavyIds: [],
      _resumeResolver: null,
      canvasSafeModeDiagnostics: null,
    })
  },

  setCanvasSafeModeDiagnostics: (d) => {
    set({ canvasSafeModeDiagnostics: d })
  },

  clearCanvasSafeModeDiagnostics: () => {
    set({ canvasSafeModeDiagnostics: null })
  },

  activateAllNow: () => {
    const { queue, parkedHeavyIds, completed, canvasSafeModeDiagnostics } = get()
    const canvasStore = useCanvasStore.getState()

    const allRemaining = [...queue, ...parkedHeavyIds]
    for (const id of allRemaining) {
      canvasStore.markTileActive(id)
    }

    if (canvasSafeModeDiagnostics) {
      ingestOrchestratorStructuredEvent({
        kind: 'canvas_safe_mode_recover',
        source: 'canvas_persistence',
        level: 'info',
        payload: { via: 'activate_all_now' },
      })
    }

    set({
      phase: 'done',
      queue: [],
      parkedHeavyIds: [],
      completed: completed + allRemaining.length,
      currentTileId: null,
      canvasSafeModeDiagnostics: null,
    })
  },

  waitForResume: () => {
    return new Promise<void>((resolve) => {
      const { phase } = get()
      if (phase !== 'paused') {
        resolve()
        return
      }
      set({ _resumeResolver: resolve })
    })
  },

  unpark: (id) => {
    const { parkedHeavyIds } = get()
    set({ parkedHeavyIds: parkedHeavyIds.filter((pid) => pid !== id) })
  },
}))

/** Helper to check if a rebuild is actively in progress. */
export function isRebuildActive(): boolean {
  const { phase } = useWorkspaceRebuildStore.getState()
  return phase !== 'idle' && phase !== 'done'
}

/** Helper to get count of heavy tiles still parked. */
export function getParkedHeavyCount(): number {
  return useWorkspaceRebuildStore.getState().parkedHeavyIds.length
}

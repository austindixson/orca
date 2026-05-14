/**
 * Persist canvas tiles + camera to `.agent-canvas/canvas-state.json` (workspace-relative).
 * Save on workspace switch and debounced while editing.
 */

import * as tauri from './tauri'
import {
  serializeCanvasState,
  parseSerializedCanvasState,
  useCanvasStore,
  type SerializedCanvasState,
  type TileData,
} from '../store/canvasStore'
import { useAgentTeamStore } from '../store/agentTeamStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useWorkspaceRebuildStore } from '../store/workspaceRebuildStore'
import { rebuildWorkspace } from './workspaceRebuilder'
import { MEGA_WORKSPACE_TILE_THRESHOLD } from './tileLoadProfile'
import { useToastStore } from '../store/toastStore'
import { ingestOrchestratorStructuredEvent } from './devTelemetryIngest'

export const CANVAS_STATE_RELATIVE_PATH = '.agent-canvas/canvas-state.json'
export const REBUILD_STATE_RELATIVE_PATH = '.agent-canvas/rebuild-state.json'

/** Delay between each tile when restoring a saved layout (first tile is immediate). */
export const STAGGER_TILE_RESTORE_MS = 500

/** Breadcrumb written at rebuild start, updated on completion. */
interface RebuildBreadcrumb {
  snapshotHash: string
  startedAt: number
  completed: boolean
  completedAt?: number
}

function computeSnapshotHash(snapshot: SerializedCanvasState): string {
  const tileIds = snapshot.tiles.map((t) => t.id).sort().join(',')
  const tileTypes = snapshot.tiles.map((t) => t.type).sort().join(',')
  return `${snapshot.tiles.length}:${tileIds.slice(0, 50)}:${tileTypes.slice(0, 50)}`
}

let persistenceHydrating = false
/** True while applying `.agent-canvas/canvas-state.json` (tile stagger, rebuild). Vault mirrors should defer. */
export function isCanvasPersistenceHydrating(): boolean {
  return persistenceHydrating
}
/** Bumped when a new workspace canvas load starts so an in-flight staggered restore can abort. */
let canvasLoadGeneration = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 800

function resetCanvasToEmpty(): void {
  useCanvasStore.getState().clearAllTiles()
  useCanvasStore.setState({
    pan: { x: 0, y: 0 },
    zoom: 1,
    maxZIndex: 0,
    layoutAnchor: null,
    anchorTileId: null,
  })
}

async function readRebuildBreadcrumb(): Promise<RebuildBreadcrumb | null> {
  try {
    const rawText = await tauri.readFile(REBUILD_STATE_RELATIVE_PATH)
    const parsed = JSON.parse(rawText) as RebuildBreadcrumb
    if (
      typeof parsed.snapshotHash === 'string' &&
      typeof parsed.startedAt === 'number' &&
      typeof parsed.completed === 'boolean'
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

async function writeRebuildBreadcrumb(breadcrumb: RebuildBreadcrumb): Promise<void> {
  try {
    await tauri.createDirectory('.agent-canvas')
  } catch {
    /* may already exist */
  }
  try {
    await tauri.writeFile(REBUILD_STATE_RELATIVE_PATH, JSON.stringify(breadcrumb, null, 2))
  } catch (e) {
    console.warn('[canvas-persistence] failed to write rebuild breadcrumb:', e)
  }
}

async function clearRebuildBreadcrumb(): Promise<void> {
  try {
    await tauri.deletePath(REBUILD_STATE_RELATIVE_PATH)
  } catch {
    /* file may not exist */
  }
}

/** Removes `.agent-canvas/rebuild-state.json` (e.g. stale incomplete-rebuild marker). Desktop workspace-relative. */
export async function clearCanvasRebuildStateBreadcrumb(): Promise<void> {
  await clearRebuildBreadcrumb()
}

function isPersistableWorkspaceRoot(rootPath: string | undefined | null): boolean {
  return Boolean(rootPath && rootPath !== '.' && rootPath.length > 0)
}

/** Skip debounced save while applying a snapshot from disk. */
export function setCanvasPersistenceHydrating(value: boolean): void {
  persistenceHydrating = value
}

/**
 * Build the orchestrator-only snapshot that gets persisted between sessions.
 *
 * Design note — "orchestrator-only" persistence:
 *
 *   Previously we saved every tile on the canvas, which made reopening large
 *   projects slow and error-prone (Mega Workspace mode, staggered rebuild,
 *   Safe Mode). The new model is simpler:
 *
 *     • Only the orchestrator tile survives a project close.
 *     • Todos persist independently in `~/.orca/tasks/<ws>.json`.
 *     • Orchestrator chat persists in `~/.orca/sessions/<id>/conversation.jsonl`
 *       (with auto-compaction + long-term memory in `~/.orca/MEMORY.md`).
 *     • Per-tile caches (terminal scrollback, browser tabs, editor buffers)
 *       have their own stores and reappear when the orchestrator (or user)
 *       re-opens those modules.
 *
 *   On reopen the user sees the orchestrator with full chat + task list and
 *   can resume work — either by sending a new message or by the orchestrator
 *   picking up pending tasks on its next turn. No staggered rebuild, no Safe
 *   Mode, no multi-second freeze on large layouts.
 *
 *   Old canvas-state.json files (from before this change) are still loaded
 *   correctly via the normal restore path; the next save rewrites them in
 *   the new orchestrator-only shape.
 */
function buildOrchestratorOnlySnapshot(): SerializedCanvasState {
  const state = useCanvasStore.getState()
  const keep = new Map<string, TileData>()
  for (const [id, t] of state.tiles) {
    if (t.type === 'orchestrator') keep.set(id, t)
  }
  const filteredState = {
    tiles: keep,
    pan: state.pan,
    zoom: state.zoom,
    maxZIndex: state.maxZIndex,
    layoutAnchor: state.layoutAnchor,
    anchorTileId: state.anchorTileId && keep.has(state.anchorTileId) ? state.anchorTileId : null,
  }
  const snapshot = serializeCanvasState(filteredState)
  // No delegated sub-agent tiles survive, so drop the persisted roster too.
  const { agentTeamMembers: _dropped, ...cleaned } = snapshot
  return cleaned
}

export async function saveCanvasStateToWorkspaceFile(rootPath: string): Promise<void> {
  if (!isPersistableWorkspaceRoot(rootPath)) return
  try {
    const snapshot = buildOrchestratorOnlySnapshot()
    const json = JSON.stringify(snapshot, null, 2)
    try {
      await tauri.createDirectory('.agent-canvas')
    } catch {
      /* may already exist */
    }
    await tauri.writeFile(CANVAS_STATE_RELATIVE_PATH, json)
  } catch (e) {
    console.warn('[canvas-persistence] save failed:', e)
  }
}

export async function loadCanvasStateFromWorkspaceFile(rootPath: string): Promise<void> {
  if (!isPersistableWorkspaceRoot(rootPath)) return
  setCanvasPersistenceHydrating(true)

  useWorkspaceRebuildStore.getState().reset()

  try {
    let rawText: string
    try {
      rawText = await tauri.readFile(CANVAS_STATE_RELATIVE_PATH)
    } catch {
      /* missing file — fresh canvas */
      resetCanvasToEmpty()
      await clearRebuildBreadcrumb()
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText) as unknown
    } catch {
      console.warn('[canvas-persistence] invalid JSON in canvas-state.json')
      resetCanvasToEmpty()
      await clearRebuildBreadcrumb()
      return
    }
    const snapshot = parseSerializedCanvasState(parsed)
    if (!snapshot) {
      console.warn('[canvas-persistence] canvas-state.json schema invalid; resetting canvas')
      resetCanvasToEmpty()
      await clearRebuildBreadcrumb()
      return
    }

    const snapshotHash = computeSnapshotHash(snapshot)
    const breadcrumb = await readRebuildBreadcrumb()
    let shouldEnterSafeMode = false

    if (breadcrumb && breadcrumb.snapshotHash === snapshotHash && !breadcrumb.completed) {
      shouldEnterSafeMode = true
      console.warn('[canvas-persistence] Previous rebuild did not complete — entering Safe Mode')
    }

    const megaWorkspace = snapshot.tiles.length >= MEGA_WORKSPACE_TILE_THRESHOLD

    if (shouldEnterSafeMode) {
      const enteredAt = Date.now()
      useWorkspaceRebuildStore.getState().setCanvasSafeModeDiagnostics({
        reason: 'incomplete_previous_rebuild',
        enteredAt,
        megaWorkspace,
      })
      ingestOrchestratorStructuredEvent({
        kind: 'canvas_safe_mode_enter',
        source: 'canvas_persistence',
        level: 'warn',
        payload: {
          reason: 'incomplete_previous_rebuild',
          enteredAt,
          megaWorkspace,
          tileCount: snapshot.tiles.length,
        },
      })
    }

    if (shouldEnterSafeMode && megaWorkspace) {
      useToastStore.getState().addToast({
        type: 'warning',
        title: 'Safe Mode · Large workspace',
        message:
          `Last session did not finish loading, and this layout has many tiles (${snapshot.tiles.length}). Lightweight tiles and orchestrators load automatically — click a tile for terminals, browsers, and editors.`,
      })
    } else if (shouldEnterSafeMode) {
      useToastStore.getState().addToast({
        type: 'warning',
        title: 'Safe Mode',
        message:
          "Last session didn't finish loading — heavy tiles paused. Click any tile to activate.",
      })
    } else if (megaWorkspace) {
      useToastStore.getState().addToast({
        type: 'info',
        title: 'Large workspace',
        message:
          `This layout has many tiles (${snapshot.tiles.length}). Lightweight tiles and orchestrators load automatically — click a tile to open editors, terminals, and browsers.`,
      })
    }

    await writeRebuildBreadcrumb({
      snapshotHash,
      startedAt: Date.now(),
      completed: false,
    })

    const loadGen = ++canvasLoadGeneration

    await rebuildWorkspace(snapshot, {
      mode: shouldEnterSafeMode ? 'safe' : 'hybrid',
      megaWorkspace,
      isCurrent: () => loadGen === canvasLoadGeneration,
    })

    if (loadGen === canvasLoadGeneration) {
      await writeRebuildBreadcrumb({
        snapshotHash,
        startedAt: breadcrumb?.startedAt ?? Date.now(),
        completed: true,
        completedAt: Date.now(),
      })
    }
  } catch (e) {
    console.warn('[canvas-persistence] load failed:', e)
  } finally {
    setCanvasPersistenceHydrating(false)
  }
}

/** Call before changing workspace root: persist current canvas for `previousRootPath`. */
export async function saveCanvasStateBeforeWorkspaceSwitch(previousRootPath: string | undefined): Promise<void> {
  if (!isPersistableWorkspaceRoot(previousRootPath)) return
  await saveCanvasStateToWorkspaceFile(previousRootPath!)
}

/** Subscribe to canvas + delegated agent roster; debounced save when either changes. */
export function subscribeCanvasAutoSave(): () => void {
  const schedule = () => {
    if (persistenceHydrating) return
    const root = useWorkspaceStore.getState().rootPath
    if (!isPersistableWorkspaceRoot(root)) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveCanvasStateToWorkspaceFile(root)
    }, DEBOUNCE_MS)
  }
  const unsubCanvas = useCanvasStore.subscribe(schedule)
  const unsubTeam = useAgentTeamStore.subscribe(schedule)
  return () => {
    unsubCanvas()
    unsubTeam()
  }
}

/**
 * Drop the debounce and start a save immediately (fire-and-forget).
 * Use on window close / beforeunload so we never block teardown on a timer or show a “wait for save” UX.
 */
export function flushPendingCanvasSaveNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (persistenceHydrating) return
  const root = useWorkspaceStore.getState().rootPath
  if (!isPersistableWorkspaceRoot(root)) return
  void saveCanvasStateToWorkspaceFile(root)
}

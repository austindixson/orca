import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { SnapOverlayState } from '../lib/snapTiles'
import type { TileLayoutUpdate } from '../lib/layoutPresets'
import {
  computePanZoomToFitTiles,
  computePresetLayout,
  getViewportLayoutRect,
  sortTilesForLayout,
} from '../lib/layoutPresets'
import {
  computeSmartCollapseLayout,
  SMART_COLLAPSE_DEFAULT_MAIN_RATIO,
} from '../lib/smartCollapseLayout'
import { findStackedPosition } from '../lib/stackedLayout'
import { computeIntelligentPosition } from '../lib/layout/anchorLayout'
import { findNonOverlappingPosition } from '../lib/layout/placement'
import { resolveOverlapsAround, TILE_MAX_CLUSTER_GAP } from '../lib/layout/repulsion'
import { forceSettle } from '../lib/layout/forceSettle'
import type { WorkspaceContext } from '../lib/layout/workspaceContext'
import { useSettingsStore, type Provider } from './settingsStore'
import { useAgentTeamStore, type AgentTeamMember, type AgentTeamMemberStatus } from './agentTeamStore'
import { useFocusStore } from './focusStore'
import { forgetTileActivity, markTileActivity } from '../lib/tileActivity'
import { refocusOrchestratorIfClosedTileWasActive } from '../lib/orchestrator/refocusOrchestratorOnTileClose'
import * as tauri from '../lib/tauri'

let panAnimationRaf = 0

/** Tear down in-flight work and agent roster, then bulk-replace tiles (avoid N× removeTile on huge canvases). */
function resetForFullCanvasHydration(): void {
  useAgentTeamStore.getState().abortAllRegisteredRuns()
  useAgentTeamStore.getState().clear()
}

/** Canvas zoom bounds (match usePanZoom wheel clamp). */
export const CANVAS_ZOOM_MIN = 0.08
export const CANVAS_ZOOM_MAX = 2.5

function clampZoom(z: number): number {
  return Math.max(CANVAS_ZOOM_MIN, Math.min(CANVAS_ZOOM_MAX, z))
}

export type TileType =
  | 'terminal'
  | 'editor'
  | 'browser'
  | 'agent_browser'
  | 'github'
  | 'diff'
  | 'todo'
  | 'agent'
  | 'agent_team'
  | 'agent_group_chat'
  | 'changelog'
  | 'orchestrator'
  | 'benchmark'
  | 'remotion'
  | 'openrouter_usage'
  | 'toolbox'
  | 'research'
  | 'reasoning'
  | 'project_status'
  | 'telemetry'
  | 'hermes_bridge'
  | 'hermes_agent'
  | 'telegram_onboard'
  | 'native_gateway'
  | 'bug_bounty'

/** Meta interface for agent_browser tile. */
export interface AgentBrowserTileMeta {
  sessionName?: string
  streamPort?: number
  currentUrl?: string
  lastSnapshot?: string
  /** Last session/backend failure shown in the tile (cleared on success). */
  lastSessionError?: string
  cursorPosition?: { x: number; y: number }
  viewportSize?: { width: number; height: number }
  /**
   * One-shot hint from `browser_click` (orchestrator) so the tile can replay
   * move/dwell/click visuals without blocking the tool round.
   */
  agentBrowserPresentation?: { targetX: number; targetY: number; requestId: string }
}

/** Optional status for Orca-style header badge (tile chrome). */
export type TileStatus = 'idle' | 'working' | 'waiting' | 'done' | 'error' | 'warning'

/** One tab inside a consolidated module tile (non-Picasso: one tile per module type). */
export interface TileModuleTab {
  id: string
  title: string
  meta: Record<string, unknown>
}

/** Hydration stage for workspace rebuild scheduler. */
export type TileHydrationStage = 'placeholder' | 'active'

export interface TileData {
  id: string
  type: TileType
  x: number
  y: number
  w: number
  h: number
  zIndex: number
  title: string
  meta: Record<string, unknown>
  /** Optional status pill in tile header (Orca-style). */
  tileStatus?: TileStatus
  /** When set, this tile hosts multiple module instances as tabs (non-Picasso mode). */
  moduleTabs?: TileModuleTab[]
  activeModuleTabId?: string
  /**
   * Hydration stage for workspace rebuild. Tiles start as 'placeholder' during
   * adaptive restore and flip to 'active' when the scheduler promotes them.
   * Undefined or 'active' means fully mounted; only 'placeholder' gates heavy content.
   */
  hydrationStage?: TileHydrationStage
  /**
   * Tile id that spawned this tile (e.g. the lead orchestrator or parent
   * sub-agent that called `spawn_sub_agent`). Used by `hierarchySpawn` to pick
   * a radial slot around the parent and by `OrchestratorHubLinks` for branch
   * lines. Undefined for tiles the user placed manually.
   */
  spawnedByTileId?: string
}

export type CanvasViewMode = 'tiles' | 'graph' | 'plan' | 'helix'
export type CanvasGraphLinkType = 'delegation' | 'dataFlow' | 'manual'

export interface CanvasGraphLink {
  id: string
  source: string
  target: string
  type: CanvasGraphLinkType
  label?: string
}

/** Persisted snapshot for `.agent-canvas/canvas-state.json`. */
export const CANVAS_STATE_FILE_VERSION = 1 as const

/** Subset of agent team rows saved with the canvas so delegated tiles reload with model + log context. */
export interface PersistedAgentTeamMember {
  tileId: string
  displayName: string
  role: string
  delegatedTask?: string
  currentTask: string
  status: AgentTeamMemberStatus
  logTail: string[]
  lastSummary?: string
  error?: string
  executionModelLabel?: string
  executionProvider?: Provider
  executionModelIsFree?: boolean
  executionModelSupportsImages?: boolean
  parentTileId?: string
}

const PERSIST_DELEGATED_LOG_TAIL_MAX = 48

function agentMemberToPersisted(m: AgentTeamMember): PersistedAgentTeamMember {
  return {
    tileId: m.tileId,
    displayName: m.displayName,
    role: m.role,
    ...(m.delegatedTask != null ? { delegatedTask: m.delegatedTask } : {}),
    currentTask: m.currentTask,
    status: m.status,
    logTail: m.logTail.slice(-PERSIST_DELEGATED_LOG_TAIL_MAX),
    ...(m.lastSummary != null ? { lastSummary: m.lastSummary } : {}),
    ...(m.error != null ? { error: m.error } : {}),
    ...(m.executionModelLabel != null ? { executionModelLabel: m.executionModelLabel } : {}),
    ...(m.executionProvider != null ? { executionProvider: m.executionProvider } : {}),
    ...(m.executionModelIsFree === true ? { executionModelIsFree: true } : {}),
    ...(m.executionModelSupportsImages === true ? { executionModelSupportsImages: true } : {}),
    ...(m.parentTileId != null ? { parentTileId: m.parentTileId } : {}),
  }
}

function parsePersistedAgentTeamMembers(raw: unknown): PersistedAgentTeamMember[] {
  if (!Array.isArray(raw)) return []
  const out: PersistedAgentTeamMember[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (typeof r.tileId !== 'string' || typeof r.displayName !== 'string' || typeof r.role !== 'string') continue
    if (typeof r.currentTask !== 'string') continue
    const st = r.status
    if (st !== 'idle' && st !== 'working' && st !== 'done' && st !== 'error') continue
    const logTail = Array.isArray(r.logTail) ? r.logTail.filter((x) => typeof x === 'string') : []
    const delegatedTask = typeof r.delegatedTask === 'string' ? r.delegatedTask : undefined
    const lastSummary = typeof r.lastSummary === 'string' ? r.lastSummary : undefined
    const error = typeof r.error === 'string' ? r.error : undefined
    const executionModelLabel =
      typeof r.executionModelLabel === 'string' ? r.executionModelLabel : undefined
    const executionProvider =
      typeof r.executionProvider === 'string' ? (r.executionProvider as Provider) : undefined
    out.push({
      tileId: r.tileId,
      displayName: r.displayName,
      role: r.role,
      ...(delegatedTask != null ? { delegatedTask } : {}),
      currentTask: r.currentTask,
      status: st,
      logTail,
      ...(lastSummary != null ? { lastSummary } : {}),
      ...(error != null ? { error } : {}),
      ...(executionModelLabel != null ? { executionModelLabel } : {}),
      ...(executionProvider != null ? { executionProvider } : {}),
      ...(r.executionModelIsFree === true ? { executionModelIsFree: true } : {}),
      ...(r.executionModelSupportsImages === true ? { executionModelSupportsImages: true } : {}),
      ...(typeof r.parentTileId === 'string' ? { parentTileId: r.parentTileId } : {}),
    })
  }
  return out
}

function reapplyDelegatedAgentTeamFromSnapshot(
  roster: PersistedAgentTeamMember[] | undefined,
  tiles: Map<string, TileData>,
  updateTile: (id: string, updates: Partial<TileData>) => void
) {
  if (!roster?.length) return
  const replace = useAgentTeamStore.getState().replaceMemberSnapshot
  for (const p of roster) {
    const tile = tiles.get(p.tileId)
    if (!tile || tile.type !== 'agent' || tile.meta?.subAgentDelegated !== true) continue
    let status = p.status
    let currentTask = p.currentTask
    if (status === 'working') {
      status = 'idle'
      currentTask =
        'Restored layout — worker was not resumed. Spawn again from the orchestrator if needed.'
      updateTile(p.tileId, { tileStatus: 'idle' })
    }
    const member: AgentTeamMember = {
      tileId: p.tileId,
      displayName: p.displayName,
      role: p.role,
      delegatedTask: p.delegatedTask,
      currentTask,
      status,
      statusUpdatedAt: Date.now(),
      logTail: p.logTail,
      lastSummary: p.lastSummary,
      error: p.error,
      executionModelLabel: p.executionModelLabel,
      executionProvider: p.executionProvider,
      executionModelIsFree: p.executionModelIsFree,
      executionModelSupportsImages: p.executionModelSupportsImages,
      parentTileId: p.parentTileId,
    }
    replace(member)
  }
}

export interface SerializedCanvasState {
  version: typeof CANVAS_STATE_FILE_VERSION
  tiles: TileData[]
  pan: { x: number; y: number }
  zoom: number
  maxZIndex: number
  layoutAnchor: { x: number; y: number } | null
  anchorTileId: string | null
  /** Delegated sub-agent roster (only tiles with `subAgentDelegated` on canvas). */
  agentTeamMembers?: PersistedAgentTeamMember[]
}

const TILE_TYPES_SET = new Set<string>([
  'terminal',
  'editor',
  'browser',
  'github',
  'diff',
  'todo',
  'agent',
  'agent_team',
  'agent_group_chat',
  'changelog',
  'orchestrator',
  'benchmark',
  'remotion',
  'openrouter_usage',
  'toolbox',
  'inspect',
  'research',
  'reasoning',
  'project_status',
  'telemetry',
  'hermes_bridge',
  'hermes_agent',
  'telegram_onboard',
  'native_gateway',
  'bug_bounty',
])

function isTileType(s: unknown): s is TileType {
  return typeof s === 'string' && TILE_TYPES_SET.has(s)
}

/** Build JSON-serializable snapshot from current canvas state (no transient UI). */
export function serializeCanvasState(
  state: Pick<
    CanvasState,
    'tiles' | 'pan' | 'zoom' | 'maxZIndex' | 'layoutAnchor' | 'anchorTileId'
  >
): SerializedCanvasState {
  const tiles = Array.from(state.tiles.values()).map((t) => ({
    ...t,
    meta: { ...t.meta },
  }))
  let maxZ = state.maxZIndex
  for (const t of tiles) {
    maxZ = Math.max(maxZ, t.zIndex)
  }
  const membersByTileId = useAgentTeamStore.getState().membersByTileId
  const agentTeamMembers: PersistedAgentTeamMember[] = []
  for (const t of tiles) {
    if (t.type !== 'agent' || t.meta?.subAgentDelegated !== true) continue
    const m = membersByTileId[t.id]
    if (m) agentTeamMembers.push(agentMemberToPersisted(m))
  }
  return {
    version: CANVAS_STATE_FILE_VERSION,
    tiles,
    pan: { ...state.pan },
    zoom: state.zoom,
    maxZIndex: maxZ,
    layoutAnchor: state.layoutAnchor ? { ...state.layoutAnchor } : null,
    anchorTileId: state.anchorTileId,
    ...(agentTeamMembers.length > 0 ? { agentTeamMembers } : {}),
  }
}

/** Parse and validate file JSON; returns null if invalid. */
export function parseSerializedCanvasState(raw: unknown): SerializedCanvasState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.version !== CANVAS_STATE_FILE_VERSION) return null
  if (!Array.isArray(o.tiles)) return null
  const tiles: TileData[] = []
  for (const row of o.tiles) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (typeof r.id !== 'string' || !isTileType(r.type)) continue
    if (
      typeof r.x !== 'number' ||
      typeof r.y !== 'number' ||
      typeof r.w !== 'number' ||
      typeof r.h !== 'number' ||
      typeof r.zIndex !== 'number'
    ) {
      continue
    }
    if (typeof r.title !== 'string') continue
    const meta =
      r.meta !== null && typeof r.meta === 'object' && !Array.isArray(r.meta)
        ? (r.meta as Record<string, unknown>)
        : {}
    const tileStatus = r.tileStatus
    const td: TileData = {
      id: r.id,
      type: r.type,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      zIndex: r.zIndex,
      title: r.title,
      meta,
    }
    if (
      tileStatus === 'idle' ||
      tileStatus === 'working' ||
      tileStatus === 'done' ||
      tileStatus === 'error' ||
      tileStatus === 'warning'
    ) {
      td.tileStatus = tileStatus
    }
    if (Array.isArray(r.moduleTabs)) {
      const parsed: TileModuleTab[] = []
      for (const tab of r.moduleTabs) {
        if (!tab || typeof tab !== 'object') continue
        const tb = tab as Record<string, unknown>
        if (typeof tb.id !== 'string' || typeof tb.title !== 'string') continue
        const tmeta =
          tb.meta !== null && typeof tb.meta === 'object' && !Array.isArray(tb.meta)
            ? (tb.meta as Record<string, unknown>)
            : {}
        parsed.push({ id: tb.id, title: tb.title, meta: tmeta })
      }
      if (parsed.length > 0) td.moduleTabs = parsed
    }
    if (typeof r.activeModuleTabId === 'string' && r.activeModuleTabId.trim()) {
      td.activeModuleTabId = r.activeModuleTabId
    }
    if (typeof r.spawnedByTileId === 'string' && r.spawnedByTileId.trim()) {
      td.spawnedByTileId = r.spawnedByTileId.trim()
    }
    const hs = r.hydrationStage
    if (hs === 'placeholder' || hs === 'active') {
      td.hydrationStage = hs
    }
    tiles.push(td)
  }
  const pan = o.pan
  if (!pan || typeof pan !== 'object' || typeof (pan as { x?: unknown }).x !== 'number' || typeof (pan as { y?: unknown }).y !== 'number') {
    return null
  }
  const p = pan as { x: number; y: number }
  if (typeof o.zoom !== 'number') return null
  if (typeof o.maxZIndex !== 'number') return null
  let layoutAnchor: { x: number; y: number } | null = null
  if (o.layoutAnchor !== null && o.layoutAnchor !== undefined) {
    if (typeof o.layoutAnchor === 'object' && o.layoutAnchor !== null) {
      const la = o.layoutAnchor as { x?: unknown; y?: unknown }
      if (typeof la.x === 'number' && typeof la.y === 'number') {
        layoutAnchor = { x: la.x, y: la.y }
      }
    }
  }
  const anchorTileId =
    o.anchorTileId === null || o.anchorTileId === undefined
      ? null
      : typeof o.anchorTileId === 'string'
        ? o.anchorTileId
        : null
  const agentTeamMembers = parsePersistedAgentTeamMembers(o.agentTeamMembers)
  return {
    version: CANVAS_STATE_FILE_VERSION,
    tiles,
    pan: { x: p.x, y: p.y },
    zoom: o.zoom,
    maxZIndex: o.maxZIndex,
    layoutAnchor,
    anchorTileId,
    ...(agentTeamMembers.length > 0 ? { agentTeamMembers } : {}),
  }
}

/** Alias for persisted JSON parsing (same as `parseSerializedCanvasState`). */
export function deserializeCanvasState(raw: unknown): SerializedCanvasState | null {
  return parseSerializedCanvasState(raw)
}

/** Options for {@link CanvasState.hydrateFromPersistenceStaggered} (reopen project). */
export interface HydrateFromPersistenceStaggerOptions {
  /** Delay between each tile appearing (ms). First tile is immediate. Default 500. */
  staggerMs?: number
  /** Return false if the workspace load was superseded — stops adding remaining tiles. */
  isCurrent?: () => boolean
}

interface CanvasState {
  tiles: Map<string, TileData>
  canvasViewMode: CanvasViewMode
  /** Optional user-authored links shown in graph mode when enabled in settings. */
  graphLinks: CanvasGraphLink[]
  /** Last known graph-space positions keyed by tile id (used for optional sync). */
  graphNodePositions: Record<string, { x: number; y: number }>
  pan: { x: number; y: number }
  zoom: number
  maxZIndex: number
  /** Tile whose inner UI is currently armed to consume wheel/trackpad scroll. */
  activeInteractionTileId: string | null
  /**
   * World-space origin for the snap grid (set once from the first tile’s position at creation).
   * Cleared when the canvas has no tiles.
   */
  layoutAnchor: { x: number; y: number } | null
  /** Guides + ghost preview + target highlights while Option-dragging. */
  snapOverlay: SnapOverlayState | null

  /** True while user must click a tile to choose the main panel (Smart Collapse). */
  smartCollapsePicking: boolean
  /** Active Smart Collapse layout: main tile + accordion side column. */
  smartCollapse: { mainId: string; expandedSideId: string | null } | null
  /** Snapshot of tile rects before Smart Collapse; restored on exit. */
  smartCollapseRestoreLayout: TileLayoutUpdate[] | null
  /** Fraction of inner layout width for the main tile column (Smart Collapse). */
  smartCollapseMainRatio: number

  /** Mission Control: pick a tile to focus; Escape restores the saved view. */
  missionScatterPickMode: boolean
  missionScatterSavedView: { pan: { x: number; y: number }; zoom: number } | null
  /** Tile rects before Mission Control scatter; restored on exitMissionScatterPick. */
  missionScatterSavedTileLayout: TileLayoutUpdate[] | null
  beginMissionScatter: () => boolean
  exitMissionScatterPick: () => void
  /** After choosing a tile for focus — drops saved view without restoring pan/zoom. */
  clearMissionScatterForFocus: () => void

  /** Mission overview toggle: zoom out (~0.7 cap) to fit tiles; second press restores camera. */
  missionOverviewActive: boolean
  missionOverviewSavedView: { pan: { x: number; y: number }; zoom: number } | null
  toggleMissionOverview: () => void

  /** One-level undo for LayoutPresetBar: tile rects + camera before last preset apply. */
  layoutPresetUndo: {
    updates: TileLayoutUpdate[]
    pan: { x: number; y: number }
    zoom: number
  } | null
  captureLayoutPresetUndoSnapshot: () => void
  restoreLayoutPresetUndo: () => void

  /** Layout anchor tile for intelligent zone placement (browser/terminal/editor “hero”). */
  anchorTileId: string | null
  /** Detected from workspace files (see workspaceStore). */
  workspaceContext: WorkspaceContext
  setAnchorTile: (id: string | null) => void
  setWorkspaceContext: (ctx: WorkspaceContext) => void

  /** Spawn with zone-aware placement (orchestrator / explicit intelligent spawn). */
  addTileIntelligent: (
    type: TileType,
    position?: { x: number; y: number },
    opts?: AddTileOptions
  ) => string

  addTile: (
    type: TileType,
    position?: { x: number; y: number },
    opts?: AddTileOptions
  ) => string

  /** Switch in-tile tab (consolidated module). */
  setActiveModuleTab: (tileId: string, tabId: string) => void
  /** Close one tab; removes the tile if it was the last tab. */
  closeModuleTab: (tileId: string, tabId: string) => void
  updateTile: (id: string, updates: Partial<TileData>) => void
  removeTile: (id: string, options?: { preserveAgentTeamEntry?: boolean }) => void
  /** Remove every tile (e.g. canvas reset). */
  clearAllTiles: () => void
  /** Replace tiles + camera from persisted snapshot (workspace open). Clears transient UI modes. */
  hydrateFromPersistence: (snapshot: SerializedCanvasState) => void
  /**
   * Same as {@link hydrateFromPersistence} but adds tiles one at a time (reopen UX).
   * Camera + non-tile fields apply immediately; tiles appear every `staggerMs` (first tile is immediate).
   */
  hydrateFromPersistenceStaggered: (
    snapshot: SerializedCanvasState,
    opts?: HydrateFromPersistenceStaggerOptions
  ) => Promise<void>
  /**
   * Insert all tiles as placeholders synchronously (Phase 1 of workspace rebuild).
   * Tiles have `hydrationStage: 'placeholder'` and render lightweight placeholder UI.
   * Use `markTileActive` to promote individual tiles in Phase 2.
   */
  hydrateFromPersistenceAsPlaceholders: (snapshot: SerializedCanvasState) => void
  /**
   * Promote a placeholder tile to active, triggering full mount of heavy content.
   * No-op if tile is already active or doesn't exist.
   */
  markTileActive: (id: string) => void
  /**
   * Demote an active tile back to a placeholder to free memory and stop side
   * effects. Used by the idle-tile reaper (10s inactivity) and tests.
   */
  markTilePlaceholder: (id: string) => void
  bringToFront: (id: string) => void
  setActiveInteractionTile: (id: string | null) => void
  setCanvasViewMode: (mode: CanvasViewMode) => void
  setGraphLinks: (links: CanvasGraphLink[]) => void
  upsertGraphLink: (link: CanvasGraphLink) => void
  removeGraphLink: (id: string) => void
  setGraphNodePosition: (id: string, pos: { x: number; y: number }) => void
  setGraphNodePositions: (positions: Record<string, { x: number; y: number }>) => void
  clearGraphNodePositions: () => void
  applyGraphNodePositionsToTiles: () => void
  setPan: (pan: { x: number; y: number }) => void
  /** Smooth pan to target (screen space); keeps current zoom. */
  animatePanTo: (target: { x: number; y: number }, durationMs?: number) => void
  setZoom: (zoom: number) => void
  setSnapOverlay: (overlay: SnapOverlayState | null) => void
  applyTilesLayout: (updates: TileLayoutUpdate[]) => void
  /** Translate a set of tiles by delta in a single batched update (optionally softened by alpha). */
  translateTilesByIds: (
    ids: string[],
    delta: { x: number; y: number },
    opts?: { alpha?: number; excludeIds?: Set<string> }
  ) => void
  /** Exchange rectangles: dragged tile takes target’s rect; target takes `draggedOriginal`. */
  swapTileRects: (
    draggedId: string,
    targetId: string,
    draggedOriginal: { x: number; y: number; w: number; h: number }
  ) => void

  /** Push overlapping tiles away from `id` (e.g. after drop/resize). */
  resolveOverlapsForTile: (id: string, opts?: { frozenIds?: Set<string> }) => void
  /**
   * Lightweight drag-time overlap pass (optional micro-settle) used during active dragging.
   * Keeps interaction smooth by running fewer iterations than full settle.
   */
  resolveOverlapsForTileLive: (
    id: string,
    opts?: {
      frozenIds?: Set<string>
      settleIterations?: number
      desiredGap?: number
    }
  ) => void

  startSmartCollapsePicker: () => void
  cancelSmartCollapsePicker: () => void
  selectSmartCollapseMain: (mainId: string) => void
  setSmartCollapseExpanded: (sideTileId: string | null) => void
  exitSmartCollapse: () => void
  refreshSmartCollapseLayout: () => void
  setSmartCollapseMainRatio: (ratio: number) => void
}

const DEFAULT_SIZES: Record<TileType, { w: number; h: number }> = {
  terminal: { w: 600, h: 400 },
  editor: { w: 700, h: 500 },
  browser: { w: 800, h: 600 },
  agent_browser: { w: 900, h: 700 },
  github: { w: 640, h: 480 },
  diff: { w: 700, h: 500 },
  todo: { w: 350, h: 450 },
  agent: { w: 460, h: 620 },
  agent_team: { w: 860, h: 620 },
  agent_group_chat: { w: 400, h: 460 },
  changelog: { w: 420, h: 360 },
  orchestrator: { w: 630, h: 500 },
  benchmark: { w: 440, h: 420 },
  remotion: { w: 480, h: 440 },
  openrouter_usage: { w: 420, h: 460 },
  toolbox: { w: 420, h: 480 },
  research: { w: 420, h: 480 },
  reasoning: { w: 460, h: 520 },
  project_status: { w: 480, h: 520 },
  telemetry: { w: 420, h: 440 },
  hermes_bridge: { w: 440, h: 520 },
  hermes_agent: { w: 400, h: 480 },
  telegram_onboard: { w: 384, h: 540 },
  native_gateway: { w: 432, h: 580 },
  bug_bounty: { w: 440, h: 540 },
}

/**
 * Spawn size for agent tiles spawned by the orchestrator (delegated sub-agents).
 * Their chat stream is collapsed by default, so the tile only needs room for the
 * header, status strip, task panel, collapsed chat bar, trace chips, task history,
 * and a disabled input row. Keeping them small also reduces visual clutter when
 * multiple sub-agents run concurrently.
 *
 * Sized to fit the full chrome at spawn without clipping, including taller task
 * content and trace/history rows introduced in recent UI updates.
 * The user can still resize smaller — this is only the spawn default.
 */
export const DELEGATED_AGENT_TILE_SIZE = { w: 460, h: 620 } as const

function useIntelligentLayoutForSpawn(): boolean {
  try {
    return useSettingsStore.getState().intelligentLayoutEnabled
  } catch {
    return true
  }
}

function intelligentLayoutSettings() {
  try {
    const s = useSettingsStore.getState()
    return {
      anchorRatio: s.intelligentLayoutAnchorRatio,
      autoDetect: s.intelligentLayoutAutoDetectAnchor,
    }
  } catch {
    return { anchorRatio: 0.6, autoDetect: true }
  }
}

const TILE_TITLES: Record<TileType, string> = {
  terminal: 'Terminal',
  editor: 'Editor',
  browser: 'Browser',
  agent_browser: 'Agent Browser',
  github: 'GitHub research',
  diff: 'Diff Review',
  todo: 'Todo',
  agent: 'Agent',
  agent_team: 'Agent team',
  agent_group_chat: 'Agent group chat',
  changelog: 'Changelog',
  orchestrator: 'Orchestrator',
  benchmark: 'Benchmark',
  remotion: 'Remotion studio',
  openrouter_usage: 'OpenRouter usage',
  toolbox: 'Toolbox',
  research: 'Research',
  reasoning: 'Thinking · Trace',
  project_status: 'Project status',
  telemetry: 'Telemetry',
  hermes_bridge: 'Hermes · Orca bridge',
  hermes_agent: 'Hermes',
  telegram_onboard: 'Telegram · Onboard',
  native_gateway: 'Native gateway',
  bug_bounty: 'Bug bounty board',
}

/** Tile types that may spawn multiple canvas windows when Picasso mode is off (parallel agents). */
/**
 * Tile types that always get their own dedicated tile, never folded into a module-tabs
 * group — even when Picasso mode is off. Terminals must live here so each shell owns its
 * own PTY; merging them into tabs broke tab-switch (shared xterm output) and caused the
 * surviving tab's PTY to be killed when any tab in the group was closed.
 */
export const PICASSO_MULTI_INSTANCE_TILE_TYPES: TileType[] = ['agent', 'hermes_agent', 'terminal']

function isSuppressCanvasRenderMeta(meta: Record<string, unknown> | undefined): boolean {
  return meta?.suppressCanvasRender === true
}

function tileRepulsionBlocked(): boolean {
  const s = useCanvasStore.getState()
  return !!(
    s.smartCollapse ||
    s.smartCollapsePicking ||
    s.missionScatterPickMode ||
    s.layoutPresetUndo
  )
}

/**
 * Apply an extra `forceSettle` pass on top of `resolveOverlapsAround` when the
 * user has bumped `tileRepulsionStrength` above zero. Returns a possibly new
 * tile map (may be the same reference when no changes were made).
 *
 * Strength 0 = skip, 1 = default 6-iter settle, >1 = more aggressive spread.
 * Always frozen: the tile we just added (`anchorId`) — it's meant to keep the
 * user's explicit drop position stable.
 */
function applyTileRepulsionSettle(
  tilesMap: Map<string, TileData>,
  anchorId: string
): Map<string, TileData> {
  try {
    const strength = useSettingsStore.getState().tileRepulsionStrength
    if (!strength || strength <= 0.01) return tilesMap
    const updates = forceSettle(tilesMap, {
      strength,
      iterations: Math.max(4, Math.round(6 * strength)),
      frozenIds: new Set([anchorId]),
    })
    if (updates.length === 0) return tilesMap
    const next = new Map(tilesMap)
    for (const u of updates) {
      const t = next.get(u.id)
      if (t) next.set(u.id, { ...t, x: u.x, y: u.y, w: u.w, h: u.h })
    }
    return next
  } catch {
    return tilesMap
  }
}

function cloneRecord<T extends Record<string, unknown>>(m: T): T {
  return JSON.parse(JSON.stringify(m)) as T
}

function picassoModeEnabled(): boolean {
  try {
    return useSettingsStore.getState().picassoMode === true
  } catch {
    return false
  }
}

function findTileByType(tiles: Map<string, TileData>, type: TileType): TileData | undefined {
  for (const t of tiles.values()) {
    if (t.type === type) return t
  }
  return undefined
}

export type AddTileOptions = {
  title?: string
  meta?: Record<string, unknown>
  /** Override default tile dimensions from DEFAULT_SIZES */
  w?: number
  h?: number
}

function mergeNonPicassoModule(
  get: () => CanvasState,
  type: TileType,
  opts?: AddTileOptions
): string | null {
  if (picassoModeEnabled()) return null
  if (PICASSO_MULTI_INSTANCE_TILE_TYPES.includes(type)) return null
  const existing = findTileByType(get().tiles, type)
  if (!existing) return null

  get().bringToFront(existing.id)
  const tile = get().tiles.get(existing.id)!
  const title = opts?.title?.trim() || TILE_TITLES[type]
  const meta = opts?.meta ?? {}

  if (!tile.moduleTabs || tile.moduleTabs.length === 0) {
    const tab1Id = nanoid()
    const tab2Id = nanoid()
    const tab1Title = tile.title || TILE_TITLES[type]
    const tab1Meta = cloneRecord(tile.meta)
    const tab2Title = title
    const tab2Meta = cloneRecord(meta)
    get().updateTile(existing.id, {
      moduleTabs: [
        { id: tab1Id, title: tab1Title, meta: tab1Meta },
        { id: tab2Id, title: tab2Title, meta: tab2Meta },
      ],
      activeModuleTabId: tab2Id,
      title: TILE_TITLES[type],
      meta: tab2Meta,
      tileStatus: undefined,
    })
    get().setActiveInteractionTile(existing.id)
  } else {
    const tabs = [...tile.moduleTabs]
    const activeIdx = tabs.findIndex((t) => t.id === tile.activeModuleTabId)
    if (activeIdx >= 0) {
      tabs[activeIdx] = { ...tabs[activeIdx], meta: cloneRecord(tile.meta) }
    }
    const newId = nanoid()
    tabs.push({ id: newId, title, meta: cloneRecord(meta) })
    get().updateTile(existing.id, {
      moduleTabs: tabs,
      activeModuleTabId: newId,
      meta: cloneRecord(meta),
      tileStatus: undefined,
    })
    get().setActiveInteractionTile(existing.id)
  }
  return existing.id
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  tiles: new Map(),
  canvasViewMode: 'tiles',
  graphLinks: [],
  graphNodePositions: {},
  pan: { x: 0, y: 0 },
  zoom: 1,
  maxZIndex: 0,
  activeInteractionTileId: null,
  snapOverlay: null,
  layoutAnchor: null,
  smartCollapsePicking: false,
  smartCollapse: null,
  smartCollapseRestoreLayout: null,
  smartCollapseMainRatio: SMART_COLLAPSE_DEFAULT_MAIN_RATIO,

  missionScatterPickMode: false,
  missionScatterSavedView: null,
  missionScatterSavedTileLayout: null,

  missionOverviewActive: false,
  missionOverviewSavedView: null,

  layoutPresetUndo: null,

  anchorTileId: null,
  workspaceContext: 'general',

  setAnchorTile: (id) => set({ anchorTileId: id }),
  setWorkspaceContext: (ctx) => set({ workspaceContext: ctx }),

  captureLayoutPresetUndoSnapshot: () => {
    const { tiles, pan, zoom } = get()
    const updates: TileLayoutUpdate[] = Array.from(tiles.values()).map((t) => ({
      id: t.id,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
    }))
    set({
      layoutPresetUndo: {
        updates,
        pan: { ...pan },
        zoom,
      },
    })
  },

  restoreLayoutPresetUndo: () => {
    const { layoutPresetUndo, tiles } = get()
    if (!layoutPresetUndo) return
    const updates = layoutPresetUndo.updates.filter((u) => tiles.has(u.id))
    if (updates.length > 0) get().applyTilesLayout(updates)
    set({
      pan: { ...layoutPresetUndo.pan },
      zoom: layoutPresetUndo.zoom,
      layoutPresetUndo: null,
    })
  },

  beginMissionScatter: () => {
    const { pan, zoom, tiles, applyTilesLayout } = get()
    const sorted = sortTilesForLayout(Array.from(tiles.values()))
    if (sorted.length < 2) return false
    const area = getViewportLayoutRect(pan, zoom)
    if (!area) return false
    const savedTileLayout: TileLayoutUpdate[] = Array.from(tiles.values()).map((t) => ({
      id: t.id,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
    }))
    set({
      missionScatterSavedView: { pan: { ...pan }, zoom },
      missionScatterSavedTileLayout: savedTileLayout,
      missionScatterPickMode: true,
    })
    const layout = computePresetLayout('scatter', sorted, area)
    if (layout.length > 0) applyTilesLayout(layout)
    const fitted = computePanZoomToFitTiles(Array.from(get().tiles.values()), {
      minZoom: 0.12,
    })
    if (fitted) set({ pan: fitted.pan, zoom: fitted.zoom })
    return true
  },

  exitMissionScatterPick: () => {
    const {
      missionScatterPickMode,
      missionScatterSavedView,
      missionScatterSavedTileLayout,
      tiles,
    } = get()
    if (!missionScatterPickMode) return
    const updates =
      missionScatterSavedTileLayout?.filter((u) => tiles.has(u.id)) ?? []
    if (updates.length > 0) get().applyTilesLayout(updates)
    if (missionScatterSavedView) {
      set({
        pan: missionScatterSavedView.pan,
        zoom: missionScatterSavedView.zoom,
        missionScatterPickMode: false,
        missionScatterSavedView: null,
        missionScatterSavedTileLayout: null,
      })
    } else {
      set({
        missionScatterPickMode: false,
        missionScatterSavedView: null,
        missionScatterSavedTileLayout: null,
      })
    }
  },

  clearMissionScatterForFocus: () =>
    set({
      missionScatterPickMode: false,
      missionScatterSavedView: null,
      missionScatterSavedTileLayout: null,
    }),

  toggleMissionOverview: () => {
    const { missionOverviewActive, missionOverviewSavedView, pan, zoom, tiles } = get()
    if (missionOverviewActive && missionOverviewSavedView) {
      set({
        pan: { ...missionOverviewSavedView.pan },
        zoom: missionOverviewSavedView.zoom,
        missionOverviewActive: false,
        missionOverviewSavedView: null,
      })
      return
    }
    const list = Array.from(tiles.values())
    if (list.length === 0) return
    const fitted = computePanZoomToFitTiles(list, { minZoom: 0.12 })
    if (!fitted) return
    const capZoom = Math.min(fitted.zoom, 0.7)
    set({
      missionOverviewSavedView: { pan: { ...pan }, zoom },
      missionOverviewActive: true,
      pan: fitted.pan,
      zoom: capZoom,
    })
  },

  addTileIntelligent: (type, position, opts) => {
    const merged = mergeNonPicassoModule(get, type, opts)
    if (merged) return merged

    const { maxZIndex, tiles, pan, zoom, workspaceContext, anchorTileId } = get()

    if (position) {
      return get().addTile(type, position, opts)
    }

    const id = nanoid()
    const size = {
      w: opts?.w ?? DEFAULT_SIZES[type].w,
      h: opts?.h ?? DEFAULT_SIZES[type].h,
    }
    const vp = getViewportLayoutRect(pan, zoom)
    const { anchorRatio, autoDetect } = intelligentLayoutSettings()
    const placed = computeIntelligentPosition({
      type,
      newW: size.w,
      newH: size.h,
      tiles,
      pan,
      zoom,
      viewport: vp,
      workspaceContext,
      anchorTileId,
      anchorSizeRatio: anchorRatio,
      autoDetectAnchor: autoDetect,
    })

    const tile: TileData = {
      id,
      type,
      x: placed.x,
      y: placed.y,
      w: placed.w,
      h: placed.h,
      zIndex: maxZIndex + 1,
      title: opts?.title?.trim() || TILE_TITLES[type],
      meta: opts?.meta ? cloneRecord(opts.meta) : {},
    }
    const suppressCanvasRender = isSuppressCanvasRenderMeta(
      tile.meta as Record<string, unknown> | undefined
    )

    let newTiles = new Map(tiles)
    newTiles.set(id, tile)

    if (!suppressCanvasRender && !tileRepulsionBlocked()) {
      const vpRep = getViewportLayoutRect(pan, zoom)
      const updates = resolveOverlapsAround(newTiles, id, { viewport: vpRep })
      for (const u of updates) {
        const t = newTiles.get(u.id)
        if (t) newTiles = new Map(newTiles).set(u.id, { ...t, x: u.x, y: u.y, w: u.w, h: u.h })
      }
      newTiles = applyTileRepulsionSettle(newTiles, id)
    }

    const firstOnCanvas = tiles.size === 0
    const sc = get().smartCollapse
    const nextAnchor = placed.setAsAnchor ? id : anchorTileId
    const basePatch = {
      tiles: newTiles,
      maxZIndex: maxZIndex + 1,
      anchorTileId: nextAnchor,
      activeInteractionTileId: suppressCanvasRender ? get().activeInteractionTileId : id,
      ...(firstOnCanvas ? { layoutAnchor: { x: placed.x, y: placed.y } } : {}),
    }
    if (sc && id !== sc.mainId) {
      set({
        ...basePatch,
        smartCollapse: { mainId: sc.mainId, expandedSideId: id },
      })
      queueMicrotask(() => get().refreshSmartCollapseLayout())
    } else {
      set(basePatch)
    }
    return id
  },

  addTile: (type, position, opts) => {
    const merged = mergeNonPicassoModule(get, type, opts)
    if (merged) return merged

    if (!position && useIntelligentLayoutForSpawn()) {
      return get().addTileIntelligent(type, position, opts)
    }

    const { maxZIndex, tiles, pan, zoom } = get()

    const id = nanoid()
    const size = {
      w: opts?.w ?? DEFAULT_SIZES[type].w,
      h: opts?.h ?? DEFAULT_SIZES[type].h,
    }

    let x: number
    let y: number

    if (position) {
      const placed = findNonOverlappingPosition(tiles, size.w, size.h, position.x, position.y)
      x = placed.x
      y = placed.y
    } else {
      const vp = getViewportLayoutRect(pan, zoom)
      const stacked = findStackedPosition(tiles, size.w, size.h, vp)
      const preferredX =
        stacked?.x ?? ((-pan.x + window.innerWidth / 2) / zoom - size.w / 2)
      const preferredY =
        stacked?.y ?? ((-pan.y + window.innerHeight / 2) / zoom - size.h / 2)
      const placed = findNonOverlappingPosition(tiles, size.w, size.h, preferredX, preferredY)
      x = placed.x
      y = placed.y
    }

    const tile: TileData = {
      id,
      type,
      x,
      y,
      ...size,
      zIndex: maxZIndex + 1,
      title: opts?.title?.trim() || TILE_TITLES[type],
      meta: opts?.meta ? cloneRecord(opts.meta) : {},
    }
    const suppressCanvasRender = isSuppressCanvasRenderMeta(
      tile.meta as Record<string, unknown> | undefined
    )

    let newTiles = new Map(tiles)
    newTiles.set(id, tile)

    if (!suppressCanvasRender && !tileRepulsionBlocked()) {
      const vpRep = getViewportLayoutRect(pan, zoom)
      const updates = resolveOverlapsAround(newTiles, id, { viewport: vpRep })
      for (const u of updates) {
        const t = newTiles.get(u.id)
        if (t) newTiles = new Map(newTiles).set(u.id, { ...t, x: u.x, y: u.y, w: u.w, h: u.h })
      }
      newTiles = applyTileRepulsionSettle(newTiles, id)
    }

    const firstOnCanvas = tiles.size === 0
    const sc = get().smartCollapse
    const basePatch = {
      tiles: newTiles,
      maxZIndex: maxZIndex + 1,
      activeInteractionTileId: suppressCanvasRender ? get().activeInteractionTileId : id,
      ...(firstOnCanvas ? { layoutAnchor: { x, y } } : {}),
    }
    if (sc && id !== sc.mainId) {
      set({
        ...basePatch,
        smartCollapse: { mainId: sc.mainId, expandedSideId: id },
      })
      queueMicrotask(() => get().refreshSmartCollapseLayout())
    } else {
      set(basePatch)
    }
    markTileActivity(id)
    return id
  },

  setActiveModuleTab: (tileId, tabId) => {
    const { tiles } = get()
    const tile = tiles.get(tileId)
    if (!tile?.moduleTabs?.length) return
    const nextTab = tile.moduleTabs.find((t) => t.id === tabId)
    if (!nextTab) return

    const newTabs = tile.moduleTabs.map((t) =>
      t.id === tile.activeModuleTabId ? { ...t, meta: cloneRecord(tile.meta) } : t
    )
    const newTiles = new Map(tiles)
    newTiles.set(tileId, {
      ...tile,
      moduleTabs: newTabs,
      activeModuleTabId: tabId,
      meta: cloneRecord(nextTab.meta),
    })
    set({ tiles: newTiles })
  },

  closeModuleTab: (tileId, tabId) => {
    const { tiles } = get()
    const tile = tiles.get(tileId)
    if (!tile?.moduleTabs?.length) return

    const closingIdx = tile.moduleTabs.findIndex((t) => t.id === tabId)
    if (closingIdx < 0) return

    const tabs = tile.moduleTabs.filter((t) => t.id !== tabId)

    if (tabs.length === 0) {
      get().removeTile(tileId)
      return
    }

    if (tabs.length === 1) {
      const only = tabs[0]
      const survivorWasTheActiveTab = tile.activeModuleTabId === only.id
      const meta = survivorWasTheActiveTab ? cloneRecord(tile.meta) : cloneRecord(only.meta)
      const newTiles = new Map(tiles)
      newTiles.set(tileId, {
        ...tile,
        moduleTabs: undefined,
        activeModuleTabId: undefined,
        title: only.title || TILE_TITLES[tile.type],
        meta,
      })
      set({ tiles: newTiles })
      return
    }

    const wasActive = tile.activeModuleTabId === tabId
    let nextActiveId = tile.activeModuleTabId
    let nextMeta = tile.meta

    if (wasActive) {
      const neighbor = tabs[closingIdx > 0 ? closingIdx - 1 : 0] ?? tabs[0]
      nextActiveId = neighbor.id
      nextMeta = cloneRecord(neighbor.meta)
    }

    const newTiles = new Map(tiles)
    newTiles.set(tileId, {
      ...tile,
      moduleTabs: tabs,
      activeModuleTabId: nextActiveId ?? tabs[0].id,
      ...(wasActive ? { meta: nextMeta } : {}),
    })
    set({ tiles: newTiles })
  },

  updateTile: (id, updates) => {
    const { tiles } = get()
    const tile = tiles.get(id)
    if (!tile) return

    let next = { ...tile, ...updates } as TileData
    if (updates.meta !== undefined && next.moduleTabs?.length && next.activeModuleTabId) {
      const idx = next.moduleTabs.findIndex((t) => t.id === next.activeModuleTabId)
      if (idx >= 0) {
        const newTabs = [...next.moduleTabs]
        newTabs[idx] = { ...newTabs[idx], meta: cloneRecord(next.meta) }
        next = { ...next, moduleTabs: newTabs }
      }
    }
    if (tile.type === 'browser') {
      const keys = Object.keys(updates) as (keyof TileData)[]
      const onlyChromeFlickerFields = keys.every(
        (k) => k === 'title' || k === 'meta' || k === 'tileStatus'
      )
      if (onlyChromeFlickerFields) {
        const metaSame =
          JSON.stringify(tile.meta ?? {}) === JSON.stringify(next.meta ?? {})
        if (next.title === tile.title && metaSame && next.tileStatus === tile.tileStatus) {
          return
        }
      }
    }

    const newTiles = new Map(tiles)
    newTiles.set(id, next)
    set({ tiles: newTiles })
    markTileActivity(id)
  },

  removeTile: (id, options) => {
    forgetTileActivity(id)
    useAgentTeamStore.getState().abortSubAgent(id)
    if (!options?.preserveAgentTeamEntry) {
      useAgentTeamStore.getState().removeMemberForTile(id)
    }
    const { tiles, smartCollapse, activeInteractionTileId } = get()
    const removed = tiles.get(id)
    if (removed?.type === 'browser') {
      void tauri.closeBrowserPreview(id).catch(() => {
        /* preview may already be gone */
      })
    }
    const newTiles = new Map(tiles)
    newTiles.delete(id)
    const nextGraphNodePositions = { ...get().graphNodePositions }
    delete nextGraphNodePositions[id]
    if (newTiles.size === 0) {
      set({
        tiles: newTiles,
        graphLinks: [],
        graphNodePositions: {},
        activeInteractionTileId: null,
        layoutAnchor: null,
        anchorTileId: null,
        smartCollapse: null,
        smartCollapsePicking: false,
        smartCollapseRestoreLayout: null,
      })
      return
    }
    const clearedAnchor = get().anchorTileId === id ? { anchorTileId: null as string | null } : {}
    let nextSmart = smartCollapse
    let clearRestore = false
    if (smartCollapse) {
      if (id === smartCollapse.mainId) {
        nextSmart = null
        clearRestore = true
      } else if (smartCollapse.expandedSideId === id) {
        nextSmart = { ...smartCollapse, expandedSideId: null }
      }
    }
    set({
      tiles: newTiles,
      graphNodePositions: nextGraphNodePositions,
      activeInteractionTileId: activeInteractionTileId === id ? null : activeInteractionTileId,
      smartCollapse: nextSmart,
      ...clearedAnchor,
      ...(clearRestore ? { smartCollapseRestoreLayout: null } : {}),
    })
    if (nextSmart && newTiles.has(nextSmart.mainId)) {
      queueMicrotask(() => get().refreshSmartCollapseLayout())
    }
    refocusOrchestratorIfClosedTileWasActive(id)
  },

  clearAllTiles: () => {
    for (const t of get().tiles.values()) {
      if (t.type === 'browser') {
        void tauri.closeBrowserPreview(t.id).catch(() => {
          /* preview may already be gone */
        })
      }
    }
    resetForFullCanvasHydration()
    set({
      tiles: new Map(),
      canvasViewMode: 'tiles',
      graphLinks: [],
      graphNodePositions: {},
      activeInteractionTileId: null,
      layoutAnchor: null,
      anchorTileId: null,
      smartCollapse: null,
      smartCollapsePicking: false,
      smartCollapseRestoreLayout: null,
    })
  },

  hydrateFromPersistence: (snapshot) => {
    resetForFullCanvasHydration()
    const newTiles = new Map<string, TileData>()
    for (const t of snapshot.tiles) {
      newTiles.set(t.id, { ...t, meta: { ...t.meta } })
    }
    const maxZ = Math.max(
      snapshot.maxZIndex,
      ...snapshot.tiles.map((t) => t.zIndex),
      0
    )
    set({
      tiles: newTiles,
      canvasViewMode: 'tiles',
      graphLinks: [],
      graphNodePositions: {},
      pan: { ...snapshot.pan },
      zoom: clampZoom(snapshot.zoom),
      maxZIndex: maxZ,
      layoutAnchor: snapshot.layoutAnchor,
      anchorTileId: snapshot.anchorTileId,
      activeInteractionTileId: null,
      snapOverlay: null,
      smartCollapsePicking: false,
      smartCollapse: null,
      smartCollapseRestoreLayout: null,
      missionScatterPickMode: false,
      missionScatterSavedView: null,
      missionScatterSavedTileLayout: null,
      missionOverviewActive: false,
      missionOverviewSavedView: null,
      layoutPresetUndo: null,
    })
    reapplyDelegatedAgentTeamFromSnapshot(snapshot.agentTeamMembers, newTiles, (id, updates) => {
      get().updateTile(id, updates)
    })
  },

  hydrateFromPersistenceStaggered: async (snapshot, opts) => {
    const staggerMs = opts?.staggerMs ?? 500
    const isCurrent = opts?.isCurrent ?? (() => true)

    resetForFullCanvasHydration()

    const maxZ = Math.max(
      snapshot.maxZIndex,
      ...snapshot.tiles.map((t) => t.zIndex),
      0
    )

    set({
      tiles: new Map(),
      canvasViewMode: 'tiles',
      graphLinks: [],
      graphNodePositions: {},
      pan: { ...snapshot.pan },
      zoom: clampZoom(snapshot.zoom),
      maxZIndex: 0,
      layoutAnchor: snapshot.layoutAnchor,
      anchorTileId: snapshot.anchorTileId,
      activeInteractionTileId: null,
      snapOverlay: null,
      smartCollapsePicking: false,
      smartCollapse: null,
      smartCollapseRestoreLayout: null,
      missionScatterPickMode: false,
      missionScatterSavedView: null,
      missionScatterSavedTileLayout: null,
      missionOverviewActive: false,
      missionOverviewSavedView: null,
      layoutPresetUndo: null,
    })

    const list = snapshot.tiles
    for (let i = 0; i < list.length; i++) {
      if (!isCurrent()) return
      if (i > 0 && staggerMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, staggerMs))
        if (!isCurrent()) return
      }
      const t = list[i]
      const tileData: TileData = { ...t, meta: { ...t.meta } }
      set((s) => {
        const newTiles = new Map(s.tiles)
        newTiles.set(t.id, tileData)
        const mz = Math.max(s.maxZIndex, t.zIndex)
        return { tiles: newTiles, maxZIndex: mz }
      })
    }

    if (!isCurrent()) return

    set({ maxZIndex: maxZ })

    const newTiles = new Map(get().tiles)
    reapplyDelegatedAgentTeamFromSnapshot(snapshot.agentTeamMembers, newTiles, (id, updates) => {
      get().updateTile(id, updates)
    })
  },

  hydrateFromPersistenceAsPlaceholders: (snapshot) => {
    resetForFullCanvasHydration()

    const newTiles = new Map<string, TileData>()
    for (const t of snapshot.tiles) {
      newTiles.set(t.id, {
        ...t,
        meta: { ...t.meta },
        hydrationStage: 'placeholder',
      })
    }

    const maxZ = Math.max(
      snapshot.maxZIndex,
      ...snapshot.tiles.map((t) => t.zIndex),
      0
    )

    set({
      tiles: newTiles,
      canvasViewMode: 'tiles',
      graphLinks: [],
      graphNodePositions: {},
      pan: { ...snapshot.pan },
      zoom: clampZoom(snapshot.zoom),
      maxZIndex: maxZ,
      layoutAnchor: snapshot.layoutAnchor,
      anchorTileId: snapshot.anchorTileId,
      activeInteractionTileId: null,
      snapOverlay: null,
      smartCollapsePicking: false,
      smartCollapse: null,
      smartCollapseRestoreLayout: null,
      missionScatterPickMode: false,
      missionScatterSavedView: null,
      missionScatterSavedTileLayout: null,
      missionOverviewActive: false,
      missionOverviewSavedView: null,
      layoutPresetUndo: null,
    })

    reapplyDelegatedAgentTeamFromSnapshot(snapshot.agentTeamMembers, newTiles, (id, updates) => {
      get().updateTile(id, updates)
    })
  },

  markTileActive: (id) => {
    const { tiles } = get()
    const tile = tiles.get(id)
    if (!tile) return
    if (tile.hydrationStage === 'active' || tile.hydrationStage === undefined) return

    const newTiles = new Map(tiles)
    newTiles.set(id, { ...tile, hydrationStage: 'active' })
    set({ tiles: newTiles })
    markTileActivity(id)
  },

  markTilePlaceholder: (id) => {
    const { tiles } = get()
    const tile = tiles.get(id)
    if (!tile) return
    if (tile.hydrationStage === 'placeholder') return

    const newTiles = new Map(tiles)
    newTiles.set(id, { ...tile, hydrationStage: 'placeholder' })
    set({ tiles: newTiles })
  },

  bringToFront: (id) => {
    const { tiles, maxZIndex } = get()
    const tile = tiles.get(id)
    if (!tile) return

    const newTiles = new Map(tiles)
    newTiles.set(id, { ...tile, zIndex: maxZIndex + 1 })
    set({ tiles: newTiles, maxZIndex: maxZIndex + 1 })
    markTileActivity(id)
  },

  setActiveInteractionTile: (id) => {
    set({ activeInteractionTileId: id })
    if (id) markTileActivity(id)
  },

  setCanvasViewMode: (mode) => {
    const normalizedMode: CanvasViewMode = mode === 'graph' ? 'helix' : mode
    const prev = get().canvasViewMode
    if (prev === normalizedMode) return
    if (prev === 'graph' && (normalizedMode === 'tiles' || normalizedMode === 'plan' || normalizedMode === 'helix')) {
      try {
        if (useSettingsStore.getState().graphSyncOnExit) {
          get().applyGraphNodePositionsToTiles()
        }
      } catch {
        // ignore settings lookup failures
      }
    }
    set({ canvasViewMode: normalizedMode })
  },

  setGraphLinks: (links) => {
    set({ graphLinks: [...links] })
  },

  upsertGraphLink: (link) => {
    set((state) => {
      const next = state.graphLinks.filter((l) => l.id !== link.id)
      next.push(link)
      return { graphLinks: next }
    })
  },

  removeGraphLink: (id) => {
    set((state) => ({ graphLinks: state.graphLinks.filter((l) => l.id !== id) }))
  },

  setGraphNodePosition: (id, pos) => {
    set((state) => ({
      graphNodePositions: {
        ...state.graphNodePositions,
        [id]: pos,
      },
    }))
  },

  setGraphNodePositions: (positions) => {
    set((state) => ({
      graphNodePositions: {
        ...state.graphNodePositions,
        ...positions,
      },
    }))
  },

  clearGraphNodePositions: () => {
    set({ graphNodePositions: {} })
  },

  applyGraphNodePositionsToTiles: () => {
    const { tiles, graphNodePositions } = get()
    if (!Object.keys(graphNodePositions).length) return
    const nextTiles = new Map(tiles)
    let changed = false
    for (const [id, pos] of Object.entries(graphNodePositions)) {
      const tile = nextTiles.get(id)
      if (!tile) continue
      const nextX = pos.x - tile.w / 2
      const nextY = pos.y - tile.h / 2
      if (tile.x === nextX && tile.y === nextY) continue
      nextTiles.set(id, { ...tile, x: nextX, y: nextY })
      changed = true
    }
    if (changed) set({ tiles: nextTiles })
  },

  setPan: (pan) => set({ pan }),

  animatePanTo: (target, durationMs = 300) => {
    if (typeof window === 'undefined') return
    if (panAnimationRaf) cancelAnimationFrame(panAnimationRaf)
    const start = get().pan
    const startTime = performance.now()
    const dur = Math.max(80, durationMs)
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / dur)
      const ease = 1 - (1 - t) * (1 - t)
      set({
        pan: {
          x: start.x + (target.x - start.x) * ease,
          y: start.y + (target.y - start.y) * ease,
        },
      })
      if (t < 1) {
        panAnimationRaf = requestAnimationFrame(step)
      } else {
        panAnimationRaf = 0
      }
    }
    panAnimationRaf = requestAnimationFrame(step)
  },

  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),

  setSnapOverlay: (overlay) => set({ snapOverlay: overlay }),

  applyTilesLayout: (updates) => {
    const { tiles } = get()
    const newTiles = new Map(tiles)
    for (const u of updates) {
      const t = newTiles.get(u.id)
      if (!t) continue
      newTiles.set(u.id, { ...t, x: u.x, y: u.y, w: u.w, h: u.h })
    }
    set({ tiles: newTiles })
  },

  translateTilesByIds: (ids, delta, opts) => {
    if (ids.length === 0) return
    if (Math.abs(delta.x) < 0.001 && Math.abs(delta.y) < 0.001) return
    const alpha = Math.max(0, Math.min(1, opts?.alpha ?? 1))
    if (alpha <= 0) return
    const exclude = opts?.excludeIds ?? new Set<string>()
    const { tiles } = get()
    const nextTiles = new Map(tiles)
    let changed = false
    const dx = delta.x * alpha
    const dy = delta.y * alpha
    for (const id of ids) {
      if (exclude.has(id)) continue
      const t = nextTiles.get(id)
      if (!t) continue
      nextTiles.set(id, { ...t, x: t.x + dx, y: t.y + dy })
      changed = true
    }
    if (changed) set({ tiles: nextTiles })
  },

  swapTileRects: (draggedId, targetId, draggedOriginal) => {
    const { tiles } = get()
    const dragged = tiles.get(draggedId)
    const target = tiles.get(targetId)
    if (!dragged || !target || draggedId === targetId) return

    const newTiles = new Map(tiles)
    newTiles.set(draggedId, {
      ...dragged,
      x: target.x,
      y: target.y,
      w: target.w,
      h: target.h,
    })
    newTiles.set(targetId, {
      ...target,
      x: draggedOriginal.x,
      y: draggedOriginal.y,
      w: draggedOriginal.w,
      h: draggedOriginal.h,
    })
    set({ tiles: newTiles })
    queueMicrotask(() => {
      const s = get()
      if (tileRepulsionBlocked()) return
      s.resolveOverlapsForTile(draggedId, { frozenIds: new Set([draggedId]) })
      s.resolveOverlapsForTile(targetId, { frozenIds: new Set([targetId]) })
    })
  },

  resolveOverlapsForTile: (id, opts) => {
    if (tileRepulsionBlocked()) return
    const { tiles, pan, zoom } = get()
    const vp = getViewportLayoutRect(pan, zoom)
    const frozenIds = opts?.frozenIds ?? new Set()
    let working = new Map(tiles)
    let changed = false
    for (let round = 0; round < 6; round++) {
      const updates = resolveOverlapsAround(working, id, {
        viewport: vp,
        padding: TILE_MAX_CLUSTER_GAP,
        frozenIds,
      })
      if (updates.length === 0) break
      changed = true
      for (const u of updates) {
        const t = working.get(u.id)
        if (t) working.set(u.id, { ...t, x: u.x, y: u.y, w: u.w, h: u.h })
      }
    }
    if (!changed) return
    working = applyTileRepulsionSettle(working, id)
    set({ tiles: working })
  },

  resolveOverlapsForTileLive: (id, opts) => {
    if (tileRepulsionBlocked()) return
    if (useFocusStore.getState().isActive) return
    const { tiles, pan, zoom } = get()
    const vp = getViewportLayoutRect(pan, zoom)
    const desiredGap = Math.max(10, opts?.desiredGap ?? TILE_MAX_CLUSTER_GAP)
    const liveGap = Math.max(14, Math.min(desiredGap, Math.round(desiredGap * 0.72)))
    const frozenIds = opts?.frozenIds ?? new Set<string>()
    const updates = resolveOverlapsAround(tiles, id, {
      viewport: vp,
      padding: liveGap,
      frozenIds,
    })
    let tilesChanged = updates.length > 0

    const nextTiles = new Map(tiles)
    for (const u of updates) {
      const t = nextTiles.get(u.id)
      if (t) nextTiles.set(u.id, { ...t, x: u.x, y: u.y, w: u.w, h: u.h })
    }

    let settledTiles = nextTiles
    try {
      const baseStrength = useSettingsStore.getState().tileRepulsionStrength
      const liveStrength = Math.max(0, Math.min(1.1, baseStrength * 0.55))
      if (liveStrength > 0.05) {
        const settleUpdates = forceSettle(nextTiles, {
          strength: liveStrength,
          iterations: Math.max(1, Math.min(2, opts?.settleIterations ?? 1)),
          padding: liveGap,
          damping: 0.82,
          frozenIds,
        })
        if (settleUpdates.length > 0) {
          tilesChanged = true
          settledTiles = new Map(nextTiles)
          for (const u of settleUpdates) {
            const t = settledTiles.get(u.id)
            if (t) settledTiles.set(u.id, { ...t, x: u.x, y: u.y, w: u.w, h: u.h })
          }
        }
      }
    } catch {
      settledTiles = nextTiles
    }

    // Note: we intentionally do NOT apply a drag-vector “flow” nudge here. That pass fought the
    // overlap cascade every frame (tiles pushed for gap + flow pulled along drag), which caused
    // violent jitter when dropping between two modules.

    const postFlowUpdates = resolveOverlapsAround(settledTiles, id, {
      viewport: vp,
      padding: liveGap,
      frozenIds,
    })
    if (postFlowUpdates.length > 0) {
      tilesChanged = true
      const postFlowTiles = new Map(settledTiles)
      for (const u of postFlowUpdates) {
        const t = postFlowTiles.get(u.id)
        if (t) postFlowTiles.set(u.id, { ...t, x: u.x, y: u.y, w: u.w, h: u.h })
      }
      settledTiles = postFlowTiles
    }

    if (!tilesChanged) return
    set({ tiles: settledTiles })
  },

  startSmartCollapsePicker: () => {
    const { tiles } = get()
    if (tiles.size < 2) return
    set({
      smartCollapsePicking: true,
      smartCollapse: null,
    })
  },

  cancelSmartCollapsePicker: () => set({ smartCollapsePicking: false }),

  selectSmartCollapseMain: (mainId) => {
    const { tiles, smartCollapsePicking } = get()
    if (!smartCollapsePicking) return
    const t = tiles.get(mainId)
    if (!t || tiles.size < 2) {
      set({ smartCollapsePicking: false })
      return
    }
    // Snap to 100% zoom so tiles aren’t laid out for a zoomed-out view while the canvas
    // stays at e.g. 28% scale (everything looks tiny). Pan is kept so framing isn’t reset.
    set({ zoom: 1 })
    const area = getViewportLayoutRect(get().pan, get().zoom)
    if (!area) {
      set({ smartCollapsePicking: false })
      return
    }
    const sorted = sortTilesForLayout(Array.from(tiles.values()))
    const ratio = SMART_COLLAPSE_DEFAULT_MAIN_RATIO
    const layout = computeSmartCollapseLayout(area, mainId, sorted, null, ratio)
    if (layout.length === 0) {
      set({ smartCollapsePicking: false })
      return
    }
    const restoreLayout: TileLayoutUpdate[] = Array.from(tiles.values()).map((tile) => ({
      id: tile.id,
      x: tile.x,
      y: tile.y,
      w: tile.w,
      h: tile.h,
    }))
    get().applyTilesLayout(layout)
    set({
      smartCollapsePicking: false,
      smartCollapse: { mainId, expandedSideId: null },
      smartCollapseRestoreLayout: restoreLayout,
      smartCollapseMainRatio: ratio,
    })
  },

  setSmartCollapseExpanded: (sideTileId) => {
    const { smartCollapse } = get()
    if (!smartCollapse) return
    if (sideTileId === smartCollapse.mainId) return
    const nextExpanded =
      smartCollapse.expandedSideId === sideTileId ? null : sideTileId
    set({
      smartCollapse: {
        mainId: smartCollapse.mainId,
        expandedSideId: nextExpanded,
      },
    })
    queueMicrotask(() => get().refreshSmartCollapseLayout())
  },

  exitSmartCollapse: () => {
    const { smartCollapseRestoreLayout, tiles } = get()
    const updates =
      smartCollapseRestoreLayout?.filter((u) => tiles.has(u.id)) ?? []
    if (updates.length > 0) {
      get().applyTilesLayout(updates)
    }
    set({
      smartCollapse: null,
      smartCollapsePicking: false,
      smartCollapseRestoreLayout: null,
    })
  },

  refreshSmartCollapseLayout: () => {
    const { tiles, pan, zoom, smartCollapse } = get()
    if (!smartCollapse) return
    const main = tiles.get(smartCollapse.mainId)
    if (!main) {
      set({ smartCollapse: null, smartCollapseRestoreLayout: null })
      return
    }
    const area = getViewportLayoutRect(pan, zoom)
    if (!area) return
    const sorted = sortTilesForLayout(Array.from(tiles.values()))
    const layout = computeSmartCollapseLayout(
      area,
      smartCollapse.mainId,
      sorted,
      smartCollapse.expandedSideId,
      get().smartCollapseMainRatio
    )
    if (layout.length > 0) get().applyTilesLayout(layout)
  },

  setSmartCollapseMainRatio: (ratio) => {
    const clamped = Math.max(0.52, Math.min(0.9, ratio))
    set({ smartCollapseMainRatio: clamped })
    queueMicrotask(() => get().refreshSmartCollapseLayout())
  },
}))

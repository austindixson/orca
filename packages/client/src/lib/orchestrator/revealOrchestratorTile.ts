import type { TileData } from '../../store/canvasStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useFocusStore } from '../../store/focusStore'
import {
  useOrchestratorActivityStore,
  type OrchestratorTileRevealEffect,
  type OrchestratorTileRevealHint,
} from '../../store/orchestratorActivityStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { computePanZoomToFitTiles } from '../layoutPresets'
import { emitRefreshChangelog } from '../uiEvents'
import { getOrchestratorAutoFocusAnchorY } from './orchestratorAutoFocusAnchor'

/** Fraction of tile area (screen space) that must be visible to skip panning. */
const VISIBLE_THRESHOLD = 0.28
const PAN_MS = 320

export type { OrchestratorTileRevealHint, OrchestratorTileRevealEffect }

function defaultHintForTile(tile: TileData): OrchestratorTileRevealHint {
  switch (tile.type) {
    case 'editor':
      return { label: 'Editing…', effect: 'scan' }
    case 'diff':
      return { label: 'Reviewing diff…', effect: 'shimmer' }
    case 'browser':
      return { label: 'Loading preview…', effect: 'scan' }
    case 'github':
      return { label: 'GitHub CLI…', effect: 'pulse' }
    case 'terminal':
      return { label: 'Terminal…', effect: 'pulse' }
    case 'todo':
      return { label: 'Todo…', effect: 'pulse' }
    case 'agent':
      return { label: 'Agent…', effect: 'pulse' }
    case 'agent_team':
      return { label: 'Agent team…', effect: 'pulse' }
    case 'changelog':
      return { label: 'Changelog…', effect: 'pulse' }
    case 'orchestrator':
      return { label: 'Orchestrator…', effect: 'pulse' }
    case 'benchmark':
      return { label: 'Benchmark…', effect: 'pulse' }
    case 'remotion':
      return { label: 'Remotion…', effect: 'pulse' }
    case 'openrouter_usage':
      return { label: 'OpenRouter usage…', effect: 'pulse' }
    case 'toolbox':
      return { label: 'Toolbox…', effect: 'pulse' }
    case 'reasoning':
      return { label: 'Thinking · Trace…', effect: 'pulse' }
    case 'research':
      return { label: 'Research…', effect: 'pulse' }
    case 'project_status':
      return { label: 'Project status…', effect: 'pulse' }
    case 'telemetry':
      return { label: 'Telemetry…', effect: 'pulse' }
    case 'hermes_bridge':
      return { label: 'Hermes bridge…', effect: 'pulse' }
    case 'hermes_agent':
      return { label: 'Hermes…', effect: 'pulse' }
    case 'telegram_onboard':
      return { label: 'Telegram onboard…', effect: 'pulse' }
    case 'native_gateway':
      return { label: 'Native gateway…', effect: 'pulse' }
    default:
      return { label: 'Working…', effect: 'pulse' }
  }
}

function getCanvasRect(): DOMRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector('[data-testid="infinite-canvas"]')
  return el?.getBoundingClientRect() ?? null
}

function visibleAreaFraction(
  tile: { x: number; y: number; w: number; h: number },
  pan: { x: number; y: number },
  zoom: number
): number {
  const r = getCanvasRect()
  if (!r) return 0
  const left = r.left + pan.x + tile.x * zoom
  const top = r.top + pan.y + tile.y * zoom
  const right = left + tile.w * zoom
  const bottom = top + tile.h * zoom
  const iw = Math.max(0, Math.min(right, r.left + r.width) - Math.max(left, r.left))
  const ih = Math.max(0, Math.min(bottom, r.top + r.height) - Math.max(top, r.top))
  const intersect = iw * ih
  const tileArea = tile.w * tile.h * zoom * zoom
  if (tileArea <= 0) return 0
  return intersect / tileArea
}

/**
 * Bring a tile to the top z-order and ensure it is visible.
 * Does not change zoom — pans smoothly only when the tile is mostly off-screen.
 * Skips pan while focus mode is active.
 *
 * When auto-focus is enabled, shows a glitter label + effect above the tile (laser scan for reads, etc.).
 *
 * `bypassAutoFocusPreference` is used for **Agent team** visibility after `spawn_sub_agent` so delegation
 * is surfaced even when the user turned off general orchestrator auto-focus.
 */
/**
 * @param sourceSessionTileId Optional override for hint.sourceSessionTileId (orchestrator widget or agent tile id).
 */
export type RevealOrchestratorTileOpts = {
  bypassAutoFocusPreference?: boolean
  /** Pan + zoom so the tile fills the viewport (used when re-enabling auto-focus). */
  preferFit?: boolean
  /** Pan to center even if the tile is already partially visible (keyboard nav keeps threshold). */
  forceCamera?: boolean
  /**
   * Skip the pulsing "Editing…/Reading…" label overlay. Used by the toolbar "Auto-focus"
   * button so manually re-framing a tile between runs does not revive a stale activity label.
   */
  suppressHighlight?: boolean
}

export function revealOrchestratorTile(
  tileId: string,
  hint?: OrchestratorTileRevealHint,
  sourceSessionTileId?: string | null,
  opts?: RevealOrchestratorTileOpts
): void {
  if (typeof window === 'undefined') return

  const { tiles, bringToFront, animatePanTo, setPan, setZoom } = useCanvasStore.getState()
  const tile = tiles.get(tileId)
  if (!tile) return

  const autoFocus = useWorkspaceStore.getState().orchestratorAutoFocus
  const clarifyFocusLock = useWorkspaceStore.getState().orchestratorClarifyFocusLock
  const isWidget = tile.meta?.orchestratorWidget === true

  // While clarify questions are waiting on the user, keep attention pinned to the orchestrator
  // widget and suppress normal module steals until the user answers or skips.
  if (clarifyFocusLock && !isWidget) {
    return
  }

  // Activity label above the tile: show for every non-widget module the orchestrator touches,
  // even when "auto-focus" (pan/bring-to-front) is off so users still see what is active.
  if (!isWidget && !opts?.suppressHighlight) {
    const resolved: OrchestratorTileRevealHint = hint ?? defaultHintForTile(tile)
    const session =
      sourceSessionTileId !== undefined ? sourceSessionTileId : resolved.sourceSessionTileId
    useOrchestratorActivityStore.getState().setAutoFocusHighlight({
      tileId,
      label: resolved.label,
      effect: resolved.effect ?? 'pulse',
      sourceSessionTileId: session,
    })
  }

  if (!opts?.bypassAutoFocusPreference && !autoFocus) {
    return
  }

  emitRefreshChangelog({ reason: 'orchestrator-module-switch', sourceTileId: tileId })

  bringToFront(tileId)

  // Widget tiles skip `setAutoFocusHighlight` (no duplicate banner on the chat module), but we
  // still want the toolbar / "last focused module" fallback to point at the orchestrator.
  if (isWidget) {
    useOrchestratorActivityStore.setState({ lastOrchestratorTileId: tileId })
  }

  if (useFocusStore.getState().isActive) {
    return
  }

  if (opts?.preferFit) {
    const fitted = computePanZoomToFitTiles([tile], {
      minZoom: 0.25,
      anchorY: 'orchestrator-hud',
    })
    if (fitted) {
      setPan(fitted.pan)
      setZoom(fitted.zoom)
    }
    return
  }

  const { pan: panNow, zoom: zoomNow } = useCanvasStore.getState()
  if (
    !opts?.forceCamera &&
    visibleAreaFraction(tile, panNow, zoomNow) >= VISIBLE_THRESHOLD
  ) {
    return
  }

  const r = getCanvasRect()
  if (!r) return

  // Re-read pan/zoom immediately before camera math so manual zoom/pan before reveal does not drift.
  const { zoom } = useCanvasStore.getState()
  const cx = tile.x + tile.w / 2
  const cy = tile.y + tile.h / 2
  const newPanX = r.width / 2 - cx * zoom
  const targetY = getOrchestratorAutoFocusAnchorY(r)
  const newPanY = targetY - cy * zoom

  animatePanTo({ x: newPanX, y: newPanY }, PAN_MS)
}

/**
 * Call after orchestrator auto-focus is turned back on: pan/zoom to the highlighted module.
 */
export function revealOrchestratorOnAutoFocusEnabled(): void {
  const h = useOrchestratorActivityStore.getState().autoFocusHighlight
  if (!h?.tileId) return
  revealOrchestratorTile(
    h.tileId,
    { label: h.label, effect: h.effect },
    h.sourceSessionTileId ?? null,
    { bypassAutoFocusPreference: true, preferFit: true }
  )
}

/**
 * Pan + zoom the canvas to fit whatever tile the orchestrator is currently using
 * (or most recently used). Resolution order:
 *   1. `autoFocusHighlight` — the tile with the live pulsing label during a run
 *   2. `agentTileFocus`     — the tile of the in-flight tool call
 *   3. `lastOrchestratorTileId` — sticky fallback so the button still works after a run ends
 *
 * Always bypasses the `orchestratorAutoFocus` preference and always refits (no visibility
 * threshold shortcut) — the user explicitly asked to see the tile by pressing the button.
 *
 * Returns `true` when it actually fit a tile, `false` when no target could be resolved.
 */
export function focusOrchestratorActiveTileNow(): boolean {
  const act = useOrchestratorActivityStore.getState()
  const { tiles } = useCanvasStore.getState()

  const candidates: Array<{
    tileId: string
    hint?: OrchestratorTileRevealHint
    sourceSessionTileId?: string | null
  }> = []
  if (act.autoFocusHighlight?.tileId) {
    candidates.push({
      tileId: act.autoFocusHighlight.tileId,
      hint: { label: act.autoFocusHighlight.label, effect: act.autoFocusHighlight.effect },
      sourceSessionTileId: act.autoFocusHighlight.sourceSessionTileId ?? null,
    })
  }
  if (act.agentTileFocus?.tileId) {
    candidates.push({ tileId: act.agentTileFocus.tileId })
  }
  if (act.lastOrchestratorTileId) {
    candidates.push({ tileId: act.lastOrchestratorTileId })
  }

  for (const c of candidates) {
    if (!tiles.get(c.tileId)) continue
    // Only refresh the pulsing activity label if there is a live hint (i.e. an in-flight
    // run). Falling back to `lastOrchestratorTileId` means the run already ended — we just
    // want to re-frame the tile without resurrecting a stale "Editing…" label.
    const suppressHighlight = !c.hint
    revealOrchestratorTile(c.tileId, c.hint, c.sourceSessionTileId ?? null, {
      bypassAutoFocusPreference: true,
      preferFit: true,
      forceCamera: true,
      suppressHighlight,
    })
    return true
  }
  return false
}

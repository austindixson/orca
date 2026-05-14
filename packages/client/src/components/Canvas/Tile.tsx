import { useState, useEffect, memo, type CSSProperties } from 'react'
import { TileData, type TileStatus, useCanvasStore } from '../../store/canvasStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { useFocusStore } from '../../store/focusStore'
import { useTodoStore } from '../../store/todoStore'
import { useDrag } from '../../hooks/useDrag'
import { useResize } from '../../hooks/useResize'
import { useAutoCloseIdleEditorModuleTabs } from '../../hooks/useAutoCloseIdleEditorModuleTabs'
import { useEffectiveMotionBlocked } from '../../hooks/useReducedMotionPreference'
import { TILE_GLOW_RGBA } from '../../lib/tileGlow'
import { tileTypeDescription } from '../../lib/tileMenuCatalog'
import { OrchestratorModuleFocusBanner } from './OrchestratorModuleFocusBanner'
import { OrchestratorTileAvatar } from '../orchestrator/OrchestratorTileAvatar'
import { TileRegistry } from './TileRegistry'
import { TileErrorBoundary } from './TileErrorBoundary'
import { TilePlaceholder } from './TilePlaceholder'
import clsx from 'clsx'
import { useShallow } from 'zustand/react/shallow'

interface TileProps {
  data: TileData
}

const TILE_ICONS: Record<string, React.ReactNode> = {
  terminal: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  editor: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  browser: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  github: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.919.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.001 10.001 0 0022 12c0-5.523-4.477-10-10-10z" />
    </svg>
  ),
  diff: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  todo: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  agent: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
    </svg>
  ),
  orchestrator: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  ),
  changelog: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 4h12v16H3z" />
      <path d="M9 4h12v16H9" />
      <path d="M6 8h6M6 12h6M6 16h4" />
    </svg>
  ),
  agent_team: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  agent_group_chat: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
      <path d="M17 9H9M17 13H9" strokeLinecap="round" />
    </svg>
  ),
  benchmark: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19h16" />
      <path d="M7 17V9M12 17v-6M17 17V5" />
    </svg>
  ),
  remotion: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M10 9l6 4-6 4V9z" fill="currentColor" stroke="none" />
    </svg>
  ),
  openrouter_usage: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19h16" />
      <path d="M7 17V9M12 17v-6M17 17V5" />
      <circle cx="18" cy="5" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  toolbox: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a6 6 0 0 0-8.48 0L4 8.52V12h3.48l2.12-2.12a3 3 0 0 1 4.24 0L16 12h4V8.52l-2.3-2.22z" />
      <path d="M4 20h16v-4H4v4z" />
    </svg>
  ),
  research: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="10" cy="10" r="6" />
      <path d="M14.5 14.5L20 20" strokeLinecap="round" />
      <path d="M7 8h6M7 11h4" strokeLinecap="round" />
    </svg>
  ),
  reasoning: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3c2.5 2 4 5 4 8.5S15 20 12 21c-3-1-4-6-4-9.5S9.5 5 12 3z" />
      <path d="M8.5 14.5c2 1 5 1 7 0" strokeLinecap="round" />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  project_status: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" />
      <path d="M9 14h6v2H9zM9 18h6v2H9z" />
    </svg>
  ),
  telemetry: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  hermes_bridge: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="7" cy="8" r="2" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="16" cy="16" r="2" />
      <path d="M8.5 9.5l6-2M15 14.5l1-5M9 15l5-2" />
    </svg>
  ),
  hermes_agent: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l2 4h4l-3 3 1 5-4-2-4 2 1-5-3-3h4z" />
      <path d="M8 18h8M10 14h4" />
    </svg>
  ),
  telegram_onboard: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13" strokeLinecap="round" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" fill="currentColor" stroke="none" opacity="0.35" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  ),
  native_gateway: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="8" width="18" height="10" rx="2" />
      <path d="M7 8V6a2 2 0 012-2h6a2 2 0 012 2v2" />
      <circle cx="12" cy="13" r="2" fill="currentColor" stroke="none" opacity="0.4" />
    </svg>
  ),
  bug_bounty: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" />
      <path d="M8 18h8M9 14h6" />
    </svg>
  ),
}

const TILE_COLORS: Record<string, string> = {
  terminal: 'text-accent-teal',
  editor: 'text-accent-blue',
  browser: 'text-accent-purple',
  github: 'text-sky-400',
  diff: 'text-accent-orange',
  todo: 'text-accent-pink',
  agent: 'text-accent-teal',
  agent_team: 'text-cyan-300',
  agent_group_chat: 'text-cyan-200',
  orchestrator: 'text-accent-teal',
  changelog: 'text-emerald-300',
  benchmark: 'text-amber-300',
  remotion: 'text-fuchsia-300',
  openrouter_usage: 'text-indigo-300',
  toolbox: 'text-lime-300',
  research: 'text-indigo-400',
  reasoning: 'text-violet-400',
  project_status: 'text-emerald-300',
  telemetry: 'text-sky-300',
  hermes_bridge: 'text-cyan-300',
  hermes_agent: 'text-teal-300',
  telegram_onboard: 'text-[#ff6b4a]',
  native_gateway: 'text-emerald-300',
  bug_bounty: 'text-amber-300',
}

const TILE_GLOW: Record<string, string> = {
  terminal: 'shadow-glow-teal',
  editor: 'shadow-glow-blue',
  browser: 'shadow-glow-purple',
  github: 'shadow-[0_0_20px_rgba(56,189,248,0.2)]',
  diff: 'shadow-glow-orange',
  todo: 'shadow-glow-pink',
  agent: 'shadow-glow-teal',
  agent_team: 'shadow-glow-teal',
  agent_group_chat: 'shadow-[0_0_18px_rgba(34,211,238,0.2)]',
  /** Softer than legacy `shadow-glow-teal` — parity with research / other agent tiles */
  orchestrator: 'shadow-[0_0_18px_rgba(45,212,191,0.12)]',
  changelog: 'shadow-glow-teal',
  benchmark: 'shadow-[0_0_18px_rgba(251,191,36,0.18)]',
  remotion: 'shadow-[0_0_18px_rgba(232,121,249,0.15)]',
  openrouter_usage: 'shadow-[0_0_18px_rgba(129,140,248,0.2)]',
  toolbox: 'shadow-[0_0_18px_rgba(163,230,53,0.18)]',
  research: 'shadow-[0_0_18px_rgba(99,102,241,0.18)]',
  reasoning: 'shadow-[0_0_18px_rgba(167,139,250,0.2)]',
  project_status: 'shadow-[0_0_18px_rgba(52,211,153,0.2)]',
  telemetry: 'shadow-[0_0_18px_rgba(56,189,248,0.2)]',
  hermes_bridge: 'shadow-[0_0_18px_rgba(34,211,238,0.2)]',
  hermes_agent: 'shadow-[0_0_18px_rgba(45,212,191,0.22)]',
  telegram_onboard: 'shadow-[0_0_20px_rgba(255,107,74,0.18)]',
  native_gateway: 'shadow-[0_0_18px_rgba(52,211,153,0.2)]',
  bug_bounty: 'shadow-[0_0_18px_rgba(251,191,36,0.18)]',
}

function scaledIdleGlowBoxShadow(tileType: string, strength: number): string {
  const c = TILE_GLOW_RGBA[tileType] ?? TILE_GLOW_RGBA.terminal
  const s = Math.min(1.5, Math.max(0, strength))
  const alpha = Math.min(0.4, c[3] * s)
  const blur = Math.round(24 * s)
  return `0 0 ${blur}px rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha}), 0 4px 20px rgba(0, 0, 0, 0.35)`
}

const UTILITY_SIZE_PRESETS: Record<TileData['type'], Array<{ w: number; h: number }>> = {
  terminal: [
    { w: 520, h: 300 },
    { w: 430, h: 240 },
    { w: 340, h: 190 },
  ],
  editor: [
    { w: 560, h: 360 },
    { w: 460, h: 300 },
    { w: 360, h: 230 },
  ],
  browser: [
    { w: 620, h: 380 },
    { w: 500, h: 310 },
    { w: 380, h: 240 },
  ],
  agent_browser: [
    { w: 900, h: 600 },
    { w: 720, h: 480 },
    { w: 560, h: 380 },
  ],
  github: [
    { w: 640, h: 440 },
    { w: 520, h: 360 },
    { w: 420, h: 300 },
  ],
  diff: [
    { w: 560, h: 320 },
    { w: 460, h: 260 },
    { w: 360, h: 210 },
  ],
  todo: [
    { w: 340, h: 300 },
    { w: 300, h: 250 },
    { w: 260, h: 210 },
  ],
  agent: [
    { w: 360, h: 280 },
    { w: 320, h: 230 },
    { w: 280, h: 190 },
  ],
  agent_team: [
    { w: 380, h: 420 },
    { w: 340, h: 360 },
    { w: 300, h: 300 },
  ],
  agent_group_chat: [
    { w: 420, h: 460 },
    { w: 380, h: 400 },
    { w: 340, h: 340 },
  ],
  changelog: [
    { w: 420, h: 320 },
    { w: 360, h: 270 },
    { w: 300, h: 220 },
  ],
  orchestrator: [
    { w: 630, h: 500 },
    { w: 520, h: 420 },
    { w: 440, h: 360 },
  ],
  benchmark: [
    { w: 440, h: 420 },
    { w: 380, h: 360 },
    { w: 320, h: 300 },
  ],
  remotion: [
    { w: 520, h: 440 },
    { w: 440, h: 380 },
    { w: 360, h: 320 },
  ],
  openrouter_usage: [
    { w: 420, h: 460 },
    { w: 380, h: 400 },
    { w: 340, h: 360 },
  ],
  toolbox: [
    { w: 420, h: 480 },
    { w: 380, h: 420 },
    { w: 340, h: 360 },
  ],
  research: [
    { w: 420, h: 480 },
    { w: 380, h: 420 },
    { w: 340, h: 360 },
  ],
  reasoning: [
    { w: 460, h: 520 },
    { w: 400, h: 460 },
    { w: 340, h: 400 },
  ],
  project_status: [
    { w: 480, h: 520 },
    { w: 420, h: 460 },
    { w: 360, h: 400 },
  ],
  telemetry: [
    { w: 420, h: 440 },
    { w: 380, h: 400 },
    { w: 340, h: 360 },
  ],
  hermes_bridge: [
    { w: 440, h: 520 },
    { w: 400, h: 460 },
    { w: 360, h: 400 },
  ],
  hermes_agent: [
    { w: 400, h: 480 },
    { w: 360, h: 420 },
    { w: 320, h: 380 },
  ],
  telegram_onboard: [
    { w: 384, h: 540 },
    { w: 360, h: 480 },
    { w: 320, h: 420 },
  ],
  native_gateway: [
    { w: 432, h: 580 },
    { w: 400, h: 520 },
    { w: 360, h: 460 },
  ],
  bug_bounty: [
    { w: 440, h: 540 },
    { w: 380, h: 460 },
    { w: 320, h: 380 },
  ],
}

function StatusBadge({ status }: { status: TileStatus }) {
  const styles: Record<TileStatus, string> = {
    idle: 'border-amber-500/25 bg-amber-500/10 text-amber-200/90',
    working: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
    waiting: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
    done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    error: 'border-red-500/30 bg-red-500/10 text-red-200',
    warning: 'border-orange-500/30 bg-orange-500/10 text-orange-200',
  }
  const dot: Record<TileStatus, string> = {
    idle: 'bg-status-idle',
    working: 'bg-status-working shadow-[0_0_8px_rgba(56,189,248,0.8)]',
    waiting: 'bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.75)]',
    done: 'bg-status-done',
    error: 'bg-status-error',
    warning: 'bg-orange-400',
  }
  const label: Record<TileStatus, string> = {
    idle: 'Idle',
    working: 'Working',
    waiting: 'Waiting',
    done: 'Done',
    error: 'Error',
    warning: 'Warning',
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot[status]}`} />
      {label[status]}
    </span>
  )
}

function TileComponent({ data }: TileProps) {
  /**
   * Perf: bundle per-tile zustand subscriptions via useShallow. Before, each Tile had ~30 separate
   * selectors across canvasStore/focusStore/settingsStore, and every global mutation walked
   * ~30×N tile selectors on every update. Consolidating into a handful of shallow-bundled slices
   * cuts that walk cost ~5x and is the single biggest canvas-lag win on large workspaces.
   */
  const {
    removeTile,
    updateTile,
    setActiveModuleTab,
    closeModuleTab,
    bringToFront,
    setActiveInteractionTile,
    selectSmartCollapseMain,
    setSmartCollapseExpanded,
  } = useCanvasStore(
    useShallow((s) => ({
      removeTile: s.removeTile,
      updateTile: s.updateTile,
      setActiveModuleTab: s.setActiveModuleTab,
      closeModuleTab: s.closeModuleTab,
      bringToFront: s.bringToFront,
      setActiveInteractionTile: s.setActiveInteractionTile,
      selectSmartCollapseMain: s.selectSmartCollapseMain,
      setSmartCollapseExpanded: s.setSmartCollapseExpanded,
    }))
  )
  const { smartCollapse, smartCollapsePicking } = useCanvasStore(
    useShallow((s) => ({
      smartCollapse: s.smartCollapse,
      smartCollapsePicking: s.smartCollapsePicking,
    }))
  )

  const {
    enterFocus,
    addToFocus,
    removeFromFocus,
    enterSelectionMode,
    toggleTileSelection,
    toggleDeletionTileSelection,
    isActive,
    focusIdx,
    isDimmed,
    primaryFocusId,
    focusedCount,
    isSelectionMode,
    isSelectedForFocus,
    isDeleteSelectionMode,
    isSelectedForDeletion,
  } = useFocusStore(
    useShallow((s) => {
      const idx = s.focusedTileIds.indexOf(data.id)
      return {
        enterFocus: s.enterFocus,
        addToFocus: s.addToFocus,
        removeFromFocus: s.removeFromFocus,
        enterSelectionMode: s.enterSelectionMode,
        toggleTileSelection: s.toggleTileSelection,
        toggleDeletionTileSelection: s.toggleDeletionTileSelection,
        isActive: s.isActive,
        focusIdx: idx,
        isDimmed: s.isActive && idx < 0,
        primaryFocusId: s.focusedTileIds[0] ?? null,
        focusedCount: s.focusedTileIds.length,
        isSelectionMode: s.isSelectionMode,
        isSelectedForFocus: s.isSelectionMode && s.selectedForFocus.includes(data.id),
        isDeleteSelectionMode: s.isDeleteSelectionMode,
        isSelectedForDeletion:
          s.isDeleteSelectionMode && s.selectedForDeletion.includes(data.id),
      }
    })
  )
  const isFocused = isActive && focusIdx >= 0
  const isPrimaryInFocus = isActive && primaryFocusId === data.id
  const { handleDragStart } = useDrag(data.id)
  const { handleResizeStart } = useResize(data.id)

  const autoFocusHighlight = useOrchestratorActivityStore((s) =>
    s.autoFocusHighlight?.tileId === data.id ? s.autoFocusHighlight : null
  )

  const [spawnIn, setSpawnIn] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setSpawnIn(false), 420)
    return () => window.clearTimeout(t)
  }, [data.id])

  const moduleTabIdsKey =
    data.moduleTabs && data.moduleTabs.length >= 2
      ? data.moduleTabs.map((t) => t.id).join(',')
      : ''
  useAutoCloseIdleEditorModuleTabs(data.id, data.type, data.activeModuleTabId, moduleTabIdsKey)

  /** Only subscribe to todoStore from actual todo tiles — avoids N-way fan-out on every keystroke. */
  const isTodoTile = data.type === 'todo'
  const todoShellHint = useTodoStore((s) => {
    if (!isTodoTile) return null as 'working' | 'done' | null
    const tasks = s.tasks
    if (tasks.length === 0) return null
    const hasOpen = tasks.some(
      (t) => t.status === 'pending' || t.status === 'in_progress'
    )
    if (hasOpen) return 'working'
    const allComplete = tasks.every((t) => t.status === 'completed' || t.status === 'cancelled')
    return allComplete ? 'done' : null
  })

  const effectiveStatus: TileStatus | undefined =
    data.tileStatus ??
    (todoShellHint === 'working'
      ? 'working'
      : todoShellHint === 'done'
        ? 'done'
        : undefined)

  type ShellKind =
    | 'none'
    | 'focus'
    | 'focus-error'
    | 'focus-done'
    | 'working'
    | 'waiting'
    | 'done'
    | 'idle'
    | 'error'
    | 'secondary'

  let shellKind: ShellKind = 'none'
  if (!isDimmed && !smartCollapsePicking) {
    if (isPrimaryInFocus) {
      if (effectiveStatus === 'error') shellKind = 'focus-error'
      else if (effectiveStatus === 'done') shellKind = 'focus-done'
      else shellKind = 'focus'
    } else if (isFocused && isActive) {
      shellKind = 'secondary'
    } else if (effectiveStatus === 'working') {
      shellKind = 'working'
    } else if (effectiveStatus === 'waiting') {
      shellKind = 'waiting'
    } else if (effectiveStatus === 'done') {
      shellKind = 'done'
    } else if (effectiveStatus === 'idle') {
      shellKind = 'idle'
    } else if (effectiveStatus === 'error') {
      shellKind = 'error'
    }
  }

  const shellOuterClass: Record<ShellKind, string | undefined> = {
    none: undefined,
    focus: 'tile-shell-focus',
    'focus-error': 'tile-shell-focus-error',
    'focus-done': 'tile-shell-focus-done',
    working: 'tile-shell-working',
    waiting: 'tile-shell-waiting',
    done: 'tile-shell-done',
    idle: 'tile-shell-idle',
    error: 'tile-shell-error',
    secondary: 'tile-shell-secondary-focus',
  }

  const useAnimatedShell = shellKind !== 'none'

  const {
    tileBorderAnimation,
    tileIdleGlowEnabled,
    tileIdleGlowStrength,
    shootingStarSpeedScale,
    shootingStarsHonorReducedMotion,
    respectPrefersReducedMotion,
    orchestratorTileRevealEffectsEnabled,
  } = useSettingsStore(
    useShallow((s) => ({
      tileBorderAnimation: s.tileBorderAnimation,
      tileIdleGlowEnabled: s.tileIdleGlowEnabled,
      tileIdleGlowStrength: s.tileIdleGlowStrength,
      shootingStarSpeedScale: s.shootingStarSpeedScale,
      shootingStarsHonorReducedMotion: s.shootingStarsHonorReducedMotion,
      respectPrefersReducedMotion: s.respectPrefersReducedMotion,
      orchestratorTileRevealEffectsEnabled: s.orchestratorTileRevealEffectsEnabled,
    }))
  )
  const motionBlocked = useEffectiveMotionBlocked(respectPrefersReducedMotion)
  const shootingStarMotionBlocked =
    shootingStarsHonorReducedMotion && motionBlocked

  const showShootingStar =
    tileBorderAnimation !== 'off' &&
    shellKind === 'none' &&
    !isDimmed &&
    !smartCollapsePicking &&
    !shootingStarMotionBlocked

  const revealAttentionFx = orchestratorTileRevealEffectsEnabled && !motionBlocked
  const glowStrengthNearDefault = Math.abs(tileIdleGlowStrength - 1) < 0.05
  const idleGlowNeedsInline =
    !useAnimatedShell && tileIdleGlowEnabled && !glowStrengthNearDefault

  const orchestratorRainbowDone =
    data.type === 'orchestrator' &&
    effectiveStatus === 'done' &&
    shellKind !== 'none' &&
    shellKind !== 'error' &&
    shellKind !== 'working' &&
    shellKind !== 'waiting'

  const resolvedShellOuterClass = orchestratorRainbowDone
    ? 'tile-shell-orchestrator-done'
    : shellOuterClass[shellKind]

  const innerChromeClass = clsx(
    'relative flex flex-col min-h-0 h-full w-full overflow-hidden',
    showShootingStar && 'z-[3]',
    useAnimatedShell ? 'rounded-[14px]' : 'rounded-2xl',
    'bg-tile-bg/95 backdrop-blur-sm',
    useAnimatedShell ? 'border border-white/[0.06]' : 'border border-tile-border/90',
    !useAnimatedShell &&
      (!tileIdleGlowEnabled
        ? 'shadow-tile'
        : idleGlowNeedsInline
          ? 'shadow-tile'
          : (TILE_GLOW[data.type] ?? 'shadow-tile')),
    spawnIn && 'animate-tile-spawn',
    'transition-all duration-300 ease-out',
    isDimmed && 'opacity-10 pointer-events-none scale-[0.95]',
    !useAnimatedShell && isFocused && 'ring-2 ring-accent-teal/50',
    isSelectedForFocus && 'ring-2 ring-accent-teal shadow-[0_0_20px_rgba(0,212,170,0.3)]',
    isSelectedForDeletion && 'ring-2 ring-red-400/70 shadow-[0_0_18px_rgba(248,113,113,0.22)]',
    isSelectionMode && !isSelectedForFocus && 'opacity-60 hover:opacity-100 hover:ring-1 hover:ring-accent-teal/30',
    isDeleteSelectionMode &&
      !isSelectedForDeletion &&
      'opacity-70 hover:opacity-100 hover:ring-1 hover:ring-red-400/35',
    smartCollapsePicking && 'cursor-pointer ring-2 ring-accent-teal/45'
  )

  const innerChromeStyle: React.CSSProperties | undefined =
    !useAnimatedShell && idleGlowNeedsInline
      ? { boxShadow: scaledIdleGlowBoxShadow(data.type, tileIdleGlowStrength) }
      : undefined

  const isSmartCollapse = smartCollapse != null
  const isSmartMain = smartCollapse?.mainId === data.id
  const isSmartSide = isSmartCollapse && !isSmartMain
  const showSideBody =
    !isSmartSide ||
    (smartCollapse != null && smartCollapse.expandedSideId === data.id)
  const isSmartCollapsedStrip = isSmartSide && !showSideBody

  const TileContent = TileRegistry[data.type]
  const subtitle =
    typeof data.meta?.subtitle === 'string' && data.meta.subtitle.trim()
      ? data.meta.subtitle.trim()
      : ''

  const handleFocusClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (e.shiftKey && isActive) {
      if (isFocused) {
        removeFromFocus(data.id)
      } else {
        addToFocus(data.id)
      }
    } else {
      enterFocus([data.id])
    }
  }

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (smartCollapsePicking) return

    if (isActive) {
      e.preventDefault()
      return
    }

    if (isSmartCollapse) {
      e.preventDefault()
      e.stopPropagation()
      if (isSmartSide) {
        setSmartCollapseExpanded(data.id)
      }
      return
    }

    if (isDeleteSelectionMode) {
      e.preventDefault()
      e.stopPropagation()
      toggleDeletionTileSelection(data.id)
      return
    }

    // Shift+click enters selection mode
    if (e.shiftKey && !isSelectionMode) {
      e.preventDefault()
      e.stopPropagation()
      enterSelectionMode(data.id)
      return
    }
    
    // In selection mode, toggle this tile's selection
    if (isSelectionMode) {
      e.preventDefault()
      e.stopPropagation()
      toggleTileSelection(data.id)
      return
    }
    
    handleDragStart(e, data.x, data.y)
  }

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (isActive || isSmartCollapse) {
      e.preventDefault()
      return
    }
    handleResizeStart(e, data.w, data.h)
  }

  const handleShrinkPresetClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isActive || isSmartCollapse) return
    const presets = UTILITY_SIZE_PRESETS[data.type]
    if (!presets || presets.length === 0) return
    const spawn = presets[0]
    if (data.type === 'orchestrator' && spawn) {
      const area = data.w * data.h
      const spawnArea = spawn.w * spawn.h
      if (area > spawnArea * 1.4) {
        updateTile(data.id, {
          w: spawn.w,
          h: spawn.h,
          meta: { ...data.meta, utilitySizeIndex: 0 },
        })
        return
      }
    }
    const currentIdx =
      typeof data.meta?.utilitySizeIndex === 'number' ? (data.meta.utilitySizeIndex as number) : -1
    const nextIdx = (currentIdx + 1) % presets.length
    const next = presets[nextIdx]
    updateTile(data.id, {
      w: next.w,
      h: next.h,
      meta: {
        ...data.meta,
        utilitySizeIndex: nextIdx,
      },
    })
  }

  const offscreenPaintHint: CSSProperties =
    !isFocused && !isPrimaryInFocus
      ? {
          contentVisibility: 'auto',
          containIntrinsicSize: `${data.w}px ${data.h}px`,
        }
      : {}

  return (
    <div
      data-tile-id={data.id}
      className="absolute flex flex-col rounded-2xl"
      style={{
        left: data.x,
        top: data.y,
        width: data.w,
        height: data.h,
        zIndex:
          (isSelectedForFocus || isSelectedForDeletion || isFocused ? 1000 : 0) +
          data.zIndex +
          (isPrimaryInFocus && isActive ? 30 : 0),
        ...offscreenPaintHint,
      }}
      onMouseDownCapture={(e) => {
        if (useCanvasStore.getState().missionScatterPickMode && !isActive) {
          e.preventDefault()
          e.stopPropagation()
          useCanvasStore.getState().clearMissionScatterForFocus()
          useFocusStore.getState().enterFocus([data.id])
          return
        }
        if (smartCollapsePicking) {
          e.preventDefault()
          e.stopPropagation()
          selectSmartCollapseMain(data.id)
        }
      }}
      onMouseDown={() => {
        if (
          isSelectionMode ||
          isDeleteSelectionMode ||
          smartCollapsePicking ||
          useCanvasStore.getState().missionScatterPickMode
        ) {
          return
        }
        setActiveInteractionTile(data.id)
        if (isActive) return
        if (!isSmartCollapse) bringToFront(data.id)
      }}
    >
      {autoFocusHighlight && (
        <OrchestratorModuleFocusBanner highlight={autoFocusHighlight} revealAttentionFx={revealAttentionFx} />
      )}
      <div
        className={clsx(
          'relative z-[1] flex min-h-0 h-full w-full flex-col overflow-hidden rounded-2xl',
          (useAnimatedShell || showShootingStar) && 'p-[2px]',
          useAnimatedShell && resolvedShellOuterClass
        )}
      >
        {showShootingStar && (
          <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden rounded-2xl">
            <div
              className={clsx(
                'tile-shooting-star-ring h-full w-full rounded-2xl',
                tileBorderAnimation === 'double' && 'tile-shooting-star-ring--double'
              )}
              style={{
                animationDuration: `${(2.85 / Math.min(2, Math.max(0.45, shootingStarSpeedScale))).toFixed(3)}s`,
              }}
            />
          </div>
        )}
        <div className={innerChromeClass} style={innerChromeStyle}>
      {/* Header */}
      <div
        className={clsx(
          'flex items-center justify-between gap-2 bg-tile-header/90 border-b border-tile-border/80 select-none shrink-0',
          isSmartCollapsedStrip ? 'px-2 py-2 min-h-[2.5rem]' : 'px-3 py-2.5',
          isActive ? 'cursor-default' : isSmartCollapse ? 'cursor-pointer' : 'cursor-move'
        )}
        onMouseDown={handleHeaderMouseDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {data.type === 'orchestrator' ? (
            <span className="shrink-0" data-tooltip={tileTypeDescription('orchestrator')}>
              <OrchestratorTileAvatar />
            </span>
          ) : (
            <span className={clsx('shrink-0', TILE_COLORS[data.type])} data-tooltip={tileTypeDescription(data.type)}>
              {TILE_ICONS[data.type]}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div
              className={clsx(
                'truncate text-sm font-semibold text-gray-100',
                isSmartCollapsedStrip && 'min-w-0'
              )}
              data-tooltip={`${data.title} — ${tileTypeDescription(data.type)}`}
            >
              {data.title}
            </div>
            {!isSmartCollapsedStrip && subtitle && (
              <div className="truncate text-[11px] text-gray-500" data-tooltip={subtitle}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {(data.tileStatus != null || (data.type === 'todo' && effectiveStatus != null)) &&
            !isSmartCollapsedStrip &&
            !(data.type === 'orchestrator' && data.tileStatus === 'idle') && (
            <StatusBadge status={data.tileStatus ?? (effectiveStatus as TileStatus)} />
          )}
          {isActive && isFocused && focusedCount > 1 && (
            <button
              className={clsx(
                'flex items-center justify-center rounded-lg hover:bg-tile-hover text-gray-500 hover:text-red-400 transition-colors',
                isSmartCollapsedStrip ? 'h-6 w-6' : 'h-7 w-7'
              )}
              onClick={(e) => {
                e.stopPropagation()
                removeFromFocus(data.id)
              }}
              data-tooltip="Remove this tile from the focus stack without closing it."
            >
              <svg className={isSmartCollapsedStrip ? 'h-3.5 w-3.5' : 'h-4 w-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
          {!isActive && (
            <button
              className={clsx(
                'flex items-center justify-center rounded-lg hover:bg-tile-hover text-gray-500 hover:text-accent-teal transition-colors',
                isSmartCollapsedStrip ? 'h-6 w-6' : 'h-7 w-7'
              )}
              onClick={handleFocusClick}
              data-tooltip="Pin this tile into focus mode to work with several tiles side by side."
            >
              <svg className={isSmartCollapsedStrip ? 'h-3.5 w-3.5' : 'h-4 w-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            </button>
          )}
          {!isActive && !isSmartCollapse && (
            <button
              className={clsx(
                'flex items-center justify-center rounded-lg hover:bg-tile-hover text-gray-500 hover:text-amber-300 transition-colors',
                isSmartCollapsedStrip ? 'h-6 w-6' : 'h-7 w-7'
              )}
              onClick={handleShrinkPresetClick}
              data-tooltip={
                data.type === 'orchestrator'
                  ? 'Cycle the orchestrator tile through its default and smaller layout presets.'
                  : 'Resize this tile to a compact utility preset.'
              }
            >
              <svg className={isSmartCollapsedStrip ? 'h-3.5 w-3.5' : 'h-4 w-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
                <polyline points="18 10 14 10 14 6" />
                <polyline points="6 14 10 14 10 18" />
              </svg>
            </button>
          )}
          {!isActive && (
            <button
              className={clsx(
                'flex items-center justify-center rounded-lg hover:bg-red-900/30 text-gray-500 hover:text-red-400 transition-colors',
                isSmartCollapsedStrip ? 'h-6 w-6' : 'h-7 w-7'
              )}
              onClick={(e) => {
                e.stopPropagation()
                removeTile(data.id)
              }}
              data-tooltip="Close this tile and remove it from the canvas."
            >
              <svg className={isSmartCollapsedStrip ? 'h-3.5 w-3.5' : 'h-4 w-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {data.moduleTabs && data.moduleTabs.length >= 2 && !isSmartCollapsedStrip && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-tile-border/60 bg-black/20 px-2 py-1">
          {data.moduleTabs.map((tab) => {
            const active = tab.id === data.activeModuleTabId
            return (
              <div key={tab.id} className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  className={clsx(
                    'max-w-[140px] truncate rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    active
                      ? 'bg-accent-teal/20 text-accent-teal'
                      : 'text-gray-400 hover:bg-tile-hover hover:text-gray-200'
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveModuleTab(data.id, tab.id)
                  }}
                  data-tooltip={tab.title}
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-gray-500 hover:bg-red-500/15 hover:text-red-300"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeModuleTab(data.id, tab.id)
                  }}
                  data-tooltip="Close this tab inside the multi-module tile."
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Content */}
      <div
        className={clsx(
          'flex-1 min-h-0 overflow-hidden',
          isSmartSide && !showSideBody && 'hidden pointer-events-none'
        )}
      >
        {data.hydrationStage === 'placeholder' ? (
          <TilePlaceholder data={data} />
        ) : TileContent ? (
          <TileErrorBoundary tileId={data.id}>
            <TileContent data={data} />
          </TileErrorBoundary>
        ) : (
          <div className="p-4 text-gray-500">
            {data.type} tile content
          </div>
        )}
      </div>

      {/* Resize handle - hidden in focus mode / Smart Collapse */}
      {!isActive && !isSmartCollapse && (
        <div
          className="pointer-events-auto absolute right-0 bottom-0 z-20 h-5 w-5 cursor-se-resize opacity-30 hover:opacity-80 transition-opacity"
          onMouseDown={handleResizeMouseDown}
        >
          <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="19" cy="19" r="2" />
            <circle cx="19" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </div>
      )}
        </div>
      </div>
      {autoFocusHighlight && revealAttentionFx && (
        <div className="pointer-events-none absolute inset-0 z-[18] overflow-hidden rounded-2xl">
          {autoFocusHighlight.effect === 'scan' ? (
            <div className="orchestrator-tile-laser" aria-hidden />
          ) : autoFocusHighlight.effect === 'shimmer' ? (
            <div className="orchestrator-tile-shimmer" aria-hidden />
          ) : (
            <div className="orchestrator-tile-pulse" aria-hidden />
          )}
        </div>
      )}
    </div>
  )
}

export const Tile = memo(TileComponent, (prev, next) => prev.data === next.data)

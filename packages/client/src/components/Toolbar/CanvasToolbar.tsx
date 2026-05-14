import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  useCanvasStore,
  type TileType,
  CANVAS_ZOOM_MIN,
  CANVAS_ZOOM_MAX,
} from '../../store/canvasStore'
import { useFocusStore } from '../../store/focusStore'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useToastStore } from '../../store/toastStore'
import { OneShotQuickInput } from '../OneShot/OneShotQuickInput'
import { OrchestratorCanvasHud } from '../orchestrator/OrchestratorCanvasHud'
import { getResourceUsage } from '../../lib/tauri'
import { AddTileDropdown } from './AddTileDropdown'
import { TrashToolbarDropdown } from './TrashToolbarDropdown'
import { CANVAS_TILE_OPTIONS, metaForTileSpawnFromAddMenu } from '../../lib/tileMenuCatalog'
import { SensorMenu } from './SensorMenu'
import { TelegramGatewayToolbarIndicator } from '../Telegram/TelegramGatewayToolbarIndicator'
import { stopAllProjectProcesses } from '../../lib/stopProjectProcesses'
import { useOneShotStore } from '../../store/oneShotStore'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { focusOrchestratorActiveTileNow } from '../../lib/orchestrator/revealOrchestratorTile'
import {
  OrchestratorToolbarPrompt,
  quickOrchestratorInputUiStore,
} from '../orchestrator/QuickOrchestratorInput'
import { useToolbarMenuPortal } from './useToolbarMenuPortal'
import { ORCA_TOOLBAR_TOP_FROM_BOTTOM_VAR } from '../../lib/orcaCanvasLayoutVars'
import { useOrchestratorRightPanelVisible } from '../../hooks/useOrchestratorRightPanelVisible'

export function CanvasToolbar() {
  const canvasViewMode = useCanvasStore((s) => s.canvasViewMode)
  const setCanvasViewMode = useCanvasStore((s) => s.setCanvasViewMode)
  const zoom = useCanvasStore((s) => s.zoom)
  const setZoom = useCanvasStore((s) => s.setZoom)
  const setPan = useCanvasStore((s) => s.setPan)
  const addTile = useCanvasStore((s) => s.addTile)
  const isActive = useFocusStore((s) => s.isActive)
  const focusedCount = useFocusStore((s) => s.focusedTileIds.length)
  const exitFocus = useFocusStore((s) => s.exitFocus)
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel)
  const activePanel = useWorkspaceStore((s) => s.activePanel)
  const orchestratorRightPanelVisible = useOrchestratorRightPanelVisible()
  const orchestratorAutoFocus = useWorkspaceStore((s) => s.orchestratorAutoFocus)
  const setOrchestratorAutoFocus = useWorkspaceStore((s) => s.setOrchestratorAutoFocus)
  const addToast = useToastStore((s) => s.addToast)
  const running = useOrchestratorSessionStore((s) => s.running)
  const waitingForSubAgents = useOrchestratorSessionStore((s) => s.waitingForSubAgents)
  const pendingSubAgentHandoffCount = useOrchestratorSessionStore(
    (s) => s.pendingSubAgentHandoffs.length
  )
  const oneShotRunning = useOneShotStore((s) => s.running)
  const abortInFlightCount = useAgentTeamStore((s) => Object.keys(s.abortByTileId).length)
  // Some tiles show status:'working' even when their AbortController was already cleared
  // (e.g. after a sub-agent handoff is pending, or the tile was restored from disk). Treat
  // any working member as a reason to keep Stop all enabled so the user always has a kill
  // switch when the UI still advertises work-in-progress.
  const workingMemberCount = useAgentTeamStore(
    (s) => Object.values(s.membersByTileId).filter((m) => m.status === 'working').length
  )
  const canStopAll =
    running ||
    oneShotRunning ||
    waitingForSubAgents ||
    abortInFlightCount > 0 ||
    workingMemberCount > 0 ||
    pendingSubAgentHandoffCount > 0

  /** True when only the main orchestrator chat is running — no tile workers / 1-shot / wait state. */
  const stopAllAffectsOnlyOrchestratorChat =
    running &&
    !oneShotRunning &&
    abortInFlightCount === 0 &&
    workingMemberCount === 0 &&
    !waitingForSubAgents &&
    pendingSubAgentHandoffCount === 0

  const requestStopAll = useCallback(() => {
    if (!canStopAll) return
    if (!stopAllAffectsOnlyOrchestratorChat) {
      const ok = window.confirm(
        'Stop all cancels the orchestrator, 1-shot (if running), and every in-flight agent tile and sub-agent. Continue?'
      )
      if (!ok) return
    }
    stopAllProjectProcesses()
  }, [
    canStopAll,
    stopAllAffectsOnlyOrchestratorChat,
  ])
  const verb = useOrchestratorActivityStore((s) => s.verb)
  const [memoryMb, setMemoryMb] = useState<number | null>(null)
  const [memoryError, setMemoryError] = useState(false)
  const [oneShotPopoverOpen, setOneShotPopoverOpen] = useState(false)
  const [askMenuOpen, setAskMenuOpen] = useState(false)
  const askMenuRef = useRef<HTMLDivElement>(null)
  const { menuRef: askMenuPortalRef, fixedStyle: askMenuFixedStyle } = useToolbarMenuPortal(
    askMenuOpen,
    askMenuRef,
    'left'
  )
  const canvasToolbarRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = canvasToolbarRef.current
    if (!el) return
    const prop = ORCA_TOOLBAR_TOP_FROM_BOTTOM_VAR
    const push = () => {
      const r = el.getBoundingClientRect()
      const parent = el.offsetParent as HTMLElement | null
      if (!parent) {
        document.documentElement.style.setProperty(prop, `${window.innerHeight - r.top}px`)
        return
      }
      const pRect = parent.getBoundingClientRect()
      const fromBottom = pRect.bottom - r.top
      document.documentElement.style.setProperty(prop, `${fromBottom}px`)
    }
    push()
    const ro = new ResizeObserver(push)
    ro.observe(el)
    window.addEventListener('resize', push)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', push)
      document.documentElement.style.removeProperty(prop)
    }
  }, [])

  useEffect(() => {
    if (!askMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (askMenuRef.current?.contains(t)) return
      if (askMenuPortalRef.current?.contains(t)) return
      setAskMenuOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAskMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [askMenuOpen, askMenuPortalRef])

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const usage = await getResourceUsage()
        if (!alive) return
        if (usage) {
          setMemoryMb(usage.rss_mb)
          setMemoryError(false)
        }
      } catch {
        if (!alive) return
        setMemoryError(true)
      }
    }
    void poll()
    const id = window.setInterval(() => void poll(), 2500)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const memoryLabel = useMemo(() => {
    const nb = '\u00A0'
    if (memoryError) return `Mem${nb}n/a`
    if (memoryMb == null) return `Mem${nb}--`
    if (memoryMb >= 1024) return `Mem${nb}${(memoryMb / 1024).toFixed(2)}${nb}GB`
    return `Mem${nb}${Math.round(memoryMb)}${nb}MB`
  }, [memoryError, memoryMb])

  const handleResetView = () => {
    setPan({ x: 0, y: 0 })
    setZoom(1)
  }

  const setOneShotMode = useOrchestratorSessionStore((s) => s.setOneShotMode)
  const quickInputCollapsed = quickOrchestratorInputUiStore((s) => s.suppressedUntilIdle)
  const setQuickInputSuppressedManually = quickOrchestratorInputUiStore((s) => s.setSuppressedManually)

  const handleOneShotToolbarClick = useCallback(() => {
    if (activePanel === 'orchestrator') {
      setOneShotMode(true)
      setActivePanel('orchestrator')
      addToast({
        type: 'info',
        title: '1-shot mode',
        message: 'Describe what you want to build in the orchestrator input, then press Run.',
      })
      return
    }
    setOneShotPopoverOpen(true)
  }, [activePanel, addToast, setActivePanel, setOneShotMode])

  const handleAddTileFromToolbar = useCallback(
    (type: TileType) => {
      const hadTodo =
        type === 'todo' &&
        [...useCanvasStore.getState().tiles.values()].some((t) => t.type === 'todo')
      const meta = metaForTileSpawnFromAddMenu(type)
      addTile(type, undefined, meta ? { meta } : undefined)
      const label = CANVAS_TILE_OPTIONS.find((o) => o.type === type)?.label ?? type
      addToast({
        type: 'info',
        title: label,
        message: hadTodo ? 'Existing todo tile focused.' : 'New tile added to the canvas.',
      })
    },
    [addTile, addToast]
  )

  return (
    <>
      <OneShotQuickInput open={oneShotPopoverOpen} onClose={() => setOneShotPopoverOpen(false)} />
      {canvasViewMode !== 'plan' && canvasViewMode !== 'helix' ? <OrchestratorCanvasHud /> : null}
      <div
        ref={canvasToolbarRef}
        className="absolute bottom-[calc(1rem+15px)] left-1/2 z-[70] flex w-fit -translate-x-1/2 flex-col items-center gap-2"
      >
        {!orchestratorRightPanelVisible && canvasViewMode !== 'plan' && (
          <div className="box-border w-[min(42rem,calc(100vw-2rem))] min-w-0 px-2">
            <OrchestratorToolbarPrompt />
          </div>
        )}

        <div
          data-testid="canvas-toolbar"
          className="flex min-w-max w-fit items-center justify-center gap-x-3 gap-y-2 rounded-xl border border-tile-border/90 bg-[color-mix(in_srgb,rgb(var(--canvas-bg-rgb)_/_0.98)_80%,black)] px-2 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur-sm sm:gap-1.5 sm:py-1.5"
        >
        <div className="flex shrink-0 items-center gap-2">
          {!orchestratorRightPanelVisible && canvasViewMode !== 'plan' && (
            <button
              type="button"
              onClick={() => {
                const s = quickOrchestratorInputUiStore.getState()
                if (s.suppressedUntilIdle) {
                  s.requestReveal()
                } else {
                  setQuickInputSuppressedManually(true)
                }
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-tile-border/80 bg-black/15 text-gray-400 transition-colors hover:border-tile-border hover:bg-black/25 hover:text-gray-200"
              aria-expanded={!quickInputCollapsed}
              data-tooltip={
                quickInputCollapsed
                  ? 'Expand chat quick entry'
                  : 'Collapse chat quick entry'
              }
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                {quickInputCollapsed ? (
                  <polyline points="6 15 12 9 18 15" />
                ) : (
                  <polyline points="6 9 12 15 18 9" />
                )}
              </svg>
            </button>
          )}
          <div ref={askMenuRef} className="relative flex shrink-0 items-stretch">
            <button
              type="button"
              onClick={() => quickOrchestratorInputUiStore.getState().requestReveal()}
              className="rounded-l-lg bg-accent-teal/15 px-2 py-1 text-[11px] font-medium text-accent-teal hover:bg-accent-teal/25"
              data-tooltip={running ? verb : 'Ask orchestrator'}
            >
              {running ? 'Chat' : 'Ask'}
            </button>
            <button
              type="button"
              onClick={() => setAskMenuOpen((o) => !o)}
              className="flex items-center rounded-r-lg border-l border-accent-teal/25 bg-accent-teal/15 px-1 text-accent-teal hover:bg-accent-teal/25"
              aria-expanded={askMenuOpen}
              aria-haspopup="menu"
              data-tooltip="More run modes"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {askMenuOpen &&
              askMenuFixedStyle &&
              typeof document !== 'undefined' &&
              createPortal(
                <div
                  ref={askMenuPortalRef}
                  role="menu"
                  style={askMenuFixedStyle}
                  className="w-48 overflow-hidden rounded-lg border border-tile-border bg-[#2d2d2d] shadow-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAskMenuOpen(false)
                      handleOneShotToolbarClick()
                    }}
                    className="flex w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left text-[11px] text-gray-200 hover:bg-[#3c3c3c]"
                  >
                    <span className="font-medium text-accent-teal">1-shot</span>
                    <span className="text-[10px] leading-tight text-gray-500">
                      Multi-phase build — pick a workspace, then run.
                    </span>
                  </button>
                </div>,
                document.body
              )}
          </div>

          <button
            type="button"
            disabled={!canStopAll}
            onClick={requestStopAll}
            className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
              canStopAll
                ? 'border-rose-500/45 bg-rose-950/35 text-rose-100 hover:bg-rose-900/40'
                : 'cursor-not-allowed border-tile-border/50 bg-black/10 text-gray-600'
            }`}
            data-tooltip="Stop orchestrator, 1-shot pipeline, and every in-flight agent or Hermes stream"
          >
            Stop all
          </button>
        </div>

        <div className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-tile-border/80 bg-black/15 px-1">
          <AddTileDropdown onSelect={handleAddTileFromToolbar} />
          <TrashToolbarDropdown />
        </div>

        <div className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-tile-border/80 bg-black/15 p-0.5">
          <button
            type="button"
            onClick={() => setCanvasViewMode('tiles')}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              canvasViewMode === 'tiles'
                ? 'bg-accent-teal/25 text-accent-teal'
                : 'text-gray-400 hover:bg-black/25 hover:text-gray-200'
            }`}
            data-tooltip="Show full rich tiles"
          >
            Tiles
          </button>
          <button
            type="button"
            onClick={() => {
              setCanvasViewMode('plan')
              setActivePanel('explorer')
            }}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              canvasViewMode === 'plan'
                ? 'bg-accent-teal/25 text-accent-teal'
                : 'text-gray-400 hover:bg-black/25 hover:text-gray-200'
            }`}
            data-tooltip="Project plan (markdown) on the left, orchestrator chat on the right"
          >
            Plan
          </button>
          <button
            type="button"
            onClick={() => {
              setCanvasViewMode('helix')
              setActivePanel('explorer')
            }}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              canvasViewMode === 'helix'
                ? 'bg-accent-teal/25 text-accent-teal'
                : 'text-gray-400 hover:bg-black/25 hover:text-gray-200'
            }`}
            data-tooltip="Hermes Lead mode: left focus tile + right lightweight node graph"
          >
            Lead
          </button>
        </div>

        <div className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-tile-border/80 bg-black/15 px-1.5">
          <button
            type="button"
            onClick={(e) => {
              if (e.shiftKey || e.altKey) {
                setOrchestratorAutoFocus(!orchestratorAutoFocus)
                return
              }
              if (!orchestratorAutoFocus) setOrchestratorAutoFocus(true)
              const focused = focusOrchestratorActiveTileNow()
              if (!focused && !orchestratorAutoFocus) {
                addToast({
                  type: 'info',
                  title: 'Auto-focus on',
                  message: 'Orchestrator has no active tile yet — it will pan here once it uses one.',
                })
              }
            }}
            className={`inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-2 text-[10px] font-medium leading-none transition-colors ${
              orchestratorAutoFocus
                ? 'border-accent-teal/55 bg-accent-teal/15 text-accent-teal'
                : 'border-tile-border/80 bg-black/15 text-gray-400 hover:border-accent-teal/40 hover:text-gray-200'
            }`}
            data-tooltip="Click: pan + zoom to fit the tile the orchestrator is using · Shift-click: toggle auto-focus on/off"
            aria-pressed={orchestratorAutoFocus}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${orchestratorAutoFocus ? 'bg-accent-teal shadow-[0_0_6px_rgba(var(--accent-teal-rgb),0.7)]' : 'bg-gray-500'}`}
            />
            Auto-focus
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={orchestratorAutoFocus}
            onClick={() => setOrchestratorAutoFocus(!orchestratorAutoFocus)}
            className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal/50 ${
              orchestratorAutoFocus
                ? 'border-accent-teal/45 bg-accent-teal/35'
                : 'border-tile-border/70 bg-black/35'
            }`}
            data-tooltip="Auto-focus: follow the orchestrator’s active tile"
          >
            <span
              className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out ${
                orchestratorAutoFocus ? 'translate-x-3' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <SensorMenu />
          <TelegramGatewayToolbarIndicator />
        </div>

        <div className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-tile-border/80 bg-black/15 px-1.5">
          <input
            type="range"
            min={CANVAS_ZOOM_MIN}
            max={CANVAS_ZOOM_MAX}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="orca-range h-1.5 w-[5.25rem] cursor-pointer accent-accent-teal sm:w-28"
            aria-label="Canvas zoom"
            data-tooltip="Canvas zoom"
          />
          <button
            type="button"
            onClick={handleResetView}
            className="min-w-[40px] px-0.5 font-mono text-[10px] tabular-nums text-gray-400 hover:text-white"
            data-tooltip="Reset pan & zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
        </div>

        <div
          className="shrink-0 whitespace-nowrap rounded-lg border border-tile-border/80 bg-black/15 px-2 py-1 font-mono text-[10px] leading-none tabular-nums text-gray-400"
          data-tooltip="Orca Coder app memory usage"
        >
          {memoryLabel}
        </div>

        {isActive && (
          <button
            type="button"
            onClick={exitFocus}
            className="shrink-0 whitespace-nowrap rounded-lg bg-accent-teal/15 px-2 py-1 text-[11px] text-accent-teal hover:bg-accent-teal/25"
            data-tooltip="Exit focus mode"
          >
            Focus
            {focusedCount > 1 && (
              <span className="ml-1 rounded bg-accent-teal/20 px-1 text-[10px]">{focusedCount}</span>
            )}
          </button>
        )}
        </div>
      </div>
    </>
  )
}

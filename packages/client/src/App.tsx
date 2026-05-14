import { useEffect, useState } from 'react'
import { InfiniteCanvas } from './components/Canvas/InfiniteCanvas'
import { CanvasRightPanel } from './components/Canvas/CanvasRightPanel'
import { CanvasToolbar } from './components/Toolbar/CanvasToolbar'
import { KeyboardShortcuts } from './components/Toolbar/KeyboardShortcuts'
import { CanvasModuleShortcuts } from './components/Canvas/CanvasModuleShortcuts'
import { FocusOverlay } from './components/FocusMode/FocusOverlay'
import { FocusLayout } from './components/FocusMode/FocusLayout'
import { SelectionModeOverlay } from './components/FocusMode/SelectionModeOverlay'
import { DeleteSelectionOverlay } from './components/FocusMode/DeleteSelectionOverlay'
import { ToastContainer } from './components/Toast/ToastContainer'
import { SettingsModal } from './components/Settings/SettingsModal'
import { IntegrationWizardModal } from './components/Integrations/IntegrationWizardModal'
import { TitleBar } from './components/TitleBar/TitleBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { OrchestratorPanel } from './components/Sidebar/OrchestratorPanel'
import { useSettingsStore } from './store/settingsStore'
import { useFocusStore } from './store/focusStore'
import { useWorkspaceStore, bootstrapWorkspaceAfterHydration } from './store/workspaceStore'
import { useCanvasStore } from './store/canvasStore'
import * as tauri from './lib/tauri'
import {
  REFRESH_CHANGELOG_EVENT,
  REFRESH_RESEARCH_EVENT,
  type RefreshChangelogDetail,
} from './lib/uiEvents'
import { useResearchSessionStore } from './store/researchSessionStore'
import { useCanvasBridge } from './hooks/useCanvasBridge'
import { ensureOpenRouterUsageTile } from './lib/orchestrator/ensureOpenRouterUsageTile'
import { flushPendingCanvasSaveNow, subscribeCanvasAutoSave } from './lib/canvasStatePersistence'
import { startTileIdleReaper } from './lib/tileIdleReaper'
import { getOrcaSessionId } from './lib/persistence/orcaSessionId'
import { getDefaultSessionId } from './lib/persistence/sessionPersistence'
import { loadTasksForWorkspace, subscribeTodoPersistence } from './lib/persistence/taskPersistence'
import { maybeShowResumePromptOnOpen } from './lib/orchestrator/resumePromptOnOpen'
import { pruneOrchestratorTodoNoise } from './lib/orchestrator/todoTaskQuality'
import { reconcileStaleDelegatedTasks } from './lib/orchestrator/todoResumeReconciliation'
import { loadOneShotState } from './lib/persistence/oneShotPersistence'
import { useTodoStore } from './store/todoStore'
import { useOrchestratorSessionStore } from './store/orchestratorSessionStore'
import { useToastStore } from './store/toastStore'
import { useAgentTeamStore } from './store/agentTeamStore'
import { useOrchestratorActivityStore } from './store/orchestratorActivityStore'
import { DevTelemetryDashboard } from './components/telemetry/DevTelemetryDashboard'
import { ProjectWelcomeScreen } from './components/Welcome/ProjectWelcomeScreen'
import { WelcomeUiProvider } from './context/WelcomeUiContext'
import { useApiSdkInit } from './api/init'
import { stopAllProjectProcesses } from './lib/stopProjectProcesses'
import {
  startOrchestratorHeartbeatScheduler,
  stopOrchestratorHeartbeatScheduler,
} from './lib/orchestrator/orchestratorHeartbeat'
import { useDriverTooltips } from './lib/useDriverTooltips'
import { initMenuBridge } from './lib/menuBridge'

function readWelcomeMode(): boolean {
  // Always show the welcome screen on app open — the previous project is no longer auto-loaded.
  // Explicit `?welcome=0` opts out (useful for automation / deep links that already know the workspace).
  try {
    return new URLSearchParams(window.location.search).get('welcome') !== '0'
  } catch {
    return true
  }
}

export default function App() {
  useDriverTooltips()

  // Initialize API SDK on app mount (Task 1.2: API-UI Client Binding)
  useApiSdkInit({
    debugMode: import.meta.env.DEV,
    // Tokens will be loaded from settings store
  })

  const {
    refreshShellCredentials,
    changelogAutomationEnabled,
    researchAutomationEnabled,
    uiTheme,
    hybridGuiShellMode,
    selectedModel,
    getAvailableModels,
  } = useSettingsStore()
  const { isActive: isFocusActive, isSelectionMode, isDeleteSelectionMode } = useFocusStore()
  const { rootPath, activePanel, setActivePanel, orchestratorPanelWidth, setOrchestratorPanelWidth } = useWorkspaceStore()
  const canvasViewMode = useCanvasStore((s) => s.canvasViewMode)
  const planWorkspaceOpen = canvasViewMode === 'plan'
  const addTile = useCanvasStore((s) => s.addTile)
  const updateTile = useCanvasStore((s) => s.updateTile)
  const [isResizingOrchestrator, setIsResizingOrchestrator] = useState(false)
  const [telemetryOpen, setTelemetryOpen] = useState(
    () => typeof window !== 'undefined' && window.location.hash === '#/telemetry'
  )
  const [welcomeMode, setWelcomeMode] = useState(readWelcomeMode)

  const hideSidebar = isFocusActive || isSelectionMode || isDeleteSelectionMode
  const showOrchestratorDock =
    hybridGuiShellMode === 'desktop_sidebar' && !hideSidebar && !planWorkspaceOpen

  /** Paperclip-style BYOA: companion server forwards tool calls to this UI (Hermes / OpenClaude adapters). */
  const canvasBridgeEnabled = import.meta.env.VITE_ENABLE_CANVAS_BRIDGE !== 'false'
  useCanvasBridge(canvasBridgeEnabled)

  useEffect(() => {
    try {
      const w = window as unknown as { __TTFP__?: Record<string, number>; __recordTtfp?: (s: string) => Promise<void> }
      if (w.__TTFP__ && w.__recordTtfp) {
        void w.__recordTtfp('T2_APP_MOUNTED')
      }
    } catch {}
    void (async () => {
      try {
        const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }
        if (!(w.__TAURI__ || w.__TAURI_INTERNALS__)) return
        const { invoke } = await import('@tauri-apps/api/core')
        const ws = (await invoke('get_ttfp_workspace').catch(() => null)) as string | null
        if (ws && ws.length > 0) {
          setWelcomeMode(false)
          await useWorkspaceStore.getState().setRootPath(ws, { orchestratorSessionPolicy: 'follow-workspace' })
        }
      } catch {}
    })()
    const onHash = () => setTelemetryOpen(window.location.hash === '#/telemetry')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    try {
      if (!rootPath || rootPath === '.') return
      const w = window as unknown as { __TTFP__?: Record<string, number>; __recordTtfp?: (s: string) => Promise<void> }
      if (!w.__TTFP__) return
      if (w.__TTFP__.T3_LOGGED) return
      w.__TTFP__.T3_LOGGED = 1
      if (w.__recordTtfp) void w.__recordTtfp('T3_ORCH_INPUT_READY')
    } catch {}
  }, [rootPath])

  useEffect(() => {
    const onPop = () => setWelcomeMode(readWelcomeMode())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /** Native desktop menubar → Zustand / canvas (see `src-tauri/src/app_menu.rs`). */
  useEffect(() => {
    return initMenuBridge()
  }, [])

  useEffect(() => {
    const onOpen = () => setWelcomeMode(true)
    window.addEventListener('orca-open-welcome', onOpen)
    return () => window.removeEventListener('orca-open-welcome', onOpen)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const t = e.target as HTMLElement | null
      const inField =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

      if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        if (inField) return
        e.preventDefault()
        void tauri.openNewAppWindow()
        return
      }
      // Close this window only (⌘W / Ctrl+W) — not the whole app; matches the title bar red button.
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') {
        if (inField) return
        e.preventDefault()
        void tauri.closeCurrentWindow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    refreshShellCredentials()
  }, [refreshShellCredentials])

  useEffect(() => {
    const m = getAvailableModels().find((x) => x.id === selectedModel)
    if (m?.provider === 'openrouter') {
      ensureOpenRouterUsageTile()
    }
  }, [selectedModel, getAvailableModels])

  useEffect(() => {
    if (hybridGuiShellMode !== 'spotlight_launcher') return
    if (activePanel !== 'orchestrator') return
    setActivePanel('explorer')
  }, [hybridGuiShellMode, activePanel, setActivePanel])

  useEffect(() => {
    const root = document.documentElement
    if (uiTheme === 'pastel') {
      root.classList.add('theme-ui-pastel')
    } else {
      root.classList.remove('theme-ui-pastel')
    }
  }, [uiTheme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (useCanvasStore.getState().missionScatterPickMode) {
        e.preventDefault()
        useCanvasStore.getState().exitMissionScatterPick()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Mark workspace bootstrap as done once Zustand rehydrates. We no longer auto-load the previous
  // project — the welcome screen is the entry point and the user picks a folder / resumes a session
  // explicitly. `bootstrapWorkspaceAfterHydration` now just flips `workspaceBootstrapDone` so
  // downstream consumers (FileExplorer) keep working once a project is actually picked.
  useEffect(() => {
    const run = () => void bootstrapWorkspaceAfterHydration()
    if (useWorkspaceStore.persist.hasHydrated()) {
      run()
      return
    }
    return useWorkspaceStore.persist.onFinishHydration(run)
  }, [])

  /** Central Obsidian vault: reverse-sync when iCloud updates files under `projects/<id>/`. */
  useEffect(() => {
    let un: (() => void) | undefined
    let cancelled = false
    void (async () => {
      const m = await import('./lib/vault/centralBrainReverseSync')
      if (cancelled) return
      un = await m.attachCentralBrainReverseSync()
    })()
    return () => {
      cancelled = true
      un?.()
    }
  }, [])

  /** Debounced save of canvas layout to `.agent-canvas/canvas-state.json` while editing. */
  useEffect(() => subscribeCanvasAutoSave(), [])

  /** Collapse tiles that sit idle for 10s back to placeholder (frees memory, pauses side effects). */
  useEffect(() => startTileIdleReaper(), [])

  useEffect(() => {
    startOrchestratorHeartbeatScheduler()
    return () => stopOrchestratorHeartbeatScheduler()
  }, [])

  /** Best-effort abort of orchestrator, 1-shot, and tile runs when leaving (browser reload / Tauri close). */
  useEffect(() => {
    const onBeforeUnload = () => {
      flushPendingCanvasSaveNow()
      stopAllProjectProcesses()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    let unlistenClose: (() => void) | undefined
    void tauri.onWindowCloseRequested(() => {
      flushPendingCanvasSaveNow()
      stopAllProjectProcesses()
    }).then((fn) => {
      unlistenClose = fn
    })
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      unlistenClose?.()
    }
  }, [])

  /** Load orchestrator conversation when the workspace folder changes (per-project session key + resume override). */
  useEffect(() => {
    let cancelled = false
    const tryLoadOrchestratorSession = () => {
      if (!useSettingsStore.persist.hasHydrated()) return
      if (!useWorkspaceStore.persist.hasHydrated()) return
      void (async () => {
        const sid = getDefaultSessionId()
        if (cancelled) return
        await useOrchestratorSessionStore.getState().loadSession(sid)
      })()
    }
    tryLoadOrchestratorSession()
    const unsubS = useSettingsStore.persist.onFinishHydration(tryLoadOrchestratorSession)
    const unsubW = useWorkspaceStore.persist.onFinishHydration(tryLoadOrchestratorSession)
    return () => {
      cancelled = true
      unsubS()
      unsubW()
    }
  }, [rootPath])

  /** Load task list for the current workspace folder; reload when `rootPath` changes. */
  useEffect(() => {
    let cancelled = false
    const tryLoad = () => {
      if (!useSettingsStore.persist.hasHydrated()) return
      if (!useWorkspaceStore.persist.hasHydrated()) return
      void (async () => {
        const loadedTasks = await loadTasksForWorkspace(useWorkspaceStore.getState().rootPath)
        if (cancelled) return
        const { cleaned: prunedTasks } = pruneOrchestratorTodoNoise(loadedTasks)
        const hasLiveAgentRoster =
          Object.keys(useAgentTeamStore.getState().membersByTileId).length > 0
        const { tasks: reconciled, touchedCount } = reconcileStaleDelegatedTasks(prunedTasks, {
          hasLiveAgentRoster,
        })
        useTodoStore.getState().replaceTasks(reconciled)
        if (!cancelled && touchedCount > 0) {
          useOrchestratorActivityStore
            .getState()
            .appendActivityLine(
              `[Resume] Cleared stale sub-agent assignments from ${touchedCount} task row${touchedCount === 1 ? '' : 's'} (delegated tiles are not restored after restart).`
            )
        }
        // After todos load, offer "Continue where we left off?" when conversation
        // is already in memory. `loadSession` also calls this after hydration so
        // ordering between tasks + messages does not matter.
        if (!cancelled) maybeShowResumePromptOnOpen()
        setTimeout(() => {
          if (!cancelled) maybeShowResumePromptOnOpen()
        }, 400)
        setTimeout(() => {
          if (!cancelled) maybeShowResumePromptOnOpen()
        }, 2000)
      })()
    }
    tryLoad()
    const unsubS = useSettingsStore.persist.onFinishHydration(tryLoad)
    const unsubW = useWorkspaceStore.persist.onFinishHydration(tryLoad)
    return () => {
      cancelled = true
      unsubS()
      unsubW()
    }
  }, [rootPath])

  /** Hint if a 1-shot pipeline was interrupted (checkpoint on disk). */
  useEffect(() => {
    let cancelled = false
    const run = () => {
      void (async () => {
        const snap = await loadOneShotState(getOrcaSessionId())
        if (cancelled || !snap?.wasRunning) return
        if (snap.phase === 'idle' || snap.phase === 'complete' || snap.phase === 'preview') return
        const path = snap.tempWorkspacePath ? ` Workspace: ${snap.tempWorkspacePath}` : ''
        useToastStore.getState().addToast({
          type: 'info',
          title: 'Previous 1-shot interrupted',
          message: `Last run stopped at phase "${snap.phase}".${path} Start a new 1-shot from the toolbar if you want to continue.`,
        })
      })()
    }
    if (useSettingsStore.persist.hasHydrated()) {
      run()
    } else {
      const unsub = useSettingsStore.persist.onFinishHydration(() => {
        if (!cancelled) run()
      })
      return () => {
        cancelled = true
        unsub()
      }
    }
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let unsub: (() => void) | undefined
    void subscribeTodoPersistence().then((u) => {
      unsub = u
    })
    return () => {
      unsub?.()
    }
  }, [])

  useEffect(() => {
    if (!isResizingOrchestrator) return
    const onMove = (e: MouseEvent) => {
      const nextWidth = Math.max(320, Math.min(760, window.innerWidth - e.clientX))
      setOrchestratorPanelWidth(nextWidth)
    }
    const onUp = () => setIsResizingOrchestrator(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isResizingOrchestrator, setOrchestratorPanelWidth])

  /** Auto-add changelog only after real activity (writes / task completion), not on app open or workspace hydrate. */
  useEffect(() => {
    if (!changelogAutomationEnabled || !tauri.isTauri()) return
    if (!rootPath || rootPath === '.') return

    const maybeAddChangelogTile = async (detail: RefreshChangelogDetail | undefined) => {
      if (!detail || detail.reason === 'orchestrator-module-switch') return

      const hasChangelog = [...useCanvasStore.getState().tiles.values()].some(
        (t) => t.type === 'changelog'
      )
      if (hasChangelog) return

      let snapshot: Awaited<ReturnType<typeof tauri.getGitChangelogSnapshot>>
      try {
        snapshot = await tauri.getGitChangelogSnapshot()
      } catch {
        return
      }
      if (!snapshot || !tauri.gitChangelogSnapshotHasVisibleActivity(snapshot)) return

      const id = addTile('changelog')
      updateTile(id, {
        title: 'Changelog',
        meta: { source: 'changelog-automation', reason: detail.reason },
      })
    }

    const onRefreshChangelog = (e: Event) => {
      const ce = e as CustomEvent<RefreshChangelogDetail>
      void maybeAddChangelogTile(ce.detail)
    }

    window.addEventListener(REFRESH_CHANGELOG_EVENT, onRefreshChangelog)
    return () => window.removeEventListener(REFRESH_CHANGELOG_EVENT, onRefreshChangelog)
  }, [addTile, changelogAutomationEnabled, rootPath, updateTile])

  /** Auto-add Research tile when the first structured research entry lands (web_search / MCP docs). */
  useEffect(() => {
    if (!researchAutomationEnabled) return

    const onRefreshResearch = () => {
      const hasResearch = [...useCanvasStore.getState().tiles.values()].some((t) => t.type === 'research')
      if (hasResearch) return
      if (useResearchSessionStore.getState().entries.length < 1) return
      const id = addTile('research')
      updateTile(id, {
        title: 'Research',
        meta: { source: 'research-automation' },
      })
    }

    window.addEventListener(REFRESH_RESEARCH_EVENT, onRefreshResearch)
    return () => window.removeEventListener(REFRESH_RESEARCH_EVENT, onRefreshResearch)
  }, [addTile, researchAutomationEnabled, updateTile])

  return (
    <WelcomeUiProvider welcomeMode={welcomeMode}>
      {welcomeMode ? (
        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-canvas-bg pt-8">
          <TitleBar />
          <ProjectWelcomeScreen
            onDismiss={() => {
              setWelcomeMode(false)
            }}
          />
        </div>
      ) : (
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-canvas-bg pt-8">
      <TitleBar />

      {/* Main Content — pt-8 on parent clears fixed portaled TitleBar */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar + canvas: mousedown closes the right orchestrator panel (click-outside). */}
        <div
          className="flex min-h-0 min-w-0 flex-1"
          onMouseDownCapture={() => {
            if (showOrchestratorDock && activePanel === 'orchestrator') {
              setActivePanel('explorer')
            }
          }}
        >
          {!hideSidebar && (
            <div className="relative z-10 h-full shrink-0">
              <Sidebar />
            </div>
          )}

          {/* Canvas column: clip only the pannable surface; hints/toolbars stay unclipped */}
          <div className="relative z-20 flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              <div className="absolute inset-0 overflow-hidden">
                <InfiniteCanvas />
              </div>
              <CanvasRightPanel />
              <CanvasToolbar />
              <KeyboardShortcuts />
              <CanvasModuleShortcuts />
              <FocusOverlay />
              <FocusLayout />
              <SelectionModeOverlay />
              <DeleteSelectionOverlay />
              <SettingsModal />
              <IntegrationWizardModal />
            </div>
          </div>
        </div>

        {showOrchestratorDock && activePanel === 'orchestrator' && (
          <div
            className="relative z-40 flex h-full min-h-0 min-w-0 shrink-0 flex-col border-l border-accent-teal/35 bg-tile-bg/70 shadow-[-8px_0_24px_rgba(0,0,0,0.35),inset_4px_0_0_0_rgba(0,212,170,0.12)] backdrop-blur-xl"
            style={{ width: orchestratorPanelWidth }}
          >
            <div
              className="absolute left-0 top-0 z-20 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-accent-teal/60"
              onMouseDown={(e) => {
                e.preventDefault()
                setIsResizingOrchestrator(true)
              }}
              data-tooltip="Drag to resize chat"
            />
            <OrchestratorPanel />
          </div>
        )}

        {showOrchestratorDock && (
          <button
            type="button"
            onClick={() => setActivePanel(activePanel === 'orchestrator' ? 'explorer' : 'orchestrator')}
            style={{ right: activePanel === 'orchestrator' ? orchestratorPanelWidth : 0 }}
            className="absolute top-1/2 z-50 flex h-24 w-7 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-accent-teal/55 bg-gradient-to-l from-accent-teal/[0.14] via-tile-bg to-tile-bg text-gray-100 shadow-[-10px_0_28px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-accent-teal/35 transition-all duration-150 hover:border-accent-teal/80 hover:from-accent-teal/22 hover:via-tile-hover hover:to-tile-hover hover:text-accent-teal"
            data-tooltip={activePanel === 'orchestrator' ? 'Hide orchestrator' : 'Show orchestrator'}
            aria-expanded={activePanel === 'orchestrator'}
            aria-label={activePanel === 'orchestrator' ? 'Hide orchestrator' : 'Show orchestrator'}
          >
            <span className="pointer-events-none select-none text-base font-semibold leading-none tracking-tight">
              {activePanel === 'orchestrator' ? '▸' : '◂'}
            </span>
          </button>
        )}
      </div>
      <ToastContainer
        rightOffsetPx={
          showOrchestratorDock && activePanel === 'orchestrator'
            ? orchestratorPanelWidth + 16
            : 16
        }
      />
        </div>
      )}
      {telemetryOpen && (
        <DevTelemetryDashboard
          onClose={() => {
            if (window.location.hash === '#/telemetry') {
              window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
            }
            setTelemetryOpen(false)
          }}
        />
      )}
    </WelcomeUiProvider>
  )
}

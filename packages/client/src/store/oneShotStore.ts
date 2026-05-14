import { create } from 'zustand'
import * as tauri from '../lib/tauri'
import { useWorkspaceStore } from './workspaceStore'
import { runOneShotResearchPhase, runOneShotPipelineFromSpec } from '../lib/orchestrator/oneShot'
import type { OneShotPhase } from '../lib/orchestrator/oneShot/oneShotTypes'
import type { ClarifyingAnswer, ClarifyingQuestion } from '../lib/orchestrator/oneShot/oneShotTypes'
import {
  buildEnrichedPrompt,
  generateClarifyingQuestions,
  loadResearchContextForClarify,
} from '../lib/orchestrator/oneShot/oneShotClarify'
import { useToastStore } from './toastStore'
import {
  appendOrchestratorSessionLogLine,
  teardownOneShotOrchestratorSession,
  useOrchestratorSessionStore,
} from './orchestratorSessionStore'
import { useOrchestratorActivityStore } from './orchestratorActivityStore'
import { useCanvasStore } from './canvasStore'
import {
  glitterVerbForOneShotClarifyPending,
  resetGlitterVerbSession,
  resetOneShotClarifyGlitterSession,
} from '../lib/orchestrator/orchestratorShimmerVerbs'
import { clearOneShotState, persistOneShotStateDebounced } from '../lib/persistence/oneShotPersistence'
import { getOrcaSessionId, resetOrcaSessionId } from '../lib/persistence/orcaSessionId'
import {
  clearConversationSessionKeyOverride,
  pinOrchestratorWorkspaceKeyForSession,
} from '../lib/persistence/sessionPersistence'

export type { OneShotPhase, ClarifyingAnswer, ClarifyingQuestion } from '../lib/orchestrator/oneShot/oneShotTypes'

/** Where to run the 1-shot pipeline (chosen before starting). */
export type OneShotWorkspaceChoice =
  | { kind: 'temp' }
  | { kind: 'current' }
  | { kind: 'opened'; path: string }
  | { kind: 'new'; parentPath: string; folderName: string }

export type ClarifyPhase = 'idle' | 'generating' | 'waiting'

export type OneShotStartOutcome = 'clarify_pending' | 'complete'

interface OneShotState {
  phase: OneShotPhase
  running: boolean
  ideaPrompt: string
  tempWorkspacePath: string | null
  /** True only for disposable `agent-canvas-oneshot-*` dirs under OS temp — safe to delete on discard/save. */
  oneShotUsesDisposableTemp: boolean
  projectRootPrefix: string
  /** Same tile id for research → clarify → rest of pipeline (HUD + canvas). */
  orchestratorTileIdForOneShot: string | null
  progress: { current: number; total: number; message: string }
  logs: string[]
  error: string | null
  previousRootPath: string | null
  abortController: AbortController | null

  clarifyPhase: ClarifyPhase
  clarifyQuestions: ClarifyingQuestion[] | null
  /** Set while the clarify modal may be shown; legacy name kept for compatibility. */
  pendingOrchestratorTileId: string | null
  clarifyAbortController: AbortController | null

  /** Toolbar quick input: exit 1-shot toggle after this run finishes (including post-clarify pipeline). */
  quickInputExitOneShotAfterPipeline: boolean
  setQuickInputExitOneShotAfterPipeline: (v: boolean) => void

  workspacePickerOpen: boolean
  workspacePickerResolve: ((c: OneShotWorkspaceChoice | null) => void) | null
  requestWorkspaceChoice: () => Promise<OneShotWorkspaceChoice | null>
  closeWorkspacePicker: (choice: OneShotWorkspaceChoice | null) => void

  setIdeaPrompt: (value: string) => void

  /**
   * After research, optional MC questions (first option = research-backed recommendation).
   * Returns `clarify_pending` if the modal should block before spec.
   */
  requestPostResearchClarify: (
    idea: string,
    researchContext: string,
    orchestratorTileId: string | null
  ) => Promise<'clarify_pending' | 'ready'>

  /**
   * Run 1-shot pipeline in a chosen workspace: research → optional clarify → spec…preview.
   * Pass `workspace` (or rely on default temp). Caller arms orchestrator `running` first; returns early with `clarify_pending` when questions are shown.
   */
  startPipeline: (
    idea: string,
    opts?: { orchestratorTileId?: string | null; workspace?: OneShotWorkspaceChoice }
  ) => Promise<OneShotStartOutcome>

  continuePipelineFromClarify: (ideaPrompt: string) => Promise<void>

  submitClarifyAnswers: (answers: ClarifyingAnswer[]) => Promise<void>
  skipClarify: () => Promise<void>

  cancel: () => Promise<void>
  /**
   * End 1-shot and reset UI. By default restores `previousRootPath` when the run used a user-picked
   * folder (so Discard returns you to your prior project). Pass `restoreWorkspace: false` on automatic
   * failure so the workspace stays on the folder you chose (e.g. new project folder).
   */
  discard: (opts?: { restoreWorkspace?: boolean }) => Promise<void>
  confirmSave: () => Promise<void>
  appendLog: (line: string) => void
}

const PHASE_ORDER: OneShotPhase[] = [
  'research',
  'clarify',
  'spec',
  'architecture',
  'decomposition',
  'codegen',
  'validation',
  'preview',
  'complete',
]

function phaseIndex(phase: OneShotPhase): number {
  if (phase === 'idle') return 0
  const i = PHASE_ORDER.indexOf(phase)
  return i >= 0 ? i + 1 : 0
}

function resetClarifyState() {
  return {
    clarifyPhase: 'idle' as const,
    clarifyQuestions: null as ClarifyingQuestion[] | null,
    pendingOrchestratorTileId: null as string | null,
    clarifyAbortController: null as AbortController | null,
  }
}

/** Persist ~/.orca/sessions/<id>/oneshot-state.json for crash recovery hints. */
function checkpointOneShot(get: () => OneShotState): void {
  const s = get()
  if (s.phase === 'idle' && !s.running) {
    void clearOneShotState(getOrcaSessionId())
    return
  }
  persistOneShotStateDebounced(getOrcaSessionId(), {
    wasRunning: s.running,
    phase: s.phase,
    ideaPrompt: s.ideaPrompt,
    tempWorkspacePath: s.tempWorkspacePath,
    projectRootPrefix: s.projectRootPrefix,
    oneShotUsesDisposableTemp: s.oneShotUsesDisposableTemp,
    previousRootPath: s.previousRootPath,
    orchestratorTileIdForOneShot: s.orchestratorTileIdForOneShot,
    clarifyPhase: s.clarifyPhase,
  })
}

async function resolveWorkspaceForOneShot(
  choice: OneShotWorkspaceChoice,
  idea: string
): Promise<{
  tempWorkspacePath: string
  projectRootPrefix: string
  previousRootPath: string | null
  oneShotUsesDisposableTemp: boolean
}> {
  const ws = useWorkspaceStore.getState()
  const prevRoot = ws.rootPath
  const slug =
    idea
      .slice(0, 32)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_') || 'project'

  if (choice.kind === 'temp') {
    const tempPath = await tauri.createTempProject(slug || 'project')
    if (tauri.isTauri()) {
      const anchor = ws.rootPath && ws.rootPath !== '.' ? ws.rootPath : null
      pinOrchestratorWorkspaceKeyForSession(anchor)
      await ws.setRootPath(tempPath)
      return {
        tempWorkspacePath: tempPath,
        projectRootPrefix: '',
        previousRootPath: prevRoot,
        oneShotUsesDisposableTemp: true,
      }
    }
    const projectRootPrefix = tempPath.endsWith('/') ? tempPath : `${tempPath}/`
    return {
      tempWorkspacePath: tempPath,
      projectRootPrefix,
      previousRootPath: prevRoot,
      oneShotUsesDisposableTemp: true,
    }
  }

  if (choice.kind === 'current') {
    const root = ws.rootPath
    if (tauri.isTauri() && (!root || root === '.')) {
      throw new Error('OPEN_FOLDER_FIRST')
    }
    if (tauri.isTauri()) {
      return {
        tempWorkspacePath: root,
        projectRootPrefix: '',
        previousRootPath: null,
        oneShotUsesDisposableTemp: false,
      }
    }
    const projectRootPrefix =
      root && root !== '.' ? (root.endsWith('/') ? root : `${root}/`) : ''
    return {
      tempWorkspacePath: root ?? '.',
      projectRootPrefix,
      previousRootPath: null,
      oneShotUsesDisposableTemp: false,
    }
  }

  if (choice.kind === 'opened') {
    pinOrchestratorWorkspaceKeyForSession(null)
    clearConversationSessionKeyOverride()
    resetOrcaSessionId()
    await ws.setRootPath(choice.path)
    if (tauri.isTauri()) {
      return {
        tempWorkspacePath: choice.path,
        projectRootPrefix: '',
        previousRootPath: prevRoot,
        oneShotUsesDisposableTemp: false,
      }
    }
    const p = choice.path.endsWith('/') ? choice.path : `${choice.path}/`
    return {
      tempWorkspacePath: choice.path,
      projectRootPrefix: p,
      previousRootPath: prevRoot,
      oneShotUsesDisposableTemp: false,
    }
  }

  await ws.createEmptyProjectInParent(choice.parentPath, choice.folderName)
  const newRoot = useWorkspaceStore.getState().rootPath
  if (tauri.isTauri()) {
    return {
      tempWorkspacePath: newRoot,
      projectRootPrefix: '',
      previousRootPath: prevRoot,
      oneShotUsesDisposableTemp: false,
    }
  }
  const projectRootPrefix = newRoot.endsWith('/') ? newRoot : `${newRoot}/`
  return {
    tempWorkspacePath: newRoot,
    projectRootPrefix,
    previousRootPath: prevRoot,
    oneShotUsesDisposableTemp: false,
  }
}

export const useOneShotStore = create<OneShotState>((set, get) => ({
  phase: 'idle',
  running: false,
  ideaPrompt: '',
  tempWorkspacePath: null,
  oneShotUsesDisposableTemp: false,
  projectRootPrefix: '',
  orchestratorTileIdForOneShot: null,
  progress: { current: 0, total: PHASE_ORDER.length, message: '' },
  logs: [],
  error: null,
  previousRootPath: null,
  abortController: null,

  clarifyPhase: 'idle',
  clarifyQuestions: null,
  pendingOrchestratorTileId: null,
  clarifyAbortController: null,

  quickInputExitOneShotAfterPipeline: false,
  setQuickInputExitOneShotAfterPipeline: (v) => set({ quickInputExitOneShotAfterPipeline: v }),

  workspacePickerOpen: false,
  workspacePickerResolve: null,

  requestWorkspaceChoice: () =>
    new Promise<OneShotWorkspaceChoice | null>((resolve) => {
      set({ workspacePickerOpen: true, workspacePickerResolve: resolve })
    }),

  closeWorkspacePicker: (choice) => {
    const r = get().workspacePickerResolve
    set({ workspacePickerOpen: false, workspacePickerResolve: null })
    r?.(choice)
  },

  appendLog: (line) => {
    set((s) => ({ logs: [...s.logs, line].slice(-2000) }))
  },

  setIdeaPrompt: (value) => set({ ideaPrompt: value }),

  requestPostResearchClarify: async (idea, researchContext, orchestratorTileId) => {
    const trimmed = idea.trim()
    if (!trimmed) return 'ready'

    const ac = new AbortController()
    set({
      clarifyPhase: 'generating',
      clarifyQuestions: null,
      clarifyAbortController: ac,
      ideaPrompt: trimmed,
      pendingOrchestratorTileId: orchestratorTileId,
    })

    const act = useOrchestratorActivityStore.getState()
    resetGlitterVerbSession()
    resetOneShotClarifyGlitterSession()
    act.setRunning(true)
    act.setIteration(1)
    const t0 = Date.now()
    act.setVerb(glitterVerbForOneShotClarifyPending(0))
    appendOrchestratorSessionLogLine(
      '[1-shot] Generating optional choices from research — first option is the recommended path (with a one-line rationale).'
    )

    if (orchestratorTileId) {
      useCanvasStore.getState().updateTile(orchestratorTileId, { tileStatus: 'working' })
    }

    let tickId: ReturnType<typeof setInterval> | null = setInterval(() => {
      useOrchestratorActivityStore.getState().setVerb(glitterVerbForOneShotClarifyPending(Date.now() - t0))
    }, 400)

    const endGeneratingUi = () => {
      if (tickId != null) {
        clearInterval(tickId)
        tickId = null
      }
      resetOneShotClarifyGlitterSession()
      useOrchestratorActivityStore.getState().setRunning(false)
      useOrchestratorActivityStore.getState().setIteration(0)
      useOrchestratorActivityStore.getState().setVerb('Ready')
      if (orchestratorTileId) {
        useCanvasStore.getState().updateTile(orchestratorTileId, { tileStatus: 'idle' })
      }
    }

    try {
      const questions = await generateClarifyingQuestions(trimmed, researchContext, ac.signal)
      endGeneratingUi()
      if (questions.length > 0) {
        set({
          clarifyPhase: 'waiting',
          clarifyQuestions: questions,
          clarifyAbortController: null,
        })
        appendOrchestratorSessionLogLine(
          '[1-shot] Choices are ready — option 1 matches the research recommendation; use the dialog (1–4, Enter), Esc to skip, or Skip to keep your original prompt.'
        )
        return 'clarify_pending'
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const aborted = /abort/i.test(msg)
      if (!aborted) {
        console.warn('[1-shot clarify]', e)
      }
      endGeneratingUi()
    }

    set(resetClarifyState())
    return 'ready'
  },

  startPipeline: async (ideaOverride, opts) => {
    const idea = (ideaOverride ?? get().ideaPrompt).trim()
    if (!idea) {
      useToastStore.getState().addToast({
        type: 'warning',
        title: '1-shot',
        message: 'Describe what you want to build.',
      })
      return 'complete'
    }

    const orchestratorTileId = opts?.orchestratorTileId ?? null
    const workspace = opts?.workspace ?? { kind: 'temp' as const }

    let resolved: Awaited<ReturnType<typeof resolveWorkspaceForOneShot>>
    try {
      resolved = await resolveWorkspaceForOneShot(workspace, idea)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'OPEN_FOLDER_FIRST') {
        useToastStore.getState().addToast({
          type: 'warning',
          title: '1-shot',
          message: 'Open a workspace folder first (File → Open folder), or pick another location.',
        })
      } else {
        useToastStore.getState().addToast({
          type: 'error',
          title: '1-shot workspace',
          message: msg.slice(0, 200),
        })
      }
      return 'complete'
    }

    const abortController = new AbortController()
    const { projectRootPrefix } = resolved

    set({
      ideaPrompt: idea,
      running: true,
      error: null,
      logs: [],
      phase: 'research',
      progress: { current: 1, total: PHASE_ORDER.length, message: 'Running pipeline…' },
      abortController,
      previousRootPath: resolved.previousRootPath,
      tempWorkspacePath: resolved.tempWorkspacePath,
      projectRootPrefix: resolved.projectRootPrefix,
      oneShotUsesDisposableTemp: resolved.oneShotUsesDisposableTemp,
      ...resetClarifyState(),
      orchestratorTileIdForOneShot: orchestratorTileId,
    })
    checkpointOneShot(get)

    const appendLog = get().appendLog

    const logBoth = (line: string) => {
      appendLog(line)
      appendOrchestratorSessionLogLine(line)
    }

    try {
      await runOneShotResearchPhase({
        ideaPrompt: idea,
        projectRootPrefix,
        signal: abortController.signal,
        orchestratorTileId,
        onLog: (line) => {
          logBoth(line)
        },
        onPhase: (phase) => {
          set({
            phase,
            progress: {
              current: phaseIndex(phase),
              total: PHASE_ORDER.length,
              message: phase,
            },
          })
          checkpointOneShot(get)
          useOrchestratorActivityStore.getState().setVerb(`1-shot · ${phase}`)
        },
      })

      const workspaceRoot = useWorkspaceStore.getState().rootPath
      const researchText =
        workspaceRoot != null ? await loadResearchContextForClarify(workspaceRoot, projectRootPrefix) : ''

      const gate = await get().requestPostResearchClarify(idea, researchText, orchestratorTileId)
      if (gate === 'clarify_pending') {
        useOrchestratorSessionStore.setState({ running: false })
        useOrchestratorActivityStore.getState().setRunning(false)
        useOrchestratorActivityStore.getState().setVerb('Ready')
        useOrchestratorActivityStore.getState().setIteration(0)
        set({
          running: false,
          phase: 'clarify',
          progress: {
            current: phaseIndex('clarify'),
            total: PHASE_ORDER.length,
            message: 'clarify',
          },
        })
        checkpointOneShot(get)
        return 'clarify_pending'
      }

      await runOneShotPipelineFromSpec({
        ideaPrompt: idea,
        projectRootPrefix,
        signal: abortController.signal,
        orchestratorTileId,
        onLog: (line) => {
          logBoth(line)
        },
        onPhase: (phase) => {
          set({
            phase,
            progress: {
              current: phaseIndex(phase),
              total: PHASE_ORDER.length,
              message: phase,
            },
          })
          checkpointOneShot(get)
          useOrchestratorActivityStore.getState().setVerb(`1-shot · ${phase}`)
        },
      })

      set({
        running: false,
        phase: 'preview',
        abortController: null,
        progress: {
          current: PHASE_ORDER.length,
          total: PHASE_ORDER.length,
          message: 'Ready to save or explore',
        },
      })
      void clearOneShotState(getOrcaSessionId())
      useOrchestratorActivityStore.getState().setVerb('1-shot · preview')
      useToastStore.getState().addToast({
        type: 'success',
        title: '1-shot',
        message: 'Generation finished. Preview in the explorer, then save to a permanent folder.',
      })
      if (get().quickInputExitOneShotAfterPipeline) {
        set({ quickInputExitOneShotAfterPipeline: false })
        const { useOrchestratorSessionStore } = await import('./orchestratorSessionStore')
        useOrchestratorSessionStore.getState().setOneShotMode(false)
      }
      return 'complete'
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const aborted = /abort/i.test(msg)
      set({
        running: false,
        error: aborted ? null : msg,
        phase: 'idle',
        abortController: null,
      })
      if (!aborted) {
        logBoth(`[Error] ${msg}`)
        useToastStore.getState().addToast({
          type: 'error',
          title: '1-shot failed',
          message: msg.slice(0, 200),
        })
      }
      await get().discard({ restoreWorkspace: false })
      return 'complete'
    }
  },

  continuePipelineFromClarify: async (ideaPrompt) => {
    const expectedGen = useOrchestratorSessionStore.getState().runGeneration
    const widgetTileId = get().orchestratorTileIdForOneShot
    const abortController = get().abortController
    const projectRootPrefix = get().projectRootPrefix
    const orchestratorTileId = widgetTileId

    if (!abortController) {
      console.warn('[1-shot] continuePipelineFromClarify: no abort controller')
      return
    }

    useOrchestratorSessionStore.setState({ running: true })
    useOrchestratorActivityStore.getState().setRunning(true)
    useOrchestratorActivityStore.getState().setVerb('1-shot · spec')
    if (orchestratorTileId) {
      useCanvasStore.getState().updateTile(orchestratorTileId, { tileStatus: 'working' })
    }

    set({
      running: true,
      phase: 'spec',
      ideaPrompt,
      progress: {
        current: phaseIndex('spec'),
        total: PHASE_ORDER.length,
        message: 'spec',
      },
    })
    checkpointOneShot(get)

    const appendLog = get().appendLog
    const logBoth = (line: string) => {
      appendLog(line)
      appendOrchestratorSessionLogLine(line)
    }

    try {
      await runOneShotPipelineFromSpec({
        ideaPrompt,
        projectRootPrefix,
        signal: abortController.signal,
        orchestratorTileId,
        onLog: logBoth,
        onPhase: (phase) => {
          set({
            phase,
            progress: {
              current: phaseIndex(phase),
              total: PHASE_ORDER.length,
              message: phase,
            },
          })
          checkpointOneShot(get)
          useOrchestratorActivityStore.getState().setVerb(`1-shot · ${phase}`)
        },
      })

      set({
        running: false,
        phase: 'preview',
        abortController: null,
        progress: {
          current: PHASE_ORDER.length,
          total: PHASE_ORDER.length,
          message: 'Ready to save or explore',
        },
      })
      void clearOneShotState(getOrcaSessionId())
      useOrchestratorActivityStore.getState().setVerb('1-shot · preview')
      useToastStore.getState().addToast({
        type: 'success',
        title: '1-shot',
        message: 'Generation finished. Preview in the explorer, then save to a permanent folder.',
      })
      if (get().quickInputExitOneShotAfterPipeline) {
        set({ quickInputExitOneShotAfterPipeline: false })
        useOrchestratorSessionStore.getState().setOneShotMode(false)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const aborted = /abort/i.test(msg)
      set({
        running: false,
        error: aborted ? null : msg,
        phase: 'idle',
        abortController: null,
      })
      if (!aborted) {
        logBoth(`[Error] ${msg}`)
        useToastStore.getState().addToast({
          type: 'error',
          title: '1-shot failed',
          message: msg.slice(0, 200),
        })
      }
      await get().discard({ restoreWorkspace: false })
    } finally {
      if (widgetTileId) {
        teardownOneShotOrchestratorSession(expectedGen, widgetTileId)
      }
    }
  },

  submitClarifyAnswers: async (answers) => {
    const idea = get().ideaPrompt
    const qs = get().clarifyQuestions ?? []
    const enriched = buildEnrichedPrompt(idea, answers, qs)
    set({ ...resetClarifyState(), ideaPrompt: enriched })
    await get().continuePipelineFromClarify(enriched)
  },

  skipClarify: async () => {
    const idea = get().ideaPrompt
    set(resetClarifyState())
    await get().continuePipelineFromClarify(idea)
  },

  discard: async (opts) => {
    get().clarifyAbortController?.abort()
    const onlyClarify =
      get().clarifyPhase === 'waiting' ||
      get().clarifyPhase === 'generating' ||
      (get().clarifyQuestions !== null && !get().tempWorkspacePath)
    if (onlyClarify && !get().tempWorkspacePath) {
      set({
        ...resetClarifyState(),
        ideaPrompt: '',
        quickInputExitOneShotAfterPipeline: false,
        orchestratorTileIdForOneShot: null,
      })
      void clearOneShotState(getOrcaSessionId())
      return
    }

    const ac = get().abortController
    ac?.abort()
    const temp = get().tempWorkspacePath
    const prev = get().previousRootPath
    const disposable = get().oneShotUsesDisposableTemp
    const explicitRestore = opts?.restoreWorkspace
    /** After deleting a disposable temp dir we must switch workspace away from that path. */
    const mustRestoreAfterDelete = disposable && !!temp && tauri.isTauri()
    /** User-picked folders: restore previous project unless error path passed `restoreWorkspace: false`. */
    const shouldRestorePrevious =
      tauri.isTauri() &&
      !!prev &&
      (mustRestoreAfterDelete || explicitRestore !== false)
    set({
      running: false,
      abortController: null,
      phase: 'idle',
      progress: { current: 0, total: PHASE_ORDER.length, message: '' },
      logs: [],
      ideaPrompt: '',
      error: null,
      ...resetClarifyState(),
      quickInputExitOneShotAfterPipeline: false,
      orchestratorTileIdForOneShot: null,
    })
    try {
      if (temp && tauri.isTauri() && disposable) {
        await tauri.deleteTempProject(temp)
      }
    } catch (e) {
      console.warn('[1-shot] delete temp:', e)
    }
    try {
      if (shouldRestorePrevious && prev && tauri.isTauri()) {
        pinOrchestratorWorkspaceKeyForSession(null)
        await useWorkspaceStore.getState().setRootPath(prev)
      }
    } catch (e) {
      console.warn('[1-shot] restore workspace:', e)
    }
    set({
      tempWorkspacePath: null,
      previousRootPath: null,
      projectRootPrefix: '',
      oneShotUsesDisposableTemp: false,
    })
    void clearOneShotState(getOrcaSessionId())
  },

  cancel: async () => {
    await get().discard()
  },

  confirmSave: async () => {
    const temp = get().tempWorkspacePath
    if (!temp) {
      useToastStore.getState().addToast({
        type: 'info',
        title: '1-shot',
        message: 'Nothing to save.',
      })
      return
    }
    if (!tauri.isTauri()) {
      useToastStore.getState().addToast({
        type: 'info',
        title: '1-shot',
        message: `Copy the folder "${temp}" inside your workspace manually, or use the desktop app for one-click save.`,
      })
      return
    }
    try {
      const picked = await tauri.openFolderDialog()
      if (!picked) return
      const dest = picked.path
      await tauri.copyProject(temp, dest)
      if (get().oneShotUsesDisposableTemp) {
        await tauri.deleteTempProject(temp)
      }
      await useWorkspaceStore.getState().setRootPath(dest, { orchestratorSessionPolicy: 'follow-workspace' })
      await useWorkspaceStore.getState().refreshFiles()
      set({
        tempWorkspacePath: null,
        previousRootPath: null,
        oneShotUsesDisposableTemp: false,
        phase: 'complete',
      })
      void clearOneShotState(getOrcaSessionId())
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Project saved',
        message: dest,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Save failed',
        message: msg.slice(0, 200),
      })
    }
  },
}))

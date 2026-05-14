import { create } from 'zustand'
import { useOrchestratorSessionStore } from './orchestratorSessionStore'

/**
 * "Continue where we left off?" resume card, shown once when a project is reopened
 * and there is (a) a prior orchestrator conversation and (b) at least one pending
 * or in-progress task. Purely a UI prompt — we do NOT inject a synthetic assistant
 * turn into `sessionMessages`. The user's "Continue" click sends a real, context-rich
 * user message through the normal `run()` path so the orchestrator has an
 * actionable, self-explaining prompt (no bare "yes").
 */
export interface ResumePromptData {
  projectName: string
  pct: number
  done: number
  total: number
  nextTaskText: string
  nextTaskId: string
  /** `${rootPath}::${sessionId}` — used by the helper to dedupe across renders. */
  key: string
}

interface ResumePromptState {
  data: ResumePromptData | null
  /** Keys we've already shown OR the user explicitly dismissed — never re-show for these. */
  seenKeys: Set<string>
  show: (data: ResumePromptData) => void
  /** Clears the visible card without marking the key as dismissed. */
  clear: () => void
  dismiss: () => void
  continueNow: () => Promise<void>
  hasSeen: (key: string) => boolean
}

function buildResumeUserMessage(d: ResumePromptData): string {
  const progressLine = d.total > 0 ? `Progress: ${d.pct}% (${d.done}/${d.total} complete).` : ''
  return [
    `Yes — continue ${d.projectName}.`,
    progressLine,
    `Next task: ${d.nextTaskText}.`,
    'Then continue through remaining pending tasks in order.',
  ]
    .filter(Boolean)
    .join('\n')
}

export const useResumePromptStore = create<ResumePromptState>((set, get) => ({
  data: null,
  seenKeys: new Set<string>(),
  show: (data) => {
    const seen = get().seenKeys
    if (seen.has(data.key)) return
    set({ data })
  },
  clear: () => {
    set({ data: null })
    void import('../components/orchestrator/QuickOrchestratorInput').then(
      ({ quickOrchestratorInputUiStore }) => {
        quickOrchestratorInputUiStore.getState().setSuppressedUntilIdle(false)
      }
    )
  },
  dismiss: () => {
    const cur = get().data
    if (cur) {
      const next = new Set(get().seenKeys)
      next.add(cur.key)
      set({ data: null, seenKeys: next })
    } else {
      set({ data: null })
    }
    void import('../components/orchestrator/QuickOrchestratorInput').then(
      ({ quickOrchestratorInputUiStore }) => {
        quickOrchestratorInputUiStore.getState().setSuppressedUntilIdle(false)
      }
    )
  },
  continueNow: async () => {
    const d = get().data
    if (!d) return
    const next = new Set(get().seenKeys)
    next.add(d.key)
    set({ data: null, seenKeys: next })
    const { quickOrchestratorInputUiStore } = await import(
      '../components/orchestrator/QuickOrchestratorInput'
    )
    quickOrchestratorInputUiStore.getState().setSuppressedUntilIdle(true)
    const msg = buildResumeUserMessage(d)
    const orch = useOrchestratorSessionStore.getState()
    orch.setInput(msg)
    await orch.run()
  },
  hasSeen: (key) => get().seenKeys.has(key),
}))

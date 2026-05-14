import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { HarnessTracePayload } from '../lib/orchestrator/runOrchestrator'

export type { HarnessTracePayload }

export type ReasoningTraceKind = 'trace' | 'reasoning' | 'content'

export interface ReasoningTraceEntry {
  id: string
  ts: number
  kind: ReasoningTraceKind
  text: string
}

interface ReasoningTraceState {
  entries: ReasoningTraceEntry[]
  clear: () => void
  append: (kind: ReasoningTraceKind, text: string) => void
  /** Merge into the last entry if same kind (for streamed text). */
  mergeLast: (kind: ReasoningTraceKind, chunk: string) => void
  appendFromHarness: (payload: HarnessTracePayload) => void
}

const MAX_ALLOWLIST_NAMES_IN_TRACE = 8

function formatHarnessPayload(p: HarnessTracePayload): string {
  switch (p.kind) {
    case 'run_start': {
      const base = `Run start${p.scopeLevel ? ` · scope ${p.scopeLevel}` : ''}${p.attemptIndex != null ? ` · attempt ${p.attemptIndex}` : ''}`
      const names = p.allowlistToolsSorted
      const count = p.allowlistToolCount ?? names?.length
      if (count == null || !names || names.length === 0) return base
      const shown = names.slice(0, MAX_ALLOWLIST_NAMES_IN_TRACE)
      const more = names.length > MAX_ALLOWLIST_NAMES_IN_TRACE ? ` +${names.length - MAX_ALLOWLIST_NAMES_IN_TRACE} more` : ''
      return `${base} · allowlist ${count} (${shown.join(', ')}${more})`
    }
    case 'llm_round':
      return `LLM round · iteration ${p.iteration}`
    case 'tool_batch':
      return `Tools · ${p.toolNames.join(', ')}`
    case 'run_end':
      return p.ok ? 'Run complete' : `Run failed${p.error ? `: ${p.error}` : ''}`
    default:
      return String((p as { kind?: string }).kind ?? 'event')
  }
}

export const useReasoningTraceStore = create<ReasoningTraceState>((set, get) => ({
  entries: [],
  clear: () => set({ entries: [] }),
  append: (kind, text) => {
    const t = text.trim()
    if (!t) return
    set({
      entries: [
        ...get().entries.slice(-400),
        { id: nanoid(), ts: Date.now(), kind, text: t },
      ],
    })
  },
  mergeLast: (kind, chunk) => {
    if (!chunk) return
    set((s) => {
      const entries = [...s.entries]
      const last = entries[entries.length - 1]
      if (last && last.kind === kind) {
        entries[entries.length - 1] = { ...last, text: last.text + chunk, ts: Date.now() }
      } else {
        entries.push({ id: nanoid(), ts: Date.now(), kind, text: chunk })
      }
      return { entries: entries.slice(-400) }
    })
  },
  appendFromHarness: (payload) => {
    get().append('trace', formatHarnessPayload(payload))
  },
}))

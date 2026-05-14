import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AgentIssueKind } from '../lib/agentIssueDetector'

export type AgentTaskStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface AgentTaskEntry {
  /** Stable identifier (uuid-ish: `${tileId}:${startedAt}`). */
  id: string
  /** Submitted prompt / delegated task text. Trimmed. */
  text: string
  status: AgentTaskStatus
  startedAt: number
  finishedAt?: number
  errorMessage?: string
  /** Source hint so team tile can show a badge: `user` vs `delegated` vs `nudge`. */
  source: 'user' | 'delegated' | 'nudge'
  /** Per-task issue counters. Incremented by classified log lines. */
  issues: {
    error: number
    warning: number
    fail: number
  }
}

interface AgentTaskState {
  /** Per-tileId list of tasks (most recent at the END). */
  byTileId: Record<string, AgentTaskEntry[]>
  /**
   * Start a new task entry for a tile. If a running task already exists for
   * this tile we mark it `cancelled` first so there's never more than one
   * open task per agent (mirrors how the runner serializes).
   */
  startTask: (
    tileId: string,
    text: string,
    opts?: { source?: AgentTaskEntry['source']; id?: string; startedAt?: number }
  ) => AgentTaskEntry
  /** Mark the most recent running task for a tile as completed. */
  finishTask: (tileId: string, status?: 'done' | 'error' | 'cancelled', errorMessage?: string) => void
  /** Increment the issue counter on the most recent task for a tile. */
  noteIssue: (tileId: string, kind: AgentIssueKind) => void
  /** Wipe all tasks for one tile. Used by Clear-history. */
  clearTileTasks: (tileId: string) => void
  /** Wipe everything (tests / profile switches). */
  clearAll: () => void
  /** Convenience selector. */
  getTasks: (tileId: string) => AgentTaskEntry[]
  /** Convenience selector for the most recent task. */
  getCurrentTask: (tileId: string) => AgentTaskEntry | undefined
}

const MAX_TASKS_PER_TILE = 50

function makeId(tileId: string, ts: number): string {
  return `${tileId}:${ts}:${Math.floor(Math.random() * 1_000_000).toString(36)}`
}

function replaceLast<T>(arr: T[], mapLast: (t: T) => T): T[] {
  if (arr.length === 0) return arr
  const copy = arr.slice()
  copy[copy.length - 1] = mapLast(copy[copy.length - 1])
  return copy
}

export const useAgentTaskStore = create<AgentTaskState>()(
  persist(
    (set, get) => ({
      byTileId: {},

      startTask: (tileId, text, opts) => {
        const now = opts?.startedAt ?? Date.now()
        const entry: AgentTaskEntry = {
          id: opts?.id ?? makeId(tileId, now),
          text: (text || '').trim() || '(empty prompt)',
          status: 'running',
          startedAt: now,
          source: opts?.source ?? 'user',
          issues: { error: 0, warning: 0, fail: 0 },
        }
        const existing = get().byTileId[tileId] ?? []
        // Auto-cancel any stale running task so list stays consistent.
        const cleaned = existing.map((t) =>
          t.status === 'running' ? { ...t, status: 'cancelled' as const, finishedAt: now } : t
        )
        const merged = [...cleaned, entry].slice(-MAX_TASKS_PER_TILE)
        set({ byTileId: { ...get().byTileId, [tileId]: merged } })
        return entry
      },

      finishTask: (tileId, status = 'done', errorMessage) => {
        const list = get().byTileId[tileId]
        if (!list || list.length === 0) return
        const last = list[list.length - 1]
        if (last.status !== 'running') return
        const updated = replaceLast(list, (t) => ({
          ...t,
          status,
          errorMessage: errorMessage ?? t.errorMessage,
          finishedAt: Date.now(),
        }))
        set({ byTileId: { ...get().byTileId, [tileId]: updated } })
      },

      noteIssue: (tileId, kind) => {
        const list = get().byTileId[tileId]
        if (!list || list.length === 0) return
        const updated = replaceLast(list, (t) => ({
          ...t,
          issues: { ...t.issues, [kind]: t.issues[kind] + 1 },
        }))
        set({ byTileId: { ...get().byTileId, [tileId]: updated } })
      },

      clearTileTasks: (tileId) => {
        const copy = { ...get().byTileId }
        if (tileId in copy) {
          delete copy[tileId]
          set({ byTileId: copy })
        }
      },

      clearAll: () => set({ byTileId: {} }),

      getTasks: (tileId) => get().byTileId[tileId] ?? [],

      getCurrentTask: (tileId) => {
        const list = get().byTileId[tileId]
        if (!list || list.length === 0) return undefined
        return list[list.length - 1]
      },
    }),
    {
      name: 'agent-task-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ byTileId: s.byTileId }),
    }
  )
)

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Per-delegated-agent-tile checklist. Parsed from the `Subtasks:` block of the
 * delegated task prompt. Tracks both auto-derived completion (from the agent's
 * log tail heuristic) and manual user overrides —
 * once the user clicks a checkbox, that item is "pinned" (auto-apply skips it).
 *
 * Items are replaced only when the source list actually changes, so a
 * re-render with the same parsed list preserves check state.
 */
export interface AgentSubtaskItem {
  text: string
  done: boolean
  /** Linked global todo id for live status mirroring. */
  todoId?: string
  /**
   * `true`  — auto-managed: heuristic can still flip this.
   * `false` — user manually toggled at least once; auto-apply leaves it alone.
   */
  auto: boolean
}

interface AgentSubtaskState {
  byTileId: Record<string, AgentSubtaskItem[]>
  /**
   * Replace subtasks for a tile only when the normalized source list differs.
   * Preserves existing done/auto flags when the texts match, so re-renders
   * don't wipe progress.
   */
  syncSubtasks: (tileId: string, items: string[]) => void
  /**
   * Apply heuristic-derived done flags. Only flips auto-managed items from
   * false → true (never un-checks). User-pinned items (auto === false) are
   * preserved as-is.
   */
  applyAutoDone: (tileId: string, doneFlags: boolean[]) => void
  /** User click — flips done, pins the item to user-managed. */
  toggle: (tileId: string, index: number) => void
  /** Link a subtask row to a global todo id (one-time lazy binding). */
  linkTodoId: (tileId: string, index: number, todoId: string) => void
  clearTile: (tileId: string) => void
}

function sameList(a: AgentSubtaskItem[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const row = a[i]
    if (!row || row.text !== b[i]) return false
  }
  return true
}

export const useAgentSubtaskStore = create<AgentSubtaskState>()(
  persist(
    (set, get) => ({
      byTileId: {},

      syncSubtasks: (tileId, items) => {
        const cur = get().byTileId[tileId]
        if (sameList(cur, items)) return
        if (items.length === 0) {
          if (!cur) return
          const copy = { ...get().byTileId }
          delete copy[tileId]
          set({ byTileId: copy })
          return
        }
        const next: AgentSubtaskItem[] = items.map((text) => ({
          text,
          done: false,
          auto: true,
        }))
        set({ byTileId: { ...get().byTileId, [tileId]: next } })
      },

      applyAutoDone: (tileId, doneFlags) => {
        const cur = get().byTileId[tileId]
        if (!cur || cur.length === 0) return
        let changed = false
        const next = cur.map((item, i) => {
          if (!item.auto) return item
          if (item.done) return item
          if (doneFlags[i]) {
            changed = true
            return { ...item, done: true }
          }
          return item
        })
        if (!changed) return
        set({ byTileId: { ...get().byTileId, [tileId]: next } })
      },

      toggle: (tileId, index) => {
        const cur = get().byTileId[tileId]
        if (!cur || index < 0 || index >= cur.length) return
        const next = cur.map((item, i) =>
          i === index ? { ...item, done: !item.done, auto: false } : item
        )
        set({ byTileId: { ...get().byTileId, [tileId]: next } })
      },

      linkTodoId: (tileId, index, todoId) => {
        const cur = get().byTileId[tileId]
        if (!cur || index < 0 || index >= cur.length) return
        const clean = (todoId ?? '').trim()
        if (!clean) return
        const row = cur[index]
        if (!row || row.todoId === clean) return
        const next = cur.map((item, i) =>
          i === index ? { ...item, todoId: clean } : item
        )
        set({ byTileId: { ...get().byTileId, [tileId]: next } })
      },

      clearTile: (tileId) => {
        const copy = { ...get().byTileId }
        if (tileId in copy) {
          delete copy[tileId]
          set({ byTileId: copy })
        }
      },
    }),
    {
      name: 'agent-subtask-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ byTileId: s.byTileId }),
    }
  )
)

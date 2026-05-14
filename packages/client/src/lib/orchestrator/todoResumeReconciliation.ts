/**
 * After app restart, `.orca/tasks.json` can still list in-progress orchestrator work and
 * `assignedAgentName` while the canvas only restores the orchestrator tile (no sub-agents).
 * Reconcile when there is no live agent roster so the sidebar does not imply waiting workers.
 */
import type { TodoTask } from '../../store/todoStore'

const DELEGATION_TOOL_PREFIXES = [
  'wait_for_sub_agent',
  'spawn_sub_agent',
  'chat_with_hermes_tile',
] as const

/** Root turn row from `addTask('Orchestrator: …')` — not a `startToolTask` line (tool name first). */
export function isRootOrchestratorTodoRow(task: TodoTask): boolean {
  return task.source === 'orchestrator' && /^Orchestrator:\s*\S/i.test(task.text.trimStart())
}

export function isDelegationToolLineTodoText(text: string): boolean {
  const t = text.trimStart()
  return DELEGATION_TOOL_PREFIXES.some((p) => t.startsWith(p))
}

export interface ReconcileStaleDelegatedTasksOptions {
  /** When true, sub-agents are live — do not mutate tasks. */
  hasLiveAgentRoster: boolean
}

export function reconcileStaleDelegatedTasks(
  tasks: TodoTask[],
  options: ReconcileStaleDelegatedTasksOptions
): { tasks: TodoTask[]; touchedCount: number } {
  if (options.hasLiveAgentRoster) {
    return { tasks, touchedCount: 0 }
  }

  const now = Date.now()
  let touchedCount = 0
  const next = tasks.map((task) => {
    if (task.source !== 'orchestrator') return task

    let assignedAgentName = task.assignedAgentName
    let status = task.status
    let changed = false

    if (assignedAgentName) {
      assignedAgentName = undefined
      changed = true
    }

    if (status === 'in_progress') {
      if (isRootOrchestratorTodoRow(task)) {
        status = 'pending'
      } else {
        status = 'cancelled'
      }
      changed = true
    }

    if (!changed) return task
    touchedCount += 1
    return { ...task, assignedAgentName, status, updatedAt: now }
  })

  return { tasks: next, touchedCount }
}

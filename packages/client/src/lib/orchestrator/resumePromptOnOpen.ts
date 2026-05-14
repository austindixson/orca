import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import { useTodoStore, type TodoTask } from '../../store/todoStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useResumePromptStore } from '../../store/resumePromptStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { getOrcaSessionId } from '../persistence/orcaSessionId'
import { pruneOrchestratorTodoNoise } from './todoTaskQuality'

function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return i >= 0 ? trimmed.slice(i + 1) : trimmed
}

/** First in-progress task wins; otherwise first pending. Preserves user-defined order. */
function pickNextActionable(tasks: TodoTask[]): TodoTask | undefined {
  return (
    tasks.find((t) => t.status === 'in_progress') ?? tasks.find((t) => t.status === 'pending')
  )
}

function computePct(tasks: TodoTask[]): { pct: number; done: number; total: number } {
  const nonCancelled = tasks.filter((t) => t.status !== 'cancelled')
  const total = nonCancelled.length
  const done = nonCancelled.filter((t) => t.status === 'completed').length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return { pct, done, total }
}

const TERMINAL_ERROR_TASK_RE = /^Debug terminal error \(/i
const TERMINAL_ERROR_PRUNE_THRESHOLD = 12

function pruneTerminalErrorLoopTasks(tasks: TodoTask[]): {
  cleaned: TodoTask[]
  prunedCount: number
} {
  const loopIds = new Set(
    tasks
      .filter(
        (t) =>
          t.source === 'orchestrator' &&
          (t.status === 'pending' || t.status === 'in_progress') &&
          TERMINAL_ERROR_TASK_RE.test(t.text.trim())
      )
      .map((t) => t.id)
  )

  if (loopIds.size < TERMINAL_ERROR_PRUNE_THRESHOLD) {
    return { cleaned: tasks, prunedCount: 0 }
  }

  const cleaned = tasks.filter((t) => !loopIds.has(t.id))
  return { cleaned, prunedCount: loopIds.size }
}

/**
 * If this project has a prior orchestrator conversation AND pending todo work,
 * populate the resume-prompt store so the orchestrator widget shows a
 * "Continue where we left off?" card. Idempotent per (rootPath, sessionId) —
 * safe to call multiple times as stores settle.
 */
export function maybeShowResumePromptOnOpen(): void {
  const resume = useResumePromptStore.getState()
  const ws = useWorkspaceStore.getState()
  if (!ws.rootPath || ws.rootPath === '.' || ws.rootPath.length === 0) {
    resume.clear()
    return
  }

  const session = useOrchestratorSessionStore.getState()
  // Never interrupt an active or queued orchestrator run.
  if (session.running || session.queuedInputs.length > 0) {
    resume.clear()
    return
  }

  // Must have a real prior conversation — otherwise "continue" makes no sense.
  const hasPriorConversation = session.sessionMessages.some(
    (m) => m.role === 'user' || m.role === 'assistant'
  )
  if (!hasPriorConversation) {
    resume.clear()
    return
  }

  const todoStore = useTodoStore.getState()
  const { cleaned: afterTerminal, prunedCount } = pruneTerminalErrorLoopTasks(todoStore.tasks)
  const { cleaned: afterNoise, removed: noiseRemoved } = pruneOrchestratorTodoNoise(afterTerminal)
  const cleaned = afterNoise
  if (prunedCount > 0 || noiseRemoved > 0) {
    todoStore.replaceTasks(cleaned)
    if (prunedCount > 0) {
      useOrchestratorActivityStore
        .getState()
        .appendActivityLine(
          `[Resume] Pruned ${prunedCount} stale terminal-error debug task${prunedCount === 1 ? '' : 's'} from a prior loop.`
        )
    }
    if (noiseRemoved > 0) {
      useOrchestratorActivityStore
        .getState()
        .appendActivityLine(
          `[Resume] Removed ${noiseRemoved} duplicate or non-actionable orchestrator todo row${noiseRemoved === 1 ? '' : 's'}.`
        )
    }
  }

  const next = pickNextActionable(cleaned)
  if (!next) {
    resume.clear()
    return
  }

  const { pct, done, total } = computePct(cleaned)
  const projectName = ws.rootName || basename(ws.rootPath) || 'this project'
  const key = `${ws.rootPath}::${getOrcaSessionId()}`

  resume.show({
    key,
    projectName,
    pct,
    done,
    total,
    nextTaskText: next.text.trim(),
    nextTaskId: next.id,
  })
}

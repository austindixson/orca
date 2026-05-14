import { create } from 'zustand'
import { evaluateOrchestratorToolTask, formatBurstTaskText } from '../lib/taskBurstAggregation'
import { useSettingsStore } from './settingsStore'

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed'
export type TodoSource = 'user' | 'orchestrator' | 'oneshot'
export type TodoDifficulty = 'easy' | 'medium' | 'hard'

/** 1-shot v2 decomposition categories (DAG tasks). */
export type TodoCategory =
  | 'research'
  | 'code'
  | 'test'
  | 'config'
  | 'docs'
  | 'integration'

export interface TodoTask {
  id: string
  text: string
  status: TodoStatus
  source: TodoSource
  /** When set, UI shows this name on the agent badge (orchestrator model or sub-agent tile). */
  assignedAgentName?: string
  /** 1-shot decomposition: estimated difficulty. */
  difficulty?: TodoDifficulty
  /** 1-shot v2: weight band from DECOMPOSITION.json (1–4+). */
  weight?: number
  /** 1-shot: rough predicted tool-call budget for this row. */
  predictedToolCalls?: number
  /** Subtasks point to parent task id. */
  parentId?: string | null
  /** 1-shot v1: backend | frontend | integration */
  phaseTag?: string
  /** 1-shot v2: topological wave index from DAG planner. */
  waveNumber?: number
  /** 1-shot v2: dependency task ids (numeric ids as strings, e.g. "1", "2"). */
  dependsOn?: string[]
  /** 1-shot v2: task category from decomposition. */
  category?: TodoCategory
  /** 1-shot v2: numeric id from DECOMPOSITION.json for cross-reference. */
  decompositionTaskId?: number
  /** Burst aggregation: normalized key for merging similar orchestrator tool rows. */
  burstGroupKey?: string
  /** Burst aggregation: number of merged occurrences. */
  burstCount?: number
  createdAt: number
  updatedAt: number
}

type TodoPatchable = Partial<
  Pick<
    TodoTask,
    | 'text'
    | 'status'
    | 'assignedAgentName'
    | 'difficulty'
    | 'weight'
    | 'predictedToolCalls'
    | 'parentId'
    | 'phaseTag'
    | 'waveNumber'
    | 'dependsOn'
    | 'category'
    | 'decompositionTaskId'
    | 'burstGroupKey'
    | 'burstCount'
  >
>

interface TodoState {
  tasks: TodoTask[]
  /** Replace all tasks (session resume / hydration). */
  replaceTasks: (tasks: TodoTask[]) => void
  addTask: (text: string, source?: TodoSource, status?: TodoStatus) => string
  updateTaskText: (id: string, text: string) => void
  setTaskStatus: (id: string, status: TodoStatus) => void
  patchTask: (id: string, patch: TodoPatchable) => void
  /** 1-shot: add a child row linked to a parent task (inherits phaseTag from parent). */
  addSubtask: (
    parentId: string,
    text: string,
    opts?: { difficulty?: TodoDifficulty; predictedToolCalls?: number }
  ) => string
  removeTask: (id: string) => void
  startToolTask: (toolName: string, detail?: string) => string
  completeToolTask: (toolName: string) => void
  getOpenCount: () => number
}

function nowMs(): number {
  return Date.now()
}

function taskId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`
}

export const useTodoStore = create<TodoState>((set, get) => ({
  tasks: [],

  replaceTasks: (tasks) => set({ tasks: [...tasks] }),

  addTask: (text, source = 'user', status = 'pending') => {
    const id = taskId(source)
    const t = nowMs()
    set((s) => ({
      tasks: [...s.tasks, { id, text: text.trim(), status, source, createdAt: t, updatedAt: t }],
    }))
    return id
  },

  updateTaskText: (id, text) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, text: text.trim(), updatedAt: nowMs() } : t
      ),
    }))
  },

  setTaskStatus: (id, status) => {
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, status, updatedAt: nowMs() } : t)),
    }))
  },

  patchTask: (id, patch) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, ...patch, updatedAt: nowMs() } : t
      ),
    }))
  },

  addSubtask: (parentId, text, opts) => {
    const parent = get().tasks.find((t) => t.id === parentId)
    const id = taskId('oneshot')
    const t = nowMs()
    set((s) => ({
      tasks: [
        ...s.tasks,
        {
          id,
          text: text.trim(),
          status: 'pending' as TodoStatus,
          source: 'oneshot' as TodoSource,
          parentId,
          phaseTag: parent?.phaseTag,
          waveNumber: parent?.waveNumber,
          category: parent?.category,
          dependsOn: parent?.dependsOn,
          decompositionTaskId: parent?.decompositionTaskId,
          difficulty: opts?.difficulty,
          weight: parent?.weight,
          predictedToolCalls: opts?.predictedToolCalls,
          createdAt: t,
          updatedAt: t,
        },
      ],
    }))
    return id
  },

  removeTask: (id) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
  },

  startToolTask: (toolName, detail) => {
    const text = detail ? `${toolName} — ${detail}` : toolName
    const existing = get().tasks.find(
      (t) => t.source === 'orchestrator' && t.status === 'in_progress' && t.text.startsWith(toolName)
    )
    if (existing) return existing.id

    if (useSettingsStore.getState().orcaBurstAggregationEnabled) {
      const burst = evaluateOrchestratorToolTask(text, get().tasks)
      if (burst.action === 'drop_rate_limit') {
        return ''
      }
      if (burst.action === 'merge' && burst.mergeTaskId && burst.burstCount) {
        get().patchTask(burst.mergeTaskId, {
          text: formatBurstTaskText(text, burst.burstCount),
          burstCount: burst.burstCount,
        })
        return burst.mergeTaskId
      }
      const id = taskId('orchestrator')
      const t = nowMs()
      const key =
        text
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .slice(0, 120) || 'task'
      set((s) => ({
        tasks: [
          ...s.tasks,
          {
            id,
            text,
            status: 'in_progress' as TodoStatus,
            source: 'orchestrator' as const,
            burstGroupKey: key,
            burstCount: 1,
            createdAt: t,
            updatedAt: t,
          },
        ],
      }))
      return id
    }

    return get().addTask(text, 'orchestrator', 'in_progress')
  },

  completeToolTask: (toolName) => {
    const task = [...get().tasks]
      .reverse()
      .find(
        (t) => t.source === 'orchestrator' && t.status === 'in_progress' && t.text.startsWith(toolName)
      )
    if (!task) return
    get().setTaskStatus(task.id, 'completed')
  },

  getOpenCount: () =>
    get().tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length,
}))


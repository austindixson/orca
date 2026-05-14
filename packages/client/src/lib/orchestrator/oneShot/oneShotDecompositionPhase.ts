/**
 * DECOMPOSITION.json schema, parsing, and syncing 1-shot tasks into the sidebar todo store.
 * Supports v1 (three fixed phases) and v2 (DAG + waves).
 */

import * as tauri from '../../tauri'
import { useTodoStore, type TodoDifficulty } from '../../../store/todoStore'
import type { DecompositionDocV2, DecompositionTaskRowV2 } from './oneShotDecompositionTypes'
import { computeWaves, type WavePlan } from './oneShotWavePlanner'

export type { DecompositionDocV2, DecompositionTaskRowV2 } from './oneShotDecompositionTypes'

export interface DecompositionSubtaskRow {
  title: string
  difficulty: TodoDifficulty
  predictedToolCalls?: number
}

export interface DecompositionTaskRow {
  title: string
  difficulty: TodoDifficulty
  predictedToolCalls?: number
  subtasks?: DecompositionSubtaskRow[]
  securityChecks?: string[]
}

export interface DecompositionPhaseRow {
  name: 'backend' | 'frontend' | 'integration'
  tasks: DecompositionTaskRow[]
}

export interface DecompositionDoc {
  phases: DecompositionPhaseRow[]
}

export type LoadedDecomposition =
  | { format: 'v1'; doc: DecompositionDoc; plan: null }
  | { format: 'v2'; doc: DecompositionDocV2; plan: WavePlan }

const PHASE_ORDER: Array<DecompositionPhaseRow['name']> = ['backend', 'frontend', 'integration']

function isDifficulty(x: unknown): x is TodoDifficulty {
  return x === 'easy' || x === 'medium' || x === 'hard'
}

function parseSubtask(raw: unknown): DecompositionSubtaskRow | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.title !== 'string' || !o.title.trim()) return null
  if (!isDifficulty(o.difficulty)) return null
  const predicted =
    typeof o.predictedToolCalls === 'number' && Number.isFinite(o.predictedToolCalls)
      ? Math.max(0, Math.round(o.predictedToolCalls))
      : undefined
  return {
    title: o.title.trim(),
    difficulty: o.difficulty,
    predictedToolCalls: predicted,
  }
}

function parseTask(raw: unknown): DecompositionTaskRow | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.title !== 'string' || !o.title.trim()) return null
  if (!isDifficulty(o.difficulty)) return null
  const predicted =
    typeof o.predictedToolCalls === 'number' && Number.isFinite(o.predictedToolCalls)
      ? Math.max(0, Math.round(o.predictedToolCalls))
      : undefined
  const subtasksRaw = Array.isArray(o.subtasks) ? o.subtasks : []
  const subtasks = subtasksRaw.map(parseSubtask).filter((x): x is DecompositionSubtaskRow => x != null)
  const securityChecks = Array.isArray(o.securityChecks)
    ? o.securityChecks.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : []
  return {
    title: o.title.trim(),
    difficulty: o.difficulty,
    predictedToolCalls: predicted,
    subtasks: subtasks.length > 0 ? subtasks : undefined,
    securityChecks: securityChecks.length > 0 ? securityChecks : undefined,
  }
}

function parsePhase(raw: unknown): DecompositionPhaseRow | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = o.name
  if (name !== 'backend' && name !== 'frontend' && name !== 'integration') return null
  if (!Array.isArray(o.tasks)) return null
  const tasks = o.tasks.map(parseTask).filter((x): x is DecompositionTaskRow => x != null)
  return { name, tasks }
}

const CATEGORIES = new Set([
  'research',
  'code',
  'test',
  'config',
  'docs',
  'integration',
])

function isCategory(x: unknown): x is DecompositionTaskRowV2['category'] {
  return typeof x === 'string' && CATEGORIES.has(x)
}

function weightToDifficulty(w: number): TodoDifficulty {
  if (w <= 1) return 'easy'
  if (w <= 2) return 'medium'
  return 'hard'
}

function parseTaskV2(raw: unknown): DecompositionTaskRowV2 | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.title !== 'string' || !o.title.trim()) return null
  if (typeof o.id !== 'number' || !Number.isFinite(o.id) || o.id <= 0) return null
  if (typeof o.weight !== 'number' || !Number.isFinite(o.weight) || o.weight < 1) return null
  if (!isCategory(o.category)) return null
  const deps = Array.isArray(o.depends_on)
    ? o.depends_on.filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0)
    : []
  const predicted =
    typeof o.estimated_tool_calls === 'number' && Number.isFinite(o.estimated_tool_calls)
      ? Math.max(0, Math.round(o.estimated_tool_calls))
      : undefined
  const securityChecks = Array.isArray(o.security_checks)
    ? o.security_checks.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : []
  const description =
    typeof o.description === 'string' && o.description.trim() ? o.description.trim() : undefined
  return {
    id: Math.round(o.id),
    title: o.title.trim(),
    description,
    depends_on: deps,
    weight: Math.round(o.weight),
    estimated_tool_calls: predicted,
    category: o.category,
    security_checks: securityChecks.length > 0 ? securityChecks : undefined,
  }
}

/** Parse v1 shape (phases-only, no version field). */
export function parseDecompositionV1(data: unknown): DecompositionDoc {
  if (!data || typeof data !== 'object') {
    throw new Error('DECOMPOSITION.json must be an object')
  }
  const phasesRaw = (data as Record<string, unknown>).phases
  if (!Array.isArray(phasesRaw) || phasesRaw.length === 0) {
    throw new Error('DECOMPOSITION.json must include a non-empty "phases" array')
  }
  const phases = phasesRaw.map(parsePhase).filter((x): x is DecompositionPhaseRow => x != null)
  if (phases.length !== phasesRaw.length) {
    throw new Error('DECOMPOSITION.json: invalid phase or task entry')
  }
  if (phases.length !== 3) {
    throw new Error('DECOMPOSITION.json must contain exactly three phases: backend, frontend, integration')
  }
  const seen = new Set(phases.map((p) => p.name))
  for (const n of PHASE_ORDER) {
    if (!seen.has(n)) {
      throw new Error(`DECOMPOSITION.json must include a phase named "${n}"`)
    }
  }
  if (seen.size !== 3) {
    throw new Error('DECOMPOSITION.json phases must be unique (backend, frontend, integration)')
  }
  for (const t of phases.flatMap((p) => p.tasks)) {
    if (t.difficulty === 'hard' && (!t.subtasks || t.subtasks.length === 0)) {
      throw new Error(`DECOMPOSITION.json: hard task "${t.title}" must include subtasks`)
    }
  }
  const ordered: DecompositionPhaseRow[] = []
  for (const name of PHASE_ORDER) {
    const p = phases.find((x) => x.name === name)
    if (!p) throw new Error(`DECOMPOSITION.json: missing phase "${name}"`)
    ordered.push(p)
  }
  return { phases: ordered }
}

export function parseDecompositionV2(data: unknown): { doc: DecompositionDocV2; plan: WavePlan } {
  if (!data || typeof data !== 'object') {
    throw new Error('DECOMPOSITION.json must be an object')
  }
  const rec = data as Record<string, unknown>
  if (rec.version !== 2) {
    throw new Error('DECOMPOSITION.json v2 must set "version": 2')
  }
  const tasksRaw = rec.tasks
  if (!Array.isArray(tasksRaw) || tasksRaw.length === 0) {
    throw new Error('DECOMPOSITION.json v2 must include a non-empty "tasks" array')
  }
  const tasks = tasksRaw.map(parseTaskV2).filter((x): x is DecompositionTaskRowV2 => x != null)
  if (tasks.length !== tasksRaw.length) {
    throw new Error('DECOMPOSITION.json v2: invalid task entry')
  }
  const ids = new Set<number>()
  for (const t of tasks) {
    if (ids.has(t.id)) {
      throw new Error(`DECOMPOSITION.json v2: duplicate task id ${t.id}`)
    }
    ids.add(t.id)
  }
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (!ids.has(dep)) {
        throw new Error(`DECOMPOSITION.json v2: task ${t.id} depends on unknown task ${dep}`)
      }
    }
  }
  if (tasks.some((t) => t.weight >= 4)) {
    // Soft validation: still parse; pipeline may log
  }
  const plan = computeWaves(tasks)
  const doc: DecompositionDocV2 = { version: 2, tasks }
  return { doc, plan }
}

/**
 * Parse and validate DECOMPOSITION.json body.
 * Supports v1 (`phases`) and v2 (`version: 2`, `tasks` with `depends_on`).
 */
export function parseDecompositionJson(json: string): LoadedDecomposition {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('DECOMPOSITION.json is not valid JSON')
  }
  if (!data || typeof data !== 'object') {
    throw new Error('DECOMPOSITION.json must be an object')
  }
  const rec = data as Record<string, unknown>
  if (rec.version === 2) {
    const { doc, plan } = parseDecompositionV2(data)
    return { format: 'v2', doc, plan }
  }
  const doc = parseDecompositionV1(data)
  return { format: 'v1', doc, plan: null }
}

/** Join workspace root with optional 1-shot prefix and filename (POSIX-style). */
export function resolveOneShotFilePath(
  workspaceRoot: string,
  projectRootPrefix: string,
  fileName: string
): string {
  const root = workspaceRoot.replace(/\/$/, '')
  const name = fileName.replace(/^\//, '')
  if (!projectRootPrefix) {
    return `${root}/${name}`
  }
  const prefix = projectRootPrefix.replace(/\/$/, '')
  return `${root}/${prefix}/${name}`
}

/** Read DECOMPOSITION.json from disk (Tauri or dev server). */
export async function loadDecompositionFromWorkspace(
  workspaceRoot: string,
  projectRootPrefix: string
): Promise<LoadedDecomposition> {
  const path = resolveOneShotFilePath(workspaceRoot, projectRootPrefix, 'DECOMPOSITION.json')
  const raw = await tauri.readFile(path)
  return parseDecompositionJson(raw)
}

/** Push decomposition tasks into the sidebar todo store (1-shot source). */
export function pushDecompositionToTodoStore(loaded: LoadedDecomposition): void {
  const store = useTodoStore.getState()
  if (loaded.format === 'v1') {
    for (const phase of loaded.doc.phases) {
      for (const task of phase.tasks) {
        const id = store.addTask(task.title, 'oneshot', 'pending')
        store.patchTask(id, {
          difficulty: task.difficulty,
          predictedToolCalls: task.predictedToolCalls,
          phaseTag: phase.name,
        })
        for (const sub of task.subtasks ?? []) {
          store.addSubtask(id, sub.title, {
            difficulty: sub.difficulty,
            predictedToolCalls: sub.predictedToolCalls,
          })
        }
      }
    }
    return
  }

  const { doc, plan } = loaded
  for (const w of plan.waves) {
    for (const tid of w.taskIds) {
      const task = doc.tasks.find((t) => t.id === tid)
      if (!task) continue
      const label = `[${task.id}] ${task.title}`
      const todoId = store.addTask(label, 'oneshot', 'pending')
      store.patchTask(todoId, {
        waveNumber: w.number,
        category: task.category,
        dependsOn: task.depends_on.map(String),
        decompositionTaskId: task.id,
        difficulty: weightToDifficulty(Math.min(task.weight, 4)),
        weight: task.weight,
        predictedToolCalls: task.estimated_tool_calls,
        phaseTag: undefined,
      })
    }
  }
}

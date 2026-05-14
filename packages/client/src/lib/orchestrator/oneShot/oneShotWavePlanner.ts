/**
 * Dependency DAG validation, topological wave scheduling, and critical path —
 * TypeScript port of divideandconquer `scripts/decompose.py` core logic.
 */

import type { DecompositionTaskRowV2 } from './oneShotDecompositionTypes'

export interface PlannedWave {
  number: number
  /** Task ids in this wave (parallel-eligible batch). */
  taskIds: number[]
  /** Prior wave numbers this wave depends on (for display). */
  dependsOnWaveNumbers: number[]
  /** Light vs heavy grouping when an outlier exists (same wave, planning only). */
  groups?: { light: number[]; heavy: number[] }
}

export interface WavePlan {
  waves: PlannedWave[]
  totalTasks: number
  totalWaves: number
  maxParallelism: number
  criticalPathLength: number
  speedupEstimate: number
  hasComplexityGrouping: boolean
}

export interface DagValidation {
  ok: boolean
  error?: string
}

function defaultToolCallsForWeight(weight: number): number {
  const bands: Record<number, number> = { 1: 5, 2: 12, 3: 22, 4: 40 }
  return bands[weight] ?? Math.max(40, weight * 10)
}

export function effectiveToolCalls(task: DecompositionTaskRowV2): number {
  if (task.estimated_tool_calls != null && Number.isFinite(task.estimated_tool_calls)) {
    return Math.max(0, Math.round(task.estimated_tool_calls))
  }
  return defaultToolCallsForWeight(task.weight)
}

/** Kahn topological sort — detects cycles. */
export function validateDag(tasks: DecompositionTaskRowV2[]): DagValidation {
  const ids = new Set(tasks.map((t) => t.id))
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (!ids.has(dep)) {
        return { ok: false, error: `Task ${t.id} depends on unknown task ${dep}` }
      }
    }
  }

  const adj = new Map<number, number[]>()
  const inDegree = new Map<number, number>()
  for (const t of tasks) {
    inDegree.set(t.id, 0)
  }
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      const list = adj.get(dep) ?? []
      list.push(t.id)
      adj.set(dep, list)
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1)
    }
  }

  const queue: number[] = []
  for (const t of tasks) {
    if ((inDegree.get(t.id) ?? 0) === 0) queue.push(t.id)
  }
  queue.sort((a, b) => a - b)

  let visited = 0
  while (queue.length > 0) {
    const node = queue.shift()!
    visited++
    for (const nb of adj.get(node) ?? []) {
      const d = (inDegree.get(nb) ?? 0) - 1
      inDegree.set(nb, d)
      if (d === 0) {
        queue.push(nb)
        queue.sort((a, b) => a - b)
      }
    }
  }

  if (visited !== tasks.length) {
    return { ok: false, error: 'Dependency graph contains a cycle' }
  }
  return { ok: true }
}

function balanceWaveTaskIds(
  taskIds: number[],
  taskById: Map<number, DecompositionTaskRowV2>
): { light: number[]; heavy: number[] } | null {
  if (taskIds.length <= 1) return null

  const weights = taskIds.map((id) => taskById.get(id)!.weight)
  const maxW = Math.max(...weights)
  const lighter = taskIds.filter((id) => taskById.get(id)!.weight < maxW)
  const heaviest = taskIds.filter((id) => taskById.get(id)!.weight === maxW)

  if (lighter.length === 0 || heaviest.length === taskIds.length) return null

  const avgOthers = lighter.reduce((s, id) => s + taskById.get(id)!.weight, 0) / lighter.length
  if (maxW >= 3 * avgOthers) {
    return { light: lighter.sort((a, b) => a - b), heavy: heaviest.sort((a, b) => a - b) }
  }
  return null
}

/**
 * Compute parallel waves: each wave is all tasks whose dependencies are satisfied by prior waves.
 * Optional maxConcurrency splits a ready batch into multiple waves (same dep semantics).
 */
export function computeWaves(
  tasks: DecompositionTaskRowV2[],
  options?: { maxConcurrency?: number; balance?: boolean }
): WavePlan {
  const maxConcurrency = options?.maxConcurrency ?? 0
  const balance = options?.balance !== false

  const v = validateDag(tasks)
  if (!v.ok) {
    throw new Error(v.error ?? 'Invalid DAG')
  }

  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const ids = new Set(tasks.map((t) => t.id))

  const adj = new Map<number, number[]>()
  const inDegree = new Map<number, number>()
  for (const id of ids) {
    inDegree.set(id, 0)
  }
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      const list = adj.get(dep) ?? []
      list.push(t.id)
      adj.set(dep, list)
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1)
    }
  }

  const waves: PlannedWave[] = []
  const remaining = new Set(ids)
  const completed = new Set<number>()
  /** waveIndex (0-based) -> set of task ids in that wave */
  const waveContents: number[][] = []

  while (remaining.size > 0) {
    const ready = [...remaining].filter((sid) => {
      const t = taskById.get(sid)!
      return t.depends_on.every((dep) => completed.has(dep))
    })
    ready.sort((a, b) => a - b)

    if (ready.length === 0) {
      throw new Error('Deadlock detected — remaining tasks have unsatisfied dependencies')
    }

    const batches =
      maxConcurrency > 0
        ? Array.from({ length: Math.ceil(ready.length / maxConcurrency) }, (_, i) =>
            ready.slice(i * maxConcurrency, (i + 1) * maxConcurrency)
          )
        : [ready]

    for (const batch of batches) {
      const depWaves = new Set<number>()
      for (const sid of batch) {
        const t = taskById.get(sid)!
        for (const dep of t.depends_on) {
          for (let wi = 0; wi < waveContents.length; wi++) {
            if (waveContents[wi].includes(dep)) {
              depWaves.add(wi + 1)
            }
          }
        }
      }

      waveContents.push([...batch])
      const waveNum = waves.length + 1
      let groups: { light: number[]; heavy: number[] } | undefined
      if (balance) {
        const g = balanceWaveTaskIds(batch, taskById)
        if (g) groups = g
      }

      waves.push({
        number: waveNum,
        taskIds: batch,
        dependsOnWaveNumbers: [...depWaves].sort((a, b) => a - b),
        groups: groups
          ? { light: groups.light, heavy: groups.heavy }
          : undefined,
      })

      for (const sid of batch) {
        completed.add(sid)
        remaining.delete(sid)
      }
    }
  }

  const criticalPathLength = computeCriticalPath(tasks)
  const sequentialTime = tasks.reduce((s, t) => s + t.weight, 0)
  const parallelTime = waves.reduce((s, w) => {
    const ws = w.taskIds.map((id) => taskById.get(id)!.weight)
    return s + Math.max(...ws, 0)
  }, 0)
  const speedupEstimate =
    parallelTime > 0 ? Math.round((Math.max(sequentialTime / parallelTime, 1) + Number.EPSILON) * 100) / 100 : 1

  const maxParallelism = Math.max(...waves.map((w) => w.taskIds.length), 0)
  const hasComplexityGrouping = waves.some((w) => w.groups && w.groups.light.length > 0 && w.groups.heavy.length > 0)

  return {
    waves,
    totalTasks: tasks.length,
    totalWaves: waves.length,
    maxParallelism,
    criticalPathLength,
    speedupEstimate,
    hasComplexityGrouping,
  }
}

export function computeCriticalPath(tasks: DecompositionTaskRowV2[]): number {
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const memo = new Map<number, number>()

  function longestPath(sid: number): number {
    if (memo.has(sid)) return memo.get(sid)!
    const s = taskById.get(sid)!
    if (s.depends_on.length === 0) {
      memo.set(sid, s.weight)
    } else {
      const base = Math.max(...s.depends_on.map((d) => longestPath(d)))
      memo.set(sid, s.weight + base)
    }
    return memo.get(sid)!
  }

  if (tasks.length === 0) return 0
  return Math.max(...tasks.map((t) => longestPath(t.id)))
}

export function formatWavePlanMarkdown(plan: WavePlan, taskById: Map<number, DecompositionTaskRowV2>): string {
  const lines: string[] = ['## Execution plan (dependency waves)', '']

  for (const w of plan.waves) {
    const depNote =
      w.dependsOnWaveNumbers.length > 0
        ? `Depends on wave(s) ${w.dependsOnWaveNumbers.join(', ')}`
        : 'No dependencies (roots)'

    lines.push(`### Wave ${w.number} — ${depNote}`)
    if (w.groups) {
      lines.push('**Light (finish early)**')
      for (const id of w.groups.light) {
        const t = taskById.get(id)!
        lines.push(
          `- [${id}] ${t.title} [weight ${t.weight}, ~${effectiveToolCalls(t)} tools]`
        )
      }
      lines.push('**Heavy (wall-clock driver)**')
      for (const id of w.groups.heavy) {
        const t = taskById.get(id)!
        lines.push(
          `- [${id}] ${t.title} [weight ${t.weight}, ~${effectiveToolCalls(t)} tools]`
        )
      }
    } else {
      for (const id of w.taskIds) {
        const t = taskById.get(id)!
        lines.push(
          `- [${id}] ${t.title} [weight ${t.weight}, ~${effectiveToolCalls(t)} tools]`
        )
      }
    }
    const tw = w.taskIds.reduce((s, id) => s + taskById.get(id)!.weight, 0)
    const driver = Math.max(...w.taskIds.map((id) => effectiveToolCalls(taskById.get(id)!)))
    lines.push(`  *Wave weight sum: ${tw} | max task tools ~${driver}*`)
    lines.push('')
  }

  lines.push('**Summary**')
  lines.push(`- ${plan.totalTasks} tasks, ${plan.totalWaves} waves, max ${plan.maxParallelism} parallel`)
  lines.push(`- Critical path (weight sum): ${plan.criticalPathLength}`)
  lines.push(`- Estimated speedup vs serial waves: ~${plan.speedupEstimate}x`)
  if (plan.hasComplexityGrouping) {
    lines.push('- At least one wave has light/heavy grouping (outlier rule)')
  }

  return lines.join('\n')
}

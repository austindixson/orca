import { useMemo } from 'react'
import { useTodoStore } from '../store/todoStore'

/** Non-cancelled todo tasks: completion % for the project “sensor” / title strip. */
export function useProjectTaskCompletion(): { pct: number; done: number; total: number } {
  const tasks = useTodoStore((s) => s.tasks)
  return useMemo(() => {
    const nonCancelled = tasks.filter((t) => t.status !== 'cancelled')
    const n = nonCancelled.length
    const d = nonCancelled.filter((t) => t.status === 'completed').length
    const p = n === 0 ? 0 : Math.round((d / n) * 100)
    return { pct: p, done: d, total: n }
  }, [tasks])
}

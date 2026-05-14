import { describe, expect, it } from 'vitest'
import {
  isOrchestratorSyntheticResumeMessage,
  normalizeOrchestratorBodyForDedup,
  pruneOrchestratorTodoNoise,
  shouldSuppressOrchestratorTodoRow,
} from './todoTaskQuality'
import type { TodoTask } from '../../store/todoStore'

function ot(partial: Partial<TodoTask> & Pick<TodoTask, 'id' | 'text'>): TodoTask {
  const t = Date.now()
  return {
    status: 'completed',
    source: 'orchestrator',
    createdAt: t,
    updatedAt: t,
    ...partial,
  }
}

describe('todoTaskQuality', () => {
  it('detects resume prompt injection body', () => {
    const msg = [
      'Yes — continue OrcaLabs.',
      'Progress: 53% (329/619 complete).',
      'Next task: Orchestrator: open a hermes agent.',
      'Then continue through remaining pending tasks in order.',
    ].join('\n')
    expect(isOrchestratorSyntheticResumeMessage(msg)).toBe(true)
    expect(shouldSuppressOrchestratorTodoRow(msg)).toBe(true)
  })

  it('does not flag real work instructions', () => {
    expect(shouldSuppressOrchestratorTodoRow('Refactor the auth module and add tests.')).toBe(false)
    expect(isOrchestratorSyntheticResumeMessage('Implement OAuth2 login flow')).toBe(false)
  })

  it('suppresses bare continue', () => {
    expect(shouldSuppressOrchestratorTodoRow('continue')).toBe(true)
    expect(shouldSuppressOrchestratorTodoRow('OK')).toBe(true)
  })

  it('prunes persisted orchestrator resume spam', () => {
    const tasks: TodoTask[] = [
      ot({
        id: 'a',
        text: `Orchestrator: Yes — continue OrcaLabs.
Progress: 53% (329/619 complete).
Next task: Orchestrator: open a hermes agent.
Then continue through remaining pending tasks in order.`,
        status: 'completed',
        updatedAt: 1,
      }),
      ot({ id: 'b', text: 'Orchestrator: Refactor auth', status: 'pending', updatedAt: 2 }),
    ]
    const { cleaned, removed } = pruneOrchestratorTodoNoise(tasks)
    expect(removed).toBe(1)
    expect(cleaned.map((t) => t.id)).toEqual(['b'])
  })

  it('dedupes near-identical resume rows keeping newest', () => {
    const body = (pct: number, done: number, total: number) =>
      `Orchestrator: Yes — continue OrcaLabs.
Progress: ${pct}% (${done}/${total} complete).
Next task: Orchestrator: open a hermes agent.
Then continue through remaining pending tasks in order.`

    const tasks: TodoTask[] = [
      ot({ id: 'old', text: body(40, 100, 200), status: 'completed', updatedAt: 10 }),
      ot({ id: 'new', text: body(84, 173, 207), status: 'completed', updatedAt: 99 }),
    ]
    const { cleaned, removed } = pruneOrchestratorTodoNoise(tasks)
    expect(removed).toBe(2)
    expect(cleaned).toHaveLength(0)
  })

  it('normalize strips progress for dedup key', () => {
    const a = normalizeOrchestratorBodyForDedup(
      `Orchestrator: Yes — continue OrcaLabs.
Progress: 40% (100/200 complete).
Next task: x.`
    )
    const b = normalizeOrchestratorBodyForDedup(
      `Orchestrator: Yes — continue OrcaLabs.
Progress: 84% (173/207 complete).
Next task: x.`
    )
    expect(a).toBe(b)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TodoTask } from '../../store/todoStore'
import {
  isDelegationToolLineTodoText,
  isRootOrchestratorTodoRow,
  reconcileStaleDelegatedTasks,
} from './todoResumeReconciliation'

function baseTask(overrides: Partial<TodoTask>): TodoTask {
  const t = Date.now()
  return {
    id: 't1',
    text: 'Orchestrator: do thing',
    status: 'in_progress',
    source: 'orchestrator',
    createdAt: t,
    updatedAt: t,
    ...overrides,
  }
}

describe('todoResumeReconciliation', () => {
  it('isRootOrchestratorTodoRow matches Orchestrator: prefix', () => {
    assert.equal(
      isRootOrchestratorTodoRow(baseTask({ text: 'Orchestrator: ship feature' })),
      true
    )
    assert.equal(
      isRootOrchestratorTodoRow(baseTask({ text: 'wait_for_sub_agent — tile' })),
      false
    )
  })

  it('isDelegationToolLineTodoText detects delegation tools', () => {
    assert.equal(isDelegationToolLineTodoText('spawn_sub_agent — args'), true)
    assert.equal(isDelegationToolLineTodoText('  wait_for_sub_agent — x'), true)
    assert.equal(isDelegationToolLineTodoText('read_file — x'), false)
  })

  it('skips all changes when hasLiveAgentRoster is true', () => {
    const tasks = [baseTask({ assignedAgentName: 'Mei' })]
    const { tasks: out, touchedCount } = reconcileStaleDelegatedTasks(tasks, {
      hasLiveAgentRoster: true,
    })
    assert.equal(touchedCount, 0)
    assert.deepEqual(out, tasks)
  })

  it('clears assignedAgentName and sets root row to pending', () => {
    const tasks = [baseTask({ assignedAgentName: 'Mei', text: 'Orchestrator: build it' })]
    const { tasks: out, touchedCount } = reconcileStaleDelegatedTasks(tasks, {
      hasLiveAgentRoster: false,
    })
    assert.equal(touchedCount, 1)
    assert.equal(out[0]?.status, 'pending')
    assert.equal(out[0]?.assignedAgentName, undefined)
    assert.equal(out[0]?.text, 'Orchestrator: build it')
  })

  it('cancels in-progress tool-line orchestrator tasks', () => {
    const tasks = [
      baseTask({
        text: 'wait_for_sub_agent — tile abc',
        assignedAgentName: undefined,
      }),
    ]
    const { tasks: out, touchedCount } = reconcileStaleDelegatedTasks(tasks, {
      hasLiveAgentRoster: false,
    })
    assert.equal(touchedCount, 1)
    assert.equal(out[0]?.status, 'cancelled')
  })

  it('does not mutate completed orchestrator tasks except clearing assignedAgentName', () => {
    const tasks = [
      baseTask({
        status: 'completed',
        assignedAgentName: 'Sora',
        text: 'Orchestrator: done',
      }),
    ]
    const { tasks: out, touchedCount } = reconcileStaleDelegatedTasks(tasks, {
      hasLiveAgentRoster: false,
    })
    assert.equal(touchedCount, 1)
    assert.equal(out[0]?.status, 'completed')
    assert.equal(out[0]?.assignedAgentName, undefined)
  })

  it('leaves user-sourced tasks unchanged', () => {
    const tasks = [
      {
        ...baseTask({ source: 'user', status: 'in_progress', assignedAgentName: 'X' as never }),
      },
    ]
    const { touchedCount } = reconcileStaleDelegatedTasks(tasks, { hasLiveAgentRoster: false })
    assert.equal(touchedCount, 0)
  })
})

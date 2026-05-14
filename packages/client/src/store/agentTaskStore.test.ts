import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Install a `localStorage` shim **before** the store import so zustand's
 * persist middleware captures a working Storage object (Node's built-in
 * localStorage requires --localstorage-file and is otherwise unusable).
 */
{
  const store: Record<string, string> = {}
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length
    },
  } satisfies Storage
}

const { useAgentTaskStore } = await import('./agentTaskStore')

function reset(): void {
  useAgentTaskStore.setState({ byTileId: {} })
}

test('startTask: creates a running entry and appends to the tile list', () => {
  reset()
  const t = useAgentTaskStore.getState().startTask('tile-a', 'write hello world', {
    source: 'user',
  })
  assert.equal(t.status, 'running')
  assert.equal(t.text, 'write hello world')
  assert.equal(t.source, 'user')
  assert.deepEqual(t.issues, { error: 0, warning: 0, fail: 0 })
  const tasks = useAgentTaskStore.getState().getTasks('tile-a')
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].id, t.id)
})

test('startTask: defaults empty text to "(empty prompt)" and trims whitespace', () => {
  reset()
  const a = useAgentTaskStore.getState().startTask('t', '   ', { source: 'user' })
  assert.equal(a.text, '(empty prompt)')
  const b = useAgentTaskStore.getState().startTask('t', '  do the thing  ', { source: 'user' })
  assert.equal(b.text, 'do the thing')
})

test('startTask: cancels an existing running task before starting the new one', () => {
  reset()
  useAgentTaskStore.getState().startTask('tile-b', 'task-1')
  useAgentTaskStore.getState().startTask('tile-b', 'task-2')
  const tasks = useAgentTaskStore.getState().getTasks('tile-b')
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].status, 'cancelled')
  assert.ok(typeof tasks[0].finishedAt === 'number')
  assert.equal(tasks[1].status, 'running')
})

test('finishTask: marks the most-recent running task as done/error/cancelled', () => {
  reset()
  useAgentTaskStore.getState().startTask('tile-c', 'alpha')
  useAgentTaskStore.getState().finishTask('tile-c', 'done')
  const done = useAgentTaskStore.getState().getCurrentTask('tile-c')!
  assert.equal(done.status, 'done')
  assert.ok(typeof done.finishedAt === 'number')

  useAgentTaskStore.getState().startTask('tile-c', 'beta')
  useAgentTaskStore.getState().finishTask('tile-c', 'error', 'boom')
  const err = useAgentTaskStore.getState().getCurrentTask('tile-c')!
  assert.equal(err.status, 'error')
  assert.equal(err.errorMessage, 'boom')

  useAgentTaskStore.getState().startTask('tile-c', 'gamma')
  useAgentTaskStore.getState().finishTask('tile-c', 'cancelled')
  const cancelled = useAgentTaskStore.getState().getCurrentTask('tile-c')!
  assert.equal(cancelled.status, 'cancelled')
})

test('finishTask: no-op if the most-recent task is already terminal', () => {
  reset()
  useAgentTaskStore.getState().startTask('tile-d', 'alpha')
  useAgentTaskStore.getState().finishTask('tile-d', 'done')
  const first = useAgentTaskStore.getState().getCurrentTask('tile-d')!
  useAgentTaskStore.getState().finishTask('tile-d', 'error', 'late')
  const second = useAgentTaskStore.getState().getCurrentTask('tile-d')!
  assert.equal(second.status, 'done')
  assert.equal(second.finishedAt, first.finishedAt)
  assert.equal(second.errorMessage, undefined)
})

test('finishTask: no-op for unknown tile', () => {
  reset()
  useAgentTaskStore.getState().finishTask('missing', 'done')
  assert.deepEqual(useAgentTaskStore.getState().byTileId, {})
})

test('noteIssue: bumps the counter on the current task', () => {
  reset()
  useAgentTaskStore.getState().startTask('tile-e', 'alpha')
  useAgentTaskStore.getState().noteIssue('tile-e', 'error')
  useAgentTaskStore.getState().noteIssue('tile-e', 'error')
  useAgentTaskStore.getState().noteIssue('tile-e', 'warning')
  useAgentTaskStore.getState().noteIssue('tile-e', 'fail')
  const t = useAgentTaskStore.getState().getCurrentTask('tile-e')!
  assert.deepEqual(t.issues, { error: 2, warning: 1, fail: 1 })
})

test('noteIssue: no-op when tile has no tasks', () => {
  reset()
  useAgentTaskStore.getState().noteIssue('nope', 'error')
  assert.deepEqual(useAgentTaskStore.getState().byTileId, {})
})

test('clearTileTasks: removes only the target tile', () => {
  reset()
  useAgentTaskStore.getState().startTask('a', 'x')
  useAgentTaskStore.getState().startTask('b', 'y')
  useAgentTaskStore.getState().clearTileTasks('a')
  assert.equal(useAgentTaskStore.getState().getTasks('a').length, 0)
  assert.equal(useAgentTaskStore.getState().getTasks('b').length, 1)
})

test('clearAll: wipes every tile', () => {
  reset()
  useAgentTaskStore.getState().startTask('a', 'x')
  useAgentTaskStore.getState().startTask('b', 'y')
  useAgentTaskStore.getState().clearAll()
  assert.deepEqual(useAgentTaskStore.getState().byTileId, {})
})

test('task list is capped to MAX_TASKS_PER_TILE (50) and drops oldest', () => {
  reset()
  for (let i = 0; i < 60; i++) {
    useAgentTaskStore.getState().startTask('tile-cap', `task ${i}`)
  }
  const tasks = useAgentTaskStore.getState().getTasks('tile-cap')
  assert.equal(tasks.length, 50)
  // The most recent task should be the last one we pushed.
  assert.equal(tasks[tasks.length - 1].text, 'task 59')
  // Oldest surviving should be somewhere mid-run, not task 0.
  assert.equal(tasks[0].text, 'task 10')
})

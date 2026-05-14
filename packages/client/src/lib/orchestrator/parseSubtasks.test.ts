import assert from 'node:assert'
import { describe, it } from 'node:test'
import { detectCompletedSubtasks, parseSubtasks } from './parseSubtasks'

describe('parseSubtasks', () => {
  it('parses bullets after Subtasks:', () => {
    const raw = `Title\n\nSubtasks:\n- First task here\n- Second task`
    assert.deepEqual(parseSubtasks(raw), ['First task here', 'Second task'])
  })
})

describe('detectCompletedSubtasks', () => {
  it('matches two long tokens across adjacent lines', () => {
    const subtasks = ['Fix checkout regression bugs']
    const log = `→ read_file(path: x)\ncheckout regression fixed`
    const flags = detectCompletedSubtasks(subtasks, log)
    assert.equal(flags[0], true)
  })

  it('does not match when distinctive tokens are absent', () => {
    const subtasks = ['Refactor payment processor']
    const log = `→ list_directory(".")\nok`
    const flags = detectCompletedSubtasks(subtasks, log)
    assert.equal(flags[0], false)
  })
})

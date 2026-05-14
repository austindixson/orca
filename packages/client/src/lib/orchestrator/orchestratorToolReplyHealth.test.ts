import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getOrchestratorToolReplyQuarantineUntilMs,
  getOrchestratorToolReplyRecentFailureCount,
  isOrchestratorToolReplyQuarantined,
  noteOrchestratorEmptyToolReplyFailure,
  resetOrchestratorToolReplyHealthForTests,
} from './orchestratorToolReplyHealth'

test('reset clears state', () => {
  resetOrchestratorToolReplyHealthForTests()
  assert.equal(isOrchestratorToolReplyQuarantined('openrouter', 'x/y'), false)
})

test('quarantine after three exhausted failures', () => {
  resetOrchestratorToolReplyHealthForTests()
  noteOrchestratorEmptyToolReplyFailure('openrouter', 'a/b')
  noteOrchestratorEmptyToolReplyFailure('openrouter', 'a/b')
  assert.equal(isOrchestratorToolReplyQuarantined('openrouter', 'a/b'), false)
  noteOrchestratorEmptyToolReplyFailure('openrouter', 'a/b')
  assert.equal(isOrchestratorToolReplyQuarantined('openrouter', 'a/b'), true)
  const until = getOrchestratorToolReplyQuarantineUntilMs('openrouter', 'a/b')
  assert.ok(until != null && until > Date.now())
})

test('recent failure count before quarantine', () => {
  resetOrchestratorToolReplyHealthForTests()
  assert.equal(getOrchestratorToolReplyRecentFailureCount('zai', 'glm'), 0)
  noteOrchestratorEmptyToolReplyFailure('zai', 'glm')
  assert.equal(getOrchestratorToolReplyRecentFailureCount('zai', 'glm'), 1)
  noteOrchestratorEmptyToolReplyFailure('zai', 'glm')
  assert.equal(getOrchestratorToolReplyRecentFailureCount('zai', 'glm'), 2)
  noteOrchestratorEmptyToolReplyFailure('zai', 'glm')
  assert.equal(isOrchestratorToolReplyQuarantined('zai', 'glm'), true)
  assert.equal(getOrchestratorToolReplyRecentFailureCount('zai', 'glm'), 0)
})

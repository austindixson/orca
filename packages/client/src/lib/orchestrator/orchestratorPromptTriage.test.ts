/**
 * Prompt triage + articulation gating heuristics.
 * Run: npm test --workspace=@agent-canvas/client -- orchestratorPromptTriage.test.ts
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyOrchestratorPrompt,
  shouldArticulateOrchestratorPrompt,
} from './orchestratorPromptTriage.ts'

describe('shouldArticulateOrchestratorPrompt', () => {
  test('short / greeting fragments → articulate', () => {
    assert.equal(shouldArticulateOrchestratorPrompt('hi'), true)
    assert.equal(shouldArticulateOrchestratorPrompt('fix pls'), true)
  })

  test('vague phrasing → articulate', () => {
    assert.equal(shouldArticulateOrchestratorPrompt('fix this'), true)
    assert.equal(shouldArticulateOrchestratorPrompt('this is broken'), true)
    assert.equal(shouldArticulateOrchestratorPrompt('it shows an error'), true)
  })

  test('production / audit intents → do not articulate', () => {
    assert.equal(shouldArticulateOrchestratorPrompt('is my project production ready?'), false)
    assert.equal(shouldArticulateOrchestratorPrompt('audit the entire codebase for XSS'), false)
  })

  test('path-anchored implementation requests → do not articulate', () => {
    assert.equal(
      shouldArticulateOrchestratorPrompt(
        'Implement JWT refresh in packages/client/src/auth/session.ts and add tests.'
      ),
      false
    )
  })

  test('long structured prompt → do not articulate', () => {
    const lines = ['Goal: ship OAuth.', 'Step 1: migrate tokens.', 'Step 2: update tests.', 'AC: green CI.']
    const long = lines.join('\n').repeat(8)
    assert.ok(long.length > 220)
    assert.ok((long.match(/\n/g) ?? []).length >= 3)
    assert.equal(shouldArticulateOrchestratorPrompt(long), false)
  })

  test('classifyOrchestratorPrompt can be complex while articulation stays off', () => {
    assert.equal(classifyOrchestratorPrompt('is my project production ready?'), 'complex')
    assert.equal(shouldArticulateOrchestratorPrompt('is my project production ready?'), false)
  })
})

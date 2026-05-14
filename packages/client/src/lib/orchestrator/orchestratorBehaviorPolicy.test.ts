import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ORCHESTRATOR_BEHAVIOR_PRIORITY_ORDER,
  buildBehaviorContractBlock,
  buildBehaviorReflexTurnGuard,
  detectOrchestratorBehaviorSignals,
} from './orchestratorBehaviorPolicy'

describe('orchestratorBehaviorPolicy', () => {
  it('encodes fixed priority order', () => {
    assert.deepEqual(ORCHESTRATOR_BEHAVIOR_PRIORITY_ORDER, [
      'safety',
      'user_immediate_request',
      'grounding',
      'continuity',
      'efficiency',
      'verbosity',
    ])
  })

  it('detects recall triggers from cross-session references', () => {
    const sig = detectOrchestratorBehaviorSignals('Remember when we fixed this last time? Continue from there.')
    assert.equal(sig.shouldRecallSessionContext, true)
    assert.equal(sig.shouldPersistDurableMemory, false)
  })

  it('detects durable-memory write triggers from preference/correction cues', () => {
    const sig = detectOrchestratorBehaviorSignals(
      "I prefer short check-ins. Please never do long status dumps; don't do that again."
    )
    assert.equal(sig.shouldRecallSessionContext, false)
    assert.equal(sig.shouldPersistDurableMemory, true)
  })

  it('builds targeted reflex guard when a trigger appears', () => {
    const guard = buildBehaviorReflexTurnGuard('As discussed before, remember this preference for me.')
    assert.ok(guard)
    assert.match(guard ?? '', /session_search/i)
    assert.match(guard ?? '', /memory/i)
    assert.match(guard ?? '', /state uncertainty/i)
  })

  it('returns null guard when no trigger appears', () => {
    const guard = buildBehaviorReflexTurnGuard('Run tests and summarize failures.')
    assert.equal(guard, null)
  })

  it('behavior contract block includes memory philosophy and recovery lane', () => {
    const block = buildBehaviorContractBlock()
    assert.match(block, /Behavior contract/i)
    assert.match(block, /policy-encoded reflexes/i)
    assert.match(block, /Recovery is first-class/i)
    assert.match(block, /Recall reflex/i)
    assert.match(block, /Write reflex/i)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDynamicPromptPreface,
  buildPromptFlowContractBlock,
} from './orchestratorPromptLayers'

describe('orchestratorPromptLayers', () => {
  it('includes staged prompt-flow contract, behavior contract, and interruption-resume policy', () => {
    const block = buildPromptFlowContractBlock()
    const preface = buildDynamicPromptPreface('default')
    assert.match(block, /Prompt-flow contract/i)
    assert.match(block, /Skills\/context scan first/i)
    assert.match(block, /Patch\/test\/verify/i)
    assert.match(block, /Interruption-resume protocol/i)
    assert.match(block, /Answer the interruption/i)
    assert.match(block, /resume handoff/i)
    assert.match(preface, /Behavior contract/i)
    assert.match(preface, /priority order per turn/i)
    assert.match(preface, /Memory philosophy contract/i)
  })

  it('dynamic preface includes flow contract for default runs', () => {
    const preface = buildDynamicPromptPreface('default')
    assert.match(preface, /Prompt-flow contract/i)
    assert.match(preface, /Interruption-resume protocol/i)
  })

  it('heartbeat preface keeps heartbeat context while retaining flow contract', () => {
    const preface = buildDynamicPromptPreface('heartbeat')
    assert.match(preface, /Run context \(heartbeat\)/i)
    assert.match(preface, /Prompt-flow contract/i)
  })
})

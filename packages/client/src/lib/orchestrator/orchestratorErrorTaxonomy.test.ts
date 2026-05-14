import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyOrchestratorError } from './orchestratorErrorTaxonomy'

describe('orchestratorErrorTaxonomy', () => {
  it('classifies 401 as auth', () => {
    const c = classifyOrchestratorError(new Error('nope'), 401)
    assert.equal(c.kind, 'auth')
    assert.equal(c.retryableTransport, false)
  })

  it('classifies 429 as rate_limit', () => {
    const c = classifyOrchestratorError(new Error('slow down'), 429)
    assert.equal(c.kind, 'rate_limit')
    assert.equal(c.retryableTransport, true)
  })

  it('suggests compaction on 400 context overflow body', () => {
    const c = classifyOrchestratorError(
      new Error('This model maximum context length is 128000 tokens'),
      400
    )
    assert.equal(c.kind, 'context_overflow')
    assert.equal(c.suggestCompaction, true)
  })

  it('classifies message-only context overflow', () => {
    const c = classifyOrchestratorError(new Error('token limit exceeded for this request'))
    assert.equal(c.kind, 'context_overflow')
    assert.equal(c.suggestCompaction, true)
  })

  it('classifies fetch failures as transient_network', () => {
    const c = classifyOrchestratorError(new Error('Failed to fetch'))
    assert.equal(c.kind, 'transient_network')
    assert.equal(c.retryableTransport, true)
  })

  it('classifies chat TimeoutError and suggests one stall retry', () => {
    const c = classifyOrchestratorError(
      new DOMException('Chat request timed out after 180s', 'TimeoutError')
    )
    assert.equal(c.kind, 'timeout')
    assert.equal(c.suggestStallRetry, true)
    assert.equal(c.retryableTransport, false)
  })
})

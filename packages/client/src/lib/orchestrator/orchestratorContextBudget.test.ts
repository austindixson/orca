import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_SESSION_HISTORY_CHARS, trimMessagesForOrchestrator } from './orchestratorContextBudget'
import type { ChatMessage } from './types'

describe('trimMessagesForOrchestrator', () => {
  it('returns empty array unchanged', () => {
    assert.deepEqual(trimMessagesForOrchestrator([], 1000), [])
  })

  it('keeps all messages when under budget', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]
    assert.deepEqual(trimMessagesForOrchestrator(messages, 10_000), messages)
  })

  it('drops oldest messages to preserve tail under char budget', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(5000) },
      { role: 'assistant', content: 'y'.repeat(5000) },
      { role: 'user', content: 'tail' },
    ]
    const trimmed = trimMessagesForOrchestrator(messages, 2000)
    assert.ok(trimmed.length < messages.length)
    assert.ok(trimmed.some((m) => m.role === 'user' && m.content === 'tail'))
  })

  it('falls back to last two messages when trimming would empty the list', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(50_000) },
      { role: 'assistant', content: 'y'.repeat(50_000) },
    ]
    const trimmed = trimMessagesForOrchestrator(messages, 100)
    assert.equal(trimmed.length, 2)
  })

  it('uses default max chars', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    assert.deepEqual(trimMessagesForOrchestrator(messages), messages)
    assert.equal(MAX_SESSION_HISTORY_CHARS, 18_000)
  })
})

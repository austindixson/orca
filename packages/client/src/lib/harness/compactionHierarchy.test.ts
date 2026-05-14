import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyCompactionHierarchy, snipMessages } from './compactionHierarchy'
import type { ChatMessage } from '../orchestrator/types'

function countUsers(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === 'user').length
}

describe('compactionHierarchy snipMessages', () => {
  it('preserves at least one user message when trimming heavy tool history', () => {
    const hugeTool = 'x'.repeat(240_000)
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'clone https://getnyx.dev/' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'browser_vision', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc_1', content: hugeTool },
      { role: 'assistant', content: '', tool_calls: [{ id: 'tc_2', type: 'function', function: { name: 'search_files', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc_2', content: hugeTool },
    ]

    const trimmed = snipMessages(messages, 80_000, 1)
    assert.ok(countUsers(trimmed) >= 1)
    assert.equal(trimmed.some((m) => m.role === 'user' && String(m.content).includes('getnyx.dev')), true)
  })

  it('can still drop the oldest user when another user exists', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'older user' },
      { role: 'assistant', content: 'ack' },
      { role: 'user', content: 'latest user' },
      { role: 'assistant', content: 'final' },
    ]

    const trimmed = snipMessages(messages, 80, 1)
    const userTexts = trimmed
      .filter((m): m is Extract<ChatMessage, { role: 'user' }> => m.role === 'user')
      .map((m) => String(m.content))
    assert.ok(userTexts.includes('latest user'))
  })

  it('orchestrator-style repeated compaction keeps at least one user before follow-up LLM calls', () => {
    let working: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Fix this site: https://getnyx.dev/' },
      { role: 'assistant', content: 'starting' },
    ]

    for (let i = 0; i < 6; i++) {
      const tc = `tc_${i}`
      working.push({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: tc, type: 'function', function: { name: 'browser_snapshot', arguments: '{}' } }],
      })
      working.push({ role: 'tool', tool_call_id: tc, content: 'x'.repeat(120_000) })
      working = applyCompactionHierarchy(working, { maxChars: 70_000, minTailMessages: 8 })
      assert.ok(
        working.some((m) => m.role === 'user'),
        `compaction pass ${i + 1} removed all user messages`
      )
    }
  })
})

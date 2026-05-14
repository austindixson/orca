import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  resolveCodexResponsesWireModelId,
  pickCodexStreamCompletionResult,
} from './chatCompletion'
describe('resolveCodexResponsesWireModelId', () => {
  it('keeps supported direct model names unchanged', () => {
    assert.equal(resolveCodexResponsesWireModelId('gpt-5.4'), 'gpt-5.4')
    assert.equal(resolveCodexResponsesWireModelId('gpt-5.4-mini'), 'gpt-5.4-mini')
    assert.equal(resolveCodexResponsesWireModelId('gpt-5.2'), 'gpt-5.2')
  })

  it('normalizes codex-* catalog ids to codex backend model names', () => {
    assert.equal(resolveCodexResponsesWireModelId('codex-gpt-5.4'), 'gpt-5.4')
    assert.equal(resolveCodexResponsesWireModelId('codex-gpt-5.4-mini'), 'gpt-5.4-mini')
    assert.equal(resolveCodexResponsesWireModelId('codex-gpt-5.2'), 'gpt-5.2')
  })
})

describe('pickCodexStreamCompletionResult', () => {
  it('throws when stream produced no text and no tools', () => {
    assert.throws(
      () =>
        pickCodexStreamCompletionResult({
          latestResponseObj: null,
          accumulated: '  ',
          bestWithTools: null,
        }),
      /OpenAI Codex returned an empty response/
    )
  })

  it('returns accumulated text when non-empty', () => {
    const r = pickCodexStreamCompletionResult({
      latestResponseObj: null,
      accumulated: 'hello',
      bestWithTools: null,
    })
    assert.equal(r.choices[0]?.message?.content, 'hello')
  })
})

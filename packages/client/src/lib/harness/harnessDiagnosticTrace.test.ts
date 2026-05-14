import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  redactSecretsForHarnessTrace,
  prepareArgsForHarnessTrace,
  estimateWorkingChars,
  buildLlmRoundMetaTrace,
} from './harnessDiagnosticTrace'

describe('harnessDiagnosticTrace', () => {
  it('redacts sk- and Bearer patterns', () => {
    const s = redactSecretsForHarnessTrace('tok sk-abcdefghijklmnopqrstuvwxyz0123456789 done')
    assert.ok(!s.includes('sk-abc'))
    assert.ok(s.includes('REDACTED'))
    const b = redactSecretsForHarnessTrace('Authorization: Bearer xyzsecret123')
    assert.ok(b.includes('[REDACTED]'))
  })

  it('prepareArgsForHarnessTrace truncates long args', () => {
    const long = 'x'.repeat(20_000)
    const r = prepareArgsForHarnessTrace(long)
    assert.equal(r.argsTruncated, true)
    assert.ok(r.argsRedacted.length < 20_000)
  })

  it('buildLlmRoundMetaTrace builds bounded previews', () => {
    const meta = buildLlmRoundMetaTrace({
      working: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'hello' },
      ],
      provider: 'openai',
      model: 'gpt-4',
      iteration: 2,
    })
    assert.equal(meta.kind, 'llm_round_meta')
    assert.equal(meta.iteration, 2)
    assert.ok(meta.workingChars > 0)
    assert.ok(meta.systemPreview.includes('SYS'))
  })

  it('estimateWorkingChars sums message sizes', () => {
    const n = estimateWorkingChars([
      { role: 'system', content: 'ab' },
      { role: 'user', content: 'cd' },
    ])
    assert.equal(n, 4)
  })
})

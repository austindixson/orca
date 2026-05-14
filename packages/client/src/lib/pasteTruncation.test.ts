import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { truncateComposerPaste } from './pasteTruncation'

describe('truncateComposerPaste', () => {
  it('keeps short paste unchanged', () => {
    const input = 'hello\nworld'
    const out = truncateComposerPaste(input)
    assert.equal(out.truncated, false)
    assert.equal(out.text, input)
    assert.equal(out.totalLines, 2)
    assert.equal(out.keptLines, 2)
  })

  it('inserts truncation token for large paste', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line-${i + 1} ${'x'.repeat(40)}`)
    const input = lines.join('\n')
    const out = truncateComposerPaste(input)
    assert.equal(out.truncated, true)
    assert.match(out.text, /^\[TRUNCATED:/)
    assert.ok(out.text.includes('line-1'))
    assert.ok(out.text.includes('line-400'))
    assert.ok(out.keptChars <= 12000)
  })
})

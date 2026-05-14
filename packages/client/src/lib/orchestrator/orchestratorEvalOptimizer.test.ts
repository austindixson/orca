import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseEvalOptimizerJson } from './orchestratorEvalOptimizer'

describe('parseEvalOptimizerJson', () => {
  it('parses bare JSON', () => {
    const r = parseEvalOptimizerJson(
      '{"pass":true,"score":9,"critique":"ok","revised_reply":null}'
    )
    assert.deepEqual(r, {
      pass: true,
      score: 9,
      critique: 'ok',
      revised_reply: null,
    })
  })

  it('strips markdown fences', () => {
    const r = parseEvalOptimizerJson(
      '```json\n{"pass":false,"score":4,"critique":"gap","revised_reply":"Better answer here."}\n```'
    )
    assert.equal(r?.pass, false)
    assert.equal(r?.score, 4)
    assert.equal(r?.revised_reply, 'Better answer here.')
  })

  it('returns null for invalid input', () => {
    assert.equal(parseEvalOptimizerJson(''), null)
    assert.equal(parseEvalOptimizerJson('not json'), null)
    assert.equal(parseEvalOptimizerJson('{"pass":'), null)
  })

  it('clamps score to 1–10 and defaults non-string critique to empty', () => {
    const hi = parseEvalOptimizerJson('{"pass":false,"score":99,"critique":"x","revised_reply":null}')
    assert.equal(hi?.score, 10)
    const lo = parseEvalOptimizerJson('{"pass":false,"score":-3,"revised_reply":null}')
    assert.equal(lo?.score, 1)
    const badCrit = parseEvalOptimizerJson('{"pass":true,"score":8,"critique":1,"revised_reply":null}')
    assert.equal(badCrit?.critique, '')
  })
})

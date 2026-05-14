import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  applyWriteHunks,
  computeWriteHunks,
  lineStartOffset,
  parseAgentWriteStreamMeta,
  shouldAnimateWrite,
  WRITE_STREAM_MAX_CHARS,
} from './agentWriteStream'

describe('agentWriteStream', () => {
  it('computeWriteHunks: empty to hello', () => {
    const hunks = computeWriteHunks('', 'hello')
    assert.equal(hunks.length, 1)
    assert.equal(applyWriteHunks('', hunks), 'hello')
  })

  it('computeWriteHunks: single line replace', () => {
    const prev = 'a\nb\nc'
    const next = 'a\nx\nc'
    const hunks = computeWriteHunks(prev, next)
    assert.equal(applyWriteHunks(prev, hunks), next)
  })

  it('computeWriteHunks: insert line between', () => {
    const prev = 'a\nb'
    const next = 'a\nx\nb'
    const hunks = computeWriteHunks(prev, next)
    assert.equal(applyWriteHunks(prev, hunks), next)
  })

  it('lineStartOffset matches split join', () => {
    const t = 'a\nb\nc'
    const lines = t.split('\n')
    assert.equal(lineStartOffset(lines, 0), 0)
    assert.equal(lineStartOffset(lines, 1), 2)
    assert.equal(lineStartOffset(lines, 2), 4)
  })

  it('parseAgentWriteStreamMeta: valid payload', () => {
    const meta = {
      agentWriteStream: {
        token: 42,
        previous: 'a',
        next: 'b',
        hunks: [{ startOffset: 0, oldLength: 1, replacement: 'b' }],
        cps: 100,
        budgetMs: 500,
      },
    }
    const p = parseAgentWriteStreamMeta(meta)
    assert.ok(p)
    assert.equal(p!.previous, 'a')
    assert.equal(p!.next, 'b')
    assert.equal(p!.token, 42)
    assert.equal(p!.hunks.length, 1)
    assert.equal(p!.cps, 100)
    assert.equal(p!.budgetMs, 500)
  })

  it('parseAgentWriteStreamMeta: rejects missing previous/next keys', () => {
    assert.equal(
      parseAgentWriteStreamMeta({
        agentWriteStream: { token: 1, hunks: [], next: 'x' },
      }),
      null
    )
    assert.equal(
      parseAgentWriteStreamMeta({
        agentWriteStream: { token: 1, hunks: [], previous: 'x' },
      }),
      null
    )
    assert.equal(
      parseAgentWriteStreamMeta({
        agentWriteStream: {
          token: 1,
          hunks: [],
          previous: 1 as unknown as string,
          next: '',
        },
      }),
      null
    )
  })

  it('parseAgentWriteStreamMeta: rejects empty degenerate snapshot', () => {
    assert.equal(
      parseAgentWriteStreamMeta({
        agentWriteStream: { token: 1, previous: '', next: '', hunks: [] },
      }),
      null
    )
  })

  it('parseAgentWriteStreamMeta: rejects identical previous/next with no hunks', () => {
    assert.equal(
      parseAgentWriteStreamMeta({
        agentWriteStream: {
          token: 1,
          previous: '{"x":1}',
          next: '{"x":1}',
          hunks: [],
        },
      }),
      null
    )
  })

  it('parseAgentWriteStreamMeta: accepts empty file with non-empty next', () => {
    const p = parseAgentWriteStreamMeta({
      agentWriteStream: {
        token: 1,
        previous: '',
        next: '{}',
        hunks: computeWriteHunks('', '{}'),
      },
    })
    assert.ok(p)
    assert.equal(p!.next, '{}')
  })

  it('parseAgentWriteStreamMeta: defaults cps/budget when invalid', () => {
    const p = parseAgentWriteStreamMeta({
      agentWriteStream: {
        token: 1,
        previous: 'a',
        next: 'b',
        hunks: [{ startOffset: 0, oldLength: 1, replacement: 'b' }],
        cps: NaN,
        budgetMs: -1,
      },
    })
    assert.ok(p)
    assert.equal(p!.cps, 1000)
    assert.equal(p!.budgetMs, 900)
  })

  it('shouldAnimateWrite respects prefs', () => {
    const base = { orchestratorAutoFocus: true, reducedMotion: false, agentWriteStreamEnabled: true }
    assert.equal(shouldAnimateWrite('a', 'b', base), true)
    assert.equal(shouldAnimateWrite('a', 'a', base), false)
    assert.equal(shouldAnimateWrite('a', 'b', { ...base, agentWriteStreamEnabled: false }), false)
    assert.equal(shouldAnimateWrite('a', 'b', { ...base, orchestratorAutoFocus: false }), false)
    assert.equal(shouldAnimateWrite('a', 'b', { ...base, reducedMotion: true }), false)
    assert.equal(
      shouldAnimateWrite('a', 'x'.repeat(WRITE_STREAM_MAX_CHARS + 1), base),
      false
    )
  })
})

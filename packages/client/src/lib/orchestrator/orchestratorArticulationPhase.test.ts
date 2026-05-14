import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseArticulationJson } from './orchestratorArticulationPhase'
import { normalizeOrchestratorArticulationMode } from '../../store/settingsStore'

describe('parseArticulationJson', () => {
  it('parses bare JSON', () => {
    const r = parseArticulationJson(
      '{"goal":"Build a login page with OAuth.","clarifications":["Assume Next.js"]}'
    )
    assert.equal(r.goal, 'Build a login page with OAuth.')
    assert.deepEqual(r.clarifications, ['Assume Next.js'])
  })

  it('strips markdown fences', () => {
    const r = parseArticulationJson('```json\n{"goal":"x","clarifications":[]}\n```')
    assert.equal(r.goal, 'x')
    assert.deepEqual(r.clarifications, [])
  })

  it('limits clarifications to 3', () => {
    const r = parseArticulationJson('{"goal":"y","clarifications":["a","b","c","d","e"]}')
    assert.deepEqual(r.clarifications, ['a', 'b', 'c'])
  })

  it('throws on empty goal', () => {
    assert.throws(
      () => parseArticulationJson('{"goal":"","clarifications":[]}'),
      /missing non-empty/
    )
  })
})

describe('normalizeOrchestratorArticulationMode', () => {
  it('accepts valid modes', () => {
    assert.equal(normalizeOrchestratorArticulationMode('off'), 'off')
    assert.equal(normalizeOrchestratorArticulationMode('before_planning'), 'before_planning')
    assert.equal(normalizeOrchestratorArticulationMode('always'), 'always')
  })

  it('defaults invalid values', () => {
    assert.equal(normalizeOrchestratorArticulationMode(undefined), 'before_planning')
    assert.equal(normalizeOrchestratorArticulationMode(''), 'before_planning')
    assert.equal(normalizeOrchestratorArticulationMode('complex'), 'before_planning')
  })
})

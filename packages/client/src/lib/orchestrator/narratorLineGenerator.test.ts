import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildFallbackBulletsFromSeed,
  generateTemplateNarrationVariant,
  narratorTemplateSeed,
} from './narratorLineGenerator'

describe('narratorLineGenerator', () => {
  it('template fallback yields high variation count for action lines', () => {
    const base = 'I am reading package.json in the editor.'
    const variants = new Set<string>()
    for (let i = 0; i < 180; i++) {
      variants.add(generateTemplateNarrationVariant(base, narratorTemplateSeed(base, i)))
    }
    assert.ok(variants.size >= 100, `expected >=100 variants, got ${variants.size}`)
  })

  it('template fallback preserves personality lead prefix', () => {
    const base = 'Calm and clear. — I am focusing on Preview tile on “Landing page”.'
    const out = generateTemplateNarrationVariant(base, 17)
    assert.ok(out.startsWith('Calm and clear. — '))
  })

  it('buildFallbackBulletsFromSeed strips scaffold labels and dedupes primary', () => {
    const primary = 'Phase 3 · System Validation & Deployment Readiness (3 tasks)'
    const seed = `Primary\n${primary}\n\nTask\n${primary}\n\nReason\nClosing remaining validation toward readiness.`
    const out = buildFallbackBulletsFromSeed(seed, primary)
    assert.equal(out.includes('Task'), false)
    assert.equal(out.includes('Reason'), false)
    assert.equal(out.includes('…'), false)
    assert.match(out, /Closing remaining validation/)
    assert.equal(out.split('\n').filter((l) => l.includes(primary)).length, 0)
  })

  it('buildFallbackBulletsFromSeed returns two bullets when task and reason differ from primary', () => {
    const seed =
      'Task\nDoing X.\n\nReason\nBecause Y matters.'
    const out = buildFallbackBulletsFromSeed(seed, 'Some other headline')
    assert.ok(out.startsWith('- '))
    assert.ok(out.includes('\n- '))
  })
})

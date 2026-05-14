import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { _upsertLessonsSectionForTest } from './memoryDistiller'

describe('memoryDistiller', () => {
  it('upsertLessonsSection prepends new bullets after heading when section exists', () => {
    const existing = `# M\n\n## Lessons (auto-distilled)\n\n- old\n`
    const next = _upsertLessonsSectionForTest(existing, ['- one', '- two'])
    assert.ok(next.includes('## Lessons (auto-distilled)'))
    assert.ok(next.includes('- one'))
    assert.ok(next.includes('- two'))
    assert.ok(next.includes('- old'))
  })

  it('upsertLessonsSection creates section when missing', () => {
    const next = _upsertLessonsSectionForTest('hello', ['- a'])
    assert.ok(next.includes('## Lessons (auto-distilled)'))
    assert.ok(next.includes('- a'))
  })

  it('ring-trims merged lessons section to max chars', () => {
    const huge = '- x\n'.repeat(2000)
    const next = _upsertLessonsSectionForTest('', [huge])
    assert.ok(next.length <= 3000 + 200)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { _upsertUserProfileDistilledSectionForTest } from './userProfileDistiller'

describe('userProfileDistiller', () => {
  it('upsertUserProfileDistilledSection prepends new bullets when section exists', () => {
    const existing = `# U\n\n## Distilled user notes (auto)\n\n- old\n`
    const next = _upsertUserProfileDistilledSectionForTest(existing, ['- one', '- two'])
    assert.ok(next.includes('## Distilled user notes (auto)'))
    assert.ok(next.includes('- one'))
    assert.ok(next.includes('- two'))
    assert.ok(next.includes('- old'))
  })

  it('creates section when missing', () => {
    const next = _upsertUserProfileDistilledSectionForTest('hello', ['- prefers terse replies'])
    assert.ok(next.includes('## Distilled user notes (auto)'))
    assert.ok(next.includes('- prefers terse replies'))
  })
})

/**
 * Central brain path mapping.
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { workspaceRelToCentralRel, centralRelToWorkspaceRel } from './centralBrainMirror'

describe('workspaceRelToCentralRel', () => {
  test('maps Orca/brain and Orca/chat (case-insensitive)', () => {
    const id = 'abc-123'
    assert.equal(
      workspaceRelToCentralRel(id, 'Orca/brain/errors/x.md'),
      `projects/${id}/brain/errors/x.md`
    )
    assert.equal(
      workspaceRelToCentralRel(id, 'orca/brain/sessions/y.md'),
      `projects/${id}/brain/sessions/y.md`
    )
    assert.equal(
      workspaceRelToCentralRel(id, 'Orca/chat/foo.md'),
      `projects/${id}/chat/foo.md`
    )
  })

  test('returns null for unrelated paths', () => {
    assert.equal(workspaceRelToCentralRel('id', 'src/foo.md'), null)
  })
})

describe('centralRelToWorkspaceRel', () => {
  test('round-trips brain and chat', () => {
    const id = 'p1'
    const b = `projects/${id}/brain/errors/z.md`
    assert.equal(centralRelToWorkspaceRel(id, b), 'Orca/brain/errors/z.md')
    const c = `projects/${id}/chat/s.md`
    assert.equal(centralRelToWorkspaceRel(id, c), 'Orca/chat/s.md')
  })
})

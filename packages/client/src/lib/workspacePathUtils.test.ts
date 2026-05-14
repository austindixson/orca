import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { absolutePathToWorkspaceRelative } from './workspacePathUtils'

describe('absolutePathToWorkspaceRelative', () => {
  test('maps file under macOS-style root', () => {
    const r = absolutePathToWorkspaceRelative('/proj/src/a.ts', '/proj')
    assert.equal(r, 'src/a.ts')
  })

  test('returns null when not under root', () => {
    assert.equal(absolutePathToWorkspaceRelative('/other/a.ts', '/proj'), null)
  })
})

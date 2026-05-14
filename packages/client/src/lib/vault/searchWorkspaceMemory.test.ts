import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseWorkspaceMemoryScopes } from './searchWorkspaceMemory'

describe('searchWorkspaceMemory', () => {
  it('parseWorkspaceMemoryScopes filters unknown entries', () => {
    assert.deepEqual(parseWorkspaceMemoryScopes(['wiki', 'nope', 'orca_chat']), ['wiki', 'orca_chat'])
  })

  it('parseWorkspaceMemoryScopes returns undefined for empty or invalid', () => {
    assert.equal(parseWorkspaceMemoryScopes(null), undefined)
    assert.equal(parseWorkspaceMemoryScopes([]), undefined)
    assert.equal(parseWorkspaceMemoryScopes(['bad']), undefined)
  })

  it('parseWorkspaceMemoryScopes accepts all three workspace scopes', () => {
    assert.deepEqual(parseWorkspaceMemoryScopes(['wiki', 'orca_brain', 'orca_chat']), [
      'wiki',
      'orca_brain',
      'orca_chat',
    ])
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pruneCollapsedFolderIds } from './hermesLeadFolderCollapseMemory'

describe('pruneCollapsedFolderIds', () => {
  it('preserves only visible folder ids and reports when state changed', () => {
    const out = pruneCollapsedFolderIds(new Set(['fs:a', 'fs:b', 'fs:c']), new Set(['fs:a', 'fs:c']))
    assert.equal(out.changed, true)
    assert.deepEqual(Array.from(out.ids).sort(), ['fs:a', 'fs:c'])
  })

  it('keeps stable state when all ids are still visible', () => {
    const prev = new Set(['fs:a', 'fs:b'])
    const out = pruneCollapsedFolderIds(prev, new Set(['fs:a', 'fs:b', 'fs:c']))
    assert.equal(out.changed, false)
    assert.deepEqual(Array.from(out.ids).sort(), ['fs:a', 'fs:b'])
  })
})

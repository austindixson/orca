import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildDiffTileMonacoPaths } from './diffTileMonacoPaths'

describe('buildDiffTileMonacoPaths', () => {
  it('builds stable unique Monaco model paths for a diff tile', () => {
    const paths = buildDiffTileMonacoPaths('tile 123', 'src/foo bar.ts (1/3)')

    assert.equal(
      paths.originalModelPath,
      'inmemory://orca/diff/tile%20123/src%2Ffoo%20bar.ts%20(1%2F3)/original'
    )
    assert.equal(
      paths.modifiedModelPath,
      'inmemory://orca/diff/tile%20123/src%2Ffoo%20bar.ts%20(1%2F3)/modified'
    )
    assert.equal(
      paths.editorPath,
      'inmemory://orca/diff/tile%20123/src%2Ffoo%20bar.ts%20(1%2F3)/editor'
    )
    assert.notEqual(paths.originalModelPath, paths.modifiedModelPath)
    assert.notEqual(paths.modifiedModelPath, paths.editorPath)
  })

  it('falls back to safe defaults for empty values', () => {
    const paths = buildDiffTileMonacoPaths('', '')

    assert.equal(paths.originalModelPath, 'inmemory://orca/diff/unknown-tile/untitled/original')
    assert.equal(paths.modifiedModelPath, 'inmemory://orca/diff/unknown-tile/untitled/modified')
    assert.equal(paths.editorPath, 'inmemory://orca/diff/unknown-tile/untitled/editor')
  })
})

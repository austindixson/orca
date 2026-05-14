import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSerializedCanvasState, CANVAS_STATE_FILE_VERSION } from './canvasStore'

test('parseSerializedCanvasState restores spawnedByTileId, hydrationStage', () => {
  const raw = {
    version: CANVAS_STATE_FILE_VERSION,
    tiles: [
      {
        id: 't1',
        type: 'agent',
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        zIndex: 1,
        title: 'Worker',
        meta: {},
        spawnedByTileId: 'parent-1',
        hydrationStage: 'placeholder',
      },
    ],
    pan: { x: 0, y: 0 },
    zoom: 1,
    maxZIndex: 1,
    layoutAnchor: null,
    anchorTileId: null,
  }
  const snap = parseSerializedCanvasState(raw)
  assert.ok(snap)
  const t = snap!.tiles[0]!
  assert.equal(t.spawnedByTileId, 'parent-1')
  assert.equal(t.hydrationStage, 'placeholder')
})

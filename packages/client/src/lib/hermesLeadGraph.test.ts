import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildHermesLeadGraphModel } from './hermesLeadGraph'
import type { TileData } from '../store/canvasStore'
import type { FileEntry } from '../store/workspaceStore'

function tile(partial: Partial<TileData> & Pick<TileData, 'id' | 'type'>): TileData {
  return {
    id: partial.id,
    type: partial.type,
    x: 0,
    y: 0,
    w: 300,
    h: 220,
    zIndex: 1,
    title: partial.title ?? partial.type,
    meta: {},
    ...partial,
  }
}

describe('buildHermesLeadGraphModel', () => {
  it('builds Hermes root + spawn hierarchy from tiles', () => {
    const tiles = new Map<string, TileData>()
    tiles.set('orch', tile({ id: 'orch', type: 'orchestrator', title: 'Lead', tileStatus: 'working' }))
    tiles.set(
      'agent-a',
      tile({ id: 'agent-a', type: 'hermes_agent', title: 'Analyzer', spawnedByTileId: 'orch', tileStatus: 'idle' })
    )

    const model = buildHermesLeadGraphModel({ tiles, files: [], focusTileId: 'agent-a' })

    assert.ok(model.nodes.some((n) => n.id === 'hermes:lead'))
    assert.ok(model.nodes.some((n) => n.id === 'tile:orch' && n.kind === 'hermes'))
    assert.ok(model.nodes.some((n) => n.id === 'tile:agent-a' && n.kind === 'agent'))
    assert.ok(model.edges.some((e) => e.kind === 'spawn' && e.source === 'tile:orch' && e.target === 'tile:agent-a'))
    assert.ok(model.edges.some((e) => e.kind === 'focus' && e.target === 'tile:agent-a'))
  })

  it('ingests file tree with cap', () => {
    const files: FileEntry[] = [
      {
        name: 'src',
        path: 'src',
        isDirectory: true,
        children: [
          { name: 'a.ts', path: 'src/a.ts', isDirectory: false },
          { name: 'b.ts', path: 'src/b.ts', isDirectory: false },
        ],
      },
    ]

    const model = buildHermesLeadGraphModel({
      tiles: new Map(),
      files,
      maxFileNodes: 2,
    })

    const fileNodes = model.nodes.filter((n) => n.id.startsWith('fs:'))
    assert.equal(fileNodes.length, 2)
    assert.ok(model.edges.some((e) => e.kind === 'contains' && e.source === 'hermes:lead'))
  })

  it('projects recent tool names as tool nodes linked to Hermes lead', () => {
    const model = buildHermesLeadGraphModel({
      tiles: new Map(),
      files: [],
      toolNames: ['read_file', 'write_file'],
    })

    assert.ok(model.nodes.some((n) => n.id === 'tool:read_file' && n.kind === 'tool'))
    assert.ok(
      model.edges.some(
        (e) => e.id === 'tool:hermes:lead->tool:read_file' && e.kind === 'tool'
      )
    )
  })
})

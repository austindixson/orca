import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { HermesLeadEdge, HermesLeadNode } from './hermesLeadGraph'
import { projectGraphWithFileDepthLimit } from './hermesLeadFileProjection'

describe('projectGraphWithFileDepthLimit', () => {
  it('collapses deep file/folder branches beyond max depth while preserving shallow nodes', () => {
    const nodes: HermesLeadNode[] = [
      { id: 'hermes:lead', label: 'Hermes Lead', kind: 'hermes' },
      { id: 'fs:src', label: 'src', kind: 'folder', path: 'src' },
      { id: 'fs:src/components', label: 'components', kind: 'folder', path: 'src/components' },
      { id: 'fs:src/components/panels', label: 'panels', kind: 'folder', path: 'src/components/panels' },
      { id: 'fs:src/components/panels/a.tsx', label: 'a.tsx', kind: 'file', path: 'src/components/panels/a.tsx' },
      { id: 'tile:editor', label: 'Editor', kind: 'tile' },
    ]

    const edges: HermesLeadEdge[] = [
      { id: 'e1', source: 'hermes:lead', target: 'fs:src', kind: 'contains' },
      { id: 'e2', source: 'fs:src', target: 'fs:src/components', kind: 'contains' },
      { id: 'e3', source: 'fs:src/components', target: 'fs:src/components/panels', kind: 'contains' },
      { id: 'e4', source: 'fs:src/components/panels', target: 'fs:src/components/panels/a.tsx', kind: 'contains' },
      { id: 'e5', source: 'hermes:lead', target: 'tile:editor', kind: 'spawn' },
    ]

    const out = projectGraphWithFileDepthLimit({ nodes, edges, maxFileDepth: 2 })

    const ids = new Set(out.nodes.map((n) => n.id))
    assert.ok(ids.has('fs:src'))
    assert.ok(ids.has('fs:src/components'))
    assert.ok(!ids.has('fs:src/components/panels'))
    assert.ok(!ids.has('fs:src/components/panels/a.tsx'))
    assert.ok(ids.has('tile:editor'), 'non-file nodes should stay visible')

    const edgeIds = new Set(out.edges.map((e) => e.id))
    assert.ok(edgeIds.has('e1'))
    assert.ok(edgeIds.has('e2'))
    assert.ok(!edgeIds.has('e3'))
    assert.ok(!edgeIds.has('e4'))
    assert.ok(edgeIds.has('e5'))
  })

  it('supports per-folder collapse memory by pruning descendants of collapsed folders at any depth', () => {
    const nodes: HermesLeadNode[] = [
      { id: 'hermes:lead', label: 'Hermes Lead', kind: 'hermes' },
      { id: 'fs:src', label: 'src', kind: 'folder', path: 'src' },
      { id: 'fs:src/components', label: 'components', kind: 'folder', path: 'src/components' },
      { id: 'fs:src/components/panels', label: 'panels', kind: 'folder', path: 'src/components/panels' },
      { id: 'fs:src/components/panels/a.tsx', label: 'a.tsx', kind: 'file', path: 'src/components/panels/a.tsx' },
      { id: 'fs:src/components/panels/b.tsx', label: 'b.tsx', kind: 'file', path: 'src/components/panels/b.tsx' },
      { id: 'tile:editor', label: 'Editor', kind: 'tile' },
    ]

    const edges: HermesLeadEdge[] = [
      { id: 'e1', source: 'hermes:lead', target: 'fs:src', kind: 'contains' },
      { id: 'e2', source: 'fs:src', target: 'fs:src/components', kind: 'contains' },
      { id: 'e3', source: 'fs:src/components', target: 'fs:src/components/panels', kind: 'contains' },
      { id: 'e4', source: 'fs:src/components/panels', target: 'fs:src/components/panels/a.tsx', kind: 'contains' },
      { id: 'e5', source: 'fs:src/components/panels', target: 'fs:src/components/panels/b.tsx', kind: 'contains' },
      { id: 'e6', source: 'hermes:lead', target: 'tile:editor', kind: 'spawn' },
    ]

    const out = projectGraphWithFileDepthLimit({
      nodes,
      edges,
      maxFileDepth: 99,
      collapsedFolderIds: new Set(['fs:src/components']),
    })

    const ids = new Set(out.nodes.map((n) => n.id))
    assert.ok(ids.has('fs:src'))
    assert.ok(ids.has('fs:src/components'))
    assert.ok(!ids.has('fs:src/components/panels'))
    assert.ok(!ids.has('fs:src/components/panels/a.tsx'))
    assert.ok(!ids.has('fs:src/components/panels/b.tsx'))
    assert.ok(ids.has('tile:editor'))

    const edgeIds = new Set(out.edges.map((e) => e.id))
    assert.ok(edgeIds.has('e1'))
    assert.ok(edgeIds.has('e2'))
    assert.ok(!edgeIds.has('e3'))
    assert.ok(!edgeIds.has('e4'))
    assert.ok(!edgeIds.has('e5'))
    assert.ok(edgeIds.has('e6'))
  })
})

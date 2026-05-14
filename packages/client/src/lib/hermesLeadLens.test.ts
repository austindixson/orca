import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { HermesLeadGraphModel } from './hermesLeadGraph'
import { computeHermesLeadLens } from './hermesLeadLens'

function modelFixture(): HermesLeadGraphModel {
  return {
    nodes: [
      { id: 'hermes:lead', kind: 'hermes', label: 'Hermes', status: 'running' },
      { id: 'agent:planner', kind: 'agent', label: 'Planner', status: 'working' },
      { id: 'agent:writer', kind: 'agent', label: 'Writer', status: 'idle' },
      { id: 'tool:read_file', kind: 'tool', label: 'read_file', status: 'recent' },
      { id: 'tool:patch', kind: 'tool', label: 'patch', status: 'recent' },
      { id: 'fs:src', kind: 'folder', label: 'src' },
      { id: 'fs:src/a.ts', kind: 'file', label: 'a.ts' },
      { id: 'tile:orchestrator', kind: 'tile', label: 'Orchestrator', status: 'working' },
    ],
    edges: [
      { id: 'spawn:1', source: 'hermes:lead', target: 'agent:planner', kind: 'spawn' },
      { id: 'spawn:2', source: 'agent:planner', target: 'agent:writer', kind: 'spawn' },
      { id: 'focus:1', source: 'hermes:lead', target: 'tile:orchestrator', kind: 'focus' },
      { id: 'tool:1', source: 'hermes:lead', target: 'tool:read_file', kind: 'tool' },
      { id: 'tool:2', source: 'hermes:lead', target: 'tool:patch', kind: 'tool' },
    ],
  }
}

describe('computeHermesLeadLens', () => {
  it('projects intent/delegation/confidence-risk fields from runtime + graph', () => {
    const lens = computeHermesLeadLens({
      model: modelFixture(),
      running: true,
      iteration: 4,
      latestToolName: 'read_file',
      latestToolRunning: true,
      latestToolElapsedMs: 1250,
      verb: 'Reading files',
      sessionToolDepthByKey: { '__null__': 1, 'tile:orchestrator': 2 },
      toolFeed: ['→ read_file', '← read_file'],
    })

    assert.equal(lens.intent, 'Executing read_file')
    assert.equal(lens.delegationDepth, 2)
    assert.ok(lens.delegationHotspots >= 1)
    assert.ok(lens.confidence >= 0 && lens.confidence <= 1)
    assert.ok(lens.risk >= 0 && lens.risk <= 1)
    assert.ok(lens.risk > 0.2)
    assert.ok(lens.confidence > 0.4)
  })

  it('reduces risk and raises confidence when orchestration is idle and shallow', () => {
    const active = computeHermesLeadLens({
      model: modelFixture(),
      running: true,
      iteration: 5,
      latestToolName: 'patch',
      latestToolRunning: true,
      latestToolElapsedMs: 2400,
      verb: 'Applying patch',
      sessionToolDepthByKey: { '__null__': 3 },
      toolFeed: ['→ patch'],
    })

    const idle = computeHermesLeadLens({
      model: modelFixture(),
      running: false,
      iteration: 0,
      latestToolName: null,
      latestToolRunning: false,
      latestToolElapsedMs: 0,
      verb: 'Ready',
      sessionToolDepthByKey: {},
      toolFeed: [],
    })

    assert.ok(idle.risk < active.risk)
    assert.ok(idle.confidence >= active.confidence)
  })
})

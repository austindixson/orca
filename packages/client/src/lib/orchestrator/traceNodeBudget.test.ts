import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DelegatedTraceChip } from './delegatedLogPresentation'
import {
  applyTraceNodeBudget,
  inferTraceNodeCategory,
  inferTraceNodeState,
  type TraceCanvasNode,
} from './traceNodeBudget'

function makeNode(id: string, chip: DelegatedTraceChip, lastSeenAt: number): TraceCanvasNode {
  return {
    id,
    chip,
    state: inferTraceNodeState(chip),
    category: inferTraceNodeCategory(chip),
    firstSeenAt: lastSeenAt - 50,
    lastSeenAt,
  }
}

describe('traceNodeBudget', () => {
  it('caps visible nodes and reports collapsed overflow', () => {
    const base = 1000
    const nodes = Array.from({ length: 6 }, (_, i) =>
      makeNode(
        `n${i}`,
        { id: `c${i}`, kind: 'call', name: `read_file_${i}` },
        base + i * 10
      )
    )

    const out = applyTraceNodeBudget({
      nodes,
      nowMs: base + 100,
      maxNodes: 3,
      ttlMs: 10_000,
      minFrameMs: 16,
      lastFrameAtMs: null,
    })

    assert.deepEqual(
      out.visibleNodes.map((n) => n.id),
      ['n3', 'n4', 'n5'],
      'newest nodes should survive cap'
    )
    assert.equal(out.capCollapsedCount, 3)
    assert.equal(out.ttlCollapsedCount, 0)
    assert.equal(out.hiddenCount, 3)
    assert.equal(out.throttled, false)
  })

  it('collapses stale terminal states but keeps active running nodes', () => {
    const nowMs = 20_000
    const nodes: TraceCanvasNode[] = [
      makeNode('queued', { id: 'queued', kind: 'info', name: 'plan step', state: 'queued' }, 1_000),
      makeNode('running', { id: 'running', kind: 'call', name: 'terminal', state: 'running' }, 1_200),
      makeNode('success', { id: 'success', kind: 'result', name: 'grep done', state: 'success' }, 1_100),
      makeNode('error', { id: 'error', kind: 'result', name: 'patch failed', state: 'error' }, 1_150),
    ]

    const out = applyTraceNodeBudget({
      nodes,
      nowMs,
      maxNodes: 10,
      ttlMs: 5_000,
      minFrameMs: 16,
      lastFrameAtMs: null,
    })

    assert.deepEqual(
      out.visibleNodes.map((n) => n.id),
      ['queued', 'running'],
      'queued/running should survive TTL; settled stale states collapse'
    )
    assert.equal(out.ttlCollapsedCount, 2)
    assert.equal(out.capCollapsedCount, 0)
  })

  it('marks updates as throttled when frame delta is below threshold', () => {
    const node = makeNode('n1', { id: 'c1', kind: 'call', name: 'search_files' }, 1_000)
    const out = applyTraceNodeBudget({
      nodes: [node],
      nowMs: 1_030,
      maxNodes: 5,
      ttlMs: 5_000,
      minFrameMs: 48,
      lastFrameAtMs: 1_000,
    })

    assert.equal(out.throttled, true)
    assert.equal(out.nextFrameAtMs, 1_000)
  })

  it('infers state and category from chips', () => {
    assert.equal(inferTraceNodeState({ id: 'a', kind: 'call', name: 'read_file' }), 'running')
    assert.equal(inferTraceNodeState({ id: 'b', kind: 'result', name: 'patch failed' }), 'error')
    assert.equal(inferTraceNodeCategory({ id: 'c', kind: 'call', name: 'search_files' }), 'search')
    assert.equal(inferTraceNodeCategory({ id: 'd', kind: 'result', name: 'terminal' }), 'exec')
  })
})

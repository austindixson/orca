/**
 * Run: pnpm exec node --import tsx/esm --test src/store/mergeReviewStore.test.ts
 */
import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

{
  const store: Record<string, string> = {}
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length
    },
  } satisfies Storage
}

const { useMergeReviewStore, MERGE_REVIEW_TICKETS_MAX } = await import('./mergeReviewStore')
const { executeOrchestratorTool } = await import('../lib/orchestrator/executeTools')

describe('mergeReviewStore', () => {
  beforeEach(() => {
    localStorage.removeItem('orca-merge-reviews')
    useMergeReviewStore.setState({ tickets: [] })
  })

  test('enqueueMergeReview appends ticket and returns id', () => {
    const id = useMergeReviewStore.getState().enqueueMergeReview({
      id: 'ticket-1',
      agentTileId: 'agent-tile-a',
      notes: 'Done with feature X',
    })
    assert.equal(id, 'ticket-1')
    const tickets = useMergeReviewStore.getState().tickets
    assert.equal(tickets.length, 1)
    assert.equal(tickets[0].status, 'pending')
    assert.equal(tickets[0].notes, 'Done with feature X')
  })

  test('setMergeReviewStatus updates status', () => {
    useMergeReviewStore.getState().enqueueMergeReview({
      id: 't2',
      agentTileId: 'x',
      notes: '',
    })
    useMergeReviewStore.getState().setMergeReviewStatus('t2', 'approved')
    assert.equal(useMergeReviewStore.getState().tickets[0].status, 'approved')
  })

  test('mergeReviewQueueSnapshot returns copy', () => {
    useMergeReviewStore.getState().enqueueMergeReview({
      id: 't3',
      agentTileId: 'y',
      notes: 'n',
    })
    const a = useMergeReviewStore.getState().mergeReviewQueueSnapshot()
    const b = useMergeReviewStore.getState().mergeReviewQueueSnapshot()
    assert.notStrictEqual(a, b)
    assert.deepEqual(a, b)
  })

  test('caps at MERGE_REVIEW_TICKETS_MAX (keeps newest)', () => {
    for (let i = 0; i < MERGE_REVIEW_TICKETS_MAX + 5; i++) {
      useMergeReviewStore.getState().enqueueMergeReview({
        id: `id-${i}`,
        agentTileId: 'a',
        notes: String(i),
      })
    }
    const tickets = useMergeReviewStore.getState().tickets
    assert.equal(tickets.length, MERGE_REVIEW_TICKETS_MAX)
    assert.equal(tickets[0].id, 'id-5')
    assert.equal(tickets[tickets.length - 1].id, `id-${MERGE_REVIEW_TICKETS_MAX + 4}`)
  })
})

describe('list_merge_review_tickets tool', () => {
  beforeEach(() => {
    localStorage.removeItem('orca-merge-reviews')
    useMergeReviewStore.setState({ tickets: [] })
  })

  test('executeOrchestratorTool returns tickets array', async () => {
    useMergeReviewStore.getState().enqueueMergeReview({
      id: 'mr-99',
      agentTileId: 'tile-z',
      notes: 'handoff summary',
    })
    const raw = await executeOrchestratorTool('list_merge_review_tickets', '{}', {
      orchestratorTileId: null,
    })
    const j = JSON.parse(raw) as {
      ok?: boolean
      tickets?: Array<{ id: string; agent_tile_id: string; status: string; notes_preview: string }>
    }
    assert.equal(j.ok, true)
    assert.equal(j.tickets?.length, 1)
    assert.equal(j.tickets?.[0].id, 'mr-99')
    assert.equal(j.tickets?.[0].agent_tile_id, 'tile-z')
    assert.ok(j.tickets?.[0].notes_preview?.includes('handoff'))
  })
})

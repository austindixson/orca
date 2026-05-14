import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { useBugBountyStore } from './bugBountyStore'

describe('bugBountyStore', () => {
  beforeEach(() => {
    useBugBountyStore.getState().clearAll()
  })

  it('new terminal errors land on the board as queued with count=1', () => {
    const id = useBugBountyStore.getState().addBounty({
      title: 'foo',
      summary: 'bar',
      severity: 'high',
      sourceKind: 'terminal',
      sourceTileId: 'tile-1',
      sourceSignature: 'sig-a',
    })
    const item = useBugBountyStore.getState().items.find((x) => x.id === id)!
    assert.equal(item.status, 'queued')
    assert.equal(item.occurrenceCount, 1)
    assert.equal(item.sourceKind, 'terminal')
  })

  it('dedupes by signature within the same source tile', () => {
    const a = useBugBountyStore.getState().addBounty({
      title: 'foo',
      summary: 'bar',
      severity: 'medium',
      sourceKind: 'terminal',
      sourceTileId: 'tile-1',
      sourceSignature: 'sig-a',
    })
    const b = useBugBountyStore.getState().addBounty({
      title: 'foo',
      summary: 'bar',
      severity: 'medium',
      sourceKind: 'terminal',
      sourceTileId: 'tile-1',
      sourceSignature: 'sig-a',
    })
    assert.equal(a, b, 'same signature/tile dedupes into the existing bounty')
    assert.equal(useBugBountyStore.getState().items.length, 1)
    const item = useBugBountyStore.getState().items[0]
    assert.equal(item.occurrenceCount, 2)
  })

  it('dedupe escalates severity toward the more severe class', () => {
    useBugBountyStore.getState().addBounty({
      title: 'foo',
      summary: 'bar',
      severity: 'medium',
      sourceSignature: 'sig-b',
      sourceTileId: 't',
    })
    useBugBountyStore.getState().addBounty({
      title: 'foo',
      summary: 'bar',
      severity: 'critical',
      sourceSignature: 'sig-b',
      sourceTileId: 't',
    })
    assert.equal(useBugBountyStore.getState().items.length, 1)
    assert.equal(useBugBountyStore.getState().items[0].severity, 'critical')
  })

  it('resolved bounties do not dedupe — new occurrence spawns a fresh item', () => {
    const first = useBugBountyStore.getState().addBounty({
      title: 'foo',
      summary: 'bar',
      severity: 'high',
      sourceSignature: 'sig-c',
      sourceTileId: 't',
    })
    useBugBountyStore.getState().patchBounty(first, { status: 'resolved' })
    const second = useBugBountyStore.getState().addBounty({
      title: 'foo',
      summary: 'bar',
      severity: 'high',
      sourceSignature: 'sig-c',
      sourceTileId: 't',
    })
    assert.notEqual(first, second)
    assert.equal(useBugBountyStore.getState().items.length, 2)
  })

  it('pickNextQueued returns the highest-severity queued bounty without a hunter', () => {
    const low = useBugBountyStore
      .getState()
      .addBounty({ title: 'low', summary: '', severity: 'low' })
    const crit = useBugBountyStore
      .getState()
      .addBounty({ title: 'crit', summary: '', severity: 'critical' })
    const med = useBugBountyStore
      .getState()
      .addBounty({ title: 'med', summary: '', severity: 'medium' })
    // Assign a hunter to crit — next pick should skip it.
    useBugBountyStore.getState().patchBounty(crit, {
      delegatedSubAgentTileId: 'agent-1',
      status: 'investigating',
    })
    const next = useBugBountyStore.getState().pickNextQueued()
    assert.ok(next, 'expected a next queued bounty')
    assert.equal(next!.id, med, 'medium should outrank low')
    // Resolve med — next pick should move to low.
    useBugBountyStore.getState().patchBounty(med, { status: 'resolved' })
    const after = useBugBountyStore.getState().pickNextQueued()
    assert.equal(after?.id, low)
  })

  it('countOpen / countInvestigating reflect lifecycle', () => {
    const a = useBugBountyStore
      .getState()
      .addBounty({ title: 'a', summary: '', severity: 'high' })
    useBugBountyStore
      .getState()
      .addBounty({ title: 'b', summary: '', severity: 'low' })
    useBugBountyStore.getState().patchBounty(a, {
      status: 'investigating',
      delegatedSubAgentTileId: 'agent-1',
    })
    assert.equal(useBugBountyStore.getState().countOpen(), 2)
    assert.equal(useBugBountyStore.getState().countInvestigating(), 1)
    useBugBountyStore.getState().dismissBounty(a)
    assert.equal(useBugBountyStore.getState().countOpen(), 1)
    assert.equal(useBugBountyStore.getState().countInvestigating(), 0)
  })
})

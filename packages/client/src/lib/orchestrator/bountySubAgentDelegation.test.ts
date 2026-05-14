import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildBountyDelegationTask } from './bountySubAgentDelegation'

describe('bountySubAgentDelegation', () => {
  it('buildBountyDelegationTask bakes the 300 IQ troubleshooter methodology', () => {
    const now = Date.now()
    const t = buildBountyDelegationTask({
      id: 'x',
      title: 'Leak in auth',
      summary: 'Token exposed',
      severity: 'critical',
      sourceIssueId: 'issue-1',
      sourceKind: 'terminal',
      sourceTileId: 'tile-42',
      sourceSignature: 'unhandled:foo',
      samplePayload: '[error] token leaked to stdout',
      occurrenceCount: 3,
      firstSeenAt: now,
      lastSeenAt: now,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    assert.match(t, /Leak in auth/)
    assert.match(t, /issue-1/)
    assert.match(t, /terminal/)
    assert.match(t, /tile-42/)
    assert.match(t, /unhandled:foo/)
    assert.match(t, /3× occurrences/)
    assert.match(t, /token leaked to stdout/)
    assert.match(t, /40-year senior software engineer/)
    assert.match(t, /300 IQ/)
    assert.match(t, /Methodology/)
    assert.match(t, /Reproduce first/)
    assert.match(t, /Falsifiable hypothesis|falsifiable hypothesis/)
    assert.match(t, /Fix the root/)
    assert.match(t, /Error recovery/)
  })

  it('falls back gracefully with no source metadata', () => {
    const now = Date.now()
    const t = buildBountyDelegationTask({
      id: 'y',
      title: 'Something odd',
      summary: 'unknown',
      severity: 'low',
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    assert.match(t, /Something odd/)
    assert.match(t, /\(no upstream link\)/)
    assert.doesNotMatch(t, /Raw sample from origin/)
  })
})

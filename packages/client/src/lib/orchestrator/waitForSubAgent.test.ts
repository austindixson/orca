/**
 * Tests for the `wait_for_sub_agent` orchestrator tool — true synchronous
 * await over the fire-and-forget `spawn_sub_agent`. Exercises:
 *   1. Returns immediately when the target sub-agent is already terminal.
 *   2. Blocks until the sub-agent transitions to `done` and returns the summary.
 *   3. Honors the parent run's AbortSignal (orchestrator Stop) with outcome:"cancelled".
 *   4. Errors cleanly when the tile_id is unknown or missing.
 *
 * These tests drive `useAgentTeamStore` directly rather than spawning a real
 * run, so they're hermetic and fast — same pattern as
 * `executeToolsWorktreePath.test.ts`.
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { executeOrchestratorTool } from './executeTools'
import { useAgentTeamStore } from '../../store/agentTeamStore'

describe('wait_for_sub_agent', () => {
  let prevMembers: Record<string, ReturnType<typeof useAgentTeamStore.getState>['membersByTileId'][string]>

  beforeEach(() => {
    prevMembers = useAgentTeamStore.getState().membersByTileId
    useAgentTeamStore.setState({ membersByTileId: {} })
  })

  afterEach(() => {
    useAgentTeamStore.setState({ membersByTileId: prevMembers })
  })

  it('errors when tile_id is missing', async () => {
    const raw = await executeOrchestratorTool('wait_for_sub_agent', '{}', {
      orchestratorTileId: null,
    })
    const out = JSON.parse(raw)
    assert.equal(out.ok, false)
    assert.match(String(out.error), /tile_id required/)
  })

  it('errors when tile_id does not match a registered sub-agent', async () => {
    const raw = await executeOrchestratorTool(
      'wait_for_sub_agent',
      JSON.stringify({ tile_id: 'tile-nope' }),
      { orchestratorTileId: null }
    )
    const out = JSON.parse(raw)
    assert.equal(out.ok, false)
    assert.match(String(out.error), /No sub-agent found/)
  })

  it('returns immediately when the sub-agent is already done', async () => {
    useAgentTeamStore.getState().registerMember({
      tileId: 'tile-fast',
      displayName: 'Hermes',
      role: 'Hermes gateway worker',
      currentTask: 'Done',
      status: 'done',
    })
    useAgentTeamStore.getState().patchMember('tile-fast', {
      status: 'done',
      lastSummary: 'All green.',
    })
    const raw = await executeOrchestratorTool(
      'wait_for_sub_agent',
      JSON.stringify({ tile_id: 'tile-fast' }),
      { orchestratorTileId: null }
    )
    const out = JSON.parse(raw)
    assert.equal(out.ok, true)
    assert.equal(out.outcome, 'done')
    assert.equal(out.summary, 'All green.')
    assert.equal(out.tile_id, 'tile-fast')
  })

  it('blocks until the sub-agent transitions to done, then returns the summary', async () => {
    useAgentTeamStore.getState().registerMember({
      tileId: 'tile-slow',
      displayName: 'Sora',
      role: 'Research',
      currentTask: 'Searching…',
      status: 'working',
    })
    // Flip the store to `done` after the tool call has started waiting.
    const flipTimer = setTimeout(() => {
      useAgentTeamStore.getState().patchMember('tile-slow', {
        status: 'done',
        lastSummary: 'Found the answer: 42.',
      })
    }, 25)
    try {
      const raw = await executeOrchestratorTool(
        'wait_for_sub_agent',
        JSON.stringify({ tile_id: 'tile-slow', timeout_ms: 5_000 }),
        { orchestratorTileId: null }
      )
      const out = JSON.parse(raw)
      assert.equal(out.ok, true)
      assert.equal(out.outcome, 'done')
      assert.equal(out.summary, 'Found the answer: 42.')
    } finally {
      clearTimeout(flipTimer)
    }
  })

  it('returns outcome:"error" when the sub-agent fails', async () => {
    useAgentTeamStore.getState().registerMember({
      tileId: 'tile-fail',
      displayName: 'Mei',
      role: 'Coding',
      currentTask: 'Build…',
      status: 'working',
    })
    setTimeout(() => {
      useAgentTeamStore.getState().patchMember('tile-fail', {
        status: 'error',
        error: 'compile failed',
      })
    }, 25)
    const raw = await executeOrchestratorTool(
      'wait_for_sub_agent',
      JSON.stringify({ tile_id: 'tile-fail', timeout_ms: 5_000 }),
      { orchestratorTileId: null }
    )
    const out = JSON.parse(raw)
    assert.equal(out.ok, true)
    assert.equal(out.outcome, 'error')
    assert.equal(out.error, 'compile failed')
  })

  it('honors the parent AbortSignal and returns outcome:"cancelled"', async () => {
    useAgentTeamStore.getState().registerMember({
      tileId: 'tile-cancel',
      displayName: 'Hermes',
      role: 'Hermes gateway worker',
      currentTask: 'Working…',
      status: 'working',
    })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 25)
    const raw = await executeOrchestratorTool(
      'wait_for_sub_agent',
      JSON.stringify({ tile_id: 'tile-cancel', timeout_ms: 5_000 }),
      { orchestratorTileId: null, signal: ac.signal }
    )
    const out = JSON.parse(raw)
    assert.equal(out.ok, true)
    assert.equal(out.outcome, 'cancelled')
  })

  it('returns outcome:"cancelled" immediately when the parent signal is already aborted', async () => {
    useAgentTeamStore.getState().registerMember({
      tileId: 'tile-pre-aborted',
      displayName: 'Hermes',
      role: 'Hermes gateway worker',
      currentTask: 'Working…',
      status: 'working',
    })
    const ac = new AbortController()
    ac.abort()
    const raw = await executeOrchestratorTool(
      'wait_for_sub_agent',
      JSON.stringify({ tile_id: 'tile-pre-aborted', timeout_ms: 5_000 }),
      { orchestratorTileId: null, signal: ac.signal }
    )
    const out = JSON.parse(raw)
    assert.equal(out.ok, true)
    assert.equal(out.outcome, 'cancelled')
    assert.match(String(out.error), /aborted/i)
  })

  it('returns immediately when the sub-agent is already needs_review (handoff complete)', async () => {
    useAgentTeamStore.getState().registerMember({
      tileId: 'tile-review',
      displayName: 'Hunter',
      role: 'Bounty',
      currentTask: 'Needs review',
      status: 'needs_review',
    })
    useAgentTeamStore.getState().patchMember('tile-review', {
      status: 'needs_review',
      lastSummary: 'Needs terminal proof.',
    })
    const raw = await executeOrchestratorTool(
      'wait_for_sub_agent',
      JSON.stringify({ tile_id: 'tile-review' }),
      { orchestratorTileId: null }
    )
    const out = JSON.parse(raw)
    assert.equal(out.ok, true)
    assert.equal(out.outcome, 'done')
    assert.match(String(out.summary), /terminal proof/i)
  })

  it('returns outcome:"timeout" when the sub-agent does not finish in time', async () => {
    useAgentTeamStore.getState().registerMember({
      tileId: 'tile-timeout',
      displayName: 'Sora',
      role: 'Research',
      currentTask: 'Searching…',
      status: 'working',
    })
    const raw = await executeOrchestratorTool(
      'wait_for_sub_agent',
      // 1000ms is the hard floor enforced by the executor — anything below
      // clamps up. We keep it short so the suite stays fast.
      JSON.stringify({ tile_id: 'tile-timeout', timeout_ms: 1_000 }),
      { orchestratorTileId: null }
    )
    const out = JSON.parse(raw)
    assert.equal(out.ok, true)
    assert.equal(out.outcome, 'timeout')
    assert.match(String(out.error), /timed out/)
  })
})

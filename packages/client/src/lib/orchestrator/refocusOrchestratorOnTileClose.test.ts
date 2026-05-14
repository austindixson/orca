import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { refocusOrchestratorIfClosedTileWasActive } from './refocusOrchestratorOnTileClose'

describe('refocusOrchestratorIfClosedTileWasActive', () => {
  let prev: Pick<
    ReturnType<typeof useOrchestratorActivityStore.getState>,
    'autoFocusHighlight' | 'agentTileFocus' | 'lastOrchestratorTileId'
  >

  beforeEach(() => {
    const s = useOrchestratorActivityStore.getState()
    prev = {
      autoFocusHighlight: s.autoFocusHighlight,
      agentTileFocus: s.agentTileFocus,
      lastOrchestratorTileId: s.lastOrchestratorTileId,
    }
    s.setAutoFocusHighlight(null)
    s.setAgentTileFocus(null)
    useOrchestratorActivityStore.setState({ lastOrchestratorTileId: null })
  })

  afterEach(() => {
    useOrchestratorActivityStore.setState({
      autoFocusHighlight: prev.autoFocusHighlight,
      agentTileFocus: prev.agentTileFocus,
      lastOrchestratorTileId: prev.lastOrchestratorTileId,
    })
  })

  it('clears autoFocusHighlight when the removed id matches', () => {
    useOrchestratorActivityStore.getState().setAutoFocusHighlight({
      tileId: 't-highlight',
      label: 'Reading…',
      effect: 'pulse',
    })
    refocusOrchestratorIfClosedTileWasActive('t-highlight')
    assert.equal(useOrchestratorActivityStore.getState().autoFocusHighlight, null)
  })

  it('clears agentTileFocus when the removed id matches', () => {
    useOrchestratorActivityStore.getState().setAgentTileFocus({
      tileId: 't-agent',
      tileType: 'editor',
      action: 'reading',
      progress: 0,
    })
    refocusOrchestratorIfClosedTileWasActive('t-agent')
    assert.equal(useOrchestratorActivityStore.getState().agentTileFocus, null)
  })

  it('clears lastOrchestratorTileId when the removed id matches', () => {
    useOrchestratorActivityStore.setState({ lastOrchestratorTileId: 't-last' })
    refocusOrchestratorIfClosedTileWasActive('t-last')
    assert.equal(useOrchestratorActivityStore.getState().lastOrchestratorTileId, null)
  })

  it('is a no-op when the removed id is not a focus target', () => {
    useOrchestratorActivityStore.getState().setAutoFocusHighlight({
      tileId: 'keep-me',
      label: 'X',
      effect: 'shimmer',
    })
    refocusOrchestratorIfClosedTileWasActive('other-tile')
    assert.equal(
      useOrchestratorActivityStore.getState().autoFocusHighlight?.tileId,
      'keep-me'
    )
  })
})

import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { resolvePathForOrchestratorTool } from './executeTools'
import { useCanvasStore, type TileData } from '../../store/canvasStore'

describe('resolvePathForOrchestratorTool', () => {
  const subId = 'tile-sub-1'
  let prevTiles: Map<string, TileData>

  beforeEach(() => {
    const st = useCanvasStore.getState()
    prevTiles = new Map(st.tiles)
    const m = new Map(st.tiles)
    m.set(subId, {
      id: subId,
      type: 'agent',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      zIndex: 1,
      title: 'Sub',
      meta: { isolatedWorktreeRelative: '.orca/worktrees/wt-a' },
    })
    useCanvasStore.setState({ tiles: m })
  })

  afterEach(() => {
    useCanvasStore.setState({ tiles: prevTiles })
  })

  it('leaves paths unchanged without subAgentTileId', () => {
    assert.deepEqual(resolvePathForOrchestratorTool({ orchestratorTileId: null }, 'src/a.ts'), {
      resolved: 'src/a.ts',
      worktreeRelative: null,
    })
  })

  it('preserves absolute path inputs so validators can reject them', () => {
    assert.deepEqual(resolvePathForOrchestratorTool({ orchestratorTileId: null }, '/Users/ghost/Desktop/orca'), {
      resolved: '/Users/ghost/Desktop/orca',
      worktreeRelative: null,
    })
  })

  it('prefixes paths when sub-agent tile has isolatedWorktreeRelative', () => {
    assert.deepEqual(
      resolvePathForOrchestratorTool({ orchestratorTileId: null, subAgentTileId: subId }, 'src/a.ts'),
      {
        resolved: '.orca/worktrees/wt-a/src/a.ts',
        worktreeRelative: '.orca/worktrees/wt-a',
      }
    )
  })

  it('maps list_directory root "." to worktree folder', () => {
    assert.deepEqual(
      resolvePathForOrchestratorTool({ orchestratorTileId: null, subAgentTileId: subId }, '.'),
      {
        resolved: '.orca/worktrees/wt-a',
        worktreeRelative: '.orca/worktrees/wt-a',
      }
    )
  })

  it('does not prefix absolute paths inside sub-agents', () => {
    assert.deepEqual(
      resolvePathForOrchestratorTool({ orchestratorTileId: null, subAgentTileId: subId }, '/tmp/outside'),
      {
        resolved: '/tmp/outside',
        worktreeRelative: '.orca/worktrees/wt-a',
      }
    )
  })
})

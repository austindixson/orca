import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AMBIGUOUS_AGENT_BROWSER_TILE,
  NO_AGENT_BROWSER_TILE,
  resolveAgentBrowserTileForTools,
} from './agentBrowserTileResolve'
import type { TileData } from '../../store/canvasStore'

function tile(id: string, type: TileData['type']): TileData {
  return {
    id,
    type,
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    zIndex: 1,
    title: 't',
    meta: {},
  }
}

test('resolves explicit tile_id for agent_browser', () => {
  const tiles = new Map<string, TileData>([
    ['a', tile('a', 'agent_browser')],
    ['b', tile('b', 'terminal')],
  ])
  const r = resolveAgentBrowserTileForTools(tiles, { tile_id: 'a' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.tile.id, 'a')
})

test('rejects tile_id that is not agent_browser', () => {
  const tiles = new Map<string, TileData>([['b', tile('b', 'terminal')]])
  const r = resolveAgentBrowserTileForTools(tiles, { tile_id: 'b' })
  assert.equal(r.ok, false)
})

test('no agent_browser tiles', () => {
  const tiles = new Map<string, TileData>([['b', tile('b', 'terminal')]])
  const r = resolveAgentBrowserTileForTools(tiles, {})
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error, NO_AGENT_BROWSER_TILE)
})

test('ambiguous when multiple agent_browser and no tile_id', () => {
  const tiles = new Map<string, TileData>([
    ['a', tile('a', 'agent_browser')],
    ['c', tile('c', 'agent_browser')],
  ])
  const r = resolveAgentBrowserTileForTools(tiles, {})
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error, AMBIGUOUS_AGENT_BROWSER_TILE)
})

test('single agent_browser without tile_id', () => {
  const tiles = new Map<string, TileData>([
    ['a', tile('a', 'agent_browser')],
    ['b', tile('b', 'terminal')],
  ])
  const r = resolveAgentBrowserTileForTools(tiles, {})
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.tile.id, 'a')
})

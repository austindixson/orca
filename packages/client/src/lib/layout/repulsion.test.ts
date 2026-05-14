import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TileData } from '../../store/canvasStore'
import {
  resolveOverlapsAround,
  TILE_MAX_CLUSTER_GAP,
  TILE_MIN_GAP,
} from './repulsion'

function tile(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  type: TileData['type'] = 'browser'
): TileData {
  return {
    id,
    type,
    x,
    y,
    w,
    h,
    zIndex: 1,
    title: '',
    meta: {},
  }
}

function mapOf(...tiles: TileData[]): Map<string, TileData> {
  const m = new Map<string, TileData>()
  for (const t of tiles) m.set(t.id, t)
  return m
}

describe('resolveOverlapsAround', () => {
  it('pushes an overlapping tile away on the shallow axis (horizontal two-tile push)', () => {
    const a = tile('a', 0, 0, 100, 100)
    const b = tile('b', 50, 0, 100, 100)
    const tiles = mapOf(a, b)
    const updates = resolveOverlapsAround(tiles, 'a', { padding: 12 })
    const moved = updates.find((u) => u.id === 'b')
    assert.ok(moved)
    assert.equal(moved!.x, 50 + 50 + 12)
    assert.equal(moved!.y, 0)
  })

  it('cascades: pushing B may push C when C overlaps B', () => {
    const a = tile('a', 0, 0, 100, 100)
    const b = tile('b', 90, 0, 100, 100)
    const c = tile('c', 180, 0, 100, 100)
    const tiles = mapOf(a, b, c)
    const updates = resolveOverlapsAround(tiles, 'a', { padding: 12 })
    const bUp = updates.find((u) => u.id === 'b')
    const cUp = updates.find((u) => u.id === 'c')
    assert.ok(bUp)
    assert.ok(cUp)
    assert.equal(bUp!.x, 90 + 10 + 12)
    assert.equal(cUp!.x, 180 + 32 + 12)
  })

  it('clamps pushed tile into viewport when horizontal push would overflow', () => {
    const a = tile('a', 350, 0, 100, 100)
    const b = tile('b', 350, 0, 100, 100)
    const tiles = mapOf(a, b)
    const viewport = { x: 0, y: 0, w: 400, h: 400 }
    const updates = resolveOverlapsAround(tiles, 'a', { padding: 12, viewport })
    const moved = updates.find((u) => u.id === 'b')
    assert.ok(moved)
    assert.equal(moved!.x + moved!.w, viewport.x + viewport.w)
  })

  it('does not move tiles listed in frozenIds', () => {
    const a = tile('a', 0, 0, 100, 100)
    const b = tile('b', 50, 0, 100, 100)
    const tiles = mapOf(a, b)
    const updates = resolveOverlapsAround(tiles, 'a', {
      padding: 12,
      frozenIds: new Set(['b']),
    })
    assert.equal(updates.length, 0)
  })

  it('moves non-frozen overlapper when root overlaps it (drop simulation: root frozen)', () => {
    const dropped = tile('dropped', 0, 0, 100, 100)
    const neighbour = tile('n', 50, 0, 100, 100)
    const tiles = mapOf(dropped, neighbour)
    const updates = resolveOverlapsAround(tiles, 'dropped', {
      padding: 12,
      frozenIds: new Set(['dropped']),
    })
    const moved = updates.find((u) => u.id === 'n')
    assert.ok(moved)
    assert.equal(moved!.x, 50 + 50 + 12)
  })

  it('default padding keeps tiles ≥ TILE_MIN_GAP and ≤ TILE_MAX_CLUSTER_GAP from pusher', () => {
    const a = tile('a', 0, 0, 100, 100)
    const b = tile('b', 50, 0, 100, 100)
    const tiles = mapOf(a, b)
    const updates = resolveOverlapsAround(tiles, 'a')
    const moved = updates.find((u) => u.id === 'b')
    assert.ok(moved)
    const gap = moved!.x - (a.x + a.w)
    assert.ok(gap >= TILE_MIN_GAP, `gap ${gap} should be ≥ ${TILE_MIN_GAP}`)
    assert.ok(
      gap <= TILE_MAX_CLUSTER_GAP,
      `gap ${gap} should be ≤ ${TILE_MAX_CLUSTER_GAP} to keep tiles clustered`
    )
    assert.equal(gap, TILE_MIN_GAP)
  })

  it('cascade preserves TILE_MIN_GAP clearance between every adjacent pair', () => {
    const a = tile('a', 0, 0, 100, 100)
    const b = tile('b', 90, 0, 100, 100)
    const c = tile('c', 180, 0, 100, 100)
    const tiles = mapOf(a, b, c)
    const updates = resolveOverlapsAround(tiles, 'a')
    const bUp = updates.find((u) => u.id === 'b')
    const cUp = updates.find((u) => u.id === 'c')
    assert.ok(bUp)
    assert.ok(cUp)
    const abGap = bUp!.x - (a.x + a.w)
    const bcGap = cUp!.x - (bUp!.x + bUp!.w)
    assert.ok(abGap >= TILE_MIN_GAP)
    assert.ok(bcGap >= TILE_MIN_GAP)
    assert.ok(abGap <= TILE_MAX_CLUSTER_GAP)
    assert.ok(bcGap <= TILE_MAX_CLUSTER_GAP)
  })
})

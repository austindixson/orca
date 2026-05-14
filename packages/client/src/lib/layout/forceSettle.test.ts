import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TileData } from '../../store/canvasStore'
import { forceSettle } from './forceSettle'

function tile(
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 100,
  type: TileData['type'] = 'browser'
): TileData {
  return { id, type, x, y, w, h, zIndex: 1, title: '', meta: {} }
}

function mapOf(...tiles: TileData[]): Map<string, TileData> {
  const m = new Map<string, TileData>()
  for (const t of tiles) m.set(t.id, t)
  return m
}

function rectsOverlap(a: TileData, b: TileData, pad = 0): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ox + pad > 0 && oy + pad > 0
}

describe('forceSettle', () => {
  it('returns no updates when strength <= 0', () => {
    const tiles = mapOf(tile('a', 0, 0), tile('b', 50, 0))
    const updates = forceSettle(tiles, { strength: 0 })
    assert.deepEqual(updates, [])
  })

  it('returns no updates when tiles do not overlap', () => {
    const tiles = mapOf(tile('a', 0, 0), tile('b', 500, 500))
    const updates = forceSettle(tiles, { strength: 1 })
    assert.deepEqual(updates, [])
  })

  it('separates overlapping tiles so they no longer intersect (convergence)', () => {
    const a = tile('a', 0, 0)
    const b = tile('b', 30, 0)
    const tiles = mapOf(a, b)
    assert.ok(rectsOverlap(a, b), 'sanity: start overlapping')

    const updates = forceSettle(tiles, { strength: 1, iterations: 20, padding: 5 })
    const next = new Map(tiles)
    for (const u of updates) {
      const t = next.get(u.id)!
      next.set(u.id, { ...t, x: u.x, y: u.y })
    }
    const A = next.get('a')!
    const B = next.get('b')!
    assert.ok(!rectsOverlap(A, B), `expected no overlap post-settle, got a=${JSON.stringify(A)} b=${JSON.stringify(B)}`)
  })

  it('respects frozenIds — the anchor tile never moves', () => {
    const a = tile('a', 0, 0)
    const b = tile('b', 30, 0)
    const tiles = mapOf(a, b)
    const updates = forceSettle(tiles, {
      strength: 1,
      iterations: 20,
      frozenIds: new Set(['a']),
    })
    assert.ok(!updates.find((u) => u.id === 'a'), 'frozen tile a should not be in updates')
    const bUpdate = updates.find((u) => u.id === 'b')
    assert.ok(bUpdate, 'unfrozen tile b should move')
  })

  it('converges within a bounded number of iterations for small clusters', () => {
    const tiles = mapOf(
      tile('a', 0, 0),
      tile('b', 20, 20),
      tile('c', 40, 40),
      tile('d', 60, 60)
    )
    const updates = forceSettle(tiles, { strength: 1, iterations: 30, padding: 5 })
    const next = new Map(tiles)
    for (const u of updates) {
      const t = next.get(u.id)!
      next.set(u.id, { ...t, x: u.x, y: u.y })
    }
    const arr = Array.from(next.values())
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        assert.ok(
          !rectsOverlap(arr[i]!, arr[j]!),
          `expected ${arr[i]!.id} and ${arr[j]!.id} to be separated`
        )
      }
    }
  })
})

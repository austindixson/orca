import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hierarchySpawn } from './hierarchySpawn'

const parent = { x: 1000, y: 1000, w: 400, h: 300 }

describe('hierarchySpawn', () => {
  it('places the first sibling to the right of the parent center (arc midpoint)', () => {
    const p = hierarchySpawn({
      parent,
      newW: 200,
      newH: 150,
      siblingIndex: 0,
      siblingCount: 1,
    })
    const cx = parent.x + parent.w / 2
    // siblingCount=1 → single child lands at arc center (theta=0 → right of parent)
    assert.ok(p.x > cx, `expected child to be right of parent cx, got x=${p.x} cx=${cx}`)
  })

  it('is deterministic for identical inputs', () => {
    const a = hierarchySpawn({ parent, newW: 200, newH: 150, siblingIndex: 2, siblingCount: 5 })
    const b = hierarchySpawn({ parent, newW: 200, newH: 150, siblingIndex: 2, siblingCount: 5 })
    assert.equal(a.x, b.x)
    assert.equal(a.y, b.y)
  })

  it('spreads siblings to distinct non-overlapping angular positions', () => {
    const count = 5
    const W = 200
    const H = 150
    const positions: { x: number; y: number }[] = []
    for (let i = 0; i < count; i++) {
      positions.push(
        hierarchySpawn({
          parent,
          newW: W,
          newH: H,
          siblingIndex: i,
          siblingCount: count,
        })
      )
    }
    // All distinct
    const unique = new Set(positions.map((p) => `${p.x.toFixed(1)}|${p.y.toFixed(1)}`))
    assert.equal(unique.size, count, 'sibling positions should all be distinct')
    // All to the right half-plane (x >= parent left edge; arc is right side)
    for (const p of positions) {
      assert.ok(p.x >= parent.x, `expected sibling x=${p.x} right of parent x=${parent.x}`)
    }
  })

  it('bumps to an outer ring after 6 siblings', () => {
    const inner = hierarchySpawn({
      parent,
      newW: 200,
      newH: 150,
      siblingIndex: 0,
      siblingCount: 12,
    })
    const outer = hierarchySpawn({
      parent,
      newW: 200,
      newH: 150,
      siblingIndex: 6,
      siblingCount: 12,
    })
    const cx = parent.x + parent.w / 2
    const cy = parent.y + parent.h / 2
    const dInner = Math.hypot(inner.x + 100 - cx, inner.y + 75 - cy)
    const dOuter = Math.hypot(outer.x + 100 - cx, outer.y + 75 - cy)
    assert.ok(
      dOuter > dInner,
      `expected outer ring (idx 6) radius ${dOuter} > inner ring (idx 0) radius ${dInner}`
    )
  })
})

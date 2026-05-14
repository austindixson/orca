import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { HermesLeadNode } from './hermesLeadGraph'
import { computeHermesLeadClusterLayout } from './hermesLeadLayout'

function n(id: string, kind: HermesLeadNode['kind']): HermesLeadNode {
  return { id, kind, label: id }
}

describe('computeHermesLeadClusterLayout', () => {
  it('pins Hermes root near top-center and distributes kinds by semantic bands', () => {
    const nodes: HermesLeadNode[] = [
      n('hermes:lead', 'hermes'),
      n('agent:1', 'agent'),
      n('agent:2', 'agent'),
      n('tool:read_file', 'tool'),
      n('tool:write_file', 'tool'),
      n('fs:src', 'folder'),
      n('fs:src/a.ts', 'file'),
      n('tile:editor', 'tile'),
    ]

    const out = computeHermesLeadClusterLayout(nodes, { width: 1000, height: 760 })

    const root = out.find((p) => p.id === 'hermes:lead')
    assert.ok(root)
    assert.ok(Math.abs(root.x - 500) < 10)
    assert.ok(root.y < 80)

    const by = (id: string) => out.find((p) => p.id === id)!
    const a1 = by('agent:1')
    const t1 = by('tool:read_file')
    const f1 = by('fs:src/a.ts')

    assert.ok(a1.x < 500, 'agents should be left-of-center band')
    assert.ok(t1.x > 500, 'tools should be right-of-center band')
    assert.ok(f1.y > 220, 'files/folders should be in lower band')
  })

  it('returns stable layout for identical input ordering', () => {
    const nodes: HermesLeadNode[] = [
      n('hermes:lead', 'hermes'),
      n('agent:1', 'agent'),
      n('agent:2', 'agent'),
      n('tool:1', 'tool'),
    ]
    const a = computeHermesLeadClusterLayout(nodes, { width: 1000, height: 760 })
    const b = computeHermesLeadClusterLayout(nodes, { width: 1000, height: 760 })
    assert.deepEqual(a, b)
  })

  it('supports density-aware pack layout mode for large graphs', () => {
    const nodes: HermesLeadNode[] = [n('hermes:lead', 'hermes')]
    for (let i = 0; i < 24; i += 1) nodes.push(n(`agent:${i}`, 'agent'))
    for (let i = 0; i < 24; i += 1) nodes.push(n(`tool:${i}`, 'tool'))
    for (let i = 0; i < 36; i += 1) nodes.push(n(`fs:file:${i}`, i % 4 === 0 ? 'folder' : 'file'))
    for (let i = 0; i < 20; i += 1) nodes.push(n(`tile:${i}`, 'tile'))

    const packed = computeHermesLeadClusterLayout(nodes, { width: 1000, height: 760, mode: 'pack' })
    const regular = computeHermesLeadClusterLayout(nodes, { width: 1000, height: 760, mode: 'semantic' })

    assert.equal(packed.length, nodes.length)
    const uniquePackedX = new Set(packed.map((p) => Math.round(p.x))).size
    assert.ok(uniquePackedX > 8, 'pack mode should spread nodes across multiple x columns')

    const outOfBounds = packed.filter((p) => p.x < 20 || p.x > 980 || p.y < 20 || p.y > 740)
    assert.equal(outOfBounds.length, 0, 'pack mode should keep points inside viewport padding')

    const packedById = new Map(packed.map((p) => [p.id, p]))
    const regularById = new Map(regular.map((p) => [p.id, p]))
    const comparisonId = 'agent:12'
    const packedPoint = packedById.get(comparisonId)
    const regularPoint = regularById.get(comparisonId)
    assert.ok(packedPoint && regularPoint)
    assert.notEqual(Math.round(packedPoint.x), Math.round(regularPoint.x), 'pack mode should produce different arrangement than semantic bands')
  })

  it('applies adaptive relaxation in pack mode to improve local node spacing', () => {
    const nodes: HermesLeadNode[] = [n('hermes:lead', 'hermes')]
    for (let i = 0; i < 30; i += 1) nodes.push(n(`agent:${i}`, 'agent'))
    for (let i = 0; i < 30; i += 1) nodes.push(n(`tool:${i}`, 'tool'))
    for (let i = 0; i < 30; i += 1) nodes.push(n(`tile:${i}`, 'tile'))

    const noRelax = computeHermesLeadClusterLayout(nodes, {
      width: 1000,
      height: 760,
      mode: 'pack',
      relaxIterations: 0,
    })
    const relaxed = computeHermesLeadClusterLayout(nodes, {
      width: 1000,
      height: 760,
      mode: 'pack',
      relaxIterations: 8,
    })

    const minDistance = (pts: { x: number; y: number; id: string }[]) => {
      let min = Number.POSITIVE_INFINITY
      for (let i = 0; i < pts.length; i += 1) {
        if (pts[i].id === 'hermes:lead') continue
        for (let j = i + 1; j < pts.length; j += 1) {
          if (pts[j].id === 'hermes:lead') continue
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
          min = Math.min(min, d)
        }
      }
      return min
    }

    assert.ok(minDistance(relaxed) > minDistance(noRelax), 'relaxation should increase minimum pair distance')
  })

  it('supports optional inter-family relaxation for extreme graph density', () => {
    const nodes: HermesLeadNode[] = [n('hermes:lead', 'hermes')]
    for (let i = 0; i < 28; i += 1) nodes.push(n(`agent:${i}`, 'agent'))
    for (let i = 0; i < 28; i += 1) nodes.push(n(`tool:${i}`, 'tool'))
    for (let i = 0; i < 24; i += 1) nodes.push(n(`tile:${i}`, 'tile'))

    const base = computeHermesLeadClusterLayout(nodes, {
      width: 1000,
      height: 760,
      mode: 'pack',
      relaxIterations: 6,
      interFamilyRelaxIterations: 0,
    })

    const withInterFamily = computeHermesLeadClusterLayout(nodes, {
      width: 1000,
      height: 760,
      mode: 'pack',
      relaxIterations: 6,
      interFamilyRelaxIterations: 5,
    })

    const getKind = (id: string): HermesLeadNode['kind'] => {
      const found = nodes.find((n) => n.id === id)
      return found?.kind ?? 'tile'
    }

    const minCrossFamily = (pts: { x: number; y: number; id: string }[]) => {
      let min = Number.POSITIVE_INFINITY
      for (let i = 0; i < pts.length; i += 1) {
        const ka = getKind(pts[i].id)
        if (ka === 'hermes') continue
        for (let j = i + 1; j < pts.length; j += 1) {
          const kb = getKind(pts[j].id)
          if (kb === 'hermes' || kb === ka) continue
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
          min = Math.min(min, d)
        }
      }
      return min
    }

    assert.ok(
      minCrossFamily(withInterFamily) > minCrossFamily(base),
      'inter-family relaxation should increase minimum spacing between different node families'
    )
  })

  it('supports inter-family relax strength tuning to increase cross-family spacing at the same iteration budget', () => {
    const nodes: HermesLeadNode[] = [n('hermes:lead', 'hermes')]
    for (let i = 0; i < 26; i += 1) nodes.push(n(`agent:${i}`, 'agent'))
    for (let i = 0; i < 26; i += 1) nodes.push(n(`tool:${i}`, 'tool'))
    for (let i = 0; i < 22; i += 1) nodes.push(n(`tile:${i}`, 'tile'))

    const lowStrength = computeHermesLeadClusterLayout(nodes, {
      width: 1000,
      height: 760,
      mode: 'pack',
      relaxIterations: 6,
      interFamilyRelaxIterations: 4,
      interFamilyRelaxStrength: 0.6,
    })

    const highStrength = computeHermesLeadClusterLayout(nodes, {
      width: 1000,
      height: 760,
      mode: 'pack',
      relaxIterations: 6,
      interFamilyRelaxIterations: 4,
      interFamilyRelaxStrength: 1.5,
    })

    const getKind = (id: string): HermesLeadNode['kind'] => nodes.find((n) => n.id === id)?.kind ?? 'tile'

    const minCrossFamily = (pts: { x: number; y: number; id: string }[]) => {
      let min = Number.POSITIVE_INFINITY
      for (let i = 0; i < pts.length; i += 1) {
        const ka = getKind(pts[i].id)
        if (ka === 'hermes') continue
        for (let j = i + 1; j < pts.length; j += 1) {
          const kb = getKind(pts[j].id)
          if (kb === 'hermes' || kb === ka) continue
          min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y))
        }
      }
      return min
    }

    assert.ok(
      minCrossFamily(highStrength) > minCrossFamily(lowStrength),
      'higher inter-family relax strength should increase minimum spacing between node families'
    )
  })
})

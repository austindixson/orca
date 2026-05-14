import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeNodeToFocusMorph, computeCardShellMorph, computeTileFrameHandoff } from './hermesLeadMorph'

describe('computeNodeToFocusMorph', () => {
  it('returns position-aware translation between graph node and focus card anchors', () => {
    const morph = computeNodeToFocusMorph({
      node: { x: 500, y: 300 },
      graphRect: { left: 700, top: 80, width: 500, height: 380 },
      focusRect: { left: 120, top: 160, width: 420, height: 280 },
      viewBox: { width: 1000, height: 760 },
    })

    assert.ok(Math.abs(morph.fromX - 950) < 0.5)
    assert.ok(Math.abs(morph.fromY - 230) < 0.5)
    assert.ok(Math.abs(morph.toX - 330) < 0.5)
    assert.ok(Math.abs(morph.toY - 300) < 0.5)
    assert.ok(morph.deltaX < 0)
    assert.ok(morph.distance > 0)
  })

  it('computes full card-shell morph geometry from node bubble to focus card bounds', () => {
    const shell = computeCardShellMorph({
      node: { x: 220, y: 500, radius: 11 },
      graphRect: { left: 740, top: 120, width: 480, height: 420 },
      focusRect: { left: 88, top: 170, width: 452, height: 290 },
      viewBox: { width: 1000, height: 760 },
    })

    assert.ok(shell.from.width > 20)
    assert.ok(shell.from.height > 20)
    assert.ok(shell.to.width === 452)
    assert.ok(shell.to.height === 290)
    assert.ok(shell.deltaX < 0)
    assert.ok(shell.scaleX > 3)
    assert.ok(shell.durationMs >= 220)
  })

  it('targets exact tile frame geometry for tile-open handoff using tile world bounds', () => {
    const handoff = computeTileFrameHandoff({
      tile: { x: 1200, y: 860, w: 640, h: 420 },
      pan: { x: -340, y: -220 },
      zoom: 0.5,
      rootRect: { left: 40, top: 24, width: 1280, height: 900 },
      hostRect: { left: 60, top: 40, width: 1240, height: 860 },
      focusRect: { left: 90, top: 160, width: 420, height: 280 },
    })

    assert.equal(handoff.from.left, 50)
    assert.equal(handoff.from.top, 136)
    assert.equal(handoff.from.width, 420)
    assert.equal(handoff.from.height, 280)

    assert.equal(handoff.to.left, 280)
    assert.equal(handoff.to.top, 226)
    assert.equal(handoff.to.width, 320)
    assert.equal(handoff.to.height, 210)
    assert.ok(handoff.durationMs >= 220)
  })
})

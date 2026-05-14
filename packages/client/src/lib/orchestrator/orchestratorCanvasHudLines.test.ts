import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractLatestPhaseLineFromActivity,
  extractNarratorVoiceLead,
  extractPlanHeadLine,
  formatTileSwitchNarration,
} from './orchestratorCanvasHudLines'

describe('orchestratorCanvasHudLines', () => {
  it('extractLatestPhaseLineFromActivity prefers the latest phase log', () => {
    const lines = ['[Prompt] x', '[Phase 1] First (2 tasks)', '[Phase 2] Second pass (1 tasks)']
    assert.equal(extractLatestPhaseLineFromActivity(lines), 'Phase 2 · Second pass (1 tasks)')
  })

  it('extractPlanHeadLine reads ### Phase from formatted hierarchy markdown', () => {
    const body = ['## Plan', '', '### Phase 1: Ship API', 'Objective: x'].join('\n')
    assert.equal(
      extractPlanHeadLine({ phase: 'formatted', title: 'P', body }),
      'Phase 1 · Ship API'
    )
  })

  it('formatTileSwitchNarration prefers agent tile focus (natural sentence)', () => {
    const s = formatTileSwitchNarration(
      {
        tileId: 't1',
        tileType: 'editor',
        action: 'reading',
        progress: 0,
        detail: '12',
      },
      { tileId: 't2', label: 'Other' },
      () => 'My editor'
    )
    assert.equal(s, 'Reading line 12 in the editor.')
  })

  it('formatTileSwitchNarration prepends personality voice lead when provided', () => {
    const s = formatTileSwitchNarration(
      {
        tileId: 't1',
        tileType: 'browser',
        action: 'navigating',
        progress: 0,
        detail: 'docs',
      },
      null,
      () => undefined,
      {
        personalityMarkdown: 'Warm and concise.\n\nMore body.',
      }
    )
    assert.ok(s?.startsWith('Warm and concise. — '))
    assert.ok(s?.includes('the browser'))
    assert.ok(s?.toLowerCase().includes('navigating'))
  })

  it('extractNarratorVoiceLead skips yaml front matter', () => {
    const lead = extractNarratorVoiceLead('---\nname: x\n---\n\nHello from the voice.')
    assert.equal(lead, 'Hello from the voice.')
  })

  it('formatTileSwitchNarration renders a full sentence for auto focus highlight', () => {
    const s = formatTileSwitchNarration(
      null,
      { tileId: 't2', label: 'Preview tile' },
      () => 'Landing page'
    )
    assert.equal(s, 'Focused on Preview tile on “Landing page”.')
  })
})

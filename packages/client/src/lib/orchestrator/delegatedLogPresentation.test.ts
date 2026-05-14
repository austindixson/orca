import { describe, expect, it } from 'vitest'
import {
  collapseStillWaitingRuns,
  extractDelegatedTraceChip,
  flattenLogTail,
  formatTraceChipLabel,
} from './delegatedLogPresentation'

describe('collapseStillWaitingRuns', () => {
  it('merges consecutive still-waiting lines', () => {
    const out = collapseStillWaitingRuns([
      '[30s] Still waiting — hint. Use Stop to cancel.',
      '[60s] Still waiting — hint. Use Stop to cancel.',
      '[90s] Still waiting — hint. Use Stop to cancel.',
      '→ read_file(...)',
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toContain('3× still-waiting')
    expect(out[0]).toContain('[90s]')
    expect(out[1]).toContain('read_file')
  })

  it('keeps a single heartbeat line', () => {
    const line = '[30s] Still waiting — x. Use Stop to cancel.'
    expect(collapseStillWaitingRuns([line])).toEqual([line])
  })
})

describe('flattenLogTail', () => {
  it('splits embedded newlines', () => {
    expect(flattenLogTail(['a\nb', 'c'])).toEqual(['a', 'b', 'c'])
  })
})

describe('extractDelegatedTraceChip', () => {
  it('parses tool arrows', () => {
    expect(extractDelegatedTraceChip('→ bash(...)', 0)?.kind).toBe('call')
    expect(extractDelegatedTraceChip('← bash', 0)?.kind).toBe('result')
  })

  it('parses bracket banners', () => {
    const c = extractDelegatedTraceChip('[Track] character sheet', 0)
    expect(c?.kind).toBe('info')
    expect(c?.name).toContain('Track')
  })

  it('parses hermes tool.call payload with path and duration', () => {
    const raw =
      'tool.call name=read_file args={"path":"/Users/ghost/Desktop/orca/packages/client/src/store/reasoningTraceStore.ts"} duration=1.1s'
    const chip = extractDelegatedTraceChip(raw, 0)
    expect(chip?.kind).toBe('call')
    expect(chip?.name).toBe('read_file')
    expect(chip?.target).toContain('reasoningTraceStore.ts')
    expect(chip?.duration).toBe('1.1s')
    expect(formatTraceChipLabel(chip!)).toContain('read_file')
    expect(formatTraceChipLabel(chip!)).toContain('1.1s')
  })

  it('parses arrow-style trace with grep + duration', () => {
    const chip = extractDelegatedTraceChip('→ grep useReasoningTraceStore 0.6s', 0)
    expect(chip?.kind).toBe('call')
    expect(chip?.name).toBe('grep')
    expect(chip?.target).toContain('useReasoningTraceStore')
    expect(chip?.duration).toBe('0.6s')
  })

  it('skips still waiting', () => {
    expect(extractDelegatedTraceChip('[120s] Still waiting — x', 0)).toBeNull()
  })
})

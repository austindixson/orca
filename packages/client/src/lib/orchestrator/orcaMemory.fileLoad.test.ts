import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { useSettingsStore } from '../../store/settingsStore'
import {
  _isMissingFileErrorForTest,
  _joinUnderRootForTest,
  formatRecurringIssueBlockFromSignalsJsonl,
  loadLongTermMemoryForSystemPrompt,
} from './orcaMemory'

describe('orcaMemory: isMissingFileError classification', () => {
  it('detects Tauri "file not found" messages as missing', () => {
    assert.equal(_isMissingFileErrorForTest(new Error('file not found')), true)
    assert.equal(_isMissingFileErrorForTest(new Error('Path does not exist')), true)
  })

  it('detects Node ENOENT errors as missing', () => {
    const e = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    assert.equal(_isMissingFileErrorForTest(e), true)
  })

  it('detects 404-style network fetch errors as missing', () => {
    assert.equal(_isMissingFileErrorForTest(new Error('Request failed 404')), true)
  })

  it('treats generic I/O errors as non-missing', () => {
    assert.equal(_isMissingFileErrorForTest(new Error('EACCES: permission denied')), false)
    assert.equal(_isMissingFileErrorForTest(new Error('disk read failed')), false)
    assert.equal(_isMissingFileErrorForTest('unknown'), false)
  })
})

describe('orcaMemory: joinUnderRoot', () => {
  it('joins POSIX paths without duplicate separators', () => {
    assert.equal(_joinUnderRootForTest('/Users/x/workspace', '.orca/MEMORY.md'), '/Users/x/workspace/.orca/MEMORY.md')
    assert.equal(_joinUnderRootForTest('/Users/x/workspace/', '/.orca/MEMORY.md'), '/Users/x/workspace/.orca/MEMORY.md')
  })

  it('preserves Windows separators when root is Windows-style', () => {
    assert.equal(_joinUnderRootForTest('C:\\Users\\x', '.orca/MEMORY.md'), 'C:\\Users\\x\\.orca\\MEMORY.md')
  })
})

describe('orcaMemory: loadLongTermMemoryForSystemPrompt off-path', () => {
  let prev: boolean

  beforeEach(() => {
    prev = useSettingsStore.getState().memoryLongTermEnabled
  })

  afterEach(() => {
    useSettingsStore.setState({ memoryLongTermEnabled: prev })
  })

  it('returns empty string when long-term memory disabled (no tauri calls)', async () => {
    useSettingsStore.setState({ memoryLongTermEnabled: false })
    assert.equal(await loadLongTermMemoryForSystemPrompt(), '')
  })
})

describe('orcaMemory: formatRecurringIssueBlockFromSignalsJsonl edge cases', () => {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  it('ignores rows older than the window cutoff', () => {
    const old = JSON.stringify({ ts: now - 2 * day, kind: 'error', detail: 'x' })
    const raw = `${old}\n${old}\n`
    assert.equal(formatRecurringIssueBlockFromSignalsJsonl(raw, now, day, 1500), '')
  })

  it('ignores malformed JSONL lines silently', () => {
    const row = JSON.stringify({ ts: now, kind: 'error', detail: 'same' })
    const raw = `not-json\n${row}\n${row}\n`
    const block = formatRecurringIssueBlockFromSignalsJsonl(raw, now, day, 1500)
    assert.ok(block.includes('Repeated (2x)'))
  })

  it('truncates to maxChars when output would exceed budget', () => {
    const rows: string[] = []
    for (let i = 0; i < 30; i += 1) {
      const row = JSON.stringify({ ts: now, kind: 'error', detail: `detail-${i % 12}` })
      rows.push(row, row)
    }
    const block = formatRecurringIssueBlockFromSignalsJsonl(rows.join('\n'), now, day, 200)
    assert.ok(block.length <= 200)
  })

  it('caps to 12 recurring buckets', () => {
    const rows: string[] = []
    for (let i = 0; i < 20; i += 1) {
      const row = JSON.stringify({ ts: now, kind: 'error', detail: `bucket-${i}` })
      rows.push(row, row)
    }
    const block = formatRecurringIssueBlockFromSignalsJsonl(rows.join('\n'), now, day, 100_000)
    const matches = block.match(/^- Repeated/gm) ?? []
    assert.ok(matches.length <= 12, `expected ≤12 buckets, got ${matches.length}`)
  })
})

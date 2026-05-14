import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { useSettingsStore } from '../../store/settingsStore'
import {
  clampLongTermMemoryChars,
  clampShortTermMemoryChars,
  formatRecurringIssueBlockFromSignalsJsonl,
  loadLongTermMemoryForSystemPrompt,
} from './orcaMemory'

describe('orcaMemory clamps', () => {
  it('clamps short-term budget', () => {
    assert.equal(clampShortTermMemoryChars(18_000), 18_000)
    assert.equal(clampShortTermMemoryChars(1), 2_000)
    assert.equal(clampShortTermMemoryChars(999_999), 200_000)
    assert.equal(clampShortTermMemoryChars(Number.NaN), 18_000)
  })

  it('clamps long-term inject cap', () => {
    assert.equal(clampLongTermMemoryChars(12_000), 12_000)
    assert.equal(clampLongTermMemoryChars(1), 500)
    assert.equal(clampLongTermMemoryChars(999_999), 50_000)
  })
})

describe('orcaMemory long-term prompt', () => {
  let prevEnabled: boolean

  beforeEach(() => {
    prevEnabled = useSettingsStore.getState().memoryLongTermEnabled
  })

  afterEach(() => {
    useSettingsStore.setState({ memoryLongTermEnabled: prevEnabled })
  })

  it('loadLongTermMemoryForSystemPrompt returns empty when long-term memory disabled', async () => {
    useSettingsStore.setState({ memoryLongTermEnabled: false })
    assert.equal(await loadLongTermMemoryForSystemPrompt(), '')
  })
})

describe('formatRecurringIssueBlockFromSignalsJsonl', () => {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  it('returns empty when no signal repeats within window', () => {
    const raw = JSON.stringify({ ts: now, kind: 'error', detail: 'a' })
    assert.equal(formatRecurringIssueBlockFromSignalsJsonl(`${raw}\n`, now, day, 1500), '')
  })

  it('emits block when same kind+detail appears twice in window', () => {
    const row = { ts: now, kind: 'error', detail: 'same' }
    const raw = `${JSON.stringify(row)}\n${JSON.stringify(row)}\n`
    const block = formatRecurringIssueBlockFromSignalsJsonl(raw, now, day, 1500)
    assert.ok(block.includes('Recent recurring signals'))
    assert.ok(block.includes('Repeated (2x)'))
    assert.ok(block.includes('same'))
  })
})

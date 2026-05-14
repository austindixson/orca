import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { useSettingsStore } from '../../store/settingsStore'
import { getAutoCompactionSystemPromptBlock } from './sessionCompaction'

describe('sessionCompaction prompt block', () => {
  let prevCompaction: boolean

  beforeEach(() => {
    prevCompaction = useSettingsStore.getState().orcaAutoCompactionEnabled
  })

  afterEach(() => {
    useSettingsStore.setState({ orcaAutoCompactionEnabled: prevCompaction })
  })

  it('returns empty when auto-compaction disabled', () => {
    useSettingsStore.setState({ orcaAutoCompactionEnabled: false })
    assert.equal(getAutoCompactionSystemPromptBlock(), '')
  })

  it('includes summary path and recall_session_history when enabled', () => {
    useSettingsStore.setState({ orcaAutoCompactionEnabled: true })
    const block = getAutoCompactionSystemPromptBlock()
    assert.ok(block.includes('summary.md'))
    assert.ok(block.includes('recall_session_history'))
    assert.ok(block.includes('search_project_wiki') || block.includes('search_workspace_memory'))
  })
})

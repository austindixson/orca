import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ORCHESTRATOR_TOOLS_OPENAI } from './toolDefinitions'
import {
  LEAD_ORCHESTRATOR_TOOL_ALLOWLIST,
  filterOrchestratorToolsByAllowlist,
  filterOrchestratorToolsForHermesAgentTileSetting,
} from './orchestratorToolFilter'

describe('orchestratorToolFilter', () => {
  it('returns full tool list when allowlist empty', () => {
    const all = filterOrchestratorToolsByAllowlist(null)
    assert.equal(all.length, ORCHESTRATOR_TOOLS_OPENAI.length)
  })

  it('full catalog includes agent browser, merge-review, and Hermes memory/recall tools', () => {
    const names = new Set(ORCHESTRATOR_TOOLS_OPENAI.map((t) => t.function.name))
    assert.ok(names.has('browser_open'))
    assert.ok(names.has('list_merge_review_tickets'))
    assert.ok(names.has('search_workspace_memory'))
    assert.ok(names.has('memory'))
    assert.ok(names.has('session_search'))
  })

  it('filters definitions by allowlist', () => {
    const f = filterOrchestratorToolsByAllowlist(['read_file', 'write_file'])
    assert.equal(f.length, 2)
    assert.ok(f.every((t) => t.function.name === 'read_file' || t.function.name === 'write_file'))
  })

  it('lead delegation allowlist is coordination + spawn + Hermes settings', () => {
    const names = new Set(LEAD_ORCHESTRATOR_TOOL_ALLOWLIST)
    assert.ok(names.has('spawn_sub_agent'))
    assert.ok(names.has('configure_hermes_api'))
    assert.ok(names.has('read_terminal_output'))
    assert.ok(names.has('session_search'))
    assert.ok(names.has('memory'))
    assert.ok(!names.has('read_file'))
    assert.ok(!names.has('write_file'))
    assert.ok(!names.has('run_shell_command'))
    assert.equal(
      filterOrchestratorToolsByAllowlist([...LEAD_ORCHESTRATOR_TOOL_ALLOWLIST]).length,
      LEAD_ORCHESTRATOR_TOOL_ALLOWLIST.length
    )
  })

  it('hides Hermes tile tools when showHermesAgentTile is false', () => {
    const full = filterOrchestratorToolsByAllowlist(null)
    const hidden = filterOrchestratorToolsForHermesAgentTileSetting(full, false)
    const names = new Set(hidden.map((t) => t.function.name))
    assert.ok(!names.has('chat_with_hermes_tile'))
    const create = hidden.find((t) => t.function.name === 'canvas_create_tile')
    assert.ok(create)
    const en = (
      create!.function.parameters as {
        properties?: { type?: { enum?: string[] } }
      }
    ).properties?.type?.enum
    assert.ok(Array.isArray(en))
    assert.ok(!en!.includes('hermes_agent'))
  })

  it('preserves Hermes tools when showHermesAgentTile is true', () => {
    const full = filterOrchestratorToolsByAllowlist(null)
    const same = filterOrchestratorToolsForHermesAgentTileSetting(full, true)
    assert.equal(same.length, full.length)
    assert.ok(same.some((t) => t.function.name === 'chat_with_hermes_tile'))
  })
})

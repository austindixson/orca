import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { executeOrchestratorTool } from './executeTools'

describe('executeTools Hermes memory/session_search aliases', () => {
  it('session_search without query returns browse-mode payload in web runtime', async () => {
    const raw = await executeOrchestratorTool('session_search', '{}', { orchestratorTileId: null })
    const parsed = JSON.parse(raw) as {
      ok: boolean
      mode?: string
      sessions?: unknown[]
      note?: string
    }
    assert.equal(parsed.ok, true)
    assert.equal(parsed.mode, 'browse')
    assert.ok(Array.isArray(parsed.sessions))
    assert.equal(parsed.sessions?.length, 0)
  })

  it('memory tool rejects in web runtime with clear error', async () => {
    const raw = await executeOrchestratorTool(
      'memory',
      JSON.stringify({ action: 'add', target: 'memory', content: 'remember x' }),
      { orchestratorTileId: null }
    )
    const parsed = JSON.parse(raw) as { ok: boolean; error?: string }
    assert.equal(parsed.ok, false)
    assert.match(String(parsed.error ?? ''), /requires Orca desktop/i)
  })
})

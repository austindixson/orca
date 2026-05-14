import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getMessengerIntegrationsPromptBlock } from './messengerIntegrationsPrompt'

describe('getMessengerIntegrationsPromptBlock', () => {
  it('mentions Hermes gateway and bridge docs', () => {
    const b = getMessengerIntegrationsPromptBlock()
    assert.ok(b.includes('hermes gateway'))
    assert.ok(b.includes('CANVAS_AGENT_BRIDGE.md'))
    assert.ok(b.includes('hermes_agent'))
    assert.ok(b.includes('terminal'))
    assert.ok(b.includes('API_SERVER_ENABLED=true hermes gateway'))
    assert.ok(b.includes('Lead orchestrator'))
    assert.ok(b.includes('configure_hermes_api'))
    assert.ok(b.includes('terminal_warnings'))
    assert.ok(b.includes('hermes_local_dev_no_auth'))
    assert.ok(b.includes('API_SERVER_CORS_ORIGINS'))
    assert.ok(b.includes('HTTP only'))
  })

  it('when Hermes agent tile is disabled, omits gateway/tile setup and forbids Hermes runners', () => {
    const b = getMessengerIntegrationsPromptBlock({ hermesAgentTileEnabled: false })
    assert.ok(b.includes('Hermes (off in Settings)'))
    assert.ok(b.includes('runner:"hermes"'))
    assert.ok(b.includes('chat_with_hermes_tile'))
    assert.ok(b.includes('CANVAS_AGENT_BRIDGE.md'))
    assert.ok(!b.includes('API_SERVER_ENABLED=true hermes gateway'))
    assert.ok(!b.includes('Lead orchestrator'))
  })
})

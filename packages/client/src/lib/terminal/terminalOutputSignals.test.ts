import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chunkLooksLikeWarning,
  summarizeHermesGatewayWarnings,
} from './terminalOutputSignals'

describe('terminalOutputSignals', () => {
  it('detects Hermes WARNING gateway lines (not only warning:)', () => {
    const hermes = `Some banner
WARNING gateway.run: No user allowlists configured.
WARNING gateway.platforms.api_server: No API key configured.
`
    assert.equal(chunkLooksLikeWarning(hermes), true)
  })

  it('summarizes Hermes gateway warnings with remediation', () => {
    const hermes = `WARNING gateway.run: allowlists
WARNING gateway.platforms.api_server: API key`
    const s = summarizeHermesGatewayWarnings(hermes)
    assert.ok(s)
    assert.ok(s!.remediation.includes('GATEWAY_ALLOW_ALL_USERS') || s!.remediation.includes('allowlist'))
    assert.ok(s!.remediation.includes('API_SERVER_KEY') || s!.remediation.includes('configure_hermes_api'))
  })

  it('marks localDevNoApiKey when Hermes says no API key / unauthenticated API', () => {
    const hermes = `WARNING gateway.platforms.api_server: No API key configured.
`
    const s = summarizeHermesGatewayWarnings(hermes)
    assert.ok(s)
    assert.equal(s!.localDevNoApiKey, true)
    assert.ok(s!.remediation.includes('configure_hermes_api') || s!.remediation.includes('empty'))
  })
})

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HERMES_GATEWAY_COMMAND,
  buildHermesGatewayShellCommand,
} from './hermesGatewayLauncher.ts'

describe('hermesGatewayLauncher', () => {
  test('buildHermesGatewayShellCommand without context matches base command', () => {
    assert.equal(buildHermesGatewayShellCommand(), HERMES_GATEWAY_COMMAND)
  })

  test('buildHermesGatewayShellCommand injects ORCA env exports', () => {
    const c = buildHermesGatewayShellCommand({
      parentOrchestratorTileId: 'orch-123',
      sessionId: 'sess-456',
    })
    assert.ok(c.includes("ORCA_PARENT_TILE_ID='orch-123'"))
    assert.ok(c.includes("ORCA_PARENT_SESSION_ID='sess-456'"))
    assert.ok(c.endsWith(HERMES_GATEWAY_COMMAND) || c.includes('hermes gateway'))
  })
})

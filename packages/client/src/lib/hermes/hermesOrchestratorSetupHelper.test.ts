import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatHermesSetupDiagnoseMarkdown } from './hermesOrchestratorSetupHelper'

describe('formatHermesSetupDiagnoseMarkdown', () => {
  it('when tile on and CLI missing, suggests install or disable tile', () => {
    const md = formatHermesSetupDiagnoseMarkdown({
      cli: {
        installed: false,
        versionLine: null,
        stderrOrError: 'not found',
      },
      hermesTileEnabled: true,
      gatewayOk: null,
      gatewayHint: null,
    })
    assert.ok(md.includes('Hermes CLI:** **not detected**'))
    assert.ok(md.includes('Hermes agent tile is ON'))
    assert.ok(md.includes('Turn off the Hermes tile'))
    assert.ok(md.includes('NousResearch'))
  })

  it('when CLI installed, shows version', () => {
    const md = formatHermesSetupDiagnoseMarkdown({
      cli: {
        installed: true,
        versionLine: 'hermes 1.2.3',
        stderrOrError: null,
      },
      hermesTileEnabled: true,
      gatewayOk: true,
      gatewayHint: null,
    })
    assert.ok(md.includes('hermes 1.2.3'))
    assert.ok(md.includes('reachable'))
  })

  it('when tile off, mentions tools hidden', () => {
    const md = formatHermesSetupDiagnoseMarkdown({
      cli: { installed: true, versionLine: 'x', stderrOrError: null },
      hermesTileEnabled: false,
      gatewayOk: null,
      gatewayHint: null,
    })
    assert.ok(md.includes('off in Settings'))
  })
})

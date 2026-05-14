import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  VAULT_MIRROR_DIAG_MAX,
  resetVaultMirrorFailureToastSessionFlag,
  useVaultMirrorDiagnosticsStore,
} from './vaultMirrorDiagnosticsStore'

describe('vaultMirrorDiagnosticsStore', () => {
  beforeEach(() => {
    resetVaultMirrorFailureToastSessionFlag()
    useVaultMirrorDiagnosticsStore.getState().clear()
  })

  it('recordAttempt prepends and caps entries', () => {
    const extra = 5
    for (let i = 0; i < VAULT_MIRROR_DIAG_MAX + extra; i++) {
      useVaultMirrorDiagnosticsStore.getState().recordAttempt({
        scope: 'test',
        relPath: `p${i}`,
        ok: i % 2 === 0,
      })
    }
    const { entries } = useVaultMirrorDiagnosticsStore.getState()
    assert.equal(entries.length, VAULT_MIRROR_DIAG_MAX)
    assert.equal(entries[0]!.relPath, `p${VAULT_MIRROR_DIAG_MAX + extra - 1}`)
  })

  it('tracks last success metadata', () => {
    useVaultMirrorDiagnosticsStore.getState().recordAttempt({
      scope: 'a',
      relPath: 'fail',
      ok: false,
    })
    useVaultMirrorDiagnosticsStore.getState().recordAttempt({
      scope: 'a',
      relPath: 'ok.md',
      ok: true,
    })
    const { lastSuccessRelPath, lastSuccessAtMs } = useVaultMirrorDiagnosticsStore.getState()
    assert.equal(lastSuccessRelPath, 'ok.md')
    assert.ok(typeof lastSuccessAtMs === 'number' && lastSuccessAtMs > 0)
  })
})

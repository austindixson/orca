import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  clearHermesEnvKeyCache,
  effectiveHermesBearerKey,
  resolveHermesAuthStatusAsync,
  resolveEffectiveHermesBearerKeyAsync,
  sanitizeHermesApiKeyForStorage,
} from './hermesApiKey'

describe('hermesApiKey', () => {
  it('effectiveHermesBearerKey omits bogus literals', () => {
    assert.equal(effectiveHermesBearerKey(undefined), undefined)
    assert.equal(effectiveHermesBearerKey(''), undefined)
    assert.equal(effectiveHermesBearerKey('null'), undefined)
    assert.equal(effectiveHermesBearerKey('undefined'), undefined)
    assert.equal(effectiveHermesBearerKey('  null  '), undefined)
    assert.equal(effectiveHermesBearerKey('sk-real'), 'sk-real')
  })

  it('sanitizeHermesApiKeyForStorage clears JSON-null mistakes', () => {
    assert.equal(sanitizeHermesApiKeyForStorage(null), '')
    assert.equal(sanitizeHermesApiKeyForStorage('null'), '')
    assert.equal(sanitizeHermesApiKeyForStorage('undefined'), '')
    assert.equal(sanitizeHermesApiKeyForStorage('  '), '')
    assert.equal(sanitizeHermesApiKeyForStorage('abc'), 'abc')
  })

  it('resolveEffectiveHermesBearerKeyAsync prefers UI key (no Tauri in node)', async () => {
    assert.equal(await resolveEffectiveHermesBearerKeyAsync(''), undefined)
    assert.equal(await resolveEffectiveHermesBearerKeyAsync('  '), undefined)
    assert.equal(await resolveEffectiveHermesBearerKeyAsync('sk-x'), 'sk-x')
  })

  it('resolveHermesAuthStatusAsync reports local no-bearer mode', async () => {
    const out = await resolveHermesAuthStatusAsync('', 'http://127.0.0.1:8642/v1')
    assert.equal(out.mode, 'none_local_gateway')
    assert.equal(out.bearer, undefined)
    assert.match(out.label, /No Bearer/i)
  })

  it('resolveHermesAuthStatusAsync reports ui key mode', async () => {
    const out = await resolveHermesAuthStatusAsync('sk-x', 'http://127.0.0.1:8642/v1')
    assert.equal(out.mode, 'ui_key')
    assert.equal(out.bearer, 'sk-x')
    assert.match(out.label, /Hermes API key field/i)
  })

  it('resolveEffectiveHermesBearerKeyAsync does not use Hermes ~/.env when base is Z.AI (node: no zai key)', async () => {
    const k = await resolveEffectiveHermesBearerKeyAsync('', 'https://api.z.ai/api/coding/paas/v4')
    assert.equal(k, undefined)
  })

  describe('env-fallback priority', () => {
    beforeEach(() => {
      clearHermesEnvKeyCache()
    })
    afterEach(() => {
      clearHermesEnvKeyCache()
    })

    it('reports none_remote_host when UI empty and host is not local / not Z.AI (node: no env)', async () => {
      const out = await resolveHermesAuthStatusAsync('', 'https://hermes.example.com/v1')
      assert.equal(out.mode, 'none_remote_host')
      assert.equal(out.bearer, undefined)
    })

    it('UI key still wins over any env lookup', async () => {
      const out = await resolveHermesAuthStatusAsync('sk-ui', 'http://127.0.0.1:8642/v1')
      assert.equal(out.mode, 'ui_key')
      assert.equal(out.bearer, 'sk-ui')
    })

    it('falls back to none_local_gateway when env read yields nothing (node runtime)', async () => {
      const out = await resolveHermesAuthStatusAsync('', 'http://127.0.0.1:8642/v1')
      assert.equal(out.mode, 'none_local_gateway')
      assert.equal(out.bearer, undefined)
      assert.match(out.detail, /~\/\.hermes\/\.env/)
    })

    it('clearHermesEnvKeyCache is idempotent and safe to call repeatedly', () => {
      clearHermesEnvKeyCache()
      clearHermesEnvKeyCache()
      clearHermesEnvKeyCache()
    })
  })
})

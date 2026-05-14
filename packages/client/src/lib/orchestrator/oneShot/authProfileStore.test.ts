import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  type AuthProfileRecord,
  loadAuthProfiles,
  resolveLaneForCommand,
  saveAuthProfiles,
  upsertAuthProfile,
  validateAuthProfile,
} from './authProfileStore'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

function sampleOAuthProfile(): AuthProfileRecord {
  return {
    id: 'drive-oauth',
    appId: 'google_drive',
    lane: 'oauth',
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
    oauth: {
      tokenRef: 'secret://drive/token',
      scopeFingerprint: 'drive.file',
    },
  }
}

describe('authProfileStore', () => {
  test('validateAuthProfile enforces lane-specific refs', () => {
    const invalid: AuthProfileRecord = {
      ...sampleOAuthProfile(),
      oauth: { tokenRef: '' },
    }
    const errors = validateAuthProfile(invalid)
    assert.ok(errors.some((e) => e.includes('oauth.tokenRef')))
  })

  test('upsertAuthProfile normalizes browser-session refs and domains', () => {
    const input: AuthProfileRecord = {
      id: 'x-session',
      appId: 'x',
      lane: 'browser_session',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
      browserSession: {
        sessionBundleRef: '  secret://x/session  ',
        runtimeFingerprintRef: ' secret://x/fingerprint ',
        domainBindings: ['x.com', 'x.com', ' twitter.com '],
        healthState: 'healthy',
      },
    }

    const out = upsertAuthProfile(input, [])
    assert.equal(out.errors.length, 0)
    assert.equal(out.next.length, 1)
    assert.deepEqual(out.next[0]?.browserSession?.domainBindings, ['x.com', 'twitter.com'])
    assert.equal(out.next[0]?.browserSession?.sessionBundleRef, 'secret://x/session')
  })

  test('resolveLaneForCommand picks oauth/browser-session for hybrid profiles by command', () => {
    const hybrid: AuthProfileRecord = {
      id: 'hybrid-launch',
      appId: 'launch-day',
      lane: 'hybrid',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
      oauth: { tokenRef: 'secret://hybrid/oauth' },
      browserSession: {
        sessionBundleRef: 'secret://hybrid/session',
        runtimeFingerprintRef: 'secret://hybrid/fingerprint',
        domainBindings: ['x.com'],
        healthState: 'healthy',
      },
      hybrid: { preferredOrder: ['oauth', 'browser_session'] },
    }

    assert.equal(resolveLaneForCommand(hybrid, 'gdrive.file.upload', 'hybrid'), 'oauth')
    assert.equal(resolveLaneForCommand(hybrid, 'x.tweet.send', 'hybrid'), 'browser_session')
    assert.equal(resolveLaneForCommand(hybrid, 'local.delete_batch', 'hybrid'), 'per_step')
  })

  test('save/load roundtrip works with injected storage', () => {
    const storage = new MemoryStorage()
    saveAuthProfiles([sampleOAuthProfile()], storage)
    const out = loadAuthProfiles(storage)
    assert.equal(out.length, 1)
    assert.equal(out[0]?.id, 'drive-oauth')
    assert.equal(out[0]?.oauth?.tokenRef, 'secret://drive/token')
  })
})

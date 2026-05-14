import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Install a minimal `localStorage` shim **before** importing the store so
 * zustand's `createJSONStorage(() => localStorage)` captures a working object.
 *
 * We **always** override — recent Node versions ship a built-in `localStorage`
 * that requires `--localstorage-file`, and without that flag its methods are
 * undefined, which breaks zustand's persist middleware.
 */
{
  const store: Record<string, string> = {}
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length
    },
  } satisfies Storage
}

const {
  agentAvatarLegacyKey,
  normalizeAgentAvatarIdentity,
  agentAvatarStorageKey,
  useAgentAvatarStore,
} = await import('./agentAvatarStore')

test('normalizeAgentAvatarIdentity: base name before dash', () => {
  assert.equal(normalizeAgentAvatarIdentity('Mei — deps scan'), 'Mei')
  assert.equal(normalizeAgentAvatarIdentity('  Sora  '), 'Sora')
  assert.equal(normalizeAgentAvatarIdentity('Hana - copy'), 'Hana')
  assert.equal(normalizeAgentAvatarIdentity('Hermes'), 'Hermes')
})

test('agentAvatarStorageKey matches normalized identity', () => {
  assert.equal(agentAvatarStorageKey('Mei — CI'), 'Mei')
})

test('agentAvatarLegacyKey: old composite format for migration reads', () => {
  assert.equal(agentAvatarLegacyKey('Mei', 'Frontend'), 'Mei::Frontend')
  assert.equal(agentAvatarLegacyKey('Hermes', undefined), 'Hermes')
  assert.equal(agentAvatarLegacyKey('  Sora  ', '  Research  '), 'Sora::Research')
  assert.equal(agentAvatarLegacyKey('', 'x'), '::x')
})

test('agentAvatarStore: same specialist shares avatar across roles', () => {
  useAgentAvatarStore.setState({ avatars: {} })
  const { setAvatar, getAvatar, clearAvatar } = useAgentAvatarStore.getState()

  setAvatar('Mei', 'Frontend', 'data:image/jpeg;base64,AAAA')
  assert.equal(getAvatar('Mei', 'Frontend'), 'data:image/jpeg;base64,AAAA')
  assert.equal(getAvatar('Mei', 'Backend'), 'data:image/jpeg;base64,AAAA')
  assert.equal(getAvatar('Mei — scan', 'X'), 'data:image/jpeg;base64,AAAA')

  setAvatar('Mei', 'Backend', 'data:image/jpeg;base64,BBBB')
  assert.equal(getAvatar('Mei', 'Frontend'), 'data:image/jpeg;base64,BBBB')

  clearAvatar('Mei', 'Frontend')
  assert.equal(getAvatar('Mei', 'Backend'), undefined)
  assert.equal(getAvatar('Mei — task', 'Y'), undefined)
})

test('agentAvatarStore: reads legacy Mei::role / Sora::role when primary key missing', () => {
  useAgentAvatarStore.setState({
    avatars: { 'Sora::Research': 'data:image/jpeg;base64,LEGACY' },
  })
  const { getAvatar } = useAgentAvatarStore.getState()
  assert.equal(getAvatar('Sora', 'Research'), 'data:image/jpeg;base64,LEGACY')
  assert.equal(getAvatar('Sora — paper', 'Research'), 'data:image/jpeg;base64,LEGACY')
})

test('agentAvatarStore: no-op on empty name or empty data URL', () => {
  useAgentAvatarStore.setState({ avatars: {} })
  const { setAvatar, getAvatar } = useAgentAvatarStore.getState()
  setAvatar('', undefined, 'data:image/jpeg;base64,AAAA')
  setAvatar('Hermes', undefined, '')
  assert.equal(Object.keys(useAgentAvatarStore.getState().avatars).length, 0)
  assert.equal(getAvatar('Hermes', undefined), undefined)
})

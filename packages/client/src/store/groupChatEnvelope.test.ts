/**
 * Envelope-level regression tests for `useGroupChatStore.postMessage`:
 * seq monotonicity, kind defaulting, threadId inheritance, provenance defaults,
 * schemaVersion stamping.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  GROUP_CHAT_SCHEMA_VERSION,
  useGroupChatStore,
} from './groupChatStore'

const SESSION = 'sess-envelope'

describe('groupChatStore envelope', () => {
  beforeEach(() => {
    useGroupChatStore.getState().clearForSession(SESSION)
  })

  it('stamps schemaVersion, monotonic seq, and default kind/provenance', () => {
    const a = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Alice',
      body: 'hello world',
      mentions: [],
    })
    const b = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Bob',
      body: 'another body',
      mentions: [],
    })
    assert.equal(a.schemaVersion, GROUP_CHAT_SCHEMA_VERSION)
    assert.equal(b.schemaVersion, GROUP_CHAT_SCHEMA_VERSION)
    assert.equal(a.seq, 1)
    assert.equal(b.seq, 2)
    assert.equal(a.kind, 'say')
    assert.equal(a.provenance.source, 'system')
    assert.equal(a.provenance.trust, 'trusted')
    // threadId defaults to self on a root message
    assert.equal(a.threadId, a.id)
    assert.equal(a.fingerprint && typeof a.fingerprint === 'string', true)
  })

  it('inherits threadId from replyTo target', () => {
    const root = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Alice',
      body: 'please review',
      mentions: [],
      kind: 'ask',
    })
    const reply = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Bob',
      body: 'on it',
      mentions: [],
      kind: 'ack',
      replyTo: root.id,
    })
    assert.equal(reply.threadId, root.threadId)
    assert.equal(reply.replyTo, root.id)
    assert.equal(reply.kind, 'ack')
  })

  it('preserves explicit provenance (external_http)', () => {
    const m = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'hermes@local',
      body: 'ping',
      mentions: [],
      provenance: { source: 'external_http', agent: 'hermes@local', trust: 'untrusted' },
    })
    assert.equal(m.provenance.source, 'external_http')
    assert.equal(m.provenance.trust, 'untrusted')
    assert.equal(m.provenance.agent, 'hermes@local')
  })

  it('listSince filters by seq and optional threadId', () => {
    const root = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Alice',
      body: 'q?',
      mentions: [],
      kind: 'ask',
    })
    useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Bob',
      body: 'unrelated',
      mentions: [],
    })
    useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Carol',
      body: 'in thread',
      mentions: [],
      replyTo: root.id,
    })
    const all = useGroupChatStore.getState().listSince(SESSION, 0)
    const thread = useGroupChatStore.getState().listSince(SESSION, 0, root.threadId)
    assert.equal(all.length, 3)
    assert.equal(thread.length, 2)
    assert.ok(thread.every((m) => m.threadId === root.threadId))
  })

  it('getMessageById returns the exact message', () => {
    const m = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Alice',
      body: 'find me',
      mentions: [],
    })
    const found = useGroupChatStore.getState().getMessageById(SESSION, m.id)
    assert.equal(found?.id, m.id)
  })
})

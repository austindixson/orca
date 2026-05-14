/**
 * Fingerprint + 2s window dedupe for `useGroupChatStore.postMessage`.
 * Identical re-posts within the window return `{ ..., deduped: true }` and do
 * NOT create a second message. Different bodies / kinds / senders do create
 * new entries.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { useGroupChatStore } from './groupChatStore'

const SESSION = 'sess-dedupe'

describe('groupChatStore dedupe', () => {
  beforeEach(() => {
    useGroupChatStore.getState().clearForSession(SESSION)
  })

  it('returns deduped=true for a repeat within 2s and keeps a single stored message', () => {
    const a = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Alice',
      body: 'same body',
      mentions: [],
    })
    const b = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Alice',
      body: 'same body',
      mentions: [],
    })
    assert.equal(a.deduped !== true, true)
    assert.equal(b.deduped, true)
    assert.equal(a.id, b.id)
    assert.equal(a.seq, b.seq)
    const all = useGroupChatStore.getState().listForSession(SESSION)
    assert.equal(all.length, 1)
  })

  it('different body → new message (no dedupe)', () => {
    const a = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Alice',
      body: 'one',
      mentions: [],
    })
    const b = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Alice',
      body: 'two',
      mentions: [],
    })
    assert.notEqual(a.id, b.id)
    assert.equal(b.deduped !== true, true)
    assert.equal(useGroupChatStore.getState().listForSession(SESSION).length, 2)
  })

  it('different kind → new message (not deduped)', () => {
    const a = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Alice',
      body: 'status check',
      mentions: [],
      kind: 'update',
    })
    const b = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'Alice',
      body: 'status check',
      mentions: [],
      kind: 'ask',
    })
    assert.notEqual(a.id, b.id)
    assert.equal(b.deduped !== true, true)
  })
})

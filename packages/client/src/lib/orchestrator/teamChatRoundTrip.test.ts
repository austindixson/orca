/**
 * End-to-end round-trip test for the team-chat inbox injector.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useGroupChatStore } from '../../store/groupChatStore'
import { collectAndFormatInboxForTile } from './teamChatInbox'

const SESSION = 'sess-rt'
const COORD = 'tile-coord'
const WORKER = 'tile-worker'
const OUTSIDER = 'tile-outsider'

function setup() {
  useGroupChatStore.getState().clearForSession(SESSION)
  useAgentTeamStore.getState().clear()

  useAgentTeamStore.getState().registerMember({
    tileId: COORD,
    displayName: 'Coord',
    role: 'coordinator',
  })
  useAgentTeamStore.getState().registerMember({
    tileId: WORKER,
    displayName: 'Mei',
    role: 'worker',
  })
  useAgentTeamStore.getState().registerMember({
    tileId: OUTSIDER,
    displayName: 'Outsider',
    role: 'worker',
  })
}

describe('teamChat round-trip inbox delivery', () => {
  beforeEach(setup)

  it('delivers @agent mentions to the addressed tile only', () => {
    useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderTileId: COORD,
      senderName: 'Coord',
      body: '@Mei please ship this',
      mentions: [{ raw: 'Mei', kind: 'agent', tileId: WORKER }],
      kind: 'handoff',
    })

    const toWorker = collectAndFormatInboxForTile(SESSION, WORKER)
    assert.ok(toWorker && toWorker.includes('please ship this'))

    const toOutsider = collectAndFormatInboxForTile(SESSION, OUTSIDER)
    assert.equal(toOutsider, null)

    const toSender = collectAndFormatInboxForTile(SESSION, COORD)
    assert.equal(toSender, null, 'sender must not receive their own message')
  })

  it('delivers directive kinds without mention to every recipient (session-wide)', () => {
    useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderTileId: COORD,
      senderName: 'Coord',
      body: 'blocked on CI',
      mentions: [],
      kind: 'blocker',
    })

    const toWorker = collectAndFormatInboxForTile(SESSION, WORKER)
    assert.ok(toWorker && toWorker.includes('blocked on CI'))

    const toOutsider = collectAndFormatInboxForTile(SESSION, OUTSIDER)
    assert.ok(toOutsider && toOutsider.includes('blocked on CI'))
  })

  it('does NOT re-deliver the same message on a second call (lastDeliveredSeq)', () => {
    useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderTileId: COORD,
      senderName: 'Coord',
      body: '@Mei land it',
      mentions: [{ raw: 'Mei', kind: 'agent', tileId: WORKER }],
      kind: 'ask',
    })

    const first = collectAndFormatInboxForTile(SESSION, WORKER)
    assert.ok(first && first.includes('land it'))

    const second = collectAndFormatInboxForTile(SESSION, WORKER)
    assert.equal(second, null, 'second call must return null (cursor advanced)')
  })

  it('honors freshnessTtlMs (stale directives are skipped)', () => {
    const now = Date.now()
    const posted = useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderTileId: COORD,
      senderName: 'Coord',
      body: 'ephemeral ping',
      mentions: [],
      kind: 'blocker',
      freshnessTtlMs: 10,
    })
    const arr = useGroupChatStore.getState().messagesBySession[SESSION]!
    arr[arr.length - 1] = { ...arr[arr.length - 1]!, createdAt: now - 1000 }
    useGroupChatStore.setState({
      messagesBySession: { ...useGroupChatStore.getState().messagesBySession, [SESSION]: [...arr] },
    })
    void posted
    const toWorker = collectAndFormatInboxForTile(SESSION, WORKER)
    assert.equal(toWorker, null, 'stale freshness window must drop the message')
  })

  it('renders external_http provenance with "via <agent>"', () => {
    useGroupChatStore.getState().postMessage({
      sessionId: SESSION,
      senderName: 'hermes@local',
      body: '@Mei take a look',
      mentions: [{ raw: 'Mei', kind: 'agent', tileId: WORKER }],
      kind: 'ask',
      provenance: { source: 'external_http', agent: 'hermes@local', trust: 'untrusted' },
    })
    const inbox = collectAndFormatInboxForTile(SESSION, WORKER)
    assert.ok(inbox && inbox.includes('via hermes@local'))
  })
})

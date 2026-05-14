import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDelegationResumeGroundingIfNeeded,
  DELEGATION_RESUME_GROUNDING_MARKER,
  delegationResumeGroundingStorageKey,
  hasDelegationResumeGroundingBeenInjected,
  markDelegationResumeGroundingInjected,
} from './delegationResumeGrounding'

const STORAGE_KEY = 'orca.delegationResumeGrounding.v1'

function clearGroundingStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

test('applyDelegationResumeGroundingIfNeeded: no prior messages — no inject', () => {
  clearGroundingStorage()
  const r = applyDelegationResumeGroundingIfNeeded({
    sessionMessages: [],
    workspaceRoot: '/tmp/ws',
    leadDelegationOnly: true,
    source: 'user',
  })
  assert.equal(r.injected, false)
  assert.equal(r.messages.length, 0)
})

test('applyDelegationResumeGroundingIfNeeded: injects once for legacy history', () => {
  clearGroundingStorage()
  const prior = [{ role: 'user' as const, content: 'old' }]
  const r = applyDelegationResumeGroundingIfNeeded({
    sessionMessages: prior,
    workspaceRoot: '/proj/a',
    leadDelegationOnly: true,
    source: 'user',
  })
  assert.equal(r.injected, true)
  assert.ok(r.messages[r.messages.length - 1]!.content.toString().includes(DELEGATION_RESUME_GROUNDING_MARKER))
  const key = delegationResumeGroundingStorageKey('/proj/a', 'default')
  assert.equal(hasDelegationResumeGroundingBeenInjected(key), true)
})

test('applyDelegationResumeGroundingIfNeeded: second call does not duplicate', () => {
  clearGroundingStorage()
  const prior = [{ role: 'user' as const, content: 'old' }]
  const first = applyDelegationResumeGroundingIfNeeded({
    sessionMessages: prior,
    workspaceRoot: '/proj/b',
    leadDelegationOnly: true,
    source: 'user',
  })
  assert.equal(first.injected, true)
  const second = applyDelegationResumeGroundingIfNeeded({
    sessionMessages: first.messages,
    workspaceRoot: '/proj/b',
    leadDelegationOnly: true,
    source: 'user',
  })
  assert.equal(second.injected, false)
  assert.equal(second.messages.length, first.messages.length)
})

test('applyDelegationResumeGroundingIfNeeded: skips sub_agent_handoff', () => {
  clearGroundingStorage()
  const prior = [{ role: 'user' as const, content: 'old' }]
  const r = applyDelegationResumeGroundingIfNeeded({
    sessionMessages: prior,
    workspaceRoot: '/proj/c',
    leadDelegationOnly: true,
    source: 'sub_agent_handoff',
  })
  assert.equal(r.injected, false)
})

test('applyDelegationResumeGroundingIfNeeded: skips when leadDelegationOnly false', () => {
  clearGroundingStorage()
  const prior = [{ role: 'user' as const, content: 'old' }]
  const r = applyDelegationResumeGroundingIfNeeded({
    sessionMessages: prior,
    workspaceRoot: '/proj/d',
    leadDelegationOnly: false,
    source: 'user',
  })
  assert.equal(r.injected, false)
})

test('applyDelegationResumeGroundingIfNeeded: idempotent when transcript already has marker', () => {
  clearGroundingStorage()
  const key = delegationResumeGroundingStorageKey('/proj/e', 'default')
  markDelegationResumeGroundingInjected(key)
  const prior = [
    { role: 'user' as const, content: `${DELEGATION_RESUME_GROUNDING_MARKER} already` },
  ]
  const r = applyDelegationResumeGroundingIfNeeded({
    sessionMessages: prior,
    workspaceRoot: '/proj/e',
    leadDelegationOnly: true,
    source: 'user',
  })
  assert.equal(r.injected, false)
})

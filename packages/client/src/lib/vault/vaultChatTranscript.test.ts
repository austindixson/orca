/**
 * Chat transcript mirror uses the same path scan rules as other Orca/*.md writes.
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { vaultMarkdownPathTriggersBrainScan } from './vaultBrainMirror'

describe('vaultChatTranscript brain scan scheduling', () => {
  test('Orca/chat transcript paths trigger graph rescan predicate', () => {
    assert.equal(vaultMarkdownPathTriggersBrainScan('Orca/chat/my-session.md'), true)
  })
})

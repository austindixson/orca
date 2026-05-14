/**
 * Vault mirror path rules and (light) integration hooks.
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { vaultMarkdownPathTriggersBrainScan } from './vaultBrainMirror'

describe('vaultMarkdownPathTriggersBrainScan', () => {
  test('matches wiki, orca, raw markdown (case-insensitive)', () => {
    assert.equal(vaultMarkdownPathTriggersBrainScan('wiki/state.md'), true)
    assert.equal(vaultMarkdownPathTriggersBrainScan('Orca/brain/sessions/x.md'), true)
    assert.equal(vaultMarkdownPathTriggersBrainScan('orca/brain/debug/self-test.md'), true)
    assert.equal(vaultMarkdownPathTriggersBrainScan('Orca/chat/foo.md'), true)
    assert.equal(vaultMarkdownPathTriggersBrainScan('raw/notes.md'), true)
  })

  test('ignores non-md and unrelated folders', () => {
    assert.equal(vaultMarkdownPathTriggersBrainScan('Orca/brain/x.txt'), false)
    assert.equal(vaultMarkdownPathTriggersBrainScan('src/foo.md'), false)
    assert.equal(vaultMarkdownPathTriggersBrainScan('docs/readme.md'), false)
  })
})

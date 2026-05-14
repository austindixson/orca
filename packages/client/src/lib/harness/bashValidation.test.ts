/**
 * Run: pnpm exec node --import tsx --test src/lib/harness/bashValidation.test.ts
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  destructiveCommandNeedsWarning,
  readOnlyBashWouldMutate,
  validateBashForMode,
} from './bashValidation.ts'

describe('bashValidation', () => {
  test('readOnlyBashWouldMutate flags rm and git push', () => {
    assert.equal(readOnlyBashWouldMutate('ls -la'), false)
    assert.equal(readOnlyBashWouldMutate('rm foo.txt'), true)
    assert.equal(readOnlyBashWouldMutate('git push origin main'), true)
  })

  test('validateBashForMode allows reads in read_only', () => {
    const a = validateBashForMode('npm test', 'read_only')
    assert.equal(a.allow, true)
  })

  test('validateBashForMode blocks mutating patterns in read_only', () => {
    const a = validateBashForMode('git commit -m x', 'read_only')
    assert.equal(a.allow, false)
    assert.ok(a.reason)
  })

  test('destructiveCommandNeedsWarning flags rm -rf', () => {
    assert.equal(destructiveCommandNeedsWarning('echo hi'), false)
    assert.equal(destructiveCommandNeedsWarning('rm -rf /tmp/x'), true)
  })
})

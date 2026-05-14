import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseSlashMenuQuery, replaceSlashTokenAtCursor } from './skillCommands'

describe('parseSlashMenuQuery', () => {
  it('activates at line start', () => {
    const value = '/deb'
    assert.deepEqual(parseSlashMenuQuery(value, value.length), { active: true, filter: 'deb' })
  })

  it('activates after whitespace', () => {
    const value = 'run /deb'
    assert.deepEqual(parseSlashMenuQuery(value, value.length), { active: true, filter: 'deb' })
  })

  it('does not activate inside URL trailing slash', () => {
    const value = 'https://getnyx.dev/'
    assert.deepEqual(parseSlashMenuQuery(value, value.length), { active: false, filter: '' })
  })

  it('does not activate at end of word', () => {
    const value = 'foo/'
    assert.deepEqual(parseSlashMenuQuery(value, value.length), { active: false, filter: '' })
  })
})

describe('replaceSlashTokenAtCursor', () => {
  it('replaces a valid slash token', () => {
    const value = 'run /deb'
    const next = replaceSlashTokenAtCursor(value, value.length, 'debug', true)
    assert.ok(next)
    assert.equal(next?.next, 'run /debug ')
  })

  it('does not replace slash inside URL', () => {
    const value = 'https://getnyx.dev/'
    assert.equal(replaceSlashTokenAtCursor(value, value.length, 'debug', true), null)
  })
})

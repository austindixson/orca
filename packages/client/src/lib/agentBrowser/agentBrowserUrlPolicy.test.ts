import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coerceBrowserLocalUrlToLatestTerminal,
  normalizeAndValidateAgentBrowserUrl,
} from './agentBrowserUrlPolicy'

test('normalizeAndValidateAgentBrowserUrl rejects example.com placeholder', () => {
  assert.throws(
    () => normalizeAndValidateAgentBrowserUrl('http://example.com'),
    /example\.com/
  )
})

test('normalizeAndValidateAgentBrowserUrl rejects 127.0.0.1', () => {
  assert.throws(
    () => normalizeAndValidateAgentBrowserUrl('http://127.0.0.1:3000'),
    /localhost/
  )
})

test('normalizeAndValidateAgentBrowserUrl accepts localhost with port', () => {
  const u = normalizeAndValidateAgentBrowserUrl('http://localhost:4321/path')
  assert.match(u, /^http:\/\/localhost:4321\//)
})

test('coerceBrowserLocalUrlToLatestTerminal passes through non-loopback URLs', () => {
  assert.equal(
    coerceBrowserLocalUrlToLatestTerminal('https://example.org/foo'),
    'https://example.org/foo'
  )
})

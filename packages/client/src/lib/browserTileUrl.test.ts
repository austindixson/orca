import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeBrowserTileInputUrl, normalizeLoopbackUrlForShell } from './browserTileUrl'

describe('normalizeLoopbackUrlForShell', () => {
  it('is a no-op when window is undefined (SSR/tests)', () => {
    assert.equal(normalizeLoopbackUrlForShell('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/')
  })

  it('aligns loopback hostname to the shell window (SAMEORIGIN iframe)', () => {
    const prev = globalThis.window
    ;(globalThis as { window: { location: { hostname: string } } }).window = {
      location: { hostname: '127.0.0.1' },
    }
    try {
      assert.equal(
        normalizeLoopbackUrlForShell('http://localhost:3000/path'),
        'http://127.0.0.1:3000/path'
      )
      assert.equal(
        normalizeLoopbackUrlForShell('http://127.0.0.1:3000/path'),
        'http://127.0.0.1:3000/path'
      )
    } finally {
      globalThis.window = prev
    }
  })
})

describe('normalizeBrowserTileInputUrl', () => {
  it('adds https to bare domains', () => {
    assert.equal(normalizeBrowserTileInputUrl('google.com'), 'https://google.com')
    assert.equal(normalizeBrowserTileInputUrl('docs.github.com/en'), 'https://docs.github.com/en')
  })

  it('adds http to localhost-like targets', () => {
    assert.equal(normalizeBrowserTileInputUrl('localhost:5173'), 'http://localhost:5173')
    assert.equal(normalizeBrowserTileInputUrl('127.0.0.1:3000/path'), 'http://127.0.0.1:3000/path')
  })

  it('preserves already-schemed urls', () => {
    assert.equal(normalizeBrowserTileInputUrl('https://example.com'), 'https://example.com')
    assert.equal(normalizeBrowserTileInputUrl('file:///tmp/x.html'), 'file:///tmp/x.html')
  })
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listHermesTools, invokeHermesTool } from './hermesServerTools'

/**
 * Stub global.fetch so the tools client exercises the same transport path
 * (agentFetch → fetch) without actually hitting localhost.
 */
function withFetchStub(
  stub: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>
): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input instanceof Request
        ? input.url
        : String(input)
    return stub(url, init)
  }) as typeof fetch
  return run().finally(() => {
    globalThis.fetch = original
  })
}

test('listHermesTools: returns array payload from `{ tools: [...] }`', async () => {
  await withFetchStub(
    async (url) => {
      assert.ok(url.endsWith('/tools'), `expected /tools URL, got ${url}`)
      return new Response(
        JSON.stringify({
          tools: [
            { name: 'hermes_kb_search', description: 'Knowledge base search' },
            { name: 'hermes_skill' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    },
    async () => {
      const res = await listHermesTools('http://127.0.0.1:8642/v1', undefined)
      assert.equal(res.ok, true)
      assert.equal(res.status, 200)
      assert.equal(res.tools.length, 2)
      assert.equal(res.tools[0].name, 'hermes_kb_search')
    }
  )
})

test('listHermesTools: tolerates a bare array body', async () => {
  await withFetchStub(
    async () =>
      new Response(JSON.stringify([{ name: 'hermes_web_search' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    async () => {
      const res = await listHermesTools('http://127.0.0.1:8642/v1', undefined)
      assert.equal(res.tools.length, 1)
      assert.equal(res.tools[0].name, 'hermes_web_search')
    }
  )
})

test('listHermesTools: 403 returns ok=false with error snippet', async () => {
  await withFetchStub(
    async () =>
      new Response(JSON.stringify({ detail: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    async () => {
      const res = await listHermesTools('http://127.0.0.1:8642/v1', 'stale')
      assert.equal(res.ok, false)
      assert.equal(res.status, 403)
      assert.equal(res.tools.length, 0)
      assert.ok(res.error && res.error.length > 0)
    }
  )
})

test('invokeHermesTool: POSTs JSON-wrapped input to /tools/{name}/invoke', async () => {
  await withFetchStub(
    async (url, init) => {
      assert.equal(
        url,
        'http://127.0.0.1:8642/v1/tools/hermes_kb_search/invoke',
        `unexpected URL: ${url}`
      )
      assert.equal((init?.method ?? 'GET').toUpperCase(), 'POST')
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      assert.deepEqual(body, { input: { query: 'hello' } })
      return new Response(JSON.stringify({ results: [{ id: 1 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
    async () => {
      const res = await invokeHermesTool(
        'http://127.0.0.1:8642/v1',
        undefined,
        'hermes_kb_search',
        { query: 'hello' }
      )
      assert.equal(res.ok, true)
      assert.equal(res.status, 200)
      assert.deepEqual(res.json, { results: [{ id: 1 }] })
    }
  )
})

test('invokeHermesTool: attaches Authorization header when UI key provided', async () => {
  await withFetchStub(
    async (_url, init) => {
      const auth = new Headers(init?.headers).get('Authorization')
      assert.equal(auth, 'Bearer sk-ui')
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
    async () => {
      const res = await invokeHermesTool(
        'http://127.0.0.1:8642/v1',
        'sk-ui',
        'hermes_skill',
        { name: 'summarize-repo' }
      )
      assert.equal(res.ok, true)
    }
  )
})

test('invokeHermesTool: non-2xx status surfaces as ok=false with text body', async () => {
  await withFetchStub(
    async () =>
      new Response('server error', { status: 500, headers: { 'content-type': 'text/plain' } }),
    async () => {
      const res = await invokeHermesTool(
        'http://127.0.0.1:8642/v1',
        undefined,
        'hermes_web_search',
        { query: 'x' }
      )
      assert.equal(res.ok, false)
      assert.equal(res.status, 500)
      assert.equal(res.text, 'server error')
      assert.equal(res.json, undefined)
    }
  )
})

test('invokeHermesTool: network failure → status=0 / ok=false', async () => {
  await withFetchStub(
    async () => {
      throw new TypeError('fetch failed')
    },
    async () => {
      const res = await invokeHermesTool(
        'http://127.0.0.1:8642/v1',
        undefined,
        'hermes_skill',
        { name: 'noop' }
      )
      assert.equal(res.ok, false)
      assert.equal(res.status, 0)
      assert.ok(res.text.includes('fetch failed'))
    }
  )
})

test('invokeHermesTool: URL-encodes tool name with special characters', async () => {
  await withFetchStub(
    async (url) => {
      assert.ok(
        url.includes('/tools/my%20skill/invoke'),
        `expected URL-encoded path, got ${url}`
      )
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
    async () => {
      await invokeHermesTool('http://127.0.0.1:8642/v1', undefined, 'my skill', {})
    }
  )
})

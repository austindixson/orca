import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractDeltaTextFromStreamEvent,
  formatHermesConnectionError,
  hermesConversationForTile,
  hermesResponsesEndpoint,
  probeHermesModels,
} from './hermesResponses'

test('hermesResponsesEndpoint appends /responses', () => {
  assert.equal(
    hermesResponsesEndpoint('http://127.0.0.1:8642/v1'),
    'http://127.0.0.1:8642/v1/responses'
  )
})

test('hermesConversationForTile', () => {
  assert.equal(hermesConversationForTile('tile-1'), 'orca-hermes-tile-1')
  assert.equal(hermesConversationForTile('x', { conversation: '  my-session  ' }), 'my-session')
  assert.equal(hermesConversationForTile('x', 'override-id'), 'override-id')
})

test('formatHermesConnectionError maps network / fetch failures', () => {
  const msg = formatHermesConnectionError(
    new Error('error sending request for url (http://127.0.0.1:8642/v1/responses)'),
    'http://127.0.0.1:8642/v1'
  )
  assert.ok(msg.includes('Cannot reach Hermes'))
  assert.ok(msg.includes('hermes gateway'))
  assert.ok(msg.includes('~/.hermes/.env'))
})

test('formatHermesConnectionError maps 403 to ~/.hermes/.env guidance', () => {
  const msg = formatHermesConnectionError(
    new Error('Hermes responses 403: {"detail":"invalid"}'),
    'http://127.0.0.1:8642/v1'
  )
  assert.ok(msg.includes('403'))
  assert.ok(msg.includes('API_SERVER_KEY'))
  assert.ok(msg.includes('~/.hermes/.env'))
})

test('formatHermesConnectionError maps 401', () => {
  const msg = formatHermesConnectionError(
    new Error('Hermes responses 401: unauthorized'),
    'http://127.0.0.1:8642/v1'
  )
  assert.ok(msg.includes('401'))
  assert.ok(msg.includes('~/.hermes/.env'))
})

test('formatHermesConnectionError returns raw message when nothing matches', () => {
  const raw = 'Something completely unexpected happened at runtime.'
  const msg = formatHermesConnectionError(new Error(raw), 'http://127.0.0.1:8642/v1')
  assert.equal(msg, raw)
})

test('extractDeltaTextFromStreamEvent handles output_text.delta', () => {
  assert.equal(
    extractDeltaTextFromStreamEvent({
      type: 'response.output_text.delta',
      delta: { text: 'Hello' },
    }),
    'Hello'
  )
})

test('extractDeltaTextFromStreamEvent handles output_item.done with message content', () => {
  assert.equal(
    extractDeltaTextFromStreamEvent({
      type: 'response.output_item.done',
      item: {
        type: 'message',
        content: [
          { type: 'output_text', text: 'Hello ' },
          { type: 'output_text', text: 'world' },
        ],
      },
    }),
    'Hello world'
  )
})

/** Stub global.fetch so probeHermesModels exercises the full code path. */
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

test('probeHermesModels: returns ok=true when /models responds 200', async () => {
  await withFetchStub(
    async (url) => {
      assert.ok(url.endsWith('/models'), `expected /models URL, got ${url}`)
      return new Response(JSON.stringify({ object: 'list', data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
    async () => {
      const probe = await probeHermesModels('http://127.0.0.1:8642/v1', undefined)
      assert.equal(probe.ok, true)
      assert.equal(probe.status, 200)
      assert.ok(probe.hint.length > 0)
    }
  )
})

test('probeHermesModels: 403 maps to auth-failed with ~/.hermes/.env hint', async () => {
  await withFetchStub(
    async () =>
      new Response(JSON.stringify({ detail: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    async () => {
      const probe = await probeHermesModels('http://127.0.0.1:8642/v1', 'some-stale-key')
      assert.equal(probe.ok, false)
      assert.equal(probe.status, 403)
      assert.ok(probe.hint.includes('~/.hermes/.env'))
    }
  )
})

test('probeHermesModels: network failure returns status=0 and ok=false', async () => {
  await withFetchStub(
    async () => {
      throw new TypeError('fetch failed')
    },
    async () => {
      const probe = await probeHermesModels('http://127.0.0.1:8642/v1', undefined)
      assert.equal(probe.ok, false)
      assert.equal(probe.status, 0)
    }
  )
})

test('probeHermesModels: attaches Authorization when UI key provided', async () => {
  await withFetchStub(
    async (_url, init) => {
      const auth = new Headers(init?.headers).get('Authorization')
      assert.equal(auth, 'Bearer sk-ui')
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
    async () => {
      const probe = await probeHermesModels('http://127.0.0.1:8642/v1', 'sk-ui')
      assert.equal(probe.ok, true)
    }
  )
})

test('probeHermesModels: no Authorization when UI key empty (node: no env fallback)', async () => {
  await withFetchStub(
    async (_url, init) => {
      const auth = new Headers(init?.headers).get('Authorization')
      assert.equal(auth, null)
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
    async () => {
      const probe = await probeHermesModels('http://127.0.0.1:8642/v1', undefined)
      assert.equal(probe.ok, true)
    }
  )
})

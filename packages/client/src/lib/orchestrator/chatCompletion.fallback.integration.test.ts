/**
 * Exercises Z.AI → OpenRouter hop and OpenRouter primary → configured fallback using a stubbed
 * global fetch (agentFetch delegates to fetch outside Tauri).
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  chatCompletionWithTools,
  resetZaiOpenRouterFallbackNoticeCoalesceForTests,
} from './chatCompletion'
import { useSettingsStore, ZAI_DEFAULT_MODEL_ID } from '../../store/settingsStore'
import { resetOpenRouterRateLimitFallbackForTests } from './openrouterRateLimitFallback'
import type { ChatCompletionResponse } from './types'

const minimalOk: ChatCompletionResponse = {
  id: 'test-completion',
  model: 'qwen/qwen3-coder-next',
  choices: [
    {
      message: { role: 'assistant', content: 'ok-from-fallback' },
      finish_reason: 'stop',
    },
  ],
}

describe('chatCompletion rate-limit fallback (mock fetch)', () => {
  let origFetch: typeof fetch

  beforeEach(() => {
    resetOpenRouterRateLimitFallbackForTests()
    resetZaiOpenRouterFallbackNoticeCoalesceForTests()
    origFetch = globalThis.fetch.bind(globalThis)
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it('Z.AI HTTP 429 then succeeds via OpenRouter fallback when OpenRouter is configured', async () => {
    const p = useSettingsStore.getState().providers
    useSettingsStore.setState({
      providers: {
        ...p,
        zai: { ...p.zai, enabled: true, apiKey: 'sk-zai-test' },
        openrouter: {
          ...p.openrouter,
          enabled: true,
          apiKey: 'sk-or-test',
          baseUrl: 'https://openrouter.ai/api/v1',
        },
      },
      openrouterRateLimitFallbackEnabled: true,
      openrouterRateLimitFallbackModelId: 'qwen/qwen3-coder-next',
    })

    let zaiCalls = 0
    let orCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input)
      if (u.includes('api.z.ai')) {
        zaiCalls++
        return new Response(JSON.stringify({ error: { message: 'rate limit' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (u.includes('openrouter.ai')) {
        orCalls++
        return new Response(JSON.stringify(minimalOk), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return origFetch(input as RequestInfo, init)
    }) as typeof fetch

    const res = await chatCompletionWithTools(
      'zai',
      ZAI_DEFAULT_MODEL_ID,
      'sk-zai-test',
      undefined,
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      60_000,
      {}
    )

    assert.equal(zaiCalls, 1, 'exactly one Z.AI request before hop')
    assert.equal(orCalls, 1, 'exactly one OpenRouter request after hop')
    assert.equal(res.choices[0]?.message?.content, 'ok-from-fallback')
  })

  it('OpenRouter primary 429 activates fallback and second request uses fallback slug', async () => {
    const p = useSettingsStore.getState().providers
    useSettingsStore.setState({
      providers: {
        ...p,
        openrouter: {
          ...p.openrouter,
          enabled: true,
          apiKey: 'sk-or-test',
          baseUrl: 'https://openrouter.ai/api/v1',
        },
      },
      openrouterRateLimitFallbackEnabled: true,
      openrouterRateLimitFallbackModelId: 'qwen/qwen3-coder-next',
    })

    /** Only count OpenRouter chat/completions — other code may call fetch (e.g. telemetry). */
    let orChatAttempts = 0
    const postedBodies: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input)
      const isOpenRouterChat =
        u.includes('openrouter.ai') && u.includes('chat/completions')
      if (!isOpenRouterChat) {
        return origFetch(input as RequestInfo, init)
      }
      orChatAttempts++
      if (init?.body) postedBodies.push(String(init.body))
      if (orChatAttempts === 1) {
        return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(minimalOk), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const primary = 'anthropic/claude-3.5-sonnet'
    const res = await chatCompletionWithTools(
      'openrouter',
      primary,
      'sk-or-test',
      'https://openrouter.ai/api/v1',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      60_000,
      {}
    )

    assert.equal(orChatAttempts, 2, '429 then success on OpenRouter chat/completions')
    assert.equal(res.choices[0]?.message?.content, 'ok-from-fallback')

    assert.equal(postedBodies.length, 2)
    const firstModel = JSON.parse(postedBodies[0]!).model as string
    const secondModel = JSON.parse(postedBodies[1]!).model as string
    assert.equal(firstModel, primary)
    assert.equal(secondModel, 'qwen/qwen3-coder-next')
  })

  it('onProviderNotice fires when hopping Z.AI to OpenRouter', async () => {
    const p = useSettingsStore.getState().providers
    const notices: string[] = []
    useSettingsStore.setState({
      providers: {
        ...p,
        zai: { ...p.zai, enabled: true, apiKey: 'sk-zai-test' },
        openrouter: {
          ...p.openrouter,
          enabled: true,
          apiKey: 'sk-or-test',
          baseUrl: 'https://openrouter.ai/api/v1',
        },
      },
      openrouterRateLimitFallbackEnabled: true,
      openrouterRateLimitFallbackModelId: 'qwen/qwen3-coder-next',
    })

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input)
      if (u.includes('api.z.ai')) {
        return new Response(JSON.stringify({ error: { code: '429' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(minimalOk), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    await chatCompletionWithTools(
      'zai',
      ZAI_DEFAULT_MODEL_ID,
      'sk-zai-test',
      undefined,
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      60_000,
      { onProviderNotice: (m) => notices.push(m) }
    )

    assert.ok(
      notices.some((n) => /OpenRouter fallback/i.test(n)),
      `expected notice in ${JSON.stringify(notices)}`
    )
  })

  it('xAI uses OpenAI-compatible chat/completions endpoint and bearer auth', async () => {
    let calledUrl = ''
    let auth = ''
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      auth = String((init?.headers as Record<string, string> | undefined)?.Authorization || '')
      return new Response(JSON.stringify(minimalOk), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const out = await chatCompletionWithTools(
      'xai',
      'grok-4.20-reasoning',
      'sk-xai-test',
      undefined,
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      60_000,
      {}
    )

    assert.equal(calledUrl, 'https://api.x.ai/v1/chat/completions')
    assert.equal(auth, 'Bearer sk-xai-test')
    assert.equal(out.choices[0]?.message?.content, 'ok-from-fallback')
  })

  it('does not retry non-retryable HTTP 400 errors (Hermes Responses)', async () => {
    let attempts = 0
    let retryNotices = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input)
      if (u.includes('/v1/responses')) {
        attempts++
        return new Response('No user message found in input', {
          status: 400,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
      return origFetch(input as RequestInfo, init)
    }) as typeof fetch

    await assert.rejects(
      () =>
        chatCompletionWithTools(
          'hermes',
          'hermes-agent',
          undefined,
          'http://127.0.0.1:8642/v1',
          [{ role: 'user', content: 'hi' }],
          [],
          undefined,
          60_000,
          {
            onRetry: () => {
              retryNotices += 1
            },
          }
        ),
      /No user message found in input/i
    )

    assert.equal(attempts, 1, 'HTTP 400 should not be retried')
    assert.equal(retryNotices, 0, 'onRetry should not fire for non-retryable 400')
  })
})

import { OPENAI_CODEX_DEFAULT_BASE, XAI_DEFAULT_BASE, ZAI_DEFAULT_BASE, useSettingsStore } from '../../store/settingsStore'
import type { Provider } from '../../store/settingsStore'
import { resolveBaseUrl } from '../llmCredentials'
import { agentFetch } from '../agentFetch'
import { formatAgentHttpError } from '../agentErrors'
import { ORCHESTRATOR_CHAT_TIMEOUT_MS } from './orchestratorConstants'
import { runZaiChatCompletionQueued } from './orchestratorZaiQueue'
import type { ChatMessage } from './types'
import { useReasoningTraceStore } from '../../store/reasoningTraceStore'
import { anthropicStreamChatCompletionText } from './anthropicChat'
import {
  buildOpenAiCodexHeaders,
  buildOpenAiCodexResponsesBody,
  buildAzureOpenAiChatCompletionsUrl,
  chatCompletionWithTools,
  orchestratorChatOptionsFromStore,
  parseRetryAfterMs,
  resolveOpenAiCodexResponsesUrl,
  retryBudgetForHttpStatus,
} from './chatCompletion'
import { abortableSleep } from './abortable'
import {
  getEffectiveOpenRouterModel,
  shouldAttemptOpenRouterRateLimitFallback,
  tryActivateOpenRouterRateLimitFallback,
} from './openrouterRateLimitFallback'
import { bedrockChatCompletionWithTools } from './bedrockAnthropicInvoke'
import type { ChatCompletionResponse } from './types'
import { responsesApiJsonToChatCompletion } from './openaiResponsesAdapter'

/** Same semantics as chatCompletion.ts — keep timeout armed through full SSE body read. */
function mergeAbortWithTimeout(
  user: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; dispose: () => void } {
  const c = new AbortController()
  const t = globalThis.setTimeout(() => {
    c.abort(
      new DOMException(
        `Chat request timed out after ${Math.round(timeoutMs / 1000)}s — check the network or model.`,
        'TimeoutError'
      )
    )
  }, timeoutMs)

  const onUser = () => {
    globalThis.clearTimeout(t)
    c.abort(user!.reason)
  }

  if (user) {
    if (user.aborted) {
      globalThis.clearTimeout(t)
      c.abort(user.reason)
    } else {
      user.addEventListener('abort', onUser, { once: true })
    }
  }

  const dispose = () => {
    globalThis.clearTimeout(t)
    if (user && !user.aborted) {
      user.removeEventListener('abort', onUser)
    }
  }

  return { signal: c.signal, dispose }
}

/** Shared by OpenAI-style planning streams (incl. OpenRouter with retry/fallback). */
async function readOpenAiPlanningSseBody(
  response: Response,
  onDelta: (accumulated: string) => void
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Planning stream: empty response body')
  }

  const decoder = new TextDecoder()
  let sseBuffer = ''
  let accumulated = ''

  const flushLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (data === '[DONE]') return
    try {
      const json = JSON.parse(data) as {
        choices?: Array<{ delta?: Record<string, unknown> }>
      }
      const d = json.choices?.[0]?.delta
      if (!d) return
      const reasoningRaw = d.reasoning ?? d.reasoning_content ?? d.thinking
      if (typeof reasoningRaw === 'string' && reasoningRaw) {
        useReasoningTraceStore.getState().mergeLast('reasoning', reasoningRaw)
      }
      const c = d.content
      if (typeof c === 'string' && c) {
        accumulated += c
        onDelta(accumulated)
        useReasoningTraceStore.getState().mergeLast('content', c)
      }
    } catch {
      /* ignore partial JSON lines */
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      sseBuffer += decoder.decode(value, { stream: true })
      const parts = sseBuffer.split('\n')
      sseBuffer = parts.pop() ?? ''
      for (const line of parts) flushLine(line)
    }
    if (sseBuffer.trim()) {
      for (const line of sseBuffer.split('\n')) flushLine(line)
    }
  } finally {
    reader.releaseLock()
  }

  if (!accumulated.trim()) {
    throw new Error('Planning stream returned empty assistant content')
  }
  return accumulated
}

function zaiChatCompletionsUrl(rawBase: string): string {
  const t = rawBase.trim().replace(/\/+$/, '')
  if (/\/chat\/completions(\?|$)/.test(t)) return t
  return `${t}/chat/completions`
}

function openRouterChatCompletionsUrl(rawBase: string): string {
  const t = rawBase.trim().replace(/\/+$/, '')
  if (!t) return 'https://openrouter.ai/api/v1/chat/completions'
  if (/\/chat\/completions(\?|$)/.test(t)) return t
  if (/\/api\/v1$/i.test(t)) return `${t}/chat/completions`
  if (/openrouter\.ai$/i.test(t)) return `${t}/api/v1/chat/completions`
  return `${t}/chat/completions`
}

function isZaiVisionModel(model: string): boolean {
  return /(?:^|[\W_])(glm-(?:5v|4\.6v|4\.5v))/i.test(model) || /glm-5v-turbo/i.test(model)
}

function assistantTextFromCompletion(res: ChatCompletionResponse): string {
  const c = res.choices?.[0]?.message?.content
  return typeof c === 'string' ? c : ''
}

function extractResponsesDeltaText(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return ''
  const o = obj as Record<string, unknown>
  const type = String(o.type ?? '')
  if (type.includes('output_text.delta') || type === 'response.output_text.delta') {
    const d = o.delta
    if (d && typeof d === 'object') {
      const t = (d as Record<string, unknown>).text
      if (typeof t === 'string') return t
    }
    const t = o.text ?? o.delta
    if (typeof t === 'string') return t
  }
  if (type === 'response.output_item.done' || type.includes('output_item.done')) {
    const item = o.item
    if (item && typeof item === 'object') {
      const it = item as Record<string, unknown>
      if (it.type === 'message' && Array.isArray(it.content)) {
        let s = ''
        for (const block of it.content) {
          if (!block || typeof block !== 'object') continue
          const b = block as Record<string, unknown>
          if (b.type === 'output_text' && typeof b.text === 'string') s += b.text
        }
        return s
      }
    }
  }
  return ''
}

function mergeResponsesReasoning(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return
  const o = obj as Record<string, unknown>
  const type = String(o.type ?? '')
  if (!type.includes('reasoning')) return
  const delta = o.delta
  if (typeof delta === 'string' && delta) {
    useReasoningTraceStore.getState().mergeLast('reasoning', delta)
    return
  }
  if (delta && typeof delta === 'object') {
    const d = delta as Record<string, unknown>
    const text =
      typeof d.text === 'string'
        ? d.text
        : typeof d.summary === 'string'
          ? d.summary
          : typeof d.content === 'string'
            ? d.content
            : ''
    if (text) useReasoningTraceStore.getState().mergeLast('reasoning', text)
  }
}

function isZaiCodingPlanModel(model: string): boolean {
  const t = model.toLowerCase()
  return (
    isZaiVisionModel(model) ||
    /glm-(?:4\.5|4\.6|4\.7|5(?:\.1)?)(?:$|[\W_])/i.test(t)
  )
}

function zaiBaseForModel(model: string, rawBase: string): string {
  const trimmed = (rawBase || '').trim() || ZAI_DEFAULT_BASE
  if (!isZaiCodingPlanModel(model)) return trimmed
  if (/\/api\/paas\/v4/i.test(trimmed)) {
    return trimmed.replace(/\/api\/paas\/v4/i, '/api/coding/paas/v4')
  }
  return trimmed || ZAI_DEFAULT_BASE
}

async function streamChatCompletionTextInner(
  provider: Provider,
  model: string,
  apiKey: string | undefined,
  baseUrlFromSettings: string | undefined,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  onDelta: (accumulated: string) => void,
  requestTimeoutMs: number
): Promise<string> {
  let apiUrl: string
  let headers: Record<string, string>
  let body: Record<string, unknown>

  if (provider === 'anthropic') {
    const key = apiKey?.trim()
    if (!key) {
      throw new Error(
        'Anthropic: add an API key in Settings, or use Pi OAuth credentials in ~/.pi/agent/auth.json (desktop).'
      )
    }
    const baseResolved = await resolveBaseUrl('anthropic', baseUrlFromSettings)
    const { signal: mergedSignal, dispose } = mergeAbortWithTimeout(signal, requestTimeoutMs)
    try {
      return await anthropicStreamChatCompletionText(
        model,
        key,
        baseResolved,
        messages,
        mergedSignal,
        onDelta,
        requestTimeoutMs
      )
    } finally {
      dispose()
    }
  }

  if (provider === 'bedrock') {
    const region = (await resolveBaseUrl('bedrock', baseUrlFromSettings)) || 'us-east-1'
    const res = await bedrockChatCompletionWithTools(
      region,
      model,
      messages,
      [],
      signal,
      requestTimeoutMs
    )
    const text = assistantTextFromCompletion(res)
    onDelta(text)
    return text
  }

  if (
    (provider === 'openai' || provider === 'azureOpenai') &&
    (provider === 'openai'
      ? useSettingsStore.getState().providers.openai.authMode !== 'oauth' &&
        useSettingsStore.getState().providers.openai.useResponsesApi
      : useSettingsStore.getState().providers[provider]?.useResponsesApi)
  ) {
    const res = await chatCompletionWithTools(
      provider,
      model,
      apiKey,
      baseUrlFromSettings,
      messages,
      [],
      signal,
      requestTimeoutMs,
      orchestratorChatOptionsFromStore(provider)
    )
    const text = assistantTextFromCompletion(res)
    onDelta(text)
    return text
  }

  if (provider === 'openaiCodex') {
    const key = apiKey?.trim()
    if (!key) {
      throw new Error('OpenAI Codex: sign in with ChatGPT (Codex) or set a token in Settings.')
    }
    const root = (await resolveBaseUrl('openaiCodex', baseUrlFromSettings)) || OPENAI_CODEX_DEFAULT_BASE
    apiUrl = resolveOpenAiCodexResponsesUrl(root)
    headers = buildOpenAiCodexHeaders(key, undefined, 'text/event-stream')
    body = buildOpenAiCodexResponsesBody(model, messages, [], undefined, true)
    const { signal: mergedSignal, dispose } = mergeAbortWithTimeout(signal, requestTimeoutMs)
    try {
      const response = await agentFetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: mergedSignal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(formatAgentHttpError(response.status, errorText, provider))
      }

      const reader = response.body?.getReader()
      if (!reader) {
        const raw = (await response.json()) as unknown
        const text = assistantTextFromCompletion(responsesApiJsonToChatCompletion(raw))
        if (!text.trim()) throw new Error('Planning stream returned empty assistant content')
        onDelta(text)
        return text
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''

      const flushPayload = (payload: string) => {
        if (!payload || payload === '[DONE]') return
        try {
          const obj = JSON.parse(payload) as Record<string, unknown>
          mergeResponsesReasoning(obj)
          const evtType = String(obj.type ?? '')
          const delta = extractResponsesDeltaText(obj)
          if (delta) {
            if (evtType === 'response.output_item.done' || evtType.includes('output_item.done')) {
              accumulated = delta
            } else {
              accumulated += delta
              useReasoningTraceStore.getState().mergeLast('content', delta)
            }
            onDelta(accumulated)
          }
          if (Array.isArray(obj.output)) {
            const text = assistantTextFromCompletion(responsesApiJsonToChatCompletion(obj))
            if (text && text.length >= accumulated.length) {
              accumulated = text
              onDelta(accumulated)
            }
          }
        } catch {
          /* ignore partial JSON lines */
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() ?? ''
          for (const block of blocks) {
            for (const line of block.split('\n')) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) continue
              flushPayload(trimmed.slice(5).trim())
            }
          }
        }
        if (buffer.trim()) {
          for (const line of buffer.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            flushPayload(trimmed.slice(5).trim())
          }
        }
      } finally {
        reader.releaseLock()
      }

      if (!accumulated.trim()) {
        throw new Error('Planning stream returned empty assistant content')
      }
      return accumulated
    } finally {
      dispose()
    }
  }

  switch (provider) {
    case 'openai': {
      const root =
        (await resolveBaseUrl('openai', baseUrlFromSettings)) || 'https://api.openai.com/v1'
      apiUrl = `${root.replace(/\/$/, '')}/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    case 'openrouter': {
      const orUrl =
        (await resolveBaseUrl('openrouter', baseUrlFromSettings)) || baseUrlFromSettings
      apiUrl = openRouterChatCompletionsUrl(orUrl || '')
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    case 'google': {
      const root =
        (await resolveBaseUrl('google', baseUrlFromSettings)) ||
        'https://generativelanguage.googleapis.com/v1beta/openai'
      apiUrl = `${root.replace(/\/$/, '')}/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    case 'xai': {
      const root = (await resolveBaseUrl('xai', baseUrlFromSettings)) || XAI_DEFAULT_BASE
      apiUrl = `${root.replace(/\/$/, '')}/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    case 'zai': {
      const zaiResolved =
        (await resolveBaseUrl('zai', baseUrlFromSettings)) || baseUrlFromSettings || ''
      const zaiBase = zaiBaseForModel(model, zaiResolved.trim() || ZAI_DEFAULT_BASE)
      apiUrl = zaiChatCompletionsUrl(zaiBase)
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Accept-Language': 'en-US,en',
      }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    case 'ollama': {
      const host =
        (await resolveBaseUrl('ollama', baseUrlFromSettings)) ||
        baseUrlFromSettings ||
        'http://127.0.0.1:11434'
      apiUrl = `${host.replace(/\/$/, '')}/v1/chat/completions`
      headers = { 'Content-Type': 'application/json' }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    case 'llamacpp': {
      const host =
        (await resolveBaseUrl('llamacpp', baseUrlFromSettings)) ||
        baseUrlFromSettings ||
        'http://127.0.0.1:8000'
      apiUrl = `${host.replace(/\/$/, '')}/v1/chat/completions`
      headers = { 'Content-Type': 'application/json' }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    case 'mistral': {
      const root =
        (await resolveBaseUrl('mistral', baseUrlFromSettings)) || 'https://api.mistral.ai/v1'
      apiUrl = `${root.replace(/\/$/, '')}/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    case 'azureOpenai': {
      const root = await resolveBaseUrl('azureOpenai', baseUrlFromSettings)
      if (!root?.trim()) {
        throw new Error('Azure OpenAI: set resource endpoint in Settings.')
      }
      const dep = useSettingsStore.getState().providers.azureOpenai.azureDeployment
      apiUrl = buildAzureOpenAiChatCompletionsUrl(root, dep)
      headers = {
        'Content-Type': 'application/json',
        'api-key': apiKey ?? '',
      }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    case 'githubCopilot': {
      const root =
        (await resolveBaseUrl('githubCopilot', baseUrlFromSettings)) || 'https://api.githubcopilot.com'
      apiUrl = `${root.replace(/\/$/, '')}/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Editor-Version': 'vscode/1.96.0',
        'Copilot-Integration-Id': 'vscode-chat',
      }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    case 'googleVertex': {
      const root = await resolveBaseUrl('googleVertex', baseUrlFromSettings)
      if (!root?.trim()) {
        throw new Error('Vertex AI: set OpenAI-compatible endpoint root in Settings.')
      }
      apiUrl = `${root.replace(/\/$/, '')}/v1/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = { model, messages, temperature: 0.3, stream: true }
      break
    }
    default:
      throw new Error(
        `Planning stream needs an OpenAI-compatible provider (incl. Google Gemini OpenAI API). Got: ${provider}`
      )
  }

  if (provider === 'openrouter') {
    const maxAttempts = 8
    let retryBudget = maxAttempts - 1
    let lastError: Error | null = null
    for (let attempt = 0; attempt < maxAttempts && retryBudget >= 0; attempt++) {
      body.model = getEffectiveOpenRouterModel(model)
      const { signal: mergedSignal, dispose } = mergeAbortWithTimeout(signal, requestTimeoutMs)
      try {
        const response = await agentFetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: mergedSignal,
        })

        if (!response.ok) {
          const errorText = await response.text()
          const err = new Error(formatAgentHttpError(response.status, errorText, provider))
          lastError = err
          const statusRetryBudget = retryBudgetForHttpStatus(response.status, errorText, provider)
          retryBudget = Math.min(retryBudget - 1, statusRetryBudget)
          if (retryBudget < 0) throw err

          if (
            shouldAttemptOpenRouterRateLimitFallback(response.status, errorText) &&
            tryActivateOpenRouterRateLimitFallback(model, String(body.model))
          ) {
            console.debug(
              `[Orchestrator] planning stream OpenRouter rate limit — using fallback model; retrying (${attempt + 1}/${maxAttempts})`
            )
            continue
          }

          const fromHeader = parseRetryAfterMs(response)
          const exponential = Math.min(3000 * 2 ** attempt, 90_000)
          const jitter = exponential * (0.85 + Math.random() * 0.3)
          const waitMs = fromHeader ?? jitter
          console.debug(
            `[Orchestrator] planning stream HTTP ${response.status} — backoff ${Math.round(waitMs)}ms (${attempt + 1}/${maxAttempts})`
          )
          await abortableSleep(waitMs, signal)
          continue
        }

        return await readOpenAiPlanningSseBody(response, onDelta)
      } finally {
        dispose()
      }
    }
    throw lastError ?? new Error('OpenRouter planning stream failed after retries')
  }

  const { signal: mergedSignal, dispose } = mergeAbortWithTimeout(signal, requestTimeoutMs)
  try {
    const response = await agentFetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: mergedSignal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(formatAgentHttpError(response.status, errorText, provider))
    }

    return await readOpenAiPlanningSseBody(response, onDelta)
  } finally {
    dispose()
  }
}

/**
 * OpenAI-style SSE streaming for **text-only** planning calls (no tools).
 * Serialized through the Z.AI queue when `provider === 'zai'`.
 */
export async function streamChatCompletionText(
  provider: Provider,
  model: string,
  apiKey: string | undefined,
  baseUrlFromSettings: string | undefined,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  onDelta: (accumulated: string) => void,
  requestTimeoutMs: number = ORCHESTRATOR_CHAT_TIMEOUT_MS
): Promise<string> {
  const inner = (): Promise<string> =>
    streamChatCompletionTextInner(
      provider,
      model,
      apiKey,
      baseUrlFromSettings,
      messages,
      signal,
      onDelta,
      requestTimeoutMs
    )
  if (provider === 'zai') {
    return runZaiChatCompletionQueued(signal, inner)
  }
  return inner()
}

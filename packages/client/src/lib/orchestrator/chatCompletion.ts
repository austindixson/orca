import {
  HERMES_API_DEFAULT_BASE,
  migrateLegacyOpenAiCodexModelId,
  normalizeHermesApiBaseUrl,
  OPENAI_CODEX_DEFAULT_BASE,
  XAI_DEFAULT_BASE,
  ZAI_DEFAULT_BASE,
  useSettingsStore,
} from '../../store/settingsStore'
import type { Provider } from '../../store/settingsStore'
import { useOpenRouterUsageStore } from '../../store/openRouterUsageStore'
import { resolveBaseUrl } from '../llmCredentials'
import { agentFetch } from '../agentFetch'
import { formatAgentHttpError } from '../agentErrors'
import { ORCHESTRATOR_CHAT_TIMEOUT_MS } from './orchestratorConstants'
import { noteZaiRateLimit, runZaiChatCompletionQueued } from './orchestratorZaiQueue'
import { APIConnectionError, APIError } from '@anthropic-ai/sdk'
import type { ChatCompletionResponse, ChatMessage } from './types'
import { stripAssistantToolArtifacts } from './stripAssistantToolArtifacts'
import { abortableSleep } from './abortable'
import { anthropicChatCompletionWithTools, openAiToolsToAnthropic } from './anthropicChat'
import {
  buildResponsesRequestBody,
  responsesApiJsonToChatCompletion,
  responsesEndpointForOpenAiBase,
} from './openaiResponsesAdapter'
import { bedrockChatCompletionWithTools } from './bedrockAnthropicInvoke'
import {
  getEffectiveOpenRouterModel,
  OPENROUTER_RATE_LIMIT_FALLBACK_MODEL_IDS,
  shouldActivateOpenRouterFallbackAfterRateLimitFailures,
  shouldAttemptOpenRouterRateLimitFallback,
  tryActivateOpenRouterRateLimitFallback,
} from './openrouterRateLimitFallback'
import { throwIfProviderErrorObjectWithoutChoices } from './chatCompletionBodyGuards'

/**
 * Coalesce rapid Z.AI → OpenRouter fallback notices (activity + console) while
 * still performing every provider hop.
 */
let zaiOpenRouterFallbackNoticeAt = 0
let zaiOpenRouterFallbackCoalesced = 0
const ZAI_OPENROUTER_FALLBACK_NOTICE_COOLDOWN_MS = 12_000

export function emitZaiOpenRouterFallbackNotice(
  model: string,
  onNotice?: (message: string) => void
): void {
  const now = Date.now()
  if (now - zaiOpenRouterFallbackNoticeAt < ZAI_OPENROUTER_FALLBACK_NOTICE_COOLDOWN_MS) {
    zaiOpenRouterFallbackCoalesced += 1
    return
  }
  const extra = zaiOpenRouterFallbackCoalesced
  zaiOpenRouterFallbackCoalesced = 0
  zaiOpenRouterFallbackNoticeAt = now
  let line = `[Orchestrator] Z.AI rate limited — switching to OpenRouter fallback (${model}).`
  if (extra > 0) {
    line += ` (${extra} similar rate-limit hop${extra === 1 ? '' : 's'} coalesced.)`
  }
  console.warn(line)
  onNotice?.(line)
}

/** Clears Z.AI→OpenRouter notice coalesce window (unit / integration tests). */
export function resetZaiOpenRouterFallbackNoticeCoalesceForTests(): void {
  zaiOpenRouterFallbackNoticeAt = 0
  zaiOpenRouterFallbackCoalesced = 0
}

/** @public Hermes tile + tests — same URL as orchestrator Z.AI chat. */
export function zaiChatCompletionsUrl(rawBase: string): string {
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

export const AZURE_OPENAI_API_VERSION_QUERY = 'api-version=2024-08-01-preview'

function azureOpenAiChatCompletionsUrl(base: string, deployment: string | undefined): string {
  const b = base.trim().replace(/\/$/, '')
  const d = deployment?.trim()
  if (d) {
    return `${b}/openai/deployments/${encodeURIComponent(d)}/chat/completions?${AZURE_OPENAI_API_VERSION_QUERY}`
  }
  if (/\/openai\/v1$/i.test(b)) {
    return `${b}/chat/completions?${AZURE_OPENAI_API_VERSION_QUERY}`
  }
  return `${b}/openai/v1/chat/completions?${AZURE_OPENAI_API_VERSION_QUERY}`
}

function azureOpenAiResponsesUrl(base: string, deployment: string | undefined): string {
  const b = base.trim().replace(/\/$/, '')
  const d = deployment?.trim()
  if (d) {
    return `${b}/openai/deployments/${encodeURIComponent(d)}/responses?${AZURE_OPENAI_API_VERSION_QUERY}`
  }
  return `${b}/openai/v1/responses?${AZURE_OPENAI_API_VERSION_QUERY}`
}

const OPENAI_CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth'

export function resolveOpenAiCodexResponsesUrl(base: string): string {
  const b = base.trim().replace(/\/+$/, '')
  if (b.endsWith('/codex/responses')) return b
  if (b.endsWith('/codex')) return `${b}/responses`
  return `${b}/codex/responses`
}

function extractOpenAiCodexAccountId(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as Record<string, unknown>
    const root = payload[OPENAI_CODEX_JWT_CLAIM_PATH]
    if (!root || typeof root !== 'object') throw new Error('missing account block')
    const accountId = (root as Record<string, unknown>).chatgpt_account_id
    if (typeof accountId !== 'string' || !accountId.trim()) throw new Error('missing account id')
    return accountId
  } catch {
    throw new Error('OpenAI Codex OAuth token is missing the ChatGPT account id.')
  }
}

export function buildOpenAiCodexHeaders(
  token: string,
  sessionId?: string,
  accept: 'application/json' | 'text/event-stream' = 'application/json'
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'chatgpt-account-id': extractOpenAiCodexAccountId(token),
    originator: 'orca',
    'OpenAI-Beta': 'responses=experimental',
    accept,
    'Content-Type': 'application/json',
  }
  if (sessionId?.trim()) {
    headers.session_id = sessionId.trim()
    headers['x-client-request-id'] = sessionId.trim()
  }
  return headers
}

export function buildOpenAiCodexResponsesBody(
  model: string,
  messages: ChatMessage[],
  tools: unknown[],
  sessionId?: string,
  stream: boolean = false
): Record<string, unknown> {
  const systemPrompt = messages
    .filter((m): m is Extract<ChatMessage, { role: 'system' }> => m.role === 'system')
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join('\n\n')
  const nonSystemMessages = messages.filter((m) => m.role !== 'system')
  const body: Record<string, unknown> = {
    model,
    store: false,
    stream,
    input: chatMessagesToCodexInput(nonSystemMessages),
    text: { verbosity: 'medium' },
    include: ['reasoning.encrypted_content'],
    prompt_cache_key: sessionId,
  }
  if (systemPrompt) body.instructions = systemPrompt
  if (tools.length > 0) {
    const toolBody = buildResponsesRequestBody({ model, messages: nonSystemMessages, tools })
    if (Array.isArray(toolBody.tools)) body.tools = toolBody.tools
    body.tool_choice = 'auto'
    body.parallel_tool_calls = true
  }
  return body
}

export function chatMessagesToCodexInput(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      out.push({ role: 'user', content: [{ type: 'input_text', text: c }] })
      continue
    }
    if (m.role === 'assistant') {
      const blocks: Array<{ type: 'output_text'; text: string }> = []
      const text = typeof m.content === 'string' ? m.content.trim() : ''
      if (text) blocks.push({ type: 'output_text', text })
      if (m.tool_calls?.length) {
        const toolSummary = m.tool_calls
          .map((tc) => {
            const name = tc.function?.name?.trim() || 'unknown_tool'
            const args = tc.function?.arguments?.trim() || '{}'
            return `Tool call: ${name}\nArguments: ${args}`
          })
          .join('\n\n')
        if (toolSummary) {
          blocks.push({ type: 'output_text', text: toolSummary })
        }
      }
      if (blocks.length > 0) {
        out.push({ role: 'assistant', content: blocks })
      }
      continue
    }
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `[Tool result for ${m.tool_call_id}]\n${m.content}`,
          },
        ],
      })
    }
  }
  return out
}

export function extractOpenAiCodexDeltaText(obj: unknown): string {
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

/**
 * Replay a sequence of Responses-API SSE events and return the final assistant text.
 *
 * `response.output_item.done` delivers the **full** message snapshot, not a
 * per-token delta — appending it onto accumulated `output_text.delta` chunks
 * would double the reply (bug: "Hi! How can I help?Hi! How can I help?"). We
 * therefore overwrite on the snapshot event and append on streaming deltas.
 *
 * Exported for regression coverage in `openaiResponsesAdapter.test.ts`.
 */
export function accumulateOpenAiCodexStreamText(events: Iterable<unknown>): string {
  let accumulated = ''
  for (const obj of events) {
    if (!obj || typeof obj !== 'object') continue
    const o = obj as Record<string, unknown>
    const evtType = String(o.type ?? '')
    const delta = extractOpenAiCodexDeltaText(obj)
    if (delta) {
      if (evtType === 'response.output_item.done' || evtType.includes('output_item.done')) {
        accumulated = delta
      } else {
        accumulated += delta
      }
    }
    if (Array.isArray(o.output)) {
      const cc = responsesApiJsonToChatCompletion(obj)
      const text = cc.choices?.[0]?.message?.content
      if (typeof text === 'string' && text.length >= accumulated.length) {
        accumulated = text
      }
    }
  }
  return accumulated
}

/**
 * Normalize Orca catalog ids to model names accepted by OpenAI Codex `POST /codex/responses`.
 *
 * Orca stores Codex models as ids like `codex-gpt-5.4`, but ChatGPT account Codex API
 * expects bare names (`gpt-5.4`, `gpt-5.4-mini`, `gpt-5.2`).
 */
export function resolveCodexResponsesWireModelId(model: string): string {
  const migrated = migrateLegacyOpenAiCodexModelId(model) ?? model
  if (migrated === 'codex-gpt-5.4') return 'gpt-5.4'
  if (migrated === 'codex-gpt-5.4-mini') return 'gpt-5.4-mini'
  if (migrated === 'codex-gpt-5.2') return 'gpt-5.2'
  return migrated
}

/**
 * Finalize Codex SSE parsing: prefer a completion that includes tool calls even when
 * assistant text is empty; fall back to accumulated text only when no structured tool calls exist.
 * Exported for regression tests.
 */
export function pickCodexStreamCompletionResult(params: {
  latestResponseObj: unknown
  accumulated: string
  bestWithTools: ChatCompletionResponse | null
}): ChatCompletionResponse {
  const { latestResponseObj, accumulated, bestWithTools } = params
  if (latestResponseObj && typeof latestResponseObj === 'object') {
    const cc = responsesApiJsonToChatCompletion(latestResponseObj)
    const msg = cc.choices?.[0]?.message
    const content = msg?.content
    const toolCalls = msg?.tool_calls
    const hasText = typeof content === 'string' && content.trim().length > 0
    const hasTools = Array.isArray(toolCalls) && toolCalls.length > 0
    if (hasText || hasTools) return cc
  }
  if (bestWithTools) return bestWithTools
  const trimmed = (accumulated ?? '').trim()
  if (!trimmed) {
    throw new Error(
      'OpenAI Codex returned an empty response — check model id, ChatGPT (Codex) sign-in, and account access.'
    )
  }
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: trimmed,
        },
        finish_reason: 'stop',
      },
    ],
  }
}

/** @internal Planning stream — Azure chat/completions URL. */
export function buildAzureOpenAiChatCompletionsUrl(
  base: string,
  deployment: string | undefined
): string {
  return azureOpenAiChatCompletionsUrl(base, deployment)
}

/**
 * Tool rounds only — planning calls use an empty tools array and omit `tools` from the request body.
 * `parallel_tool_calls` matches OpenAI / Hermes-Agent (`run_agent.py`): lets the model return multiple
 * `tool_calls` in one assistant message when the provider supports it. Some budget models stall when
 * this is true — see `orchestratorModelHints.shouldUseParallelToolCallsInApi` + caller options.
 */
function buildChatBody(
  tools: unknown[],
  core: Record<string, unknown>,
  opts?: { parallelToolCalls?: boolean }
): Record<string, unknown> {
  if (!tools || tools.length === 0) return core
  const parallel = opts?.parallelToolCalls !== false
  const base: Record<string, unknown> = { ...core, tools, tool_choice: 'auto' }
  if (parallel) base.parallel_tool_calls = true
  return base
}

function isZaiVisionModel(model: string): boolean {
  return /(?:^|[\W_])(glm-(?:5v|4\.6v|4\.5v))/i.test(model) || /glm-5v-turbo/i.test(model)
}

function isZaiCodingPlanModel(model: string): boolean {
  const t = model.toLowerCase()
  return (
    isZaiVisionModel(model) ||
    /glm-(?:4\.5|4\.6|4\.7|5(?:\.1)?)(?:$|[\W_])/i.test(t)
  )
}

/** @public Hermes tile — Coding Plan models use the coding base URL. */
export function zaiBaseForModel(model: string, rawBase: string): string {
  const trimmed = (rawBase || '').trim() || ZAI_DEFAULT_BASE
  if (!isZaiCodingPlanModel(model)) return trimmed
  if (/\/api\/paas\/v4/i.test(trimmed)) {
    return trimmed.replace(/\/api\/paas\/v4/i, '/api/coding/paas/v4')
  }
  return trimmed || ZAI_DEFAULT_BASE
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return true
  if (e instanceof Error && e.name === 'AbortError') return true
  const code =
    e && typeof e === 'object' && 'code' in e
      ? String((e as { code: unknown }).code)
      : ''
  // Undici / Node: body read aborted after headers (still HTTP 200).
  if (code === 'ERR_ABORTED') return true
  if (e instanceof Error) {
    const m = e.message
    if (/request cancelled|request canceled/i.test(m)) return true
    if (/the user aborted a request/i.test(m)) return true
    if (/the operation was aborted/i.test(m)) return true
  }
  return false
}

/** Adds request URL to opaque client errors (e.g. Tauri “error decoding response body”). */
function augmentChatRequestError(err: Error, apiUrl: string): Error {
  const msg = err.message
  if (msg.includes(apiUrl)) return err
  if (/decoding|fetch|load|network|ECONNREFUSED/i.test(msg)) {
    return new Error(`${msg}\n→ POST ${apiUrl}`)
  }
  return err
}

/** Our own timeout (not user Stop). Must not be retried like network blips. */
function isOrchestratorTimeout(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'TimeoutError'
}

/**
 * AbortSignal that fires after `timeoutMs`, merged with optional user `signal` (Stop button).
 * Call `dispose()` after the HTTP response **body** has been read (or after `fetch` throws) so the
 * timer stays armed through `response.text()` — `fetch` can resolve at headers while the body stalls.
 */
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

/** Transient network failures (not user abort). */
function isRetryableFetchFailure(e: unknown): boolean {
  return !isAbortError(e)
}

/** Zhipu / Z.AI JSON error codes (see BigModel rate-limit docs): 1302 = account concurrency, 1305 = platform overload. */
function parseZhipuErrorCode(errorText: string): string | null {
  try {
    const parsed = JSON.parse(errorText) as Record<string, unknown>
    const err = parsed.error
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      const code = e.code
      if (code !== undefined && code !== null) return String(code)
    }
  } catch {
    if (/\b1302\b/.test(errorText)) return '1302'
    if (/\b1305\b/.test(errorText)) return '1305'
  }
  return null
}

/**
 * Z.AI can return provider-specific 429 wording, so detect both status-like and message-like patterns.
 * This gates a cross-provider fallback hop to OpenRouter when enabled in Settings.
 */
export function shouldAttemptZaiRateLimitProviderFallback(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  if (!msg.trim()) return false
  return (
    /\bHTTP\s*429\b/i.test(msg) ||
    /\b429\b/.test(msg) ||
    /usage limit reached/i.test(msg) ||
    /api quota exceeded/i.test(msg) ||
    /rate limit/i.test(msg)
  )
}

export function shouldAttemptZaiRateLimitProviderFallbackFromHttp(
  status: number,
  errorText: string
): boolean {
  if (status === 429) return true
  const code = parseZhipuErrorCode(errorText)
  if (code === '1302' || code === '1305') return true
  const slice = errorText.slice(0, 1500)
  return (
    /usage limit reached/i.test(slice) ||
    /api quota exceeded/i.test(slice) ||
    /rate limit/i.test(slice) ||
    /too many requests/i.test(slice)
  )
}

/** Exported for orchestrator empty-tool-reply recovery (Z.AI → OpenRouter hop). */
export function readOpenRouterFallbackConfigForZaiRateLimit():
  | { model: string; apiKey: string; baseUrl: string | undefined }
  | null {
  const s = useSettingsStore.getState()
  if (!s.openrouterRateLimitFallbackEnabled) return null
  const provider = s.providers.openrouter
  if (!provider?.enabled) return null
  const apiKey = (provider.apiKey ?? '').trim()
  if (!apiKey) return null
  const model =
    (s.openrouterRateLimitFallbackModelId || OPENROUTER_RATE_LIMIT_FALLBACK_MODEL_IDS[0]).trim()
  if (!model) return null
  return {
    model,
    apiKey,
    baseUrl: provider.baseUrl,
  }
}

/**
 * HTTP responses worth retrying before surfacing an error to the UI (handled inside this module).
 * Returns max number of additional retries (0 = don't retry).
 */
export function retryBudgetForHttpStatus(
  status: number,
  errorText: string,
  provider?: Provider
): number {
  const slice = errorText.slice(0, 1200)
  if (provider === 'zai') {
    const code = parseZhipuErrorCode(errorText)
    noteZaiRateLimit(status, code)
    if (code === '1302') return 4
    if (code === '1305') return 8
  }
  // 429 rate limit: retry more; Z.AI tier/concurrency may still need a wait or plan upgrade
  if (status === 429) return 6
  // Transient server errors: more retries
  if (status === 408 || status === 502 || status === 529) return 6
  if (status === 503) {
    if (/rate|limit|throttl|overload|unavailable|try again|temporarily|busy|maintenance/i.test(slice)) {
      return 4
    }
  }
  return 0
}

/** Parse `Retry-After` (seconds or HTTP-date). Caps wait to 2 minutes. */
export function parseRetryAfterMs(response: Response): number | null {
  const h = response.headers.get('Retry-After')
  if (!h) return null
  const sec = parseInt(h.trim(), 10)
  if (!Number.isNaN(sec) && sec >= 0) {
    return Math.min(sec * 1000, 120_000)
  }
  const when = Date.parse(h)
  if (!Number.isNaN(when)) {
    return Math.min(Math.max(0, when - Date.now()), 120_000)
  }
  return null
}

/**
 * Non-streaming chat/completions with OpenAI-style tools (OpenAI, OpenRouter, Z.AI Coding, Ollama OpenAI compat).
 * Retries transient **network** failures and **HTTP** 429 / 408 / 502 / 529 / overload 503 with backoff.
 * Callers only see an error after these attempts — use console.debug for retry diagnostics (not user-facing).
 */
export interface ChatCompletionOptions {
  onRetry?: (attempt: number, maxAttempts: number, status: number, waitMs: number) => void
  /** User-visible log when rate limits or provider hops need explanation (Settings gaps, fallback engaged). */
  onProviderNotice?: (message: string) => void
  /**
   * Hermes gateway streaming trace style:
   * - `event_types` (default): compact `[Hermes trace] response.created` style markers.
   * - `terminal_raw`: emit raw SSE `event:` and `data:` lines to mirror Hermes terminal output.
   */
  hermesTraceStyle?: 'event_types' | 'terminal_raw'
  /**
   * When false, omit `parallel_tool_calls` on the request and run tool batches sequentially
   * (must match `executeAssistantToolCalls` parallel flag).
   */
  parallelToolCalls?: boolean
  /** OpenAI / Azure OpenAI: use `/v1/responses` instead of chat/completions. */
  useResponsesApi?: boolean
  /** Azure OpenAI deployment name (when using Azure resource base URL). */
  azureDeployment?: string
  /** Provider session/correlation id when supported by the backend. */
  sessionId?: string
}

/** Merge Settings → Responses API / Azure deployment for any orchestrator caller. */
export function orchestratorChatOptionsFromStore(
  provider: Provider
): Pick<ChatCompletionOptions, 'useResponsesApi' | 'azureDeployment'> {
  const cfg = useSettingsStore.getState().providers[provider]
  const useResponsesApi =
    provider === 'openai' && cfg?.authMode === 'oauth' ? false : cfg?.useResponsesApi
  return {
    useResponsesApi,
    azureDeployment: provider === 'azureOpenai' ? cfg?.azureDeployment : undefined,
  }
}

export async function chatCompletionWithTools(
  provider: Provider,
  model: string,
  apiKey: string | undefined,
  baseUrlFromSettings: string | undefined,
  messages: ChatMessage[],
  tools: unknown[],
  signal?: AbortSignal,
  requestTimeoutMs: number = ORCHESTRATOR_CHAT_TIMEOUT_MS,
  options?: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  if (provider === 'hermes') {
    const resolvedBase = await resolveBaseUrl('hermes', baseUrlFromSettings)
    const b = normalizeHermesApiBaseUrl(resolvedBase?.trim() || HERMES_API_DEFAULT_BASE)
    const { isZaiHermesOpenAiBase } = await import('../hermes/hermesResponses')
    if (isZaiHermesOpenAiBase(b)) {
      return chatCompletionWithTools(
        'zai',
        model,
        apiKey,
        b,
        messages,
        tools,
        signal,
        requestTimeoutMs,
        options
      )
    }
    return chatCompletionHermesGatewayResponsesPath(
      model,
      apiKey,
      b,
      messages,
      tools,
      signal,
      requestTimeoutMs,
      options
    )
  }
  const inner = (): Promise<ChatCompletionResponse> =>
    chatCompletionWithToolsInner(
      provider,
      model,
      apiKey,
      baseUrlFromSettings,
      messages,
      tools,
      signal,
      requestTimeoutMs,
      options
    )
  if (provider === 'zai') {
    try {
      return await runZaiChatCompletionQueued(signal, inner)
    } catch (error) {
      const fallback = readOpenRouterFallbackConfigForZaiRateLimit()
      if (fallback && shouldAttemptZaiRateLimitProviderFallback(error)) {
        emitZaiOpenRouterFallbackNotice(fallback.model, options?.onProviderNotice)
        return chatCompletionWithToolsInner(
          'openrouter',
          fallback.model,
          fallback.apiKey,
          fallback.baseUrl,
          messages,
          tools,
          signal,
          requestTimeoutMs,
          options
        )
      }
      throw error
    }
  }
  return inner()
}

/** OpenAI / Azure OpenAI Responses API (`/v1/responses`) with the same retry policy as chat/completions. */
async function chatCompletionResponsesPath(
  provider: Provider,
  model: string,
  apiKey: string | undefined,
  baseUrlFromSettings: string | undefined,
  messages: ChatMessage[],
  tools: unknown[],
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  options: ChatCompletionOptions | undefined,
  azureDeployment: string | undefined
): Promise<ChatCompletionResponse> {
  const key = apiKey?.trim()
  if (!key) {
    throw new Error(
      provider === 'azureOpenai'
        ? 'Azure OpenAI: set API key in Settings or AZURE_OPENAI_API_KEY.'
        : 'OpenAI: set API key in Settings or OPENAI_API_KEY.'
    )
  }
  let apiUrl: string
  if (provider === 'openai') {
    const root =
      (await resolveBaseUrl('openai', baseUrlFromSettings)) || 'https://api.openai.com/v1'
    apiUrl = responsesEndpointForOpenAiBase(root)
  } else {
    const root = await resolveBaseUrl('azureOpenai', baseUrlFromSettings)
    if (!root?.trim()) {
      throw new Error('Azure OpenAI: set resource endpoint base URL in Settings or AZURE_OPENAI_ENDPOINT.')
    }
    apiUrl = azureOpenAiResponsesUrl(root, azureDeployment)
  }
  const headers: Record<string, string> =
    provider === 'azureOpenai'
      ? { 'Content-Type': 'application/json', 'api-key': key }
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
  const body = buildResponsesRequestBody({ model, messages, tools, temperature: 0.3 })

  const maxAttempts = 8
  let lastError: Error | null = null
  let retryBudget = maxAttempts - 1
  const startMs = Date.now()

  for (let attempt = 0; attempt < maxAttempts && retryBudget >= 0; attempt++) {
    const { signal: mergedSignal, dispose } = mergeAbortWithTimeout(signal, requestTimeoutMs)
    let response: Response
    try {
      response = await agentFetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: mergedSignal,
      })
    } catch (e: unknown) {
      dispose()
      if (isOrchestratorTimeout(e)) throw e instanceof Error ? e : new Error(String(e))
      if (isAbortError(e)) throw e instanceof Error ? e : new Error(String(e))
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt < maxAttempts - 1 && isRetryableFetchFailure(e)) {
        await abortableSleep(Math.min(2000 * 2 ** attempt, 45_000) * (0.85 + Math.random() * 0.3), signal)
        continue
      }
      throw augmentChatRequestError(lastError, apiUrl)
    }
    try {
      if (response.ok) {
        const rawBody = await response.text()
        let parsed: unknown
        try {
          parsed = JSON.parse(rawBody) as unknown
        } catch (parseErr) {
          const why = parseErr instanceof Error ? parseErr.message : String(parseErr)
          throw new Error(`Responses API: JSON parse failed: ${why}`)
        }
        throwIfProviderErrorObjectWithoutChoices(parsed, response.status)
        console.debug(`[Orchestrator] Responses API success in ${Date.now() - startMs}ms total`)
        return responsesApiJsonToChatCompletion(parsed)
      }
      const errorText = await response.text()
      const err = new Error(formatAgentHttpError(response.status, errorText, provider))
      lastError = err
      const statusRetryBudget = retryBudgetForHttpStatus(response.status, errorText, provider)
      retryBudget = Math.min(retryBudget - 1, statusRetryBudget)
      if (retryBudget > 0 && statusRetryBudget > 0) {
        const fromHeader = parseRetryAfterMs(response)
        const exponential = Math.min(3000 * 2 ** attempt, 90_000)
        const waitMs = fromHeader ?? exponential * (0.85 + Math.random() * 0.3)
        options?.onRetry?.(attempt + 1, maxAttempts, response.status, waitMs)
        await abortableSleep(waitMs, signal)
        continue
      }
      throw err
    } finally {
      dispose()
    }
  }

  throw augmentChatRequestError(
    lastError ?? new Error('Responses API failed after retries'),
    apiUrl
  )
}

async function chatCompletionOpenAiCodexResponsesPath(
  model: string,
  apiKey: string | undefined,
  baseUrlFromSettings: string | undefined,
  messages: ChatMessage[],
  tools: unknown[],
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  options: ChatCompletionOptions | undefined
): Promise<ChatCompletionResponse> {
  const key = apiKey?.trim()
  if (!key) {
    throw new Error('OpenAI Codex: sign in with ChatGPT (Codex) or set a token in Settings.')
  }
  const root = (await resolveBaseUrl('openaiCodex', baseUrlFromSettings)) || OPENAI_CODEX_DEFAULT_BASE
  const apiUrl = resolveOpenAiCodexResponsesUrl(root)
  const headers = buildOpenAiCodexHeaders(key, options?.sessionId, 'text/event-stream')
  const wireModel = resolveCodexResponsesWireModelId(model)
  const body = buildOpenAiCodexResponsesBody(wireModel, messages, tools, options?.sessionId, true)
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
      throw new Error(formatAgentHttpError(response.status, errorText, 'openaiCodex' as Provider))
    }
    const reader = response.body?.getReader()
    if (!reader) {
      const parsed = (await response.json()) as unknown
      throwIfProviderErrorObjectWithoutChoices(parsed, response.status)
      const cc = responsesApiJsonToChatCompletion(parsed)
      const msg = cc.choices?.[0]?.message
      const hasText = typeof msg?.content === 'string' && msg.content.trim().length > 0
      const hasTools = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0
      if (!hasText && !hasTools) {
        throw new Error(
          'OpenAI Codex returned an empty response — check model id, ChatGPT (Codex) sign-in, and account access.'
        )
      }
      return cc
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let accumulated = ''
    let latestResponseObj: unknown = null
    /** Preserves tool-only completions when the last SSE object is a late event with empty `output`. */
    let bestWithTools: ChatCompletionResponse | null = null

    const mergeCodexSnapshotForTools = (snapshot: unknown) => {
      if (!snapshot || typeof snapshot !== 'object') return
      const rec = snapshot as Record<string, unknown>
      if (!Array.isArray(rec.output)) return
      const cc = responsesApiJsonToChatCompletion(snapshot)
      const tcs = cc.choices?.[0]?.message?.tool_calls
      if (Array.isArray(tcs) && tcs.length > 0) {
        bestWithTools = cc
      }
    }

    const flushPayload = (payload: string) => {
      if (!payload || payload === '[DONE]') return
      try {
        const obj = JSON.parse(payload) as Record<string, unknown>
        latestResponseObj = obj
        const evtType = String(obj.type ?? '')
        const delta = extractOpenAiCodexDeltaText(obj)
        if (delta) {
          // output_item.done carries the full message snapshot, not a delta — appending duplicates text.
          if (evtType === 'response.output_item.done' || evtType.includes('output_item.done')) {
            accumulated = delta
          } else {
            accumulated += delta
          }
        }
        mergeCodexSnapshotForTools(obj)
        if (obj.response && typeof obj.response === 'object') {
          mergeCodexSnapshotForTools(obj.response)
        }
        if (Array.isArray(obj.output)) {
          const cc = responsesApiJsonToChatCompletion(obj)
          const text = cc.choices?.[0]?.message?.content
          if (typeof text === 'string' && text.length >= accumulated.length) {
            accumulated = text
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

    return pickCodexStreamCompletionResult({
      latestResponseObj,
      accumulated,
      bestWithTools,
    })
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e))
    throw augmentChatRequestError(err, apiUrl)
  } finally {
    dispose()
  }
}

/** Hermes gateway `POST /v1/responses` — optional Bearer when the gateway uses API_SERVER_KEY. */
async function chatCompletionHermesGatewayResponsesPath(
  model: string,
  apiKey: string | undefined,
  baseNorm: string,
  messages: ChatMessage[],
  tools: unknown[],
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  options: ChatCompletionOptions | undefined
): Promise<ChatCompletionResponse> {
  const { hermesResponsesEndpoint } = await import('../hermes/hermesResponses')
  const { effectiveHermesBearerKey } = await import('../hermes/hermesApiKey')
  const apiUrl = hermesResponsesEndpoint(baseNorm)
  const key = effectiveHermesBearerKey(apiKey)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (key) headers.Authorization = `Bearer ${key}`
  const hermesMessages =
    messages.some((m) => m.role === 'user')
      ? messages
      : [
          ...messages,
          {
            role: 'user' as const,
            content:
              '[Hermes bridge continuation] Continue from the latest tool outputs and prior context. If work remains, call the next tool(s). If complete, return the final answer.',
          },
        ]
  const hermesTraceStyle = options?.hermesTraceStyle ?? 'event_types'
  if (hermesMessages !== messages && hermesTraceStyle !== 'terminal_raw') {
    options?.onProviderNotice?.(
      '[Hermes trace] injected continuation user turn to satisfy Hermes Responses input contract'
    )
  }
  const body = {
    ...buildResponsesRequestBody({ model, messages: hermesMessages, tools, temperature: 0.3 }),
    stream: true,
  }

  const maxAttempts = 8
  let lastError: Error | null = null
  let retryBudget = maxAttempts - 1
  const startMs = Date.now()
  const provider: Provider = 'hermes'

  for (let attempt = 0; attempt < maxAttempts && retryBudget >= 0; attempt++) {
    const { signal: mergedSignal, dispose } = mergeAbortWithTimeout(signal, requestTimeoutMs)
    let response: Response
    try {
      response = await agentFetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: mergedSignal,
      })
    } catch (e: unknown) {
      dispose()
      if (isOrchestratorTimeout(e)) throw e instanceof Error ? e : new Error(String(e))
      if (isAbortError(e)) throw e instanceof Error ? e : new Error(String(e))
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt < maxAttempts - 1 && isRetryableFetchFailure(e)) {
        await abortableSleep(Math.min(2000 * 2 ** attempt, 45_000) * (0.85 + Math.random() * 0.3), signal)
        continue
      }
      throw augmentChatRequestError(lastError, apiUrl)
    }
    try {
      if (response.ok) {
        const reader = response.body?.getReader()
        if (!reader) {
          const rawBody = await response.text()
          let parsed: unknown
          try {
            parsed = JSON.parse(rawBody) as unknown
          } catch (parseErr) {
            const why = parseErr instanceof Error ? parseErr.message : String(parseErr)
            throw new Error(`Hermes Responses API: JSON parse failed: ${why}`)
          }
          throwIfProviderErrorObjectWithoutChoices(parsed, response.status)
          console.debug(`[Orchestrator] Hermes Responses API success in ${Date.now() - startMs}ms total`)
          return responsesApiJsonToChatCompletion(parsed)
        }

        const { extractDeltaTextFromStreamEvent } = await import('../hermes/hermesResponses')
        const decoder = new TextDecoder()
        let buffer = ''
        let accumulated = ''
        let latestResponseObj: unknown = null
        let bestWithTools: ChatCompletionResponse | null = null
        let emittedAnyDelta = false
        const seenEventTypes = new Set<string>()

        const mergeSnapshotForTools = (snapshot: unknown) => {
          if (!snapshot || typeof snapshot !== 'object') return
          const rec = snapshot as Record<string, unknown>
          if (!Array.isArray(rec.output)) return
          const cc = responsesApiJsonToChatCompletion(snapshot)
          const tcs = cc.choices?.[0]?.message?.tool_calls
          if (Array.isArray(tcs) && tcs.length > 0) {
            bestWithTools = cc
          }
        }

        const flushPayload = (payload: string) => {
          if (!payload || payload === '[DONE]') return
          try {
            const obj = JSON.parse(payload) as Record<string, unknown>
            latestResponseObj = obj
            const evtType = String(obj.type ?? '')
            if (evtType && hermesTraceStyle === 'event_types') {
              const marker = `[Hermes trace] ${evtType}`
              if (!seenEventTypes.has(marker)) {
                seenEventTypes.add(marker)
                options?.onProviderNotice?.(marker)
              }
            }
            const delta = extractDeltaTextFromStreamEvent(obj)
            if (delta) {
              if (evtType === 'response.output_item.done' || evtType.includes('output_item.done')) {
                accumulated = delta
              } else {
                accumulated += delta
              }
              if (!emittedAnyDelta && hermesTraceStyle === 'event_types') {
                emittedAnyDelta = true
                options?.onProviderNotice?.('[Hermes trace] streaming response started')
              }
            }
            mergeSnapshotForTools(obj)
            if (obj.response && typeof obj.response === 'object') {
              mergeSnapshotForTools(obj.response)
            }
            if (Array.isArray(obj.output)) {
              const cc = responsesApiJsonToChatCompletion(obj)
              const text = cc.choices?.[0]?.message?.content
              if (typeof text === 'string' && text.length >= accumulated.length) {
                accumulated = text
              }
            }
          } catch {
            /* ignore partial JSON lines */
          }
        }

        const processSseLine = (line: string) => {
          const trimmed = line.trim()
          if (!trimmed) return
          if (trimmed.startsWith('event:')) {
            const eventName = trimmed.slice(6).trim()
            if (hermesTraceStyle === 'terminal_raw') {
              options?.onProviderNotice?.(`event: ${eventName}`)
            }
            return
          }
          if (!trimmed.startsWith('data:')) return
          const payload = trimmed.slice(5).trim()
          if (hermesTraceStyle === 'terminal_raw') {
            options?.onProviderNotice?.(`data: ${payload}`)
          }
          flushPayload(payload)
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
                processSseLine(line)
              }
            }
          }
          if (buffer.trim()) {
            for (const line of buffer.split('\n')) {
              processSseLine(line)
            }
          }
        } finally {
          reader.releaseLock()
        }

        if (latestResponseObj && typeof latestResponseObj === 'object') {
          const cc = responsesApiJsonToChatCompletion(latestResponseObj)
          const msg = cc.choices?.[0]?.message
          const hasText = typeof msg?.content === 'string' && msg.content.trim().length > 0
          const hasTools = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0
          if (hasText || hasTools) return cc
        }
        if (bestWithTools) return bestWithTools
        const trimmed = (accumulated ?? '').trim()
        if (!trimmed) {
          throw new Error('Hermes Responses API returned an empty response.')
        }
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: trimmed,
              },
              finish_reason: 'stop',
            },
          ],
        }
      }
      const errorText = await response.text()
      const err = new Error(formatAgentHttpError(response.status, errorText, provider))
      lastError = err
      const statusRetryBudget = retryBudgetForHttpStatus(response.status, errorText, provider)
      retryBudget = Math.min(retryBudget - 1, statusRetryBudget)
      if (retryBudget > 0 && statusRetryBudget > 0) {
        const fromHeader = parseRetryAfterMs(response)
        const exponential = Math.min(3000 * 2 ** attempt, 90_000)
        const waitMs = fromHeader ?? exponential * (0.85 + Math.random() * 0.3)
        options?.onRetry?.(attempt + 1, maxAttempts, response.status, waitMs)
        await abortableSleep(waitMs, signal)
        continue
      }
      throw err
    } finally {
      dispose()
    }
  }

  throw augmentChatRequestError(
    lastError ?? new Error('Hermes Responses API failed after retries'),
    apiUrl
  )
}

async function chatCompletionWithToolsInner(
  provider: Provider,
  model: string,
  apiKey: string | undefined,
  baseUrlFromSettings: string | undefined,
  messages: ChatMessage[],
  tools: unknown[],
  signal?: AbortSignal,
  requestTimeoutMs: number = ORCHESTRATOR_CHAT_TIMEOUT_MS,
  options?: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  const startMs = Date.now()
  console.debug(`[Orchestrator] chatCompletionWithTools start — ${provider}/${model}`)

  if (provider === 'bedrock') {
    const region = (await resolveBaseUrl('bedrock', baseUrlFromSettings)) || 'us-east-1'
    return bedrockChatCompletionWithTools(region, model, messages, tools, signal, requestTimeoutMs)
  }

  if (
    (provider === 'openai' || provider === 'azureOpenai') &&
    options?.useResponsesApi
  ) {
    return chatCompletionResponsesPath(
      provider,
      model,
      apiKey,
      baseUrlFromSettings,
      messages,
      tools,
      signal,
      requestTimeoutMs,
      options,
      options?.azureDeployment
    )
  }

  if (provider === 'openaiCodex') {
    return chatCompletionOpenAiCodexResponsesPath(
      model,
      apiKey,
      baseUrlFromSettings,
      messages,
      tools,
      signal,
      requestTimeoutMs,
      options
    )
  }

  if (provider === 'anthropic') {
    const key = apiKey?.trim()
    if (!key) {
      throw new Error(
        'Anthropic: add an API key in Settings → API Providers, or sign in with Pi (`~/.pi/agent/auth.json` OAuth) when using the desktop app.'
      )
    }
    const baseResolved = await resolveBaseUrl('anthropic', baseUrlFromSettings)
    return anthropicChatCompletionWithRetries(
      model,
      key,
      baseResolved,
      messages,
      tools,
      signal,
      requestTimeoutMs,
      options
    )
  }

  const allowParallelToolCallsInRequest = options?.parallelToolCalls !== false
  const bodyOpts = { parallelToolCalls: allowParallelToolCallsInRequest }

  let apiUrl: string
  let headers: Record<string, string>
  let body: Record<string, unknown>

  switch (provider) {
    case 'openai': {
      const root =
        (await resolveBaseUrl('openai', baseUrlFromSettings)) || 'https://api.openai.com/v1'
      apiUrl = `${root.replace(/\/$/, '')}/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
      break
    }
    case 'openrouter': {
      let orUrl =
        (await resolveBaseUrl('openrouter', baseUrlFromSettings)) || baseUrlFromSettings
      apiUrl = openRouterChatCompletionsUrl(orUrl || '')
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
      break
    }
    case 'google': {
      // Pi `google-generative-ai` uses @google/genai; we use Google’s OpenAI-compatible HTTP API.
      const root =
        (await resolveBaseUrl('google', baseUrlFromSettings)) ||
        'https://generativelanguage.googleapis.com/v1beta/openai'
      apiUrl = `${root.replace(/\/$/, '')}/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
      break
    }
    case 'xai': {
      const root = (await resolveBaseUrl('xai', baseUrlFromSettings)) || XAI_DEFAULT_BASE
      apiUrl = `${root.replace(/\/$/, '')}/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
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
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
      break
    }
    case 'ollama': {
      const host =
        (await resolveBaseUrl('ollama', baseUrlFromSettings)) ||
        baseUrlFromSettings ||
        'http://127.0.0.1:11434'
      apiUrl = `${host.replace(/\/$/, '')}/v1/chat/completions`
      headers = { 'Content-Type': 'application/json' }
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
      break
    }
    case 'llamacpp': {
      // llama.cpp local server (mac-code style): OpenAI-compatible API at /v1/chat/completions
      // Default port 8000 per mac-code README (llama-server --port 8000)
      const host =
        (await resolveBaseUrl('llamacpp', baseUrlFromSettings)) ||
        baseUrlFromSettings ||
        'http://127.0.0.1:8000'
      apiUrl = `${host.replace(/\/$/, '')}/v1/chat/completions`
      headers = { 'Content-Type': 'application/json' }
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
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
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
      break
    }
    case 'azureOpenai': {
      const root = await resolveBaseUrl('azureOpenai', baseUrlFromSettings)
      if (!root?.trim()) {
        throw new Error(
          'Azure OpenAI: set the resource endpoint in Settings (e.g. https://YOUR_RESOURCE.openai.azure.com) or AZURE_OPENAI_ENDPOINT.'
        )
      }
      apiUrl = azureOpenAiChatCompletionsUrl(root, options?.azureDeployment)
      headers = {
        'Content-Type': 'application/json',
        'api-key': apiKey?.trim() ?? '',
      }
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
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
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
      break
    }
    case 'googleVertex': {
      const root = await resolveBaseUrl('googleVertex', baseUrlFromSettings)
      if (!root?.trim()) {
        throw new Error(
          'Vertex AI: set the OpenAI-compatible endpoint root in Settings (project/location/endpoints/openapi) or VERTEX_AI_BASE_URL.'
        )
      }
      apiUrl = `${root.replace(/\/$/, '')}/v1/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      body = buildChatBody(
        tools,
        {
          model,
          messages,
          temperature: 0.3,
          stream: false,
        },
        bodyOpts
      )
      break
    }
    default:
      throw new Error(
        `Orchestrator tools need a supported provider. Got: ${provider}`
      )
  }

  /** Enough attempts for flaky networks, gateway blips, and rate limits (429 retries up to `retryBudgetForHttpStatus`). */
  const maxAttempts = 8
  let lastError: Error | null = null
  let retryBudget = maxAttempts - 1
  const primaryOpenRouterModel = provider === 'openrouter' ? model.trim() : ''
  let primaryOpenRouterRateLimitFailures = 0
  let zaiMissingFallbackNoticeSent = false

  for (let attempt = 0; attempt < maxAttempts && retryBudget >= 0; attempt++) {
    if (provider === 'openrouter') {
      body.model = getEffectiveOpenRouterModel(model)
    }
    let response: Response
    const { signal: mergedSignal, dispose } = mergeAbortWithTimeout(signal, requestTimeoutMs)
    const attemptStart = Date.now()
    console.debug(`[Orchestrator] attempt ${attempt + 1}/${maxAttempts} → ${apiUrl}`)
    try {
      response = await agentFetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: mergedSignal,
      })
      console.debug(`[Orchestrator] response in ${Date.now() - attemptStart}ms — HTTP ${response.status}`)
    } catch (e: unknown) {
      console.debug(`[Orchestrator] fetch error after ${Date.now() - attemptStart}ms`, e)
      dispose()
      if (isOrchestratorTimeout(e)) {
        throw e instanceof Error ? e : new Error(String(e))
      }
      if (isAbortError(e)) {
        throw e instanceof Error ? e : new Error(String(e))
      }
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt < maxAttempts - 1 && isRetryableFetchFailure(e)) {
        const waitMs = Math.min(2000 * 2 ** attempt, 45_000) * (0.85 + Math.random() * 0.3)
        console.debug(
          `[Orchestrator] network retry in ${Math.round(waitMs)}ms (${attempt + 1}/${maxAttempts})`,
          lastError.message
        )
        await abortableSleep(waitMs, signal)
        continue
      }
      throw augmentChatRequestError(lastError, apiUrl)
    }

    try {
      if (response.ok) {
        const ct = response.headers.get('content-type') ?? ''
        let rawBody: string
        try {
          rawBody = await response.text()
        } catch (readErr) {
          if (isAbortError(readErr)) {
            throw readErr instanceof Error ? readErr : new Error(String(readErr))
          }
          throw new Error(
            `Chat response: failed to read body (HTTP ${response.status}) — ${readErr instanceof Error ? readErr.message : String(readErr)}`
          )
        }
        let data: ChatCompletionResponse
        try {
          data = JSON.parse(rawBody) as ChatCompletionResponse
        } catch (parseErr) {
          const snippet = rawBody.trim().slice(0, 480)
          const why = parseErr instanceof Error ? parseErr.message : String(parseErr)
          throw new Error(
            `Chat response: JSON parse failed (HTTP ${response.status}${ct ? `, ${ct}` : ''}): ${why}` +
              (snippet ? ` — body: ${snippet}` : rawBody.length === 0 ? ' — body: (empty)' : '')
          )
        }
        throwIfProviderErrorObjectWithoutChoices(data, response.status)
        console.debug(`[Orchestrator] success in ${Date.now() - startMs}ms total`)
        if (provider === 'openrouter' && data.usage) {
          try {
            useOpenRouterUsageStore.getState().recordFromCompletion(String(body.model), data)
          } catch {
            /* non-fatal */
          }
        }
        return data
      }

      const errorText = await response.text()
      const err = new Error(formatAgentHttpError(response.status, errorText, provider))
      lastError = err

      const statusRetryBudget = retryBudgetForHttpStatus(response.status, errorText, provider)
      retryBudget = Math.min(retryBudget - 1, statusRetryBudget)
      const shouldRetry = retryBudget > 0 && statusRetryBudget > 0

      if (
        provider === 'zai' &&
        shouldAttemptZaiRateLimitProviderFallbackFromHttp(response.status, errorText)
      ) {
        if (readOpenRouterFallbackConfigForZaiRateLimit()) {
          // Exit Z.AI retry loop early so chatCompletionWithTools() can hop providers immediately.
          throw err
        }
        if (!zaiMissingFallbackNoticeSent) {
          zaiMissingFallbackNoticeSent = true
          options?.onProviderNotice?.(
            '[Orchestrator] Z.AI rate limited — auto-fallback needs OpenRouter enabled with an API key and rate-limit fallback on. Retrying on Z.AI with backoff…'
          )
        }
      }

      if (shouldRetry) {
        const modelUsedInRequest = String(body.model ?? '').trim()
        const isPrimaryOpenRouterRequest =
          provider === 'openrouter' && modelUsedInRequest === primaryOpenRouterModel
        const isRateLimitLikeOpenRouterError =
          provider === 'openrouter' &&
          shouldAttemptOpenRouterRateLimitFallback(response.status, errorText)
        if (isRateLimitLikeOpenRouterError && isPrimaryOpenRouterRequest) {
          primaryOpenRouterRateLimitFailures += 1
        } else if (provider === 'openrouter' && !isRateLimitLikeOpenRouterError) {
          primaryOpenRouterRateLimitFailures = 0
        }
        if (
          isRateLimitLikeOpenRouterError &&
          isPrimaryOpenRouterRequest &&
          shouldActivateOpenRouterFallbackAfterRateLimitFailures(primaryOpenRouterRateLimitFailures) &&
          tryActivateOpenRouterRateLimitFallback(model, modelUsedInRequest)
        ) {
          const fb = getEffectiveOpenRouterModel(model)
          console.debug(
            `[Orchestrator] OpenRouter rate limit on primary — switching to fallback model ${fb}; retrying (${attempt + 1}/${maxAttempts})`
          )
          options?.onProviderNotice?.(
            `[Orchestrator] OpenRouter rate limited — using fallback model ${fb} for this window.`
          )
          options?.onRetry?.(attempt + 1, maxAttempts, response.status, 0)
          continue
        }
        if (isRateLimitLikeOpenRouterError && isPrimaryOpenRouterRequest) {
          console.debug(
            `[Orchestrator] OpenRouter rate limit on primary (streak ${primaryOpenRouterRateLimitFailures}) — next 429 may activate fallback`
          )
        }
        const fromHeader = parseRetryAfterMs(response)
        const exponential = Math.min(3000 * 2 ** attempt, 90_000)
        const jitter = exponential * (0.85 + Math.random() * 0.3)
        const waitMs = fromHeader ?? jitter
        console.debug(
          `[Orchestrator] HTTP ${response.status} — backoff ${Math.round(waitMs)}ms (${attempt + 1}/${maxAttempts})`
        )
        options?.onRetry?.(attempt + 1, maxAttempts, response.status, waitMs)
        await abortableSleep(waitMs, signal)
        continue
      }

      throw err
    } finally {
      dispose()
    }
  }

  throw augmentChatRequestError(
    lastError ?? new Error('Chat completion failed after retries'),
    apiUrl
  )
}

/**
 * Anthropic Messages API via `@anthropic-ai/sdk` (API key or Pi OAuth bearer token).
 * Retries 429 / transient errors like the OpenAI-compatible path.
 */
async function anthropicChatCompletionWithRetries(
  model: string,
  apiKey: string,
  baseUrl: string | undefined,
  messages: ChatMessage[],
  tools: unknown[],
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  options?: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  const maxAttempts = 8
  let lastError: Error | null = null
  let retryBudget = maxAttempts - 1
  const anthropicTools = openAiToolsToAnthropic(tools)

  for (let attempt = 0; attempt < maxAttempts && retryBudget >= 0; attempt++) {
    const { signal: mergedSignal, dispose } = mergeAbortWithTimeout(signal, requestTimeoutMs)
    try {
      const data = await anthropicChatCompletionWithTools(
        model,
        apiKey,
        baseUrl,
        messages,
        anthropicTools,
        mergedSignal,
        requestTimeoutMs
      )
      dispose()
      console.debug(`[Orchestrator] Anthropic success — ${model}`)
      return data
    } catch (e: unknown) {
      dispose()
      if (isOrchestratorTimeout(e)) {
        throw e instanceof Error ? e : new Error(String(e))
      }
      if (isAbortError(e)) {
        throw e instanceof Error ? e : new Error(String(e))
      }

      const err = e instanceof Error ? e : new Error(String(e))
      lastError = err

      let status = 0
      let bodySnippet = err.message
      if (e instanceof APIError) {
        status = e.status ?? 0
        const errBody = 'body' in e ? (e as APIError & { body?: unknown }).body : undefined
        bodySnippet = `${e.message}${errBody != null ? ` — ${String(errBody).slice(0, 400)}` : ''}`
      }
      if (e instanceof APIConnectionError && attempt < maxAttempts - 1) {
        const waitMs = Math.min(2000 * 2 ** attempt, 45_000) * (0.85 + Math.random() * 0.3)
        console.debug(
          `[Orchestrator] Anthropic connection error — retry in ${Math.round(waitMs)}ms (${attempt + 1}/${maxAttempts})`
        )
        await abortableSleep(waitMs, signal)
        continue
      }

      const statusRetryBudget = retryBudgetForHttpStatus(status, bodySnippet, 'openai')
      retryBudget = Math.min(retryBudget - 1, statusRetryBudget)
      const shouldRetry = retryBudget >= 0 && statusRetryBudget > 0

      if (shouldRetry) {
        const exponential = Math.min(3000 * 2 ** attempt, 90_000)
        const jitter = exponential * (0.85 + Math.random() * 0.3)
        const waitMs = jitter
        console.debug(
          `[Orchestrator] Anthropic HTTP ${status} — backoff ${Math.round(waitMs)}ms (${attempt + 1}/${maxAttempts})`
        )
        options?.onRetry?.(attempt + 1, maxAttempts, status, waitMs)
        await abortableSleep(waitMs, signal)
        continue
      }

      throw err
    }
  }

  throw lastError ?? new Error('Anthropic chat completion failed after retries')
}

/**
 * Post-transport check: first choice has no native `tool_calls` and no non-empty stripped assistant text.
 * Text-parsed tools are evaluated in `runOrchestratorAgent` via `parseTextToolCalls`.
 */
export function chatCompletionAssistantNativeEmpty(res: ChatCompletionResponse): boolean {
  const msg = res.choices?.[0]?.message
  if (!msg) return true
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return false
  const raw = typeof msg.content === 'string' ? msg.content : ''
  return !stripAssistantToolArtifacts(raw).trim()
}

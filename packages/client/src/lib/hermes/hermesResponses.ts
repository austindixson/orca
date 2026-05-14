/**
 * Hermes gateway client — single path for `/v1/responses` (SSE stream with one
 * non-stream fallback on empty body). Bearer is resolved by `hermesApiKey.ts`:
 * UI key > Z.AI provider key > `~/.hermes/.env` (Tauri) > none.
 *
 * The previous Z.AI `chat/completions` branch and the retry-omit-bearer logic
 * were removed because:
 *   - Z.AI requests should use the orchestrator's provider path, not this tile.
 *   - Retrying without a bearer just masked auth misconfiguration. With the
 *     env auto-read in `hermesApiKey.ts`, an empty UI key already means
 *     "use `~/.hermes/.env` or send no Authorization".
 */

import { describeBearerForLog, hermesDebug, hermesInstrumentedFetch } from './hermesDebugLog'
import { resolveEffectiveHermesBearerKeyAsync } from './hermesApiKey'
import { responsesApiJsonToChatCompletion } from '../orchestrator/openaiResponsesAdapter'
import {
  HERMES_API_DEFAULT_BASE,
  HERMES_API_DEFAULT_MODEL,
  normalizeHermesApiBaseUrl,
} from '../../store/settingsStore'

function emitDebugLog(
  runId: string,
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  fetch('http://127.0.0.1:7696/ingest/d871edbc-ff39-4d74-96b8-887cea450cfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'eaa681' },
    body: JSON.stringify({
      sessionId: 'eaa681',
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}

/** User-facing hint when Hermes API is down or returns auth errors. */
export function formatHermesConnectionError(err: unknown, apiBaseUrl: string): string {
  const raw = err instanceof Error ? err.message : String(err)
  const t = raw.toLowerCase()
  if (
    t.includes('error sending request') ||
    t.includes('connection refused') ||
    t.includes('failed to fetch') ||
    t.includes('networkerror') ||
    t.includes('econnrefused') ||
    t.includes('connection reset') ||
    t.includes('socket')
  ) {
    return `Cannot reach Hermes at ${apiBaseUrl}. Start the gateway: \`API_SERVER_ENABLED=true hermes gateway\` (or set it in \`~/.hermes/.env\`). Orca auto-reads \`API_SERVER_KEY\` from \`~/.hermes/.env\` — override in Settings → Integrations only if needed.`
  }
  if (/\b403\b/.test(t)) {
    return `${raw} — **403:** Hermes rejected the Bearer (or missing auth). **1)** \`grep API_SERVER_KEY ~/.hermes/.env\`. **2)** Orca auto-reads that value; if you set one in Settings → Integrations → Hermes API key, it must match **exactly** (or leave the field empty to use the file). **3)** Only one \`hermes gateway\` should listen on the API port.`
  }
  if (/\b401\b/.test(t)) {
    return `${raw} — **401:** Hermes requires a Bearer. Set \`API_SERVER_KEY\` in \`~/.hermes/.env\` (Orca will auto-read it), or paste the key into Settings → Integrations → Hermes API key.`
  }
  return raw
}

export function hermesResponsesEndpoint(baseUrl: string): string {
  const b = normalizeHermesApiBaseUrl(baseUrl)
  return `${b}/responses`
}

/**
 * Z.AI's Coding / PaaS base exposes an OpenAI-compatible `/chat/completions`
 * but **not** `/responses`. The orchestrator's `chatCompletion.ts` reuses this
 * flag to route the `hermes` provider to the Z.AI chat path instead of the
 * Hermes gateway. Not used by the Hermes tile itself.
 */
export function isZaiHermesOpenAiBase(baseUrl: string | undefined): boolean {
  if (!baseUrl?.trim()) return false
  try {
    return new URL(baseUrl.trim()).hostname === 'api.z.ai'
  } catch {
    return false
  }
}

/** Result of GET /models — cheap reachability + auth check. */
export type HermesProbeResult = {
  ok: boolean
  status: number
  modelsUrl: string
  hint: string
  detail: string
}

/** GET /models with the same Bearer resolution the chat client uses. */
export async function probeHermesModels(
  baseUrl: string,
  apiKey: string | undefined,
  signal?: AbortSignal
): Promise<HermesProbeResult> {
  const b = normalizeHermesApiBaseUrl(baseUrl)
  hermesDebug.probeStart({ baseRaw: baseUrl, baseNorm: b, mode: 'hermes_responses' })
  // #region agent log
  emitDebugLog('hermes-gateway-issues', 'H1', 'hermesResponses.ts:108', 'Probe Hermes models start', {
    baseNorm: b,
    hasUiApiKey: !!apiKey?.trim(),
  })
  // #endregion

  const modelsUrl = `${b}/models`
  const headers: Record<string, string> = {}
  const key = await resolveEffectiveHermesBearerKeyAsync(apiKey, b)
  if (key) headers.Authorization = `Bearer ${key}`

  try {
    const res = await hermesInstrumentedFetch('probe-hermes-models', modelsUrl, {
      method: 'GET',
      headers,
      signal,
    })
    const text = await res.text().catch(() => '')
    const detail = text.slice(0, 800)

    if (res.ok) {
      // #region agent log
      emitDebugLog('hermes-gateway-issues', 'H1', 'hermesResponses.ts:128', 'Probe Hermes models success', {
        status: res.status,
      })
      // #endregion
      return {
        ok: true,
        status: res.status,
        modelsUrl,
        hint: 'Hermes gateway accepted this key (GET /v1/models OK).',
        detail,
      }
    }

    const hint =
      res.status === 401 || res.status === 403
        ? 'Auth mismatch: Orca auto-reads `API_SERVER_KEY` from `~/.hermes/.env`. If you pasted a key into Settings → Integrations, it must match that file exactly (or clear the field to use the file).'
        : `Unexpected ${res.status} from Hermes.`

    // #region agent log
    emitDebugLog('hermes-gateway-issues', 'H2', 'hermesResponses.ts:145', 'Probe Hermes models non-ok', {
      status: res.status,
      hint,
    })
    // #endregion
    return { ok: false, status: res.status, modelsUrl, hint, detail }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // #region agent log
    emitDebugLog('hermes-gateway-issues', 'H1', 'hermesResponses.ts:153', 'Probe Hermes models network failure', {
      message: msg.slice(0, 240),
    })
    // #endregion
    return {
      ok: false,
      status: 0,
      modelsUrl,
      hint: `Network error reaching ${modelsUrl}. Confirm \`hermes gateway\` is running on this host/port.`,
      detail: msg.slice(0, 800),
    }
  }
}

/** Stable id for Hermes named conversations (server-side session). */
export function hermesConversationForTile(tileId: string, metaOverride?: unknown): string {
  if (typeof metaOverride === 'string' && metaOverride.trim()) {
    return metaOverride.trim().slice(0, 200)
  }
  if (metaOverride && typeof metaOverride === 'object' && 'conversation' in metaOverride) {
    const c = (metaOverride as { conversation?: unknown }).conversation
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 200)
  }
  return `orca-hermes-${tileId}`
}

/** Extract assistant text from a Responses-API SSE event object. */
export function extractDeltaTextFromStreamEvent(obj: unknown): string {
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
          if (block && typeof block === 'object') {
            const b = block as Record<string, unknown>
            if (b.type === 'output_text' && typeof b.text === 'string') s += b.text
          }
        }
        return s
      }
    }
  }
  return ''
}

function extractProgressLine(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const type = String(o.type ?? '')
  if (type.includes('tool') || type.includes('hermes')) {
    try {
      return JSON.stringify(o).slice(0, 500)
    } catch {
      return type
    }
  }
  return null
}

type RequestSpec = {
  baseUrl: string
  bearer: string | undefined
  model: string
  input: string
  conversation: string
  stream: boolean
  signal?: AbortSignal
}

async function postHermesResponses(spec: RequestSpec): Promise<Response> {
  const url = hermesResponsesEndpoint(spec.baseUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (spec.stream) headers.Accept = 'text/event-stream'
  if (spec.bearer) headers.Authorization = `Bearer ${spec.bearer}`

  const body = {
    model: spec.model.trim() || HERMES_API_DEFAULT_MODEL,
    input: spec.input,
    conversation: spec.conversation,
    store: true,
    stream: spec.stream,
  }

  return hermesInstrumentedFetch('post-hermes-responses', url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: spec.signal,
  })
}

export type SendHermesPromptParams = {
  baseUrl: string
  apiKey: string | undefined
  model: string
  input: string
  conversation: string
  signal?: AbortSignal
  onTextDelta: (accumulated: string) => void
  onProgress?: (line: string) => void
  /** Raw `data:` JSON payloads from the SSE stream (for tile telemetry). */
  onTelemetryEvent?: (dataPayload: string) => void
}

async function streamResponses(spec: RequestSpec, params: SendHermesPromptParams): Promise<string> {
  const res = await postHermesResponses(spec)
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if (errText.trim()) {
      params.onTelemetryEvent?.(
        JSON.stringify({ type: 'http_error', status: res.status, body: errText.slice(0, 8000) })
      )
    }
    hermesDebug.chatError({
      where: 'streamResponses',
      url: hermesResponsesEndpoint(spec.baseUrl),
      status: res.status,
      authorization: spec.bearer ? 'Bearer <redacted>' : '(no Bearer)',
      bearer: describeBearerForLog(spec.bearer),
      responseBodyPreview: errText.slice(0, 400),
    })
    // #region agent log
    emitDebugLog('hermes-gateway-issues', 'H3', 'hermesResponses.ts:282', 'Hermes responses HTTP error', {
      status: res.status,
      hasBearer: !!spec.bearer,
      baseUrl: spec.baseUrl,
      responseSnippet: errText.slice(0, 200),
    })
    // #endregion
    throw new Error(`Hermes responses ${res.status}: ${errText.slice(0, 400) || res.statusText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    const t = await res.text()
    params.onTelemetryEvent?.(t)
    const j = JSON.parse(t) as unknown
    const cc = responsesApiJsonToChatCompletion(j)
    const text = cc.choices?.[0]?.message?.content ?? ''
    const acc = typeof text === 'string' ? text : ''
    params.onTextDelta(acc)
    return acc
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''

  const flushEvent = (payload: string) => {
    if (payload === '[DONE]') return
    params.onTelemetryEvent?.(payload)
    let obj: unknown
    try {
      obj = JSON.parse(payload)
    } catch {
      return
    }
    const prog = extractProgressLine(obj)
    if (prog) params.onProgress?.(prog)

    const o = obj as Record<string, unknown>
    const evtType = String(o.type ?? '')
    const delta = extractDeltaTextFromStreamEvent(obj)
    if (delta) {
      if (evtType === 'response.output_item.done' || evtType.includes('output_item.done')) {
        accumulated = delta
      } else {
        accumulated += delta
      }
      params.onTextDelta(accumulated)
    }

    if (Array.isArray(o.output)) {
      const cc = responsesApiJsonToChatCompletion(obj)
      const text = cc.choices?.[0]?.message?.content
      if (typeof text === 'string' && text.length > accumulated.length) {
        accumulated = text
        params.onTextDelta(accumulated)
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const block of parts) {
        for (const line of block.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          flushEvent(trimmed.slice(5).trim())
        }
      }
    }
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        flushEvent(trimmed.slice(5).trim())
      }
    }
  } finally {
    reader.releaseLock()
  }

  return accumulated
}

async function nonStreamResponses(spec: RequestSpec, params: SendHermesPromptParams): Promise<string> {
  const res = await postHermesResponses({ ...spec, stream: false })
  const rawText = await res.text()
  params.onTelemetryEvent?.(rawText)
  if (!res.ok) {
    hermesDebug.chatError({
      where: 'nonStreamResponses',
      url: hermesResponsesEndpoint(spec.baseUrl),
      status: res.status,
      authorization: spec.bearer ? 'Bearer <redacted>' : '(no Bearer)',
      bearer: describeBearerForLog(spec.bearer),
      responseBodyPreview: rawText.slice(0, 400),
    })
    throw new Error(`Hermes responses ${res.status}: ${rawText.slice(0, 400) || res.statusText}`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(rawText) as unknown
  } catch {
    throw new Error('Hermes: invalid JSON response')
  }
  const cc = responsesApiJsonToChatCompletion(raw)
  const text = cc.choices?.[0]?.message?.content
  const out = typeof text === 'string' ? text : ''
  params.onTextDelta(out)
  return out
}

/**
 * Send a single Hermes turn. Streams SSE; if the stream finishes empty, falls
 * back once to non-streaming JSON. Throws on HTTP error with status + body.
 */
export async function sendHermesPrompt(params: SendHermesPromptParams): Promise<string> {
  const baseNorm = normalizeHermesApiBaseUrl(params.baseUrl)
  const bearer = await resolveEffectiveHermesBearerKeyAsync(params.apiKey, baseNorm)

  hermesDebug.chatStart({
    baseRaw: params.baseUrl,
    baseNorm,
    mode: 'hermes_responses',
    model: params.model,
    conversation: params.conversation,
    inputChars: params.input.length,
  })

  const spec: RequestSpec = {
    baseUrl: baseNorm,
    bearer,
    model: params.model,
    input: params.input,
    conversation: params.conversation,
    stream: true,
    signal: params.signal,
  }

  try {
    const streamed = await streamResponses(spec, params)
    if (streamed.trim()) {
      hermesDebug.chatDone({ outChars: streamed.length })
      return streamed
    }
    const viaFallback = await nonStreamResponses(spec, params)
    hermesDebug.chatDone({ outChars: viaFallback.length, viaNonStreamFallback: true })
    return viaFallback
  } catch (e) {
    if (params.signal?.aborted) throw e
    hermesDebug.chatError({
      name: e instanceof Error ? e.name : 'Error',
      message: e instanceof Error ? e.message.slice(0, 600) : String(e).slice(0, 600),
    })
    throw e
  }
}

export { HERMES_API_DEFAULT_BASE, HERMES_API_DEFAULT_MODEL }

/**
 * Hermes server-side tools client — thin wrapper over `GET /v1/tools` (discovery)
 * and `POST /v1/tools/{name}/invoke` (execution). The orchestrator exposes the
 * three headline Hermes tools (`hermes_kb_search`, `hermes_web_search`,
 * `hermes_skill`) as regular tool calls inside its loop; this module is the
 * shared HTTP layer both the dispatcher and the discovery UI call into.
 *
 * Bearer resolution mirrors `hermesResponses.ts` so the user only has to
 * configure the Hermes API key in one place (UI override > Z.AI provider key
 * > `~/.hermes/.env`).
 */

import { hermesInstrumentedFetch } from './hermesDebugLog'
import { resolveEffectiveHermesBearerKeyAsync } from './hermesApiKey'
import { normalizeHermesApiBaseUrl } from '../../store/settingsStore'

/** Minimal descriptor returned by `GET /v1/tools`. */
export interface HermesToolDescriptor {
  name: string
  description?: string
  /** Raw JSON-schema for the tool's parameters (OpenAI-function style). */
  parameters?: Record<string, unknown>
}

/** Result of invoking a single Hermes tool. */
export interface HermesToolInvocationResult {
  ok: boolean
  status: number
  /** Best-effort stringified body (already truncated to ≤ 16 KiB). */
  text: string
  /** Parsed JSON body, when the server returned `application/json`. */
  json?: unknown
}

/** List the tools the Hermes gateway currently exposes. */
export async function listHermesTools(
  baseUrl: string,
  apiKey: string | undefined,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; tools: HermesToolDescriptor[]; error?: string }> {
  const b = normalizeHermesApiBaseUrl(baseUrl)
  const url = `${b}/tools`
  const headers: Record<string, string> = { Accept: 'application/json' }
  const key = await resolveEffectiveHermesBearerKeyAsync(apiKey, b)
  if (key) headers.Authorization = `Bearer ${key}`

  try {
    const res = await hermesInstrumentedFetch('hermes-tools-list', url, {
      method: 'GET',
      headers,
      signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, tools: [], error: text.slice(0, 800) }
    }
    const body = await res.json().catch(() => null as unknown)
    const tools = extractToolList(body)
    return { ok: true, status: res.status, tools }
  } catch (e) {
    return { ok: false, status: 0, tools: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Invoke a single Hermes tool. Input is a parsed object (not a JSON string) so
 * callers don't have to double-serialise; the response text is capped so one
 * bad tool call can't flood the orchestrator loop with megabytes.
 */
export async function invokeHermesTool(
  baseUrl: string,
  apiKey: string | undefined,
  toolName: string,
  toolInput: unknown,
  signal?: AbortSignal
): Promise<HermesToolInvocationResult> {
  const b = normalizeHermesApiBaseUrl(baseUrl)
  const url = `${b}/tools/${encodeURIComponent(toolName)}/invoke`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const key = await resolveEffectiveHermesBearerKeyAsync(apiKey, b)
  if (key) headers.Authorization = `Bearer ${key}`

  const body = JSON.stringify({ input: toolInput ?? {} })

  try {
    const res = await hermesInstrumentedFetch(`hermes-tool-invoke:${toolName}`, url, {
      method: 'POST',
      headers,
      body,
      signal,
    })
    const raw = await res.text().catch(() => '')
    const trimmed = raw.slice(0, 16 * 1024)
    let json: unknown
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      try {
        json = JSON.parse(trimmed)
      } catch {
        json = undefined
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      text: trimmed,
      json,
    }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      text: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Extract a tool array from whatever shape `GET /v1/tools` happens to return.
 * The gateway spec has been rolled forward a few times — tolerate `{ tools }`,
 * `{ data }`, or a bare array rather than hard-failing on a schema nit.
 */
function extractToolList(body: unknown): HermesToolDescriptor[] {
  if (!body) return []
  if (Array.isArray(body)) return body.filter(isToolDescriptor) as HermesToolDescriptor[]
  if (typeof body === 'object') {
    const o = body as Record<string, unknown>
    if (Array.isArray(o.tools)) return o.tools.filter(isToolDescriptor) as HermesToolDescriptor[]
    if (Array.isArray(o.data)) return o.data.filter(isToolDescriptor) as HermesToolDescriptor[]
  }
  return []
}

function isToolDescriptor(v: unknown): v is HermesToolDescriptor {
  return !!v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string'
}

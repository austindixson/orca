import { agentFetch } from './agentFetch'

/**
 * Preflight probe for OpenRouter models — verifies the model has at least one
 * live provider endpoint exposing `tools` in its `supported_parameters`, plus
 * surfaces the common failure modes (401 / 402 / 404 / rate-limited) that
 * otherwise only show up mid-run as opaque schema-guard or "No endpoints found
 * that support tool use" errors.
 *
 * See `docs/CANVAS_AGENT_BRIDGE.md` § "Preflight tool-use probe".
 */

export type PreflightStatus =
  | 'ok'
  | 'no-tools'
  | 'auth'
  | 'credits'
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'unknown'
  | 'skipped'

export interface PreflightResult {
  status: PreflightStatus
  detail?: string
  providerName?: string
  endpointName?: string
  checkedAt: number
}

interface EndpointInfo {
  status?: string | number | null
  supported_parameters?: string[]
  provider_name?: string
  name?: string
  tag?: string
}

interface EndpointsResponse {
  data?: {
    architecture?: { input_modalities?: string[] }
    endpoints?: EndpointInfo[]
  }
  error?: { message?: string; code?: number | string }
}

function splitModelName(modelName: string): { author: string; slug: string } | null {
  const t = modelName.trim()
  const i = t.indexOf('/')
  if (i <= 0 || i >= t.length - 1) return null
  return { author: t.slice(0, i), slug: t.slice(i + 1) }
}

function endpointLooksLive(status: EndpointInfo['status']): boolean {
  if (status === undefined || status === null) return true
  const s = typeof status === 'number' ? String(status) : status
  // OpenRouter's public docs currently return "0" for healthy endpoints and
  // non-zero / textual values for degraded ones; treat anything we can't
  // positively recognise as "live" conservatively as live so we don't hide
  // working routes if OR changes the enum.
  if (s === '0' || s === 'ok' || s === 'available' || s === 'healthy') return true
  if (s === 'deprecated' || s === 'unavailable' || s === 'offline' || s === 'disabled') return false
  return true
}

/**
 * Classify an `/endpoints` response (or failure) into a stable result code.
 * Exported for unit testing — the happy path call is `preflightOpenRouterModel`.
 */
export function classifyEndpointsResponse(
  httpStatus: number,
  body: unknown
): Omit<PreflightResult, 'checkedAt'> {
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      status: 'auth',
      detail: 'OpenRouter rejected the API key (401/403). Check Settings → Providers → OpenRouter.',
    }
  }
  if (httpStatus === 402) {
    return {
      status: 'credits',
      detail: 'OpenRouter reports insufficient credits (402). Top up at openrouter.ai/credits or use a :free model.',
    }
  }
  if (httpStatus === 404) {
    return {
      status: 'not-found',
      detail: 'OpenRouter does not know this model slug (404). Check the `vendor/model[:tag]` spelling.',
    }
  }
  if (httpStatus === 429) {
    return {
      status: 'rate-limited',
      detail: 'OpenRouter is rate-limiting this key (429). Wait a minute or switch to a paid tier.',
    }
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    const msg =
      (body as EndpointsResponse | null)?.error?.message ??
      `OpenRouter returned HTTP ${httpStatus}.`
    return { status: 'unknown', detail: String(msg) }
  }

  const data = (body as EndpointsResponse | null)?.data
  const endpoints = data?.endpoints ?? []
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    return {
      status: 'no-tools',
      detail: 'OpenRouter returned no endpoints for this model. It may be deprecated or private-beta.',
    }
  }
  const live = endpoints.filter((ep) => endpointLooksLive(ep.status))
  if (live.length === 0) {
    return {
      status: 'no-tools',
      detail: 'All OpenRouter endpoints for this model are marked unavailable right now.',
    }
  }
  const toolCapable = live.find((ep) => (ep.supported_parameters ?? []).includes('tools'))
  if (!toolCapable) {
    return {
      status: 'no-tools',
      detail:
        'No OpenRouter provider for this model exposes tool calls. Orca’s orchestrator needs tool-use — pick a different model.',
    }
  }
  return {
    status: 'ok',
    providerName: toolCapable.provider_name,
    endpointName: toolCapable.name || toolCapable.tag,
  }
}

/**
 * Hit OpenRouter's `/models/{author}/{slug}/endpoints` and decide whether the
 * model is usable as an Orca orchestrator/sub-agent (i.e. at least one live
 * provider supports `tools`). Never throws; transient network failures surface
 * as `{ status: 'network' }`.
 */
export async function preflightOpenRouterModel(
  modelName: string,
  apiKey: string | undefined
): Promise<PreflightResult> {
  const now = Date.now()
  const trimmed = (modelName || '').trim()
  if (!trimmed) {
    return { status: 'skipped', detail: 'No model slug provided.', checkedAt: now }
  }
  if (trimmed === 'openrouter/free') {
    // Router alias — OR picks a tool-capable model per request; treat as ok
    // but flag the caveat in `detail` so UI can warn the user.
    return {
      status: 'ok',
      detail:
        'Router alias: OpenRouter picks a provider per request. Safe for sub-agents, risky as the orchestrator model because tool-use is not guaranteed every turn.',
      providerName: 'OpenRouter Router',
      checkedAt: now,
    }
  }
  if (!apiKey || !apiKey.trim()) {
    return {
      status: 'skipped',
      detail: 'No OpenRouter API key configured yet — add one in Settings → Providers → OpenRouter.',
      checkedAt: now,
    }
  }
  const parsed = splitModelName(trimmed)
  if (!parsed) {
    return {
      status: 'not-found',
      detail: 'Slug must look like `vendor/model` or `vendor/model:tag` (e.g. `x-ai/grok-code-fast-1`).',
      checkedAt: now,
    }
  }
  const url = `https://openrouter.ai/api/v1/models/${encodeURIComponent(parsed.author)}/${encodeURIComponent(parsed.slug)}/endpoints`
  let res: Response
  try {
    res = await agentFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
  } catch (err) {
    return {
      status: 'network',
      detail: err instanceof Error ? err.message : 'Network error while reaching OpenRouter.',
      checkedAt: now,
    }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const classified = classifyEndpointsResponse(res.status, body)
  return { ...classified, checkedAt: now }
}

export function describePreflight(result: PreflightResult | undefined): {
  tone: 'ok' | 'warn' | 'err' | 'neutral'
  short: string
  long: string
} {
  if (!result) return { tone: 'neutral', short: 'Not checked', long: 'Tool-use preflight has not been run for this model.' }
  switch (result.status) {
    case 'ok':
      return {
        tone: 'ok',
        short: result.providerName ? `Tools ✓ (${result.providerName})` : 'Tools ✓',
        long: result.detail ?? 'At least one live OpenRouter provider supports tool calls.',
      }
    case 'no-tools':
      return {
        tone: 'err',
        short: 'No tool-use',
        long:
          result.detail ??
          'OpenRouter could not find a live provider that exposes tool calls for this model.',
      }
    case 'auth':
      return { tone: 'err', short: 'Bad API key', long: result.detail ?? 'OpenRouter rejected the API key.' }
    case 'credits':
      return { tone: 'err', short: 'No credits', long: result.detail ?? 'OpenRouter reports insufficient credits.' }
    case 'not-found':
      return { tone: 'err', short: 'Unknown slug', long: result.detail ?? 'Unknown model slug.' }
    case 'rate-limited':
      return { tone: 'warn', short: 'Rate-limited', long: result.detail ?? 'OpenRouter is rate-limiting this key.' }
    case 'network':
      return { tone: 'warn', short: 'Network error', long: result.detail ?? 'Could not reach OpenRouter.' }
    case 'skipped':
      return { tone: 'neutral', short: 'Add key', long: result.detail ?? 'Preflight skipped.' }
    default:
      return { tone: 'warn', short: 'Unknown', long: result.detail ?? 'OpenRouter returned an unexpected response.' }
  }
}

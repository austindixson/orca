import { agentFetch } from './agentFetch'

interface EndpointInfo {
  status?: string
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
}

const CACHE_TTL_MS = 60_000
const capabilityCache = new Map<string, { expiresAt: number; value: OpenRouterImageRouteResult }>()

export interface OpenRouterImageRouteResult {
  supported: boolean
  providerName?: string
  endpointName?: string
}

function cacheKey(modelName: string): string {
  return modelName.trim().toLowerCase()
}

function splitModelName(modelName: string): { author: string; slug: string } | null {
  const t = modelName.trim()
  const i = t.indexOf('/')
  if (i <= 0 || i >= t.length - 1) return null
  return { author: t.slice(0, i), slug: t.slice(i + 1) }
}

function endpointLooksLive(status: string | undefined): boolean {
  // OpenRouter docs show enum-like status values as strings; "0" is healthy/available.
  return status === undefined || status === '0'
}

export async function openRouterImageRoute(
  modelName: string,
  apiKey: string
): Promise<OpenRouterImageRouteResult> {
  const key = cacheKey(modelName)
  const now = Date.now()
  const cached = capabilityCache.get(key)
  if (cached && cached.expiresAt > now) return cached.value

  // Router aliases are capability-aware by design.
  if (modelName === 'openrouter/free') {
    const v: OpenRouterImageRouteResult = {
      supported: true,
      providerName: 'OpenRouter Router',
      endpointName: 'free-router',
    }
    capabilityCache.set(key, { value: v, expiresAt: now + CACHE_TTL_MS })
    return v
  }

  const parsed = splitModelName(modelName)
  if (!parsed) return { supported: false }

  const url = `https://openrouter.ai/api/v1/models/${encodeURIComponent(parsed.author)}/${encodeURIComponent(parsed.slug)}/endpoints`
  try {
    const res = await agentFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    if (!res.ok) {
      const v: OpenRouterImageRouteResult = { supported: false }
      capabilityCache.set(key, { value: v, expiresAt: now + 10_000 })
      return v
    }
    const data = (await res.json()) as EndpointsResponse
    const modalities = data.data?.architecture?.input_modalities ?? []
    const modelSupportsImage = modalities.includes('image')
    if (!modelSupportsImage) {
      const v: OpenRouterImageRouteResult = { supported: false }
      capabilityCache.set(key, { value: v, expiresAt: now + CACHE_TTL_MS })
      return v
    }
    const endpoints = data.data?.endpoints ?? []
    const selected = endpoints.find((ep) => {
      if (!endpointLooksLive(ep.status)) return false
      const params = ep.supported_parameters ?? []
      return params.includes('tools')
    })
    const v: OpenRouterImageRouteResult = selected
      ? {
          supported: true,
          providerName: selected.provider_name,
          endpointName: selected.name || selected.tag,
        }
      : { supported: false }
    capabilityCache.set(key, { value: v, expiresAt: now + CACHE_TTL_MS })
    return v
  } catch {
    // Network/transient fetch failure: do not hard-block attempts.
    return { supported: true }
  }
}

import { agentFetch } from './agentFetch'
import { resolveApiKey, resolveBaseUrl } from './llmCredentials'
import { useSettingsStore } from '../store/settingsStore'
import type { OpenRouterCreditsSnapshot } from '../store/openRouterUsageStore'

/** Normalize settings base to `.../api/v1` for OpenRouter REST paths. */
function openRouterApiV1Root(baseFromSettings: string | undefined): string {
  const t = (baseFromSettings ?? '').trim().replace(/\/$/, '')
  if (!t) return 'https://openrouter.ai/api/v1'
  if (/\/api\/v1$/i.test(t)) return t
  if (/openrouter\.ai$/i.test(t)) return `${t}/api/v1`
  return 'https://openrouter.ai/api/v1'
}

/**
 * Account credits: GET /api/v1/credits (see OpenRouter docs). May require account-capable key.
 */
async function fetchCreditsEndpoint(
  apiKey: string,
  root: string
): Promise<OpenRouterCreditsSnapshot | null> {
  const url = `${root}/credits`
  const res = await agentFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const now = Date.now()
  if (!res.ok) return null
  const json = (await res.json()) as {
    data?: { total_credits?: number; total_usage?: number }
  }
  const d = json.data
  if (!d || typeof d.total_credits !== 'number' || typeof d.total_usage !== 'number') {
    return null
  }
  const remaining = d.total_credits - d.total_usage
  return {
    fetchedAt: now,
    usageUsd: d.total_usage,
    limitUsd: d.total_credits,
    remainingUsd: Number.isFinite(remaining) ? Math.max(0, remaining) : undefined,
  }
}

/**
 * Per-key usage: GET /api/v1/auth/key (fallback when /credits is unavailable).
 */
async function fetchAuthKeyEndpoint(
  apiKey: string,
  root: string
): Promise<OpenRouterCreditsSnapshot> {
  const url = `${root}/auth/key`
  const res = await agentFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const now = Date.now()
  if (!res.ok) {
    const t = await res.text()
    return {
      fetchedAt: now,
      error: t.slice(0, 200) || `HTTP ${res.status}`,
    }
  }
  const json = (await res.json()) as {
    data?: {
      label?: string
      usage?: number
      limit?: number
      limit_remaining?: number
      is_free_tier?: boolean
    }
  }
  const d = json.data
  if (!d) {
    return { fetchedAt: now, error: 'Unexpected auth/key response' }
  }
  return {
    fetchedAt: now,
    label: d.label,
    usageUsd: d.usage,
    limitUsd: d.limit,
    remainingUsd: d.limit_remaining,
    isFreeTier: d.is_free_tier,
  }
}

/**
 * OpenRouter account / key usage — tries GET /credits, then GET /auth/key.
 */
export async function fetchOpenRouterCredits(params: {
  apiKey: string
  baseUrlFromSettings?: string
}): Promise<OpenRouterCreditsSnapshot> {
  const root = openRouterApiV1Root(params.baseUrlFromSettings)
  const fromCredits = await fetchCreditsEndpoint(params.apiKey, root)
  if (fromCredits) return fromCredits
  return fetchAuthKeyEndpoint(params.apiKey, root)
}

export async function fetchOpenRouterCreditsFromSettings(): Promise<OpenRouterCreditsSnapshot | null> {
  const settings = useSettingsStore.getState()
  const key = await resolveApiKey('openrouter', settings.providers.openrouter.apiKey)
  if (!key) {
    return { fetchedAt: Date.now(), error: 'No OpenRouter API key' }
  }
  const base = await resolveBaseUrl('openrouter', settings.providers.openrouter.baseUrl)
  return fetchOpenRouterCredits({ apiKey: key, baseUrlFromSettings: base })
}

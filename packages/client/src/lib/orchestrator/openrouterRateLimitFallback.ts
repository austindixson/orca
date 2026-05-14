import { useSettingsStore } from '../../store/settingsStore'

/** OpenRouter slugs offered when the primary model hits HTTP 429. */
export const OPENROUTER_RATE_LIMIT_FALLBACK_MODEL_IDS = [
  'qwen/qwen3-coder-30b-a3b-instruct',
  'qwen/qwen3-coder-next',
] as const

/**
 * Legacy name kept for tests: threshold was "failures after which we activate fallback".
 * Policy is now: activate on the **first** rate-limit-like failure on the primary (see
 * {@link shouldActivateOpenRouterFallbackAfterRateLimitFailures}).
 */
export const OPENROUTER_RECONNECT_ATTEMPTS_BEFORE_FALLBACK = 0

export type OpenRouterRateLimitFallbackModelId =
  (typeof OPENROUTER_RATE_LIMIT_FALLBACK_MODEL_IDS)[number]

const DEFAULT_FALLBACK_MODEL: OpenRouterRateLimitFallbackModelId =
  'qwen/qwen3-coder-30b-a3b-instruct'

/** Wall-clock ms until requests stop using the fallback model (module state, not persisted). */
let fallbackUntilMs = 0

export function resetOpenRouterRateLimitFallbackForTests(): void {
  fallbackUntilMs = 0
}

export function getOpenRouterRateLimitFallbackUntilMs(): number {
  return fallbackUntilMs
}

/**
 * Effective model for OpenRouter `chat/completions` when a rate-limit window is active.
 * Does not change the user's selected model in Settings.
 */
export function getEffectiveOpenRouterModel(requestedModel: string): string {
  const s = useSettingsStore.getState()
  if (!s.openrouterRateLimitFallbackEnabled) return requestedModel
  if (Date.now() >= fallbackUntilMs) return requestedModel
  const fb = normalizeFallbackModelId(s.openrouterRateLimitFallbackModelId)
  if (!fb || fb === requestedModel) return requestedModel
  return fb
}

function normalizeFallbackModelId(raw: string | undefined): string {
  const t = (raw ?? '').trim()
  if (t) return t
  return DEFAULT_FALLBACK_MODEL
}

/**
 * On OpenRouter HTTP 429: if enabled, start (or refresh) the fallback window and return true so the
 * caller retries immediately with {@link getEffectiveOpenRouterModel} (no backoff for that hop).
 * Returns false when the 429 was already on the fallback model or fallback is disabled / invalid.
 */
export function tryActivateOpenRouterRateLimitFallback(
  userSelectedModel: string,
  modelUsedInRequest: string
): boolean {
  const s = useSettingsStore.getState()
  if (!s.openrouterRateLimitFallbackEnabled) return false
  const fb = normalizeFallbackModelId(s.openrouterRateLimitFallbackModelId)
  const primary = userSelectedModel.trim()
  const used = modelUsedInRequest.trim()
  if (!fb || fb === primary) return false
  // Request used a different slug than the user’s primary (e.g. already on fallback) — no second activation
  if (used !== primary) return false
  const mins = Math.max(0.25, Number(s.openrouterRateLimitFallbackMinutes) || 2)
  fallbackUntilMs = Date.now() + mins * 60_000
  return true
}

/**
 * HTTP status + body patterns where we should try the configured OpenRouter fallback model (not only 429).
 * OpenRouter may surface limits as 503/529 with rate-like bodies.
 */
export function shouldAttemptOpenRouterRateLimitFallback(status: number, errorText: string): boolean {
  if (status === 429) return true
  const slice = errorText.slice(0, 2500)
  if (status === 503 || status === 529) {
    return /rate|limit|throttl|overload|capacity|too many|temporar|busy|retry later|unavailable/i.test(
      slice
    )
  }
  return false
}

/**
 * Decide whether fallback should activate after a streak of rate-limit-like failures on the primary model.
 * `primaryRateLimitFailureCount` counts failed primary requests in a row.
 */
export function shouldActivateOpenRouterFallbackAfterRateLimitFailures(
  primaryRateLimitFailureCount: number
): boolean {
  return primaryRateLimitFailureCount >= 1
}

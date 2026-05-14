import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { useSettingsStore } from '../../store/settingsStore'
import {
  getEffectiveOpenRouterModel,
  getOpenRouterRateLimitFallbackUntilMs,
  resetOpenRouterRateLimitFallbackForTests,
  shouldActivateOpenRouterFallbackAfterRateLimitFailures,
  tryActivateOpenRouterRateLimitFallback,
} from './openrouterRateLimitFallback'

describe('openrouterRateLimitFallback', () => {
  beforeEach(() => {
    resetOpenRouterRateLimitFallbackForTests()
    useSettingsStore.setState({
      openrouterRateLimitFallbackEnabled: true,
      openrouterRateLimitFallbackModelId: 'qwen/qwen3-coder-next',
      openrouterRateLimitFallbackMinutes: 2,
    })
  })

  it('returns primary model when fallback window is not active', () => {
    assert.equal(getEffectiveOpenRouterModel('anthropic/claude-3.5-sonnet'), 'anthropic/claude-3.5-sonnet')
  })

  it('activates fallback on 429 for primary and maps requests to fallback slug', () => {
    const primary = 'anthropic/claude-3.5-sonnet'
    const ok = tryActivateOpenRouterRateLimitFallback(primary, primary)
    assert.equal(ok, true)
    assert.ok(getOpenRouterRateLimitFallbackUntilMs() > Date.now())
    assert.equal(getEffectiveOpenRouterModel(primary), 'qwen/qwen3-coder-next')
  })

  it('does not activate when disabled in settings', () => {
    useSettingsStore.setState({ openrouterRateLimitFallbackEnabled: false })
    const primary = 'x-ai/grok-code-fast-1'
    assert.equal(tryActivateOpenRouterRateLimitFallback(primary, primary), false)
    assert.equal(getEffectiveOpenRouterModel(primary), primary)
  })

  it('does not fast-retry path when 429 is already on the fallback model', () => {
    const primary = 'openai/gpt-4o'
    tryActivateOpenRouterRateLimitFallback(primary, primary)
    assert.equal(tryActivateOpenRouterRateLimitFallback(primary, 'qwen/qwen3-coder-next'), false)
  })

  it('activates on the first rate-limit failure streak on primary', () => {
    assert.equal(shouldActivateOpenRouterFallbackAfterRateLimitFailures(0), false)
    assert.equal(shouldActivateOpenRouterFallbackAfterRateLimitFailures(1), true)
    assert.equal(shouldActivateOpenRouterFallbackAfterRateLimitFailures(2), true)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  shouldAttemptZaiRateLimitProviderFallback,
  shouldAttemptZaiRateLimitProviderFallbackFromHttp,
} from './chatCompletion'

describe('shouldAttemptZaiRateLimitProviderFallback', () => {
  it('matches Z.AI quota error wording', () => {
    assert.equal(
      shouldAttemptZaiRateLimitProviderFallback(
        new Error('HTTP 429: Usage limit reached for 5 hour. Your limit will reset later')
      ),
      true
    )
    assert.equal(
      shouldAttemptZaiRateLimitProviderFallback(
        new Error('[Rate limited on Z.AI] API quota exceeded, waiting...')
      ),
      true
    )
  })

  it('does not match unrelated errors', () => {
    assert.equal(
      shouldAttemptZaiRateLimitProviderFallback(new Error('HTTP 500: Internal server error')),
      false
    )
    assert.equal(shouldAttemptZaiRateLimitProviderFallback(new Error('socket closed')), false)
  })

  it('matches HTTP-level rate-limit signals for early provider hop', () => {
    assert.equal(shouldAttemptZaiRateLimitProviderFallbackFromHttp(429, 'anything'), true)
    assert.equal(
      shouldAttemptZaiRateLimitProviderFallbackFromHttp(503, '{"error":{"code":"1305"}}'),
      true
    )
    assert.equal(
      shouldAttemptZaiRateLimitProviderFallbackFromHttp(400, 'API quota exceeded on your plan'),
      true
    )
    assert.equal(shouldAttemptZaiRateLimitProviderFallbackFromHttp(500, 'internal error'), false)
  })
})

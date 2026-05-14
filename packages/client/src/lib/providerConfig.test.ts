import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { parseAndValidateHybridProviderConfig, validateHybridProviderConfig } from './providerConfig'

describe('validateHybridProviderConfig', () => {
  it('accepts the hermes-dev provider config example', () => {
    const text = readFileSync(
      '/Users/ghost/Desktop/orca/hermes-dev/HERMES-ANY-APP-PROVIDER-CONFIG.example.json',
      'utf8'
    )
    const parsed = JSON.parse(text)
    const out = validateHybridProviderConfig(parsed)
    assert.equal(out.ok, true)
    assert.equal(out.errors.length, 0)
  })

  it('rejects invalid runtime policy', () => {
    const bad = {
      version: '1.0.0',
      providers: [
        {
          id: 'x',
          displayName: 'X',
          type: 'hosted_api',
          enabled: true,
          api: { baseUrl: 'https://example.com', apiKeyRef: 'k', timeoutMs: 1000 },
          models: [{ id: 'm', displayName: 'M', supportsTools: true, contextWindowTokens: 4096, reasoningModes: ['auto'] }],
          defaultModelId: 'm',
        },
      ],
      runtimePolicies: {
        localOrchestrator: { providerId: 'x', modelId: 'm', reasoningMode: 'bad', allowFallback: true },
        hermesLead: { providerId: 'x', modelId: 'm', reasoningMode: 'expert', allowFallback: true },
      },
    }
    const out = validateHybridProviderConfig(bad)
    assert.equal(out.ok, false)
    assert.ok(out.errors.some((e) => e.includes('runtimePolicies.localOrchestrator.reasoningMode')))
  })

  it('parseAndValidate returns parse errors', () => {
    const out = parseAndValidateHybridProviderConfig('{ nope')
    assert.equal(out.ok, false)
    if (!out.ok) assert.ok(out.errors.length > 0)
  })
})

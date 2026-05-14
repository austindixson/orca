/**
 * Settings store helpers — canvas theme normalization (legacy id migration).
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareModelsForDisplay,
  migrateLegacyOpenAiCodexModelId,
  migrateSettingsPersistedStateForVaultMirror,
  migrateZaiBaseUrlToCoding,
  type ModelConfig,
  normalizeCanvasThemeId,
  normalizeHermesApiBaseUrl,
  normalizeHybridAuthProfiles,
  normalizeHybridGuiShellMode,
  normalizeHybridRuntimePolicies,
  normalizeOpenAiDiscoveredModels,
  normalizeOpenRouterCatalogResponse,
  resolveHybridProviderConfigState,
  validateHybridRuntimePolicyRefs,
  DEFAULT_HYBRID_RUNTIME_POLICIES,
  XAI_DEFAULT_BASE,
  XAI_MODELS,
  PROVIDER_INFO,
} from './settingsStore'

describe('normalizeCanvasThemeId', () => {
  test('maps legacy nyx persisted id to orca', () => {
    assert.equal(normalizeCanvasThemeId('nyx'), 'orca')
  })

  test('accepts current theme ids', () => {
    assert.equal(normalizeCanvasThemeId('orca'), 'orca')
    assert.equal(normalizeCanvasThemeId('midnightBloom'), 'midnightBloom')
    assert.equal(normalizeCanvasThemeId('graphiteLab'), 'graphiteLab')
    assert.equal(normalizeCanvasThemeId('pastelMist'), 'pastelMist')
  })

  test('falls back to orca for unknown values', () => {
    assert.equal(normalizeCanvasThemeId(''), 'orca')
    assert.equal(normalizeCanvasThemeId(null), 'orca')
    assert.equal(normalizeCanvasThemeId('not-a-theme'), 'orca')
  })
})

describe('normalizeHermesApiBaseUrl', () => {
  test('does not append /v1 to api.z.ai …/paas/v4 (Z.AI OpenAI chat base)', () => {
    assert.equal(
      normalizeHermesApiBaseUrl('https://api.z.ai/api/coding/paas/v4'),
      'https://api.z.ai/api/coding/paas/v4'
    )
    assert.equal(
      normalizeHermesApiBaseUrl('https://api.z.ai/api/paas/v4'),
      'https://api.z.ai/api/paas/v4'
    )
  })

  test('strips legacy …/paas/v4/v1 suffix from Z.AI bases', () => {
    assert.equal(
      normalizeHermesApiBaseUrl('https://api.z.ai/api/coding/paas/v4/v1'),
      'https://api.z.ai/api/coding/paas/v4'
    )
  })

  test('still appends /v1 for local Hermes gateway', () => {
    assert.equal(normalizeHermesApiBaseUrl('http://127.0.0.1:8642'), 'http://127.0.0.1:8642/v1')
  })

  test('preserves explicit /v1 suffix', () => {
    assert.equal(normalizeHermesApiBaseUrl('http://127.0.0.1:8642/v1'), 'http://127.0.0.1:8642/v1')
  })
})

describe('normalizeHybridGuiShellMode', () => {
  test('accepts spotlight launcher mode and falls back to desktop sidebar', () => {
    assert.equal(normalizeHybridGuiShellMode('spotlight_launcher'), 'spotlight_launcher')
    assert.equal(normalizeHybridGuiShellMode('desktop_sidebar'), 'desktop_sidebar')
    assert.equal(normalizeHybridGuiShellMode(''), 'desktop_sidebar')
    assert.equal(normalizeHybridGuiShellMode('unknown'), 'desktop_sidebar')
  })
})

describe('normalizeHybridAuthProfiles', () => {
  test('filters invalid records and keeps encrypted refs + lane metadata', () => {
    const out = normalizeHybridAuthProfiles([
      {
        id: 'drive-oauth',
        appId: 'google_drive',
        lane: 'oauth',
        createdAt: '2026-04-22T00:00:00.000Z',
        updatedAt: '2026-04-22T00:00:00.000Z',
        oauth: { tokenRef: 'secret://drive/token' },
      },
      {
        id: 'bad-profile',
        appId: 'x',
        lane: 'browser_session',
        createdAt: '2026-04-22T00:00:00.000Z',
        updatedAt: '2026-04-22T00:00:00.000Z',
        browserSession: { sessionBundleRef: '', runtimeFingerprintRef: '', domainBindings: [] },
      },
    ])

    assert.equal(out.length, 1)
    assert.equal(out[0]?.id, 'drive-oauth')
    assert.equal(out[0]?.oauth?.tokenRef, 'secret://drive/token')
  })
})

describe('migrateZaiBaseUrlToCoding', () => {
  test('maps general api.z.ai PaaS URL to Coding Plan endpoint', () => {
    assert.equal(
      migrateZaiBaseUrlToCoding('https://api.z.ai/api/paas/v4'),
      'https://api.z.ai/api/coding/paas/v4'
    )
    assert.equal(
      migrateZaiBaseUrlToCoding('http://api.z.ai/api/paas/v4/'),
      'https://api.z.ai/api/coding/paas/v4'
    )
  })

  test('leaves coding URL and other hosts unchanged', () => {
    assert.equal(
      migrateZaiBaseUrlToCoding('https://api.z.ai/api/coding/paas/v4'),
      'https://api.z.ai/api/coding/paas/v4'
    )
    assert.equal(migrateZaiBaseUrlToCoding(''), 'https://api.z.ai/api/coding/paas/v4')
  })
})

describe('normalizeOpenAiDiscoveredModels', () => {
  test('keeps likely chat/reasoning models and filters non-chat endpoints', () => {
    const models = normalizeOpenAiDiscoveredModels({
      data: [
        { id: 'gpt-4.1' },
        { id: 'gpt-5' },
        { id: 'o3' },
        { id: 'codex-mini-latest' },
        { id: 'text-embedding-3-large' },
        { id: 'whisper-1' },
        { id: 'gpt-image-1' },
      ],
    })

    assert.deepEqual(
      models.map((m) => m.name),
      ['codex-mini-latest', 'gpt-4.1', 'gpt-5', 'o3']
    )
    assert.equal(models.find((m) => m.name === 'gpt-4.1')?.supportsImages, true)
    assert.equal(models.find((m) => m.name === 'o3')?.supportsTools, true)
  })
})

describe('compareModelsForDisplay', () => {
  test('sorts OpenAI coding models by input price descending before other models', () => {
    const models: ModelConfig[] = [
      { id: 'gpt-5-mini', provider: 'openai', name: 'gpt-5-mini', displayName: 'GPT-5 Mini', supportsTools: true },
      { id: 'gpt-5.2-pro', provider: 'openai', name: 'gpt-5.2-pro', displayName: 'GPT-5.2 Pro', supportsTools: true },
      { id: 'gpt-4.1', provider: 'openai', name: 'gpt-4.1', displayName: 'GPT-4.1', supportsTools: true },
      { id: 'claude-sonnet', provider: 'anthropic', name: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', supportsTools: true },
      { id: 'gpt-5-codex', provider: 'openai', name: 'gpt-5-codex', displayName: 'GPT-5 Codex', supportsTools: true },
    ]

    const ordered = [...models].sort(compareModelsForDisplay)
    assert.deepEqual(ordered.map((m) => m.name), [
      'gpt-5.2-pro',
      'gpt-5-codex',
      'gpt-5-mini',
      'claude-sonnet-4-20250514',
      'gpt-4.1',
    ])
  })

  test('sorts OpenAI Codex coding models ahead of non-coding models too', () => {
    const models: ModelConfig[] = [
      { id: 'codex-gpt-5.1-codex', provider: 'openaiCodex', name: 'gpt-5.1-codex', displayName: 'GPT-5.1 Codex', supportsTools: true },
      { id: 'gpt-4.1', provider: 'openai', name: 'gpt-4.1', displayName: 'GPT-4.1', supportsTools: true },
      { id: 'claude-sonnet', provider: 'anthropic', name: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', supportsTools: true },
    ]

    const ordered = [...models].sort(compareModelsForDisplay)
    assert.deepEqual(ordered.map((m) => m.id), [
      'codex-gpt-5.1-codex',
      'claude-sonnet',
      'gpt-4.1',
    ])
  })
})

describe('migrateLegacyOpenAiCodexModelId', () => {
  test('maps unsupported legacy OpenAI Codex model ids onto the supported default model id', () => {
    assert.equal(migrateLegacyOpenAiCodexModelId('gpt-5.2-codex'), 'codex-gpt-5.4')
    assert.equal(migrateLegacyOpenAiCodexModelId('gpt-5-codex'), 'codex-gpt-5.4')
    assert.equal(migrateLegacyOpenAiCodexModelId('codex-mini-latest'), 'codex-gpt-5.4')
  })

  test('leaves non-legacy model ids unchanged', () => {
    assert.equal(migrateLegacyOpenAiCodexModelId('gpt-5.4'), 'gpt-5.4')
    assert.equal(migrateLegacyOpenAiCodexModelId(null), null)
  })
})

describe('migrateSettingsPersistedStateForVaultMirror', () => {
  test('promotes legacy default-off mirror to on when user never toggled (v0)', () => {
    const out = migrateSettingsPersistedStateForVaultMirror(
      { orcaVaultBrainMirrorEnabled: false },
      0
    ) as { orcaVaultBrainMirrorEnabled: boolean }
    assert.equal(out.orcaVaultBrainMirrorEnabled, true)
  })

  test('does not override explicit opt-out (userChoice true, mirror false)', () => {
    const out = migrateSettingsPersistedStateForVaultMirror(
      { orcaVaultBrainMirrorEnabled: false, orcaVaultBrainMirrorUserChoice: true },
      0
    ) as { orcaVaultBrainMirrorEnabled: boolean }
    assert.equal(out.orcaVaultBrainMirrorEnabled, false)
  })

  test('leaves already-enabled installs unchanged', () => {
    const out = migrateSettingsPersistedStateForVaultMirror(
      { orcaVaultBrainMirrorEnabled: true },
      0
    ) as { orcaVaultBrainMirrorEnabled: boolean }
    assert.equal(out.orcaVaultBrainMirrorEnabled, true)
  })

  test('no-op when persist version already >= 1', () => {
    const state = { orcaVaultBrainMirrorEnabled: false }
    const out = migrateSettingsPersistedStateForVaultMirror(state, 1)
    assert.deepEqual(out, state)
  })
})

describe('hybrid provider runtime policy hydration', () => {
  test('normalizes malformed runtime policy payloads with fallback defaults', () => {
    const out = normalizeHybridRuntimePolicies({
      localOrchestrator: { providerId: '   ', modelId: '', reasoningMode: 'n/a', allowFallback: 'yes' },
    })

    assert.deepEqual(out.localOrchestrator, DEFAULT_HYBRID_RUNTIME_POLICIES.localOrchestrator)
    assert.deepEqual(out.hermesLead, DEFAULT_HYBRID_RUNTIME_POLICIES.hermesLead)
  })

  test('resolveHybridProviderConfigState applies runtimePolicies from valid config json', () => {
    const json = `{
      "version":"1.0.0",
      "providers":[
        {
          "id":"local-gateway",
          "displayName":"Local",
          "type":"local_gateway",
          "enabled":true,
          "api":{"baseUrl":"http://127.0.0.1:8642/v1","apiKeyRef":"key://local","timeoutMs":45000},
          "models":[{"id":"gpt-5.4-mini","displayName":"Local Mini","supportsTools":true,"contextWindowTokens":131072,"reasoningModes":["auto","fast"]}],
          "defaultModelId":"gpt-5.4-mini"
        },
        {
          "id":"openrouter",
          "displayName":"OpenRouter",
          "type":"hosted_api",
          "enabled":true,
          "api":{"baseUrl":"https://openrouter.ai/api/v1","apiKeyRef":"key://openrouter","timeoutMs":60000},
          "models":[{"id":"anthropic/claude-sonnet-4","displayName":"Sonnet","supportsTools":true,"contextWindowTokens":200000,"reasoningModes":["auto","expert","heavy"]}],
          "defaultModelId":"anthropic/claude-sonnet-4"
        }
      ],
      "runtimePolicies":{
        "localOrchestrator":{"providerId":"local-gateway","modelId":"gpt-5.4-mini","reasoningMode":"fast","allowFallback":true},
        "hermesLead":{"providerId":"openrouter","modelId":"anthropic/claude-sonnet-4","reasoningMode":"expert","allowFallback":true}
      }
    }`
    const out = resolveHybridProviderConfigState(json)

    assert.equal(out.hybridProviderConfigErrors.length, 0)
    assert.equal(out.hybridProviderConfig?.runtimePolicies.localOrchestrator.providerId, 'local-gateway')
    assert.equal(out.hybridRuntimePolicies.hermesLead.reasoningMode, 'expert')
  })

  test('validateHybridRuntimePolicyRefs rejects unknown provider/model references', () => {
    const config = {
      version: '1.0.0',
      providers: [
        {
          id: 'openrouter',
          displayName: 'OpenRouter',
          type: 'hosted_api',
          enabled: true,
          api: { baseUrl: 'https://openrouter.ai/api/v1', apiKeyRef: 'key://openrouter', timeoutMs: 60000 },
          models: [
            {
              id: 'openai/gpt-5.4-mini',
              displayName: 'GPT-5.4 Mini',
              supportsTools: true,
              contextWindowTokens: 200000,
              reasoningModes: ['auto', 'fast', 'expert'],
            },
          ],
          defaultModelId: 'openai/gpt-5.4-mini',
        },
      ],
      runtimePolicies: {
        localOrchestrator: {
          providerId: 'missing-provider',
          modelId: 'openai/gpt-5.4-mini',
          reasoningMode: 'fast',
          allowFallback: true,
        },
        hermesLead: {
          providerId: 'openrouter',
          modelId: 'missing-model',
          reasoningMode: 'heavy',
          allowFallback: true,
        },
      },
    }

    const errors = validateHybridRuntimePolicyRefs(config)
    assert.equal(errors.length, 2)
    assert.ok(errors.some((e) => e.includes('localOrchestrator.providerId references unknown provider')))
    assert.ok(errors.some((e) => e.includes("hermesLead.modelId references unknown model 'missing-model'")))
  })
})

describe('normalizeOpenRouterCatalogResponse', () => {
  test('maps OpenRouter /v1/models data array to catalog entries', () => {
    const rows = normalizeOpenRouterCatalogResponse({
      data: [
        {
          id: 'anthropic/claude-3.5-sonnet',
          name: 'Anthropic: Claude 3.5 Sonnet',
          context_length: 200_000,
          pricing: { prompt: '0.000003', completion: '0.000015' },
        },
      ],
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.id, 'anthropic/claude-3.5-sonnet')
    assert.equal(rows[0]!.name, 'Anthropic: Claude 3.5 Sonnet')
    assert.equal(rows[0]!.contextLength, 200_000)
    assert.equal(rows[0]!.pricing?.prompt, '0.000003')
    assert.equal(rows[0]!.pricing?.completion, '0.000015')
  })

  test('returns empty array for invalid payload', () => {
    assert.deepEqual(normalizeOpenRouterCatalogResponse(null), [])
    assert.deepEqual(normalizeOpenRouterCatalogResponse({}), [])
  })
})

describe('xAI provider defaults', () => {
  test('exports xAI provider metadata and default base URL', () => {
    assert.equal(PROVIDER_INFO.xai?.name, 'xAI (Grok)')
    assert.equal(PROVIDER_INFO.xai?.requiresKey, true)
    assert.equal(XAI_DEFAULT_BASE, 'https://api.x.ai/v1')
  })

  test('includes baseline Grok models', () => {
    assert.ok(XAI_MODELS.some((m) => m.name === 'grok-4.20-reasoning'))
    assert.ok(XAI_MODELS.some((m) => m.name === 'grok-4'))
  })
})

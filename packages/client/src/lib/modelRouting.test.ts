import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ModelConfig } from '../store/settingsStore'
import { listPreferredVisionModels, pickPreferredVisionModel } from './modelRouting'

function m(partial: Partial<ModelConfig> & Pick<ModelConfig, 'id' | 'provider' | 'name' | 'displayName'>): ModelConfig {
  return {
    supportsImages: false,
    supportsTools: true,
    ...partial,
  }
}

describe('modelRouting vision selection', () => {
  it('selects a non-Z.AI vision model when current model is non-vision', () => {
    const models: ModelConfig[] = [
      m({ id: 'openai-gpt-5', provider: 'openai', name: 'gpt-5', displayName: 'GPT-5' }),
      m({
        id: 'or-minimax',
        provider: 'openrouter',
        name: 'minimax/minimax-m2.5:free',
        displayName: 'MiniMax M2.5 Free',
        supportsImages: true,
      }),
      m({ id: 'zai-glm-4-6v', provider: 'zai', name: 'GLM-4.6V', displayName: 'GLM-4.6V', supportsImages: true }),
    ]

    const selected = pickPreferredVisionModel(models, models[0])
    assert.equal(selected?.id, 'or-minimax')
  })

  it('prefers top Z.AI vision model when current provider is Z.AI', () => {
    const current = m({ id: 'zai-glm-4-5v', provider: 'zai', name: 'GLM-4.5V', displayName: 'GLM-4.5V', supportsImages: true })
    const models: ModelConfig[] = [
      current,
      m({ id: 'zai-glm-4-6v', provider: 'zai', name: 'GLM-4.6V', displayName: 'GLM-4.6V', supportsImages: true }),
      m({ id: 'or-free-router', provider: 'openrouter', name: 'openrouter/free', displayName: 'OR Free', supportsImages: true }),
    ]

    const selected = pickPreferredVisionModel(models, current)
    assert.equal(selected?.id, 'zai-glm-4-6v')
  })

  it('returns only image-capable models in ranked order', () => {
    const models: ModelConfig[] = [
      m({ id: 'txt-only', provider: 'openai', name: 'gpt-text', displayName: 'Text Only' }),
      m({ id: 'zai-glm-4-6v', provider: 'zai', name: 'GLM-4.6V', displayName: 'GLM-4.6V', supportsImages: true }),
      m({ id: 'or-free-router', provider: 'openrouter', name: 'openrouter/free', displayName: 'OR Free', supportsImages: true }),
    ]

    const ranked = listPreferredVisionModels(models, null)
    assert.deepEqual(
      ranked.map((x) => x.id),
      ['or-free-router', 'zai-glm-4-6v']
    )
  })
})

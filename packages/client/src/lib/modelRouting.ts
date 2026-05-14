import type { ModelConfig } from '../store/settingsStore'

function rankVisionModel(m: ModelConfig, preferZai: boolean): number {
  const id = `${m.id} ${m.name} ${m.displayName}`.toLowerCase()
  if (preferZai) {
    if (m.provider === 'zai' && /glm-4\.6v/.test(id)) return 0
    if (m.provider === 'zai' && /glm-4\.5v/.test(id)) return 1
    if (m.provider === 'zai' && /glm-5v/.test(id)) return 2
  }
  // User preference: MiniMax M2.5 free first for image-attached runs.
  if (!preferZai && m.provider === 'openrouter' && /minimax\/minimax-m2\.5:free/.test(id)) return 0
  // Then OpenRouter free router.
  if (!preferZai && m.provider === 'openrouter' && (m.name === 'openrouter/free' || m.id === 'or-free-router')) return 1
  // Prefer Z.AI non-turbo vision on paid tiers with tighter quotas.
  if (m.provider === 'zai' && /glm-4\.6v/.test(id)) return 2 + (preferZai ? 100 : 0)
  if (m.provider === 'zai' && /glm-4\.5v/.test(id)) return 3 + (preferZai ? 100 : 0)
  if (m.provider === 'zai' && /glm-5v/.test(id)) return 4 + (preferZai ? 100 : 0)
  // Then any other explicit vision model.
  if (m.supportsImages) return 10
  return 99
}

export function pickPreferredVisionModel(
  models: ModelConfig[],
  current: ModelConfig | null | undefined
): ModelConfig | null {
  const vision = models.filter((m) => m.supportsImages)
  if (vision.length === 0) return null
  const preferZai = current?.provider === 'zai'

  // Keep current only if already the top preferred choice.
  if (current?.supportsImages && rankVisionModel(current, preferZai) <= 0) return current

  const sorted = [...vision].sort((a, b) => {
    const ra = rankVisionModel(a, preferZai)
    const rb = rankVisionModel(b, preferZai)
    if (ra !== rb) return ra - rb
    return a.displayName.localeCompare(b.displayName)
  })
  return sorted[0] ?? null
}

export function listPreferredVisionModels(
  models: ModelConfig[],
  current?: ModelConfig | null
): ModelConfig[] {
  const preferZai = current?.provider === 'zai'
  const vision = models.filter((m) => m.supportsImages)
  return [...vision].sort((a, b) => {
    const ra = rankVisionModel(a, preferZai)
    const rb = rankVisionModel(b, preferZai)
    if (ra !== rb) return ra - rb
    return a.displayName.localeCompare(b.displayName)
  })
}

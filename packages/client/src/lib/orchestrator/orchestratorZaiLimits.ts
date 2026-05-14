import {
  ZAI_MODELS,
  maxConcurrentSubAgentsForZaiTier,
  useSettingsStore,
  type ZaiPlanTier,
} from '../../store/settingsStore'
import { MAX_CONCURRENT_SUB_AGENTS } from './orchestratorConstants'

/** True when the selected orchestrator model is a Z.AI GLM model (Coding Plan). */
export function isSelectedModelZai(modelId: string | null | undefined): boolean {
  if (!modelId) return false
  return ZAI_MODELS.some((m) => m.id === modelId)
}

/**
 * Sub-agent concurrency cap: tier-based when using a Z.AI main model, else legacy default (5).
 */
export function getEffectiveMaxConcurrentSubAgents(
  selectedModelId: string | null | undefined,
  zaiTier: ZaiPlanTier
): number {
  if (isSelectedModelZai(selectedModelId)) {
    return maxConcurrentSubAgentsForZaiTier(zaiTier)
  }
  return MAX_CONCURRENT_SUB_AGENTS
}

/** Reads current settings — use from `spawn_sub_agent` gate. */
export function getMaxConcurrentSubAgentsFromSettings(): number {
  const { selectedModel, zaiPlanTier } = useSettingsStore.getState()
  return getEffectiveMaxConcurrentSubAgents(selectedModel, zaiPlanTier)
}

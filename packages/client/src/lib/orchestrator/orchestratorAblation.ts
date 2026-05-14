/**
 * Controlled toggles for harness components (ablation / A–B testing).
 * Defaults preserve current production behavior.
 */
import { useSettingsStore } from '../../store/settingsStore'

export interface HarnessAblationFlags {
  /** Directory crawl stagnation nudges + halt in `runOrchestrator`. */
  stagnationGuard: boolean
  /** Auto-detected inspect issues in `inspectStore` (console/network heuristics). */
  inspectErrorDetection: boolean
  /** `canAutoFix` gating in auto-fix workflows. */
  autoFixGate: boolean
  /** FS overlap / workspace rules in `shouldParallelizeToolBatch`. */
  parallelBatchRules: boolean
}

export const DEFAULT_HARNESS_ABLATION: HarnessAblationFlags = {
  stagnationGuard: true,
  inspectErrorDetection: true,
  autoFixGate: true,
  parallelBatchRules: true,
}

export function mergeHarnessAblation(
  partial?: Partial<HarnessAblationFlags> | null
): HarnessAblationFlags {
  return { ...DEFAULT_HARNESS_ABLATION, ...partial }
}

/**
 * Persisted settings + optional per-run override.
 */
export function getHarnessAblationFlags(
  override?: Partial<HarnessAblationFlags> | null
): HarnessAblationFlags {
  const s = useSettingsStore.getState()
  const base: HarnessAblationFlags = {
    stagnationGuard: s.harnessStagnationGuard !== false,
    inspectErrorDetection: s.harnessInspectErrorDetection !== false,
    autoFixGate: s.harnessAutoFixGate !== false,
    parallelBatchRules: s.harnessParallelBatchRules !== false,
  }
  return mergeHarnessAblation({ ...base, ...override })
}

import {
  useSettingsStore,
  ZAI_HISTORICAL_SAFE_MIN_ROUND_MS,
  type Provider,
} from '../../store/settingsStore'
import { abortableSleep, throwIfAborted } from './abortable'

/**
 * Minimum time between *starts* of consecutive orchestrator chat/completions for providers
 * with strict RPM (notably Z.AI Coding). Reduces burst traffic in tight tool loops.
 */
let lastRoundStartMs = 0

/** Call at the start of each orchestrator run so the first round is not throttled by the previous session. */
export function resetOrchestratorPaceClock(): void {
  lastRoundStartMs = 0
}

export async function paceOrchestratorLlmRound(
  provider: Provider,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  const minGap =
    provider === 'zai'
      ? useSettingsStore.getState().zaiMinMsBetweenRounds ?? ZAI_HISTORICAL_SAFE_MIN_ROUND_MS
      : 0
  if (minGap <= 0) return
  const now = Date.now()
  const elapsed = now - lastRoundStartMs
  if (elapsed < minGap) {
    await abortableSleep(minGap - elapsed, signal)
  }
  lastRoundStartMs = Date.now()
}

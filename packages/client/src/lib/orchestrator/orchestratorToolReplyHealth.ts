/**
 * Runtime health for models that return HTTP-200 but semantically empty tool rounds.
 * Short-lived in-memory quarantine — not persisted across app restarts.
 */

const FAILURE_WINDOW_MS = 15 * 60_000
const FAILURES_BEFORE_QUARANTINE = 3
const QUARANTINE_MS = 5 * 60_000

type Entry = {
  failureTimes: number[]
  quarantineUntilMs: number
}

const byKey = new Map<string, Entry>()

function key(provider: string, model: string): string {
  return `${provider.trim().toLowerCase()}::${model.trim()}`
}

function pruneOldFailures(times: number[], now: number): number[] {
  const cutoff = now - FAILURE_WINDOW_MS
  return times.filter((t) => t >= cutoff)
}

/**
 * Record one empty tool-enabled assistant turn (after recovery exhausted or on final failure).
 */
export function noteOrchestratorEmptyToolReplyFailure(provider: string, model: string): void {
  const k = key(provider, model)
  const now = Date.now()
  let e = byKey.get(k)
  if (!e) {
    e = { failureTimes: [], quarantineUntilMs: 0 }
    byKey.set(k, e)
  }
  e.failureTimes = pruneOldFailures([...e.failureTimes, now], now)
  if (e.failureTimes.length >= FAILURES_BEFORE_QUARANTINE) {
    e.quarantineUntilMs = now + QUARANTINE_MS
    e.failureTimes = []
  }
}

/** True while quarantine window is active — steer users to a different model / OpenRouter fallback. */
export function isOrchestratorToolReplyQuarantined(provider: string, model: string): boolean {
  const e = byKey.get(key(provider, model))
  if (!e) return false
  return Date.now() < e.quarantineUntilMs
}

/** For Settings / diagnostics — recent empty-tool failures in the sliding window (not quarantine-only). */
export function getOrchestratorToolReplyRecentFailureCount(provider: string, model: string): number {
  const e = byKey.get(key(provider, model))
  if (!e) return 0
  const now = Date.now()
  return pruneOldFailures(e.failureTimes, now).length
}

export function getOrchestratorToolReplyQuarantineUntilMs(
  provider: string,
  model: string
): number | null {
  const e = byKey.get(key(provider, model))
  if (!e || e.quarantineUntilMs <= Date.now()) return null
  return e.quarantineUntilMs
}

export function resetOrchestratorToolReplyHealthForTests(): void {
  byKey.clear()
}

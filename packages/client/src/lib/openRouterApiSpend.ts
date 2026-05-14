/**
 * Derive session / today / ~7d spend from OpenRouter’s cumulative account usage (GET /credits or /auth/key).
 * OpenRouter does not expose per-window spend; we use deltas from cumulative `usageUsd` plus local snapshots.
 */

const LS_KEY = 'openrouter-api-usage-spend-v1'
const SS_SESSION_BASE = 'openrouter-api-usage-session-base'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const SNAPSHOT_RETAIN_MS = 14 * 24 * 60 * 60 * 1000
const MAX_SNAPSHOTS = 2500

export type OpenRouterApiSpend = {
  session: number
  today: number
  week: number
}

type Persisted = {
  lastUsageUsd: number
  lastDayKey: string
  /** Cumulative usage at the start of the current local calendar day (best effort). */
  baselineDayUsd: number
  /** Recent (usageUsd, time) samples for rolling 7d. */
  snapshots: { ts: number; u: number }[]
}

function localDayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function readState(): Persisted {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) throw new Error('empty')
    const o = JSON.parse(raw) as Persisted
    if (typeof o.lastUsageUsd !== 'number' || !Array.isArray(o.snapshots)) throw new Error('bad shape')
    return {
      lastUsageUsd: o.lastUsageUsd,
      lastDayKey: typeof o.lastDayKey === 'string' ? o.lastDayKey : localDayKey(Date.now()),
      baselineDayUsd: typeof o.baselineDayUsd === 'number' ? o.baselineDayUsd : o.lastUsageUsd,
      snapshots: o.snapshots.filter((s) => s && typeof s.ts === 'number' && typeof s.u === 'number'),
    }
  } catch {
    return {
      lastUsageUsd: 0,
      lastDayKey: '',
      baselineDayUsd: 0,
      snapshots: [],
    }
  }
}

function writeState(s: Persisted) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s))
  } catch {
    /* quota / private mode */
  }
}

function getSessionBaselineUsd(currentUsage: number): number {
  try {
    const v = sessionStorage.getItem(SS_SESSION_BASE)
    if (v != null) {
      const n = parseFloat(v)
      if (Number.isFinite(n)) return n
    }
    sessionStorage.setItem(SS_SESSION_BASE, String(currentUsage))
    return currentUsage
  } catch {
    return currentUsage
  }
}

function trimSnapshots(snapshots: { ts: number; u: number }[], now: number): { ts: number; u: number }[] {
  const cutoff = now - SNAPSHOT_RETAIN_MS
  const trimmed = snapshots.filter((x) => x.ts >= cutoff).slice(-MAX_SNAPSHOTS)
  return trimmed
}

function weekSpendFromSnapshots(
  usageUsd: number,
  snapshots: { ts: number; u: number }[],
  now: number
): number {
  const cutoff = now - WEEK_MS
  let best: { ts: number; u: number } | null = null
  for (const s of snapshots) {
    if (s.ts <= cutoff && (!best || s.ts > best.ts)) best = s
  }
  if (best) return Math.max(0, usageUsd - best.u)
  if (snapshots.length === 0) return 0
  const oldest = snapshots.reduce((a, b) => (a.ts < b.ts ? a : b))
  return Math.max(0, usageUsd - oldest.u)
}

/**
 * Call when a fresh cumulative `usageUsd` is received from OpenRouter credits/auth endpoints.
 * Updates persisted day baseline and snapshot history, then returns spend deltas.
 */
export function computeApiSpendDeltas(usageUsd: number): OpenRouterApiSpend {
  const now = Date.now()
  const dayKey = localDayKey(now)

  let state = readState()

  if (state.lastDayKey && state.lastDayKey !== dayKey) {
    state.baselineDayUsd = state.lastUsageUsd
    state.lastDayKey = dayKey
  } else if (!state.lastDayKey) {
    state.lastDayKey = dayKey
    state.baselineDayUsd = usageUsd
  }

  state.snapshots.push({ ts: now, u: usageUsd })
  state.snapshots = trimSnapshots(state.snapshots, now)
  state.lastUsageUsd = usageUsd
  writeState(state)

  const sessionBase = getSessionBaselineUsd(usageUsd)
  const session = Math.max(0, usageUsd - sessionBase)
  const today = Math.max(0, usageUsd - state.baselineDayUsd)
  const week = weekSpendFromSnapshots(usageUsd, state.snapshots, now)

  return { session, today, week }
}

import { create } from 'zustand'
import { nanoid } from 'nanoid'

/**
 * Lifecycle of a bounty item on the "bug bounty board".
 * - `queued`: triaged, waiting for a hunter to pick it up
 * - `investigating`: a troubleshooter sub-agent has been assigned
 * - `resolved`: the hunter finished with a root-cause / fix / deferral note
 * - `dismissed`: user or triage marked it as noise / duplicate
 * - Legacy values retained for prior persisted state so restored snapshots load.
 */
export type BountyStatus =
  | 'queued'
  | 'investigating'
  | 'resolved'
  | 'dismissed'
  | 'triaged'
  | 'reproducing'
  | 'fixing'
  | 'validated'
  | 'closed'

export type BountySeverity = 'critical' | 'high' | 'medium' | 'low'

export type BountySourceKind =
  | 'terminal'
  | 'console'
  | 'network'
  | 'inspect'
  | 'manual'

export interface BugBountyItem {
  id: string
  title: string
  summary: string
  severity: BountySeverity
  /** Upstream issue id from inspectStore, if that was the source. */
  sourceIssueId?: string
  /** Where this bounty originated (terminal log, browser console, network, etc.). */
  sourceKind?: BountySourceKind
  /** Origin tile id (terminal tile, inspect tile, …) — used for context + dedupe scope. */
  sourceTileId?: string
  /** Normalized line/error signature used for dedupe within a short window. */
  sourceSignature?: string
  /** Verbatim snippet from the origin (one or two lines) for humans + prompt context. */
  samplePayload?: string
  /** How many times the same signature has fired while the bounty was open. */
  occurrenceCount: number
  /**
   * When true, auto hunter dispatch is disabled (e.g. repeated hunter startup failures).
   */
  hunterDispatchBlocked?: boolean
  firstSeenAt: number
  lastSeenAt: number
  status: BountyStatus
  assignedAgentProfile?: string
  /** The sub-agent tile a bounty hunter is running in (when investigating). */
  delegatedSubAgentTileId?: string
  /** Short bullet summary produced by the hunter when it finishes. */
  resolutionNote?: string
  createdAt: number
  updatedAt: number
}

export type BountyPatch = Partial<
  Pick<
    BugBountyItem,
    | 'status'
    | 'assignedAgentProfile'
    | 'title'
    | 'summary'
    | 'delegatedSubAgentTileId'
    | 'resolutionNote'
    | 'severity'
    | 'hunterDispatchBlocked'
  >
>

const hunterStartupStrikesByBountyId = new Map<string, number>()

interface AddOrMergeInput {
  title: string
  summary: string
  severity: BountySeverity
  sourceIssueId?: string
  sourceKind?: BountySourceKind
  sourceTileId?: string
  sourceSignature?: string
  samplePayload?: string
  status?: BountyStatus
  assignedAgentProfile?: string
}

interface BugBountyState {
  items: BugBountyItem[]
  addBounty: (p: AddOrMergeInput) => string
  patchBounty: (id: string, patch: BountyPatch) => void
  removeBounty: (id: string) => void
  dismissBounty: (id: string) => void
  /** Highest-severity queued bounty that does not yet have a hunter. */
  pickNextQueued: () => BugBountyItem | undefined
  countInvestigating: () => number
  countOpen: () => number
  clearAll: () => void
  /** After repeated hunter sub-agent startup timeouts, stop auto-dispatch for this bounty. */
  recordHunterStartupFailure: (bountyId: string) => void
}

function now() {
  return Date.now()
}

const SEVERITY_RANK: Record<BountySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function findDedupe(
  items: BugBountyItem[],
  input: AddOrMergeInput
): BugBountyItem | undefined {
  if (input.sourceIssueId) {
    const bySrc = items.find((x) => x.sourceIssueId === input.sourceIssueId)
    if (bySrc) return bySrc
  }
  if (input.sourceSignature) {
    const bySig = items.find(
      (x) =>
        x.sourceSignature === input.sourceSignature &&
        (x.sourceTileId ?? '') === (input.sourceTileId ?? '') &&
        x.status !== 'resolved' &&
        x.status !== 'dismissed' &&
        x.status !== 'closed'
    )
    if (bySig) return bySig
  }
  return undefined
}

function escalateSeverity(a: BountySeverity, b: BountySeverity): BountySeverity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b
}

export const useBugBountyStore = create<BugBountyState>((set, get) => ({
  items: [],

  addBounty: (p) => {
    const existing = findDedupe(get().items, p)
    if (existing) {
      set((s) => ({
        items: s.items.map((b) =>
          b.id === existing.id
            ? {
                ...b,
                occurrenceCount: b.occurrenceCount + 1,
                lastSeenAt: now(),
                severity: escalateSeverity(b.severity, p.severity),
                samplePayload: p.samplePayload ?? b.samplePayload,
                updatedAt: now(),
              }
            : b
        ),
      }))
      // Pool manager may want to re-prioritise on burst; let it know.
      void maybeNotifyHunterPool()
      return existing.id
    }

    const id = nanoid()
    const t = now()
    const row: BugBountyItem = {
      id,
      title: p.title,
      summary: p.summary,
      severity: p.severity,
      sourceIssueId: p.sourceIssueId,
      sourceKind: p.sourceKind,
      sourceTileId: p.sourceTileId,
      sourceSignature: p.sourceSignature,
      samplePayload: p.samplePayload,
      status: p.status ?? 'queued',
      assignedAgentProfile: p.assignedAgentProfile,
      occurrenceCount: 1,
      firstSeenAt: t,
      lastSeenAt: t,
      createdAt: t,
      updatedAt: t,
    }
    set((s) => ({ items: [...s.items, row] }))
    void maybeNotifyHunterPool()
    return id
  },

  patchBounty: (id, patch) => {
    set((s) => ({
      items: s.items.map((b) =>
        b.id === id ? { ...b, ...patch, updatedAt: now() } : b
      ),
    }))
    void maybeNotifyHunterPool()
  },

  removeBounty: (id) => {
    set((s) => ({ items: s.items.filter((b) => b.id !== id) }))
  },

  dismissBounty: (id) => {
    set((s) => ({
      items: s.items.map((b) =>
        b.id === id ? { ...b, status: 'dismissed', updatedAt: now() } : b
      ),
    }))
  },

  pickNextQueued: () => {
    const items = get().items
    const queued = items.filter(
      (b) =>
        (b.status === 'queued' || b.status === 'triaged') &&
        !b.delegatedSubAgentTileId &&
        !b.hunterDispatchBlocked
    )
    if (queued.length === 0) return undefined
    queued.sort((a, b) => {
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      if (sev !== 0) return sev
      return a.createdAt - b.createdAt
    })
    return queued[0]
  },

  countInvestigating: () =>
    get().items.filter(
      (b) =>
        b.status === 'investigating' ||
        b.status === 'reproducing' ||
        b.status === 'fixing'
    ).length,

  countOpen: () =>
    get().items.filter(
      (b) => b.status !== 'resolved' && b.status !== 'dismissed' && b.status !== 'closed'
    ).length,

  clearAll: () => set({ items: [] }),

  recordHunterStartupFailure: (bountyId) => {
    const item = get().items.find((b) => b.id === bountyId)
    if (!item) return
    const n = (hunterStartupStrikesByBountyId.get(bountyId) ?? 0) + 1
    hunterStartupStrikesByBountyId.set(bountyId, n)
    if (n < 2) return
    set((s) => ({
      items: s.items.map((b) =>
        b.id === bountyId
          ? {
              ...b,
              hunterDispatchBlocked: true,
              delegatedSubAgentTileId: undefined,
              status: 'queued',
              resolutionNote:
                'blocker: bounty hunter failed to start twice (no run activity). Check API keys, model limits, or stale workers; triage manually.',
              updatedAt: now(),
            }
          : b
      ),
    }))
    void maybeNotifyHunterPool()
  },
}))

/**
 * Lazy-imported so tests / Node-runs without window don't pull React/Canvas deps.
 * Swallows errors to never break the store critical path.
 */
async function maybeNotifyHunterPool(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const { scheduleBountyHunterPoolTick } = await import(
      '../lib/orchestrator/bountyHunterPool'
    )
    scheduleBountyHunterPoolTick()
  } catch {
    // Best-effort: if the pool isn't available (SSR / tests), bounties still queue.
  }
}

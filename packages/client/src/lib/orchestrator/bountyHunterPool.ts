/**
 * Bug Bounty Hunter pool.
 *
 * Keeps up to `orcaBugBountyMaxHunters` (default 3) troubleshooter sub-agents
 * ("bounty hunters") working on the highest-severity queued bounties. When a
 * hunter finishes it checks the bounty board: if more bounties are queued a new
 * hunter is spawned; otherwise the pool goes quiet and the agent's tile is
 * closed after a short grace window.
 *
 * Hunters are plain delegated sub-agents (same loop as `spawn_sub_agent`) with
 * a bespoke "40-year senior engineer, 300 IQ troubleshooting methodology"
 * system prompt. Multi-role teams (pentester / coder / …) can be layered on
 * later by expanding `HUNTER_ROLES`.
 */

import { nanoid } from 'nanoid'
import type { BugBountyItem } from '../../store/bugBountyStore'
import { useBugBountyStore } from '../../store/bugBountyStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useCanvasStore } from '../../store/canvasStore'
import { startSubAgentRun } from './subAgentRunner'
import { ensureAgentTeamTile } from './ensureAgentTeamTile'
import { buildBountyDelegationTask } from './bountySubAgentDelegation'
import { ensureBugBountyTile } from './ensureBugBountyTile'

const ROLE_TROUBLESHOOTER = 'Bounty · Troubleshooter'
const DEFAULT_MAX_HUNTERS = 3

/** Delay before closing a finished hunter's tile so humans can read the final summary. */
const IDLE_CLOSE_GRACE_MS = 20_000

/** Debounce consecutive pool ticks (burst insert safety). */
const TICK_DEBOUNCE_MS = 120

let tickTimer: ReturnType<typeof setTimeout> | null = null
let poolSubscribed = false
const idleCloseTimers = new Map<string, ReturnType<typeof setTimeout>>()

function getMaxHunters(): number {
  try {
    const n = Number(useSettingsStore.getState().orcaBugBountyMaxHunters)
    if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_HUNTERS
    return Math.min(8, Math.floor(n))
  } catch {
    return DEFAULT_MAX_HUNTERS
  }
}

function isHunterMember(role: string | undefined): boolean {
  return Boolean(role && role.includes('Bounty'))
}

function listActiveHunterTileIds(): string[] {
  const members = useAgentTeamStore.getState().membersByTileId
  return Object.values(members)
    .filter((m) => isHunterMember(m.role) && m.status === 'working')
    .map((m) => m.tileId)
}

function countActiveHunters(): number {
  return listActiveHunterTileIds().length
}

/**
 * Public entry point — debounced tick that drives the pool. Call this whenever:
 * - a bounty is added / patched / dismissed
 * - a hunter's status changes
 * - settings change (max-hunters, toggles)
 */
export function scheduleBountyHunterPoolTick(): void {
  if (typeof window === 'undefined') return
  ensurePoolSubscriptions()
  if (tickTimer) return
  tickTimer = setTimeout(() => {
    tickTimer = null
    try {
      runPoolTick()
    } catch {
      // Never let pool scheduling throw into Zustand setters.
    }
  }, TICK_DEBOUNCE_MS)
}

/** Direct (non-debounced) tick — used from tests / after explicit completion. */
export function runPoolTickNow(): void {
  if (typeof window === 'undefined') return
  if (tickTimer) {
    clearTimeout(tickTimer)
    tickTimer = null
  }
  runPoolTick()
}

function runPoolTick(): void {
  const s = useSettingsStore.getState()
  if (!s.orcaBugBountyLaneEnabled) return
  if (!s.orcaBugBountyAutoDelegateSubagents) return

  const max = getMaxHunters()
  let openSlots = max - countActiveHunters()
  if (openSlots <= 0) return

  // Pull queued bounties one at a time — dispatchHunter mutates store, so we
  // re-query each iteration to respect any concurrent changes.
  while (openSlots > 0) {
    const next = useBugBountyStore.getState().pickNextQueued()
    if (!next) break
    const dispatched = dispatchHunter(next)
    if (!dispatched) break
    openSlots--
  }
}

/**
 * Spawn a troubleshooter sub-agent for `item`. Returns `false` if dispatch was
 * skipped (e.g. item already had an assigned hunter by the time we got here).
 */
function dispatchHunter(item: BugBountyItem): boolean {
  if (item.delegatedSubAgentTileId) return false

  const displayBase = item.title.trim() || 'Bounty item'
  const displayName =
    displayBase.length > 46 ? `Bounty: ${displayBase.slice(0, 43)}…` : `Bounty: ${displayBase}`

  const task = buildBountyDelegationTask(item)


  const hunterModelIdRaw = (() => {
    try {
      return useSettingsStore.getState().orcaBugBountyHunterModelId ?? null
    } catch {
      return null
    }
  })()
  const hunterModelId = hunterModelIdRaw?.trim() || null

  ensureBugBountyTile()

  // Bounty hunters are tracked in the Agent Team tile only.
  // We intentionally do not create per-hunter canvas tiles (visible or hidden)
  // to keep scatter/layout free of worker tile artifacts.
  const tileId = `bounty-hunter-${nanoid(10)}`

  useAgentTeamStore.getState().registerMember({
    tileId,
    displayName,
    role: ROLE_TROUBLESHOOTER,
    currentTask: 'Triaging bounty…',
    status: 'working',
    delegatedTask: task,
  })
  ensureAgentTeamTile()

  useBugBountyStore.getState().patchBounty(item.id, {
    delegatedSubAgentTileId: tileId,
    assignedAgentProfile: ROLE_TROUBLESHOOTER,
    status: 'investigating',
  })

  startSubAgentRun({
    tileId,
    displayName,
    role: ROLE_TROUBLESHOOTER,
    task,
    taskComplexity: 'complex',
    modelIdOverride: hunterModelId,
    runtimeMeta: {
      bountyHunterPool: true,
      bountyItemId: item.id,
    },
  })

  return true
}

/**
 * Subscribe once to agent-team and settings changes so hunter completion fires
 * a pool tick (possibly picking up the next bounty or closing the tile).
 */
function ensurePoolSubscriptions(): void {
  if (poolSubscribed) return
  poolSubscribed = true

  let lastStatuses: Record<string, string> = captureHunterStatuses()

  useAgentTeamStore.subscribe((state) => {
    const current: Record<string, string> = {}
    for (const m of Object.values(state.membersByTileId)) {
      if (isHunterMember(m.role)) current[m.tileId] = m.status
    }
    let changed = false
    for (const [tileId, status] of Object.entries(current)) {
      if (lastStatuses[tileId] !== status) {
        changed = true
        onHunterStatusChange(tileId, lastStatuses[tileId], status)
      }
    }
    for (const tileId of Object.keys(lastStatuses)) {
      if (!(tileId in current)) {
        changed = true
        cancelIdleClose(tileId)
      }
    }
    lastStatuses = current
    if (changed) scheduleBountyHunterPoolTick()
  })

  useSettingsStore.subscribe(() => {
    scheduleBountyHunterPoolTick()
  })
}

function captureHunterStatuses(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of Object.values(useAgentTeamStore.getState().membersByTileId)) {
    if (isHunterMember(m.role)) out[m.tileId] = m.status
  }
  return out
}

function onHunterStatusChange(
  tileId: string,
  prev: string | undefined,
  next: string
): void {
  if (next === 'done' || next === 'error' || next === 'idle') {
    const bountyId = findBountyItemIdForTile(tileId)
    if (bountyId) {
      const patchStatus = next === 'error' ? 'queued' : 'resolved'
      const patch =
        next === 'error'
          ? { status: 'queued' as const, delegatedSubAgentTileId: undefined }
          : { status: patchStatus as 'resolved' }
      useBugBountyStore.getState().patchBounty(bountyId, patch)
    }
    scheduleIdleClose(tileId)
  } else if (next === 'working' && prev !== 'working') {
    cancelIdleClose(tileId)
  }
}

function findBountyItemIdForTile(tileId: string): string | undefined {
  const items = useBugBountyStore.getState().items
  return items.find((b) => b.delegatedSubAgentTileId === tileId)?.id
}

function scheduleIdleClose(tileId: string): void {
  cancelIdleClose(tileId)
  const t = setTimeout(() => {
    idleCloseTimers.delete(tileId)
    try {
      // If nothing queued, close the hunter's tile; if bounties queued and
      // we're under the cap, dispatch a new hunter before closing.
      const maxH = getMaxHunters()
      const openSlots = maxH - countActiveHunters()
      if (openSlots > 0) {
        const next = useBugBountyStore.getState().pickNextQueued()
        if (next) dispatchHunter(next)
      }
      useCanvasStore.getState().removeTile(tileId)
      useAgentTeamStore.getState().removeMemberForTile(tileId)
    } catch {
      // best-effort cleanup
    }
  }, IDLE_CLOSE_GRACE_MS)
  idleCloseTimers.set(tileId, t)
}

function cancelIdleClose(tileId: string): void {
  const t = idleCloseTimers.get(tileId)
  if (t) {
    clearTimeout(t)
    idleCloseTimers.delete(tileId)
  }
}

/** Test hook — reset module state. */
export function __resetBountyHunterPoolForTests(): void {
  if (tickTimer) clearTimeout(tickTimer)
  tickTimer = null
  for (const t of idleCloseTimers.values()) clearTimeout(t)
  idleCloseTimers.clear()
  poolSubscribed = false
}

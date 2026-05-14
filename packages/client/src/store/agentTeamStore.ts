import { create } from 'zustand'
import type { Provider } from './settingsStore'
import { classifyAgentLogLine } from '../lib/agentIssueDetector'
import { useAgentTaskStore } from './agentTaskStore'

export type AgentTeamMemberStatus = 'idle' | 'working' | 'done' | 'error' | 'needs_review'

export interface AgentTeamMember {
  tileId: string
  displayName: string
  /** Role / job title (e.g. "Frontend", "Tests"). */
  role: string
  /** Original delegated task text when the worker came from `spawn_sub_agent`. */
  delegatedTask?: string
  /** Latest status line (tool phase, verb, etc.). */
  currentTask: string
  status: AgentTeamMemberStatus
  /** Epoch ms when the member was created or most recently patched. */
  statusUpdatedAt: number
  /** Ring buffer of log lines for the agent tile + team tracker. */
  logTail: string[]
  lastSummary?: string
  error?: string
  /** Resolved model for delegated sub-agents (not global Settings). */
  executionModelLabel?: string
  executionProvider?: Provider
  executionModelIsFree?: boolean
  executionModelSupportsImages?: boolean
  /**
   * When this agent was spawned by another sub-agent (nested delegation) the
   * parent worker's tile id. `null`/undefined means spawned directly by the
   * lead orchestrator. Used for branch lines + chain highlights in
   * OrchestratorHubLinks.
   */
  parentTileId?: string
  /**
   * Highest group-chat `seq` that has been delivered to this member's inbox
   * injector. `undefined` means "nothing delivered yet" → next injection
   * starts from seq 0. Used by `subAgentRunner` + `runOrchestrator` to avoid
   * re-injecting the same message on consecutive LLM rounds.
   */
  lastDeliveredSeq?: number
}

const MAX_LOG = 120

interface AgentTeamState {
  membersByTileId: Record<string, AgentTeamMember>
  /** In-flight runs: delegated sub-agents, local agent tiles, Hermes streams (tile-scoped). */
  abortByTileId: Record<string, AbortController>
  registerMember: (m: {
    tileId: string
    displayName: string
    role: string
    delegatedTask?: string
    currentTask?: string
    status?: AgentTeamMemberStatus
    parentTileId?: string
    /**
     * Skip existing backlog: set the inbox cursor so the next round won't
     * deliver messages with `seq <= lastDeliveredSeq`. Typically the current
     * per-session seq at spawn time.
     */
    lastDeliveredSeq?: number
  }) => void
  patchMember: (tileId: string, patch: Partial<AgentTeamMember>) => void
  appendAgentLog: (tileId: string, line: string) => void
  setAbortController: (tileId: string, c: AbortController | null) => void
  abortSubAgent: (tileId: string) => void
  /** Abort every in-flight run that registered an AbortController (agents + Hermes). */
  abortAllRegisteredRuns: () => void
  removeMemberForTile: (tileId: string) => void
  /** Count of delegated sub-agents currently running (`spawn_sub_agent`). */
  countWorkingSubAgents: () => number
  clear: () => void
  /**
   * Replace a member from a persisted canvas snapshot (restores log tail + model labels).
   * Used after reload — not for normal spawn (use registerMember).
   */
  replaceMemberSnapshot: (m: AgentTeamMember) => void
}

export const useAgentTeamStore = create<AgentTeamState>((set, get) => ({
  membersByTileId: {},
  abortByTileId: {},

  registerMember: (m) => {
    const now = Date.now()
    const next: AgentTeamMember = {
      tileId: m.tileId,
      displayName: m.displayName,
      role: m.role,
      delegatedTask: m.delegatedTask,
      currentTask: m.currentTask ?? 'Queued…',
      status: m.status ?? 'working',
      statusUpdatedAt: now,
      logTail: [],
      parentTileId: m.parentTileId,
      lastDeliveredSeq: m.lastDeliveredSeq,
    }
    set({
      membersByTileId: { ...get().membersByTileId, [m.tileId]: next },
    })
  },

  patchMember: (tileId, patch) => {
    const cur = get().membersByTileId[tileId]
    if (!cur) return
    set({
      membersByTileId: {
        ...get().membersByTileId,
        [tileId]: { ...cur, ...patch, statusUpdatedAt: patch.statusUpdatedAt ?? Date.now() },
      },
    })
  },

  appendAgentLog: (tileId, line) => {
    const cur = get().membersByTileId[tileId]
    if (!cur) return
    const logTail = [...cur.logTail, line].slice(-MAX_LOG)
    set({
      membersByTileId: {
        ...get().membersByTileId,
        [tileId]: { ...cur, logTail },
      },
    })
    // Classify each incoming log line so the Tasks collapsible surfaces live
    // error/warning/fail counts without us having to instrument every call site.
    try {
      for (const ln of String(line).split(/\r?\n/)) {
        const kind = classifyAgentLogLine(ln)
        if (kind) useAgentTaskStore.getState().noteIssue(tileId, kind)
      }
    } catch {
      // Issue detection is best-effort; never let it break the log path.
    }
  },

  setAbortController: (tileId, c) => {
    const copy = { ...get().abortByTileId }
    if (c == null) delete copy[tileId]
    else copy[tileId] = c
    set({ abortByTileId: copy })
  },

  abortSubAgent: (tileId) => {
    get().abortByTileId[tileId]?.abort()
    get().setAbortController(tileId, null)
  },

  abortAllRegisteredRuns: () => {
    const ids = Object.keys(get().abortByTileId)
    for (const id of ids) {
      get().abortSubAgent(id)
    }
  },

  removeMemberForTile: (tileId) => {
    get().abortByTileId[tileId]?.abort()
    const membersByTileId = { ...get().membersByTileId }
    const abortByTileId = { ...get().abortByTileId }
    if (!membersByTileId[tileId]) return
    delete membersByTileId[tileId]
    delete abortByTileId[tileId]
    set({ membersByTileId, abortByTileId })
  },

  countWorkingSubAgents: () =>
    Object.values(get().membersByTileId).filter((m) => m.status === 'working').length,

  clear: () => set({ membersByTileId: {}, abortByTileId: {} }),

  replaceMemberSnapshot: (m) => {
    set({
      membersByTileId: {
        ...get().membersByTileId,
        [m.tileId]: {
          ...m,
          logTail: Array.isArray(m.logTail) ? m.logTail : [],
          statusUpdatedAt: m.statusUpdatedAt ?? Date.now(),
        },
      },
    })
  },
}))

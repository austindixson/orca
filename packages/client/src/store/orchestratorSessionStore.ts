import { create } from 'zustand'
import {
  resolveLeadDelegationForRun,
  runOrchestratorLeadAware,
  type OrchestratorActivityPayload,
} from '../lib/orchestrator/runOrchestrator'
import { useReasoningTraceStore } from './reasoningTraceStore'
import { patchHarnessFileState } from '../lib/orchestrator/orchestratorFileState'
import {
  providerSupportsOrchestratorTools,
  type ChatMessage,
  type UserMessageContent,
} from '../lib/orchestrator/types'
import { ensureOrchestratorWidgetTile } from '../lib/orchestrator/ensureOrchestratorWidgetTile'
import { revealOrchestratorTile } from '../lib/orchestrator/revealOrchestratorTile'
import { ensureOpenRouterUsageTile } from '../lib/orchestrator/ensureOpenRouterUsageTile'
import { ensureTelegramGatewayTiles } from '../lib/orchestrator/ensureTelegramGatewayTiles'
import { heuristicTelegramGatewayTilesIntent } from '../lib/orchestrator/heuristicTelegramGatewayTilesIntent'
import { resolveApiKey } from '../lib/llmCredentials'
import {
  HERMES_PROVIDER_MODEL_ID,
  PROVIDER_INFO,
  providerAllowsEmptyApiKey,
  ZAI_DEFAULT_MODEL_ID,
  useSettingsStore,
} from './settingsStore'
import { useToastStore } from './toastStore'
import { useOrchestratorActivityStore } from './orchestratorActivityStore'
import {
  glitterVerbForPrepare,
  glitterVerbForLlm,
  glitterVerbForLlmPending,
  glitterVerbForTools,
  glitterVerbForToolsPending,
  glitterVerbForRunStart,
  resetGlitterVerbSession,
} from '../lib/orchestrator/orchestratorShimmerVerbs'
import { useTodoStore } from './todoStore'
import { shouldSuppressOrchestratorTodoRow } from '../lib/orchestrator/todoTaskQuality'
import { useWorkspaceStore } from './workspaceStore'
import { emitRefreshChangelog } from '../lib/uiEvents'
import { useCanvasStore } from './canvasStore'
import type { InputAttachment } from '../lib/inputAttachments'
import { toUserContentWithAttachments } from '../lib/inputAttachments'
import { preprocessImagesWithZai } from '../lib/zaiVisionPreprocess'
import { loadInstalledSkillsCatalogForOrchestrator, resolveSkillCommandPrompt } from '../lib/skillCommands'
import { heuristicResearchIntent } from '../lib/orchestrator/researchIntent'
import { loadProjectInstructionsForPrompt } from '../lib/orchestrator/orchestratorClaudeMd'
import {
  MAX_PLANNING_USER_CHARS,
  MAX_SINGLE_USER_CHARS,
  truncateString,
  trimMessagesForOrchestrator,
} from '../lib/orchestrator/orchestratorContextBudget'
import { applyDelegationResumeGroundingIfNeeded } from '../lib/orchestrator/delegationResumeGrounding'
import { clampShortTermMemoryChars } from '../lib/orchestrator/orcaMemory'
import {
  classifyOrchestratorPrompt,
  shouldArticulateOrchestratorPrompt,
} from '../lib/orchestrator/orchestratorPromptTriage'
import {
  runOrchestratorArticulationPhase,
} from '../lib/orchestrator/orchestratorArticulationPhase'
import {
  formatDecompositionBlock,
  runOrchestratorDecompositionPhase,
} from '../lib/orchestrator/orchestratorDecompositionPhase'
import { loadDivideAndConquerSkillForDecomposition } from '../lib/orchestrator/ensureDivideAndConquerSkill'
import {
  formatHierarchyBlock,
  runOrchestratorHierarchyPhase,
  shouldUseHierarchicalPlanning,
} from '../lib/orchestrator/orchestratorHierarchyPhase'
import {
  buildExecutionContractFromDecomposition,
  buildExecutionContractFromHierarchy,
  type ExecutionContract,
} from '../lib/orchestrator/orchestratorExecutionContract'
import {
  ORCHESTRATOR_DEFAULT_MAX_ITERATIONS,
  ORCHESTRATOR_HARD_MAX_ITERATIONS,
  ORCHESTRATOR_SIMPLE_MAX_ITERATIONS,
  ORCHESTRATOR_TRIVIAL_MAX_ITERATIONS,
} from '../lib/orchestrator/orchestratorConstants'
import { persistOrchestratorPlanMarkdown } from '../lib/orchestrator/orchestratorPersistPlan'
import { nanoid } from 'nanoid'
import {
  flushTelemetryIngestNow,
  ingestOrchestratorActivityLine,
  ingestOrchestratorStructuredEvent,
  setTelemetryRunId,
  setTelemetryRunSession,
} from '../lib/devTelemetryIngest'
import {
  appendSubAgentTrace,
  appendTimelineEvent,
  archiveConversationAndReplace,
  getDefaultSessionId,
  loadConversationFromDisk,
  messageContentText,
  resetPersistedMessageCursor,
  syncConversationToDisk,
  writeSessionMeta,
} from '../lib/persistence/sessionPersistence'
import { flushOrchestratorVaultChatMirror } from '../lib/vault/vaultChatTranscript'
import { compactSession } from '../lib/persistence/sessionCompaction'
import { useAgentTeamStore } from './agentTeamStore'
import { useOneShotStore } from './oneShotStore'
import {
  buildInterruptionCheckpoint,
  buildInterruptionResumeDirectivePrefix,
  summarizeInterruptedTaskFromSession,
  type InterruptionCheckpoint,
} from '../lib/orchestrator/interruptionResume'
import {
  formatWorkspaceTraceLine,
  summarizeHermesProviderNoticeLine,
} from '../lib/orchestrator/hermesTracePresentation'
import { setWorkspace as tauriSetWorkspace } from '../lib/tauri'
import { pickPreferredVisionModel } from '../lib/modelRouting'

const orchestratorSessionRuntime = {
  runOrchestratorLeadAware,
}

export function __setOrchestratorSessionRuntimeForTests(
  overrides: Partial<typeof orchestratorSessionRuntime>
): void {
  Object.assign(orchestratorSessionRuntime, overrides)
}

export function __resetOrchestratorSessionRuntimeForTests(): void {
  orchestratorSessionRuntime.runOrchestratorLeadAware = runOrchestratorLeadAware
}

export interface QueuedRun {
  /** Stable id for queue UI (edit, reorder, delete). */
  id: string
  text: string
  attachments: InputAttachment[]
  source?: 'user' | 'sub_agent_handoff' | 'heartbeat'
  /** Mid-run model switch: keep the same Orchestrator todo row instead of creating a duplicate. */
  reuseOrchestratorTodoTaskId?: string
  /** Points at interruptionCheckpoint when this queued item was created by an in-run user interruption. */
  interruptionCheckpointId?: string
}

export type SubAgentHandoffOutcome = 'done' | 'error' | 'cancelled'

/** Last completed `run()` outcome for bridges (e.g. Telegram) — not persisted. */
export type RunOutcome =
  | { kind: 'ok'; assistantText: string; turnIndex: number }
  | { kind: 'skipped'; reason: string }
  | { kind: 'queued' }
  | { kind: 'busy_rejected' }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string }

/** Live planning UI: streaming phase hides raw tokens in the panel; formatted markdown after parse. */
export type OrchestratorPlanningDraft = {
  phase: 'streaming' | 'formatted'
  title: string
  body: string
}

interface OrchestratorSessionState {
  input: string
  inputAttachments: InputAttachment[]
  running: boolean
  /** When true, Send runs the 1-shot multi-phase pipeline instead of normal chat. Not persisted. */
  oneShotMode: boolean
  queuedInputs: QueuedRun[]
  sessionMessages: ChatMessage[]
  /** Sub-agent completions while the main orchestrator run is active; merged into session when the run ends. */
  pendingSubAgentHandoffs: string[]
  /** Main orchestrator is idle locally but waiting to resume once delegated workers report back. */
  waitingForSubAgents: boolean
  /** Latest interruption checkpoint captured when a user message arrives during an in-flight run. */
  interruptionCheckpoint: InterruptionCheckpoint | null
  abortController: AbortController | null
  runGeneration: number
  /** Trace file stem for the last started main orchestrator run (`orch-<n>` → `.agent-canvas/harness/traces/orch-<n>.jsonl`). */
  lastHarnessTraceSessionKey: string | null
  stopLogged: boolean
  /** Phased / decomposition plan preview (streaming or finalized markdown). */
  planningDraft: OrchestratorPlanningDraft | null
  /** Set when a `run()` finishes (success, skip, error, or abort). Used by Telegram gateway. */
  lastRunOutcome: RunOutcome | null
  /**
   * Settings `selectedModel` id locked for the current in-flight `run()` (including internal
   * vision fallbacks). When the user picks a different model in the footer, we detect divergence
   * and abort + restart that turn.
   */
  runLockedSelectedModelId: string | null
  setInput: (input: string) => void
  setInputAttachments: (attachments: InputAttachment[]) => void
  appendInputAttachments: (attachments: InputAttachment[]) => void
  removeInputAttachment: (attachmentId: string) => void
  setOneShotMode: (oneShotMode: boolean) => void
  run: (queuedRun?: QueuedRun, options?: { oneShotFromQuickInput?: boolean }) => Promise<void>
  clearQueue: () => void
  removeQueuedInput: (id: string) => void
  updateQueuedInputText: (id: string, text: string) => void
  /**
   * If idle: dequeue and run immediately. If a run is active: move this item to the head of the queue
   * (next after current) — same as Cursor-style "send now" priority.
   */
  runQueuedInputNow: (id: string) => void
  stop: () => void
  /** Log + queue or append sub-agent result so the orchestrator conversation stays informed (Hermes-style handoff). */
  recordSubAgentHandoff: (p: {
    displayName: string
    role: string
    tileId: string
    outcome: SubAgentHandoffOutcome
    summary?: string
    error?: string
  }) => void
  /** Load persisted conversation from ~/.orca (or browser fallback). */
  loadSession: (sessionId: string) => Promise<void>
  /** Flush conversation to disk immediately. */
  saveCheckpoint: () => Promise<void>
  /**
   * Trim `sessionMessages` to an optional synthetic prefix + the most recent
   * `keepLastN` messages, and rewrite `conversation.jsonl` to match (old rows
   * are archived). Called by {@link compactSession} after it writes
   * `summary.md`, so the next session open stays fast and the LLM keeps the
   * digest as short-term context instead of replaying thousands of turns.
   */
  applyCompactionRotation: (prefixMessage: ChatMessage | null, keepLastN: number) => Promise<void>
}

/** Exported for 1-shot pipeline (same HUD + activity verbs as main orchestrator). */
export function applyOrchestratorActivityFromPayload(p: OrchestratorActivityPayload) {
  const act = useOrchestratorActivityStore.getState()
  if (p.kind === 'prepare') {
    resetGlitterVerbSession()
    act.setVerb(glitterVerbForPrepare())
    return
  }
  if (p.kind === 'llm_pending') {
    act.setVerb(glitterVerbForLlmPending(p.elapsedMs, p.iteration))
    return
  }
  if (p.kind === 'tools_pending') {
    act.setIteration(p.iteration)
    act.setVerb(
      glitterVerbForToolsPending(
        p.toolNames,
        p.elapsedMs,
        p.completed,
        p.total,
        p.currentTool
      )
    )
    return
  }
  act.setIteration(p.iteration)
  if (p.kind === 'llm') {
    act.setVerb(glitterVerbForLlm(p.iteration))
  } else {
    act.setVerb(glitterVerbForTools(p.toolNames))
    act.appendToolFeedLine(`◆ model → ${p.toolNames.join(', ')}`)
  }
}

/**
 * Historical prefix. The user-facing label is now configurable via
 * `settingsStore.orchestratorDisplayName`, but we keep this as the stored
 * prefix so transcripts written before/after a name change stay parseable.
 */
const ASSISTANT_ACTIVITY_PREFIX = 'Assistant · '

/** Prevent duplicate "Resumed" transcript re-seeding for the same session in one app lifetime. */
let lastHydratedSessionId: string | null = null

/**
 * Canvas state can restore `tileStatus: working | waiting` while the session store is idle
 * (reload, Stop-all races, missed finally). Clear only those badges — keep `error` so the last
 * failure remains visible until the next run starts.
 */
function markOrchestratorWidgetTileIdleIfStuck(): void {
  try {
    const id = ensureOrchestratorWidgetTile()
    const st = useCanvasStore.getState().tiles.get(id)?.tileStatus
    if (st === 'working' || st === 'waiting') {
      useCanvasStore.getState().updateTile(id, { tileStatus: 'idle' })
    }
  } catch {
    /* ignore */
  }
}

/** Read the user-configured orchestrator name; fallback to "Assistant". */
function resolveOrchestratorDisplayName(): string {
  const raw = useSettingsStore.getState().orchestratorDisplayName
  const name = (raw ?? '').trim()
  return name.length > 0 ? name : 'Assistant'
}

/** Stored activity prefix. Always uses the canonical "Assistant · " for parsing. */
export function assistantActivityStoredPrefix(): string {
  return ASSISTANT_ACTIVITY_PREFIX
}

/** Display prefix for the current orchestrator name ("Mei · ", "Sora · ", …). */
export function assistantActivityDisplayPrefix(): string {
  const name = resolveOrchestratorDisplayName()
  return `${name} · `
}

function normalizeAssistantActivityProse(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith(ASSISTANT_ACTIVITY_PREFIX)) {
    return trimmed.slice(ASSISTANT_ACTIVITY_PREFIX.length).trim()
  }
  return trimmed
}

const CONTINUE_LOG_CONTEXT_CHARS = 1000

function maybeExpandContinuePromptFromRecentLogs(input: string): string {
  const trimmed = input.trim()
  if (trimmed.toLowerCase() !== 'continue') return input
  const recentLogs = useOrchestratorActivityStore
    .getState()
    .activityFeed
    .join('\n')
    .slice(-CONTINUE_LOG_CONTEXT_CHARS)
    .trim()
  if (!recentLogs) {
    return 'Continue from the latest orchestrator context and decide the next best actions.'
  }
  return [
    'Continue from the latest orchestrator context.',
    'Use the recent orchestrator logs below to decide exactly what to do next.',
    '',
    `Recent orchestrator logs (last ${CONTINUE_LOG_CONTEXT_CHARS} chars):`,
    recentLogs,
  ].join('\n')
}

/**
 * Logs assistant prose to the activity feed with a stable prefix so it is never
 * mistaken for a trace line (e.g. markdown blockquotes starting with `>`).
 */
export function appendAssistantActivityLine(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  const prose = normalizeAssistantActivityProse(text)
  const feed = useOrchestratorActivityStore.getState().activityFeed
  const last = feed[feed.length - 1]
  if (last && normalizeAssistantActivityProse(last) === prose) {
    return
  }
  const line = trimmed.startsWith(ASSISTANT_ACTIVITY_PREFIX) ? text : `${ASSISTANT_ACTIVITY_PREFIX}${text}`
  appendOrchestratorSessionLogLine(line)
}

/**
 * Rewrites the last user `ChatMessage` that still contains the synthetic
 * planning/decomposition body (`orchestratorUserBody`) so only the clean
 * original user text is persisted and replayed on reload.
 *
 * The orchestrator needs the bloated prompt to guide its first turn, but
 * storing it as the user message makes the chat show the system prompt
 * verbatim as "You · ### Orchestrator decomposition…" on reload — which the
 * user never typed. We strip it after the LLM call while keeping attachments.
 */
function sanitizePersistedOrchestratorUserMessage(
  messages: ChatMessage[],
  bloatedPrompt: string,
  cleanPrompt: string
): ChatMessage[] {
  if (bloatedPrompt === cleanPrompt) return messages
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const content = m.content
    if (typeof content === 'string') {
      if (content === bloatedPrompt || content.includes('**Original user message:**')) {
        messages[i] = { ...m, content: cleanPrompt }
      }
      break
    }
    if (Array.isArray(content)) {
      let mutated = false
      const nextParts = content.map((part) => {
        if (
          part &&
          typeof part === 'object' &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          const txt = (part as { text: string }).text
          if (txt === bloatedPrompt || txt.includes('**Original user message:**')) {
            mutated = true
            return { ...(part as object), text: cleanPrompt }
          }
        }
        return part
      })
      if (mutated) {
        messages[i] = { ...m, content: nextParts as UserMessageContent }
      }
      break
    }
  }
  return messages
}

/** Exported for 1-shot pipeline — same side effects as orchestrator log lines (activity feed, todo hooks, telemetry). */
export function appendOrchestratorSessionLogLine(line: string) {
  useOrchestratorActivityStore.getState().appendActivityLine(line)
  useOrchestratorActivityStore.getState().appendToolFeedLine(line)
  const startMatch = line
    .trimStart()
    .match(/^→\s*([A-Za-z0-9_:-]+)(?:\((.*)\)|\s+(.+))?$/)
  if (startMatch) {
    const tool = startMatch[1]
    const detail = (startMatch[2] ?? startMatch[3] ?? '').slice(0, 80)
    useTodoStore.getState().startToolTask(tool, detail)
    persistTimelineFromLogLine(line)
    ingestOrchestratorActivityLine(line)
    return
  }
  const endMatch = line.trimStart().match(/^←\s*([A-Za-z0-9_:-]+)/)
  if (endMatch) {
    useTodoStore.getState().completeToolTask(endMatch[1])
  }
  persistTimelineFromLogLine(line)
  ingestOrchestratorActivityLine(line)
}

function appendLog(line: string) {
  appendOrchestratorSessionLogLine(line)
}

function persistTimelineFromLogLine(line: string) {
  const t = line.trimStart()
  if (!t.startsWith('→') && !t.startsWith('←')) return
  const sid = getDefaultSessionId()
  if (t.startsWith('→')) {
    void appendTimelineEvent(sid, { kind: 'tool_start', line: t.slice(0, 2000) })
  } else {
    void appendTimelineEvent(sid, { kind: 'tool_end', line: t.slice(0, 2000) })
  }
}

function applyActivity(p: OrchestratorActivityPayload) {
  applyOrchestratorActivityFromPayload(p)
}

function formatSubAgentHandoffBlock(p: {
  displayName: string
  role: string
  tileId: string
  outcome: SubAgentHandoffOutcome
  summary?: string
  error?: string
}): string {
  const verb =
    p.outcome === 'done' ? 'completed' : p.outcome === 'cancelled' ? 'cancelled' : 'failed'
  const head = `[Sub-agent ${p.displayName} (${p.role}) · tile ${p.tileId}] ${verb}`
  const detail =
    p.outcome === 'error' && p.error?.trim()
      ? p.error.trim()
      : (p.summary ?? '').trim()
  if (!detail) return head
  return `${head}\n\n${detail.length > 12_000 ? `${detail.slice(0, 12_000)}…` : detail}`
}

function isZaiRateLimitError(msg: string): boolean {
  const t = msg.toLowerCase()
  return t.includes('rate limited') || t.includes('quota') || t.includes('429')
}

const scheduleAnimationFrame: (cb: FrameRequestCallback) => number =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : ((cb) => setTimeout(() => cb(Date.now()), 0) as unknown as number)

const cancelScheduledAnimationFrame = (id: number): void => {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(id)
    return
  }
  clearTimeout(id)
}

export function countWorkingSubAgentsForOrchestratorTile(orchestratorTileId: string): number {
  const { membersByTileId } = useAgentTeamStore.getState()
  const tiles = useCanvasStore.getState().tiles
  return Object.values(membersByTileId).filter((member) => {
    if (member.status !== 'working') return false
    const tile = tiles.get(member.tileId)
    const meta =
      tile?.meta && typeof tile.meta === 'object' ? (tile.meta as Record<string, unknown>) : null
    return meta?.parentOrchestratorTileId === orchestratorTileId
  }).length
}

export function mergePendingSubAgentHandoffs(blocks: string[]): string {
  return `[Parallel sub-agent results]\n\n${blocks.join('\n\n---\n\n')}`
}

/**
 * Tear down orchestrator HUD + telemetry after a 1-shot pipeline finishes or errors.
 * Same as `runOneShotAfterClarify` finally block; also used when the pipeline resumes after post-research clarification.
 */
export function teardownOneShotOrchestratorSession(expectedGeneration: number, widgetTileId: string) {
  if (useOrchestratorSessionStore.getState().runGeneration !== expectedGeneration) return
  flushTelemetryIngestNow()
  setTelemetryRunSession(null)
  setTelemetryRunId(null)
  useOrchestratorSessionStore.setState({ running: false, abortController: null, stopLogged: false })
  useOrchestratorActivityStore.getState().resetIdle()
  useCanvasStore.getState().updateTile(widgetTileId, { tileStatus: 'idle' })
  emitRefreshChangelog({ reason: 'orchestrator-task-complete', sourceTileId: widgetTileId })
}

/**
 * Run 1-shot pipeline after optional workspace picker + MC clarification (after research).
 * Same UI/telemetry as pressing Run on a 1-shot prompt (tasks panel, tile, logs).
 */
export async function runOneShotAfterClarify(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return

  const state = useOrchestratorSessionStore.getState()
  if (state.running) {
    useToastStore.getState().addToast({
      type: 'info',
      title: 'Busy',
      message: 'Wait for the current run to finish before starting 1-shot.',
    })
    return
  }

  const { useOneShotStore } = await import('./oneShotStore')
  const workspace = await useOneShotStore.getState().requestWorkspaceChoice()
  if (workspace === null) return

  const latest = useOrchestratorSessionStore.getState()
  if (latest.running) {
    useToastStore.getState().addToast({
      type: 'info',
      title: 'Busy',
      message: 'Another run started while the folder picker was open. Try again.',
    })
    return
  }

  const myGen = latest.runGeneration + 1
  useWorkspaceStore.getState().setActivePanel('tasks')
  const widgetTileId = ensureOrchestratorWidgetTile()
  const selModel = useSettingsStore
    .getState()
    .getAvailableModels()
    .find((m) => m.id === useSettingsStore.getState().selectedModel)
  if (selModel?.provider === 'openrouter') {
    ensureOpenRouterUsageTile()
  }
  useCanvasStore.getState().updateTile(widgetTileId, { tileStatus: 'working' })
  useOrchestratorActivityStore.getState().clearToolFeed()
  useOrchestratorActivityStore.getState().clearWritePreviews()
  useOrchestratorActivityStore.getState().setRunning(true)
  useOrchestratorActivityStore.getState().setVerb('1-shot · starting')
  useOrchestratorActivityStore.getState().setIteration(0)
  appendOrchestratorSessionLogLine(`You · ${trimmed}`)
  appendOrchestratorSessionLogLine(
    '[1-shot] Multi-phase pipeline: research → spec → architecture → decomposition → codegen → validation in the workspace you chose.'
  )
  setTelemetryRunSession(`orch-1shot-${myGen}-${nanoid(8)}`)
  setTelemetryRunId(`orch-1shot-${myGen}`)
  useOrchestratorSessionStore.setState({
    runGeneration: myGen,
    running: true,
    input: '',
    inputAttachments: [],
    stopLogged: false,
  })

  let clarifyPaused = false
  try {
    const outcome = await useOneShotStore.getState().startPipeline(trimmed, {
      orchestratorTileId: widgetTileId,
      workspace,
    })
    if (outcome === 'clarify_pending') {
      clarifyPaused = true
    }
  } catch {
    /* Errors + discard handled inside startPipeline */
  } finally {
    if (!clarifyPaused) {
      teardownOneShotOrchestratorSession(myGen, widgetTileId)
    }
  }
}

export const useOrchestratorSessionStore = create<OrchestratorSessionState>((set, get) => ({
  input: '',
  inputAttachments: [],
  running: false,
  oneShotMode: false,
  queuedInputs: [],
  sessionMessages: [],
  pendingSubAgentHandoffs: [],
  waitingForSubAgents: false,
  interruptionCheckpoint: null,
  abortController: null,
  runGeneration: 0,
  lastHarnessTraceSessionKey: null,
  stopLogged: false,
  planningDraft: null,
  lastRunOutcome: null,
  runLockedSelectedModelId: null,

  setOneShotMode: (oneShotMode) => set({ oneShotMode }),

  recordSubAgentHandoff: (p) => {
    void appendSubAgentTrace(getDefaultSessionId(), p.tileId, {
      at: Date.now(),
      outcome: p.outcome,
      displayName: p.displayName,
      role: p.role,
      summary: p.summary,
      error: p.error,
    })
    const block = formatSubAgentHandoffBlock(p)
    appendLog(block)

    // Mirror into the spawning sub-agent's log when the finished worker was
    // itself nested (e.g. a Hermes worker recruiting its own Hermes helpers).
    // Without this, nested handoffs only ever surface in the lead session and
    // the parent sub-agent never gets visibility into what its helpers did.
    // We only *mirror* the text — we do not inject it into the parent's tool
    // loop (the parent is fire-and-forget by design), so it appears in the
    // parent tile's agent log stream for human/agent inspection.
    const childTile = useCanvasStore.getState().tiles.get(p.tileId)
    const childMeta =
      childTile?.meta && typeof childTile.meta === 'object'
        ? (childTile.meta as Record<string, unknown>)
        : null
    const parentAgentTileId =
      typeof childMeta?.parentAgentTileId === 'string'
        ? childMeta.parentAgentTileId.trim()
        : ''
    if (parentAgentTileId && parentAgentTileId !== p.tileId) {
      useAgentTeamStore.getState().appendAgentLog(
        parentAgentTileId,
        `\n── Nested handoff ──\n${block}\n`
      )
    }
    const state = get()
    const running = state.running
    if (running) {
      set((s) => ({ pendingSubAgentHandoffs: [...s.pendingSubAgentHandoffs, block] }))
    } else {
      const widgetTileId = ensureOrchestratorWidgetTile()
      if (state.waitingForSubAgents) {
        const nextPending = [...state.pendingSubAgentHandoffs, block]
        let stillWorking = countWorkingSubAgentsForOrchestratorTile(widgetTileId)
        // Handoff can arrive before the worker status flips out of "working".
        // Treat the emitting tile as complete for this waiting check.
        const member = useAgentTeamStore.getState().membersByTileId[p.tileId]
        const tile = useCanvasStore.getState().tiles.get(p.tileId)
        const meta =
          tile?.meta && typeof tile.meta === 'object'
            ? (tile.meta as Record<string, unknown>)
            : null
        const belongsToWidget = meta?.parentOrchestratorTileId === widgetTileId
        if (member?.status === 'working' && belongsToWidget) {
          stillWorking = Math.max(0, stillWorking - 1)
        }
        set({
          pendingSubAgentHandoffs: nextPending,
          waitingForSubAgents: stillWorking > 0,
        })
        if (stillWorking > 0) {
          appendLog(
            `[Waiting] ${stillWorking} sub-agent${stillWorking === 1 ? '' : 's'} still running; holding handoff for orchestrator resume.`
          )
          useCanvasStore.getState().updateTile(widgetTileId, { tileStatus: 'waiting' })
          return
        }
        const merged = mergePendingSubAgentHandoffs(nextPending)
        set({ pendingSubAgentHandoffs: [], waitingForSubAgents: false })
        appendLog(
          `[Resume] ${nextPending.length} sub-agent handoff${nextPending.length === 1 ? '' : 's'} ready. Resuming orchestrator.`
        )
        useCanvasStore.getState().updateTile(widgetTileId, { tileStatus: 'working' })
        queueMicrotask(() => {
          void get().run({
            id: nanoid(),
            text: merged,
            attachments: [],
            source: 'sub_agent_handoff',
          })
        })
        return
      }
      set((s) => {
        const sessionMessages = [
          ...s.sessionMessages,
          {
            role: 'user' as const,
            content: `[Sub-agent handoff]\n\n${block}`,
          },
        ]
        void syncConversationToDisk(getDefaultSessionId(), sessionMessages)
        return { sessionMessages }
      })
    }
  },

  setInput: (input) => set({ input }),
  setInputAttachments: (attachments) => set({ inputAttachments: attachments }),
  appendInputAttachments: (attachments) =>
    set((prev) => ({ inputAttachments: [...prev.inputAttachments, ...attachments] })),
  removeInputAttachment: (attachmentId) =>
    set((prev) => ({
      inputAttachments: prev.inputAttachments.filter((a) => a.id !== attachmentId),
    })),

  run: async (queuedRun, options) => {
    const state = get()
    const fromQueue = !!queuedRun
    const source = queuedRun?.source ?? 'user'
    const text = (fromQueue ? queuedRun.text : state.input).trim()
    const promptSeedText = maybeExpandContinuePromptFromRecentLogs(text)
    const attachments = fromQueue ? queuedRun.attachments : state.inputAttachments
    const queuedCheckpoint =
      fromQueue && queuedRun?.interruptionCheckpointId && state.interruptionCheckpoint?.id === queuedRun.interruptionCheckpointId
        ? state.interruptionCheckpoint
        : null
    const displayText =
      source === 'sub_agent_handoff'
        ? 'Sub-agent results ready'
        : source === 'heartbeat'
          ? '[Heartbeat] Proactive check-in'
          : text || '(attachment)'
    if (!text && attachments.length === 0) {
      set({ lastRunOutcome: { kind: 'skipped', reason: 'Empty message.' } })
      return
    }

    /** 1-shot: multi-phase temp workspace pipeline (sidebar toggle or quick toolbar). */
    if (!fromQueue && state.oneShotMode) {
      if (attachments.length > 0) {
        useToastStore.getState().addToast({
          type: 'warning',
          title: '1-shot',
          message: 'Remove attachments — 1-shot uses text only.',
        })
        set({
          lastRunOutcome: {
            kind: 'skipped',
            reason: 'Remove attachments — 1-shot uses text only.',
          },
        })
        return
      }
      if (!text) {
        set({ lastRunOutcome: { kind: 'skipped', reason: 'Empty message.' } })
        return
      }
      if (state.running) {
        useToastStore.getState().addToast({
          type: 'info',
          title: 'Busy',
          message: 'Wait for the current run to finish before starting 1-shot.',
        })
        set({
          lastRunOutcome: {
            kind: 'skipped',
            reason: 'Wait for the current run to finish before starting 1-shot.',
          },
        })
        return
      }

      ensureOrchestratorWidgetTile()
      const { useOneShotStore } = await import('./oneShotStore')
      useOneShotStore.getState().setQuickInputExitOneShotAfterPipeline(options?.oneShotFromQuickInput === true)
      set({ input: '', inputAttachments: [] })
      await runOneShotAfterClarify(text)
      set({
        lastRunOutcome: {
          kind: 'skipped',
          reason:
            '1-shot mode is on — disable 1-shot in the UI to use the normal orchestrator from Telegram.',
        },
      })
      return
    }

    if (state.running) {
      if (fromQueue) {
        set({ lastRunOutcome: { kind: 'busy_rejected' } })
        return
      }
      useWorkspaceStore.getState().setActivePanel('tasks')
      const queuedId = nanoid()
      const checkpoint = buildInterruptionCheckpoint({
        id: nanoid(),
        interruptedRunGeneration: state.runGeneration,
        interruptedTaskSummary: summarizeInterruptedTaskFromSession(state.sessionMessages),
        interruptedByText: text || '(attachment)',
        createdAt: Date.now(),
      })
      set((prev) => ({
        queuedInputs: [
          ...prev.queuedInputs,
          {
            id: queuedId,
            text,
            attachments,
            interruptionCheckpointId: checkpoint.id,
          },
        ],
        interruptionCheckpoint: checkpoint,
        input: '',
        inputAttachments: [],
      }))
      appendLog(
        `[Queued] ${displayText}${attachments.length > 0 ? ` (+${attachments.length} attachment${attachments.length === 1 ? '' : 's'})` : ''}`
      )
      appendLog('[Interrupt] Captured checkpoint. Next turn will answer interruption first, then offer resume.')
      useToastStore.getState().addToast({
        type: 'info',
        title: 'Queued',
        message: 'Message queued and will run when current task finishes.',
      })
      set({ lastRunOutcome: { kind: 'queued' } })
      return
    }

    let settings = useSettingsStore.getState()
    if (settings.leadProfile === 'hermes' && !settings.providers.hermes.enabled) {
      settings.setProviderConfig('hermes', { enabled: true })
      settings = useSettingsStore.getState()
    }
    const effectiveLeadDelegation = resolveLeadDelegationForRun({
      explicitLeadDelegationOnly: undefined,
      settingsLeadDelegationOnly: settings.orchestratorLeadDelegationOnly,
      leadProfile: settings.leadProfile,
    })
    const hermesDirectConversationMode = settings.leadProfile === 'hermes' && !effectiveLeadDelegation
    const wantsImages = attachments.some((a) => a.kind === 'image')
    const imageAttachments = attachments.filter((a) => a.kind === 'image' && !!a.dataUrl)
    const nonImageAttachments = attachments.filter((a) => a.kind !== 'image')
    const models = settings.getAvailableModels()
    if (hermesDirectConversationMode && settings.selectedModel !== HERMES_PROVIDER_MODEL_ID) {
      settings.setSelectedModel(HERMES_PROVIDER_MODEL_ID)
      settings = useSettingsStore.getState()
    }
    const hermesSelected = hermesDirectConversationMode
      ? models.find((m) => m.id === HERMES_PROVIDER_MODEL_ID) ?? null
      : null
    if (hermesDirectConversationMode && !hermesSelected) {
      throw new Error('Hermes lead mode requires Hermes gateway provider. Enable Hermes in Settings → Integrations.')
    }
    const selectedCurrent =
      hermesSelected ??
      models.find((m) => m.id === settings.selectedModel) ??
      models.find((m) => providerSupportsOrchestratorTools(m.provider)) ??
      models[0]
    const selected = wantsImages ? pickPreferredVisionModel(models, selectedCurrent) : selectedCurrent
    const shouldRestoreZaiDefaultAfterRun = wantsImages && selected?.provider === 'zai'
    let suppressModelSwitchSubscribe = false
    if (selected && settings.selectedModel !== selected.id) {
      suppressModelSwitchSubscribe = true
      try {
        settings.setSelectedModel(selected.id)
      } finally {
        suppressModelSwitchSubscribe = false
      }
      if (wantsImages) {
        useToastStore.getState().addToast({
          type: 'info',
          title: 'Using vision-capable model',
          message: `${selected.displayName} selected for image attachments.`,
        })
      }
    }
    if (!selected) {
      if (wantsImages) {
        useToastStore.getState().addToast({
          type: 'error',
          title: 'No multimodal model available',
          message: 'Enable or select a model that supports image attachments.',
        })
        set({
          lastRunOutcome: {
            kind: 'skipped',
            reason: 'Enable or select a model that supports image attachments.',
          },
        })
        return
      }
      useToastStore.getState().addToast({
        type: 'error',
        title: 'No model',
        message: 'Pick a model in Settings.',
      })
      settings.toggleSettings()
      set({
        lastRunOutcome: { kind: 'skipped', reason: 'Pick a model in Settings.' },
      })
      return
    }

    if (!providerSupportsOrchestratorTools(selected.provider) || selected.supportsTools === false) {
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Orchestrator provider',
        message:
          'Canvas orchestrator uses tool calling. Pick a Tools-capable model.',
      })
      settings.toggleSettings()
      set({
        lastRunOutcome: {
          kind: 'skipped',
          reason: 'Canvas orchestrator uses tool calling. Pick a Tools-capable model.',
        },
      })
      return
    }

    const providerConfig = settings.providers[selected.provider]
    const apiKey = await resolveApiKey(selected.provider, providerConfig.apiKey)
    if (selected.provider === 'openai' && providerConfig.authMode === 'oauth') {
      const { hasOpenAiCodexOAuthOnly } = await import('../lib/llmCredentials')
      if (await hasOpenAiCodexOAuthOnly()) {
        useToastStore.getState().addToast({
          type: 'error',
          title: 'OpenAI OAuth cannot run models here',
          message:
            'Your desktop ChatGPT/Codex OAuth is signed in, but this account token does not include OpenAI API model scopes. Switch OpenAI auth mode to API key for the orchestrator, or use another provider.',
        })
        settings.toggleSettings()
        set({
          lastRunOutcome: {
            kind: 'skipped',
            reason:
              'OpenAI OAuth cannot run models here — switch OpenAI auth mode to API key for the orchestrator, or use another provider.',
          },
        })
        return
      }
    }
    if (!apiKey && !providerAllowsEmptyApiKey(selected.provider)) {
      useToastStore.getState().addToast({
        type: 'error',
        title: 'API key required',
        message: `Set ${PROVIDER_INFO[selected.provider].name} in Settings.`,
      })
      settings.toggleSettings()
      set({
        lastRunOutcome: {
          kind: 'skipped',
          reason: `Set ${PROVIDER_INFO[selected.provider].name} API key in Settings.`,
        },
      })
      return
    }

    const myGen = state.runGeneration + 1
    const ws = useWorkspaceStore.getState()
    const activeWorkspaceRoot = ws.rootPath && ws.rootPath !== '.' ? ws.rootPath : null
    if (activeWorkspaceRoot) {
      try {
        await tauriSetWorkspace(activeWorkspaceRoot)
      } catch (e) {
        appendLog(
          `[Workspace] Failed to sync active workspace (${activeWorkspaceRoot}): ${e instanceof Error ? e.message : String(e)}`
        )
      }
    }
    if (!fromQueue) {
      ws.setActivePanel('tasks')
    }
    const abortController = new AbortController()
    const suppressTodo = shouldSuppressOrchestratorTodoRow(displayText)
    let rootTaskId: string | null = null
    if (fromQueue && queuedRun?.reuseOrchestratorTodoTaskId) {
      rootTaskId = queuedRun.reuseOrchestratorTodoTaskId
      useTodoStore.getState().patchTask(rootTaskId, {
        status: 'in_progress',
        assignedAgentName: selected.displayName,
      })
    } else if (!suppressTodo) {
      rootTaskId = useTodoStore
        .getState()
        .addTask(`Orchestrator: ${displayText}`, 'orchestrator', 'in_progress')
      useTodoStore.getState().patchTask(rootTaskId, { assignedAgentName: selected.displayName })
    }

    let planningDraftRaf = 0
    let resumeFromPendingSubAgentsAfterRun = false
    /** When set before `abort()`, queue-microtask `run(this)` to retry the same prompt with the newly selected model. */
    let modelSwitchRestartQueued: QueuedRun | null = null
    let unsubSettings: (() => void) | null = null
    /** Filled on orchestrator success or catch; applied in `finally` before dequeuing the next run. */
    let runOutcomeForThisTurn: RunOutcome | null = null
    /** Original stagnation error line for memory distiller (when guard triggers). */
    let lastStagnationHint: string | null = null
    const setPlanningDraftLive = (title: string, body: string, phase: 'streaming' | 'formatted') => {
      if (planningDraftRaf) cancelScheduledAnimationFrame(planningDraftRaf)
      if (phase === 'streaming') {
        planningDraftRaf = scheduleAnimationFrame(() => {
          set({ planningDraft: { phase, title, body } })
        })
      } else {
        planningDraftRaf = 0
        set({ planningDraft: { phase, title, body } })
      }
    }

    set({
      runGeneration: myGen,
      lastHarnessTraceSessionKey: `orch-${myGen}`,
      running: true,
      waitingForSubAgents: false,
      abortController,
      runLockedSelectedModelId: selected.id,
      ...(fromQueue ? {} : { input: '', inputAttachments: [] }),
      stopLogged: false,
      planningDraft: null,
    })

    unsubSettings = useSettingsStore.subscribe((state, prev) => {
      if (suppressModelSwitchSubscribe) return
      if (state.selectedModel === prev.selectedModel) return
      const st = get()
      if (!st.running || st.runGeneration !== myGen) return
      const locked = st.runLockedSelectedModelId
      if (!locked || state.selectedModel === locked) return
      const models = useSettingsStore.getState().getAvailableModels()
      const meta = models.find((m) => m.id === state.selectedModel)
      const label = meta?.displayName ?? state.selectedModel
      useToastStore.getState().addToast({
        type: 'info',
        title: 'Switching model',
        message: `Switching to ${label} — restarting turn`,
      })
      modelSwitchRestartQueued = {
        id: nanoid(),
        text,
        attachments,
        source,
        ...(rootTaskId ? { reuseOrchestratorTodoTaskId: rootTaskId } : {}),
      }
      abortController.abort()
    })

    setTelemetryRunSession(`orch-${myGen}-${nanoid(8)}`)
    setTelemetryRunId(`orch-${myGen}`)
    void writeSessionMeta(getDefaultSessionId(), {
      incomplete: true,
      workspaceRoot:
        useWorkspaceStore.getState().rootPath === '.'
          ? null
          : useWorkspaceStore.getState().rootPath,
    })

    useOrchestratorActivityStore.getState().clearToolFeed()
    useOrchestratorActivityStore.getState().clearWritePreviews()
    useReasoningTraceStore.getState().clear()
    useOrchestratorActivityStore.getState().setRunning(true)
    useOrchestratorActivityStore.getState().setVerb(glitterVerbForRunStart())
    useOrchestratorActivityStore.getState().setIteration(0)

    const attachmentNote =
      attachments.length > 0
        ? ` · ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
        : ''
    if (source === 'sub_agent_handoff') {
      appendLog(`[Resume] ${displayText}`)
    } else if (source === 'heartbeat') {
      appendLog(`[Heartbeat] ${displayText}`)
    } else {
      appendLog(`You · ${displayText}${attachmentNote}`)
    }
    appendLog(formatWorkspaceTraceLine(activeWorkspaceRoot))

    const widgetTileId = ensureOrchestratorWidgetTile()
    if (selected.provider === 'openrouter') {
      ensureOpenRouterUsageTile()
    }
    useCanvasStore.getState().updateTile(widgetTileId, { tileStatus: 'working' })

    let promptBaseText = displayText
    let skillActivated = false
    if (promptSeedText) {
      const skillResolved = await resolveSkillCommandPrompt(promptSeedText)
      if (skillResolved.error) {
        useToastStore.getState().addToast({
          type: 'warning',
          title: 'Skill command',
          message: skillResolved.error,
        })
      }
      if (skillResolved.activated) {
        skillActivated = true
        appendLog(`[Skill] Activated /${skillResolved.skillName}`)
        if (skillResolved.sourcePath) {
          appendLog(`[Skill] Loaded ${skillResolved.sourcePath}`)
        }
      }
      promptBaseText = skillResolved.promptText
    }

    if (heuristicTelegramGatewayTilesIntent(promptBaseText)) {
      ensureTelegramGatewayTiles()
    }

    try {
      if (wantsImages && selected.provider === 'zai') {
        appendLog(
          '[Z.AI Vision MCP default] Recommended for Z.AI image workflows: https://docs.z.ai/devpack/mcp/vision-mcp-server'
        )
      }
      let finalPrompt = promptBaseText
      if (wantsImages && imageAttachments.length > 0 && selected.provider === 'zai') {
        if (!apiKey) {
          throw new Error('Z.AI API key required for vision preprocess.')
        }
        for (const img of imageAttachments) {
          appendLog(`Read(${img.name})`)
          appendLog(`⎿  Read image (${(img.size / 1024).toFixed(1)}KB)`)
        }
        const pre = await preprocessImagesWithZai({
          apiKey,
          baseUrl: providerConfig.baseUrl,
          images: imageAttachments.map((img) => ({
            name: img.name,
            size: img.size,
            dataUrl: img.dataUrl!,
          })),
          signal: abortController.signal,
        })
        appendLog('⎿  Async hook PreToolUse completed')
        appendLog(`[Vision preprocess] ${pre.modelUsed} analyzed ${imageAttachments.length} image(s).`)
        finalPrompt = `${promptBaseText}\n\n[Vision analysis]\n${truncateString(pre.summary, 12_000)}`
      }

      let researchMode = !hermesDirectConversationMode && heuristicResearchIntent(finalPrompt)
      if (researchMode) {
        appendLog(
          '[Research] Mode on — open browser tiles for sources; optional research/<topic>.md on canvas.'
        )
      }

      let projectInstructions: string | null = null
      let installedSkillsCatalog: string | null = null
      const loaded = await Promise.allSettled([
        loadProjectInstructionsForPrompt(),
        hermesDirectConversationMode ? Promise.resolve(null) : loadInstalledSkillsCatalogForOrchestrator(),
      ])
      if (loaded[0].status === 'fulfilled' && loaded[0].value) {
        projectInstructions = loaded[0].value
        appendLog('[Project] Loaded ~/.claude/orca.md or CLAUDE.md and/or workspace orca.md or CLAUDE.md into system prompt.')
      }
      if (loaded[1].status === 'fulfilled' && loaded[1].value) {
        installedSkillsCatalog = loaded[1].value
        appendLog('[Skills] Injected installed skills/commands catalog into system prompt.')
      }

      const articulationMode = useSettingsStore.getState().orchestratorArticulationMode
      let workingPrompt = finalPrompt
      let didArticulation = false
      const isHeartbeatRun = source === 'heartbeat'

      const runArticulationPhase = async (): Promise<void> => {
        appendLog('[Articulation] Clarifying your request…')
        const ar = await runOrchestratorArticulationPhase({
          provider: selected.provider,
          model: selected.name,
          apiKey,
          baseUrl: providerConfig.baseUrl,
          userPrompt: truncateString(finalPrompt, MAX_PLANNING_USER_CHARS),
          signal: abortController.signal,
          onStream: (acc) => setPlanningDraftLive('Articulating', acc, 'streaming'),
        })
        setPlanningDraftLive('Articulating', ar.goal, 'formatted')
        workingPrompt = ar.goal
        didArticulation = true
        if (ar.clarifications.length > 0) {
          appendLog(`[Articulation] Notes: ${ar.clarifications.join(' · ')}`)
        }
        const preview =
          ar.goal.length > 220 ? `${ar.goal.slice(0, 217).trim()}…` : ar.goal
        appendLog(`[Articulation] ${preview}`)
      }

      if (!isHeartbeatRun && !hermesDirectConversationMode && articulationMode === 'always') {
        try {
          await runArticulationPhase()
        } catch (e) {
          set({ planningDraft: null })
          workingPrompt = finalPrompt
          didArticulation = false
          const msg = e instanceof Error ? e.message : String(e)
          appendLog(`[Articulation] Skipped (${msg})`)
        }
      }

      let promptTier = classifyOrchestratorPrompt(
        articulationMode === 'always' && didArticulation ? workingPrompt : finalPrompt
      )

      if (isHeartbeatRun || hermesDirectConversationMode) {
        promptTier = 'simple'
        if (isHeartbeatRun) {
          appendLog('[Heartbeat] Using simple path (no articulation / hierarchy / decomposition).')
        }
      }

      if (
        !isHeartbeatRun &&
        !hermesDirectConversationMode &&
        articulationMode === 'before_planning' &&
        shouldArticulateOrchestratorPrompt(finalPrompt) &&
        !didArticulation
      ) {
        try {
          await runArticulationPhase()
        } catch (e) {
          set({ planningDraft: null })
          workingPrompt = finalPrompt
          const msg = e instanceof Error ? e.message : String(e)
          appendLog(`[Articulation] Skipped (${msg})`)
        }
      }

      if (!hermesDirectConversationMode) {
        const tierLabel =
          promptTier === 'trivial' ? 'Trivial — direct reply (no tools).' :
          promptTier === 'simple' ? 'Simple — direct tools (no decomposition).' :
          'Complex — phased planning/delegation will be prepared.'
        appendLog(`[Prompt] ${tierLabel}`)
      }

      const interpretedPrefix =
        workingPrompt.trim() !== finalPrompt.trim()
          ? `**Interpreted request:**\n${workingPrompt}\n\n`
          : ''

      let orchestratorUserBody = interpretedPrefix
        ? `${interpretedPrefix}${finalPrompt}`
        : finalPrompt
      let maxIterationsForRun =
        promptTier === 'trivial' ? ORCHESTRATOR_TRIVIAL_MAX_ITERATIONS :
        promptTier === 'simple' ? ORCHESTRATOR_SIMPLE_MAX_ITERATIONS : ORCHESTRATOR_DEFAULT_MAX_ITERATIONS

      const visionComplex = promptTier === 'complex' && wantsImages
      if (visionComplex) {
        maxIterationsForRun = ORCHESTRATOR_HARD_MAX_ITERATIONS
        appendLog(
          `[Budget] ${maxIterationsForRun} max tool rounds (vision + complex request). Prefer canvas_list_modules once, parallel list_directory, and spawn_sub_agent; avoid sequential directory crawls.`
        )
      }

      let usedPlanningBlock = false
      let planExecutionContract: Partial<ExecutionContract> | undefined
      let useHierarchy =
        !isHeartbeatRun &&
        !hermesDirectConversationMode &&
        shouldUseHierarchicalPlanning({
          promptTier,
          prompt: workingPrompt,
          wantsImages,
          skillActivated,
        })
      if (useHierarchy) {
        try {
          appendLog('[Hierarchy] Building phased plan (3–5 phases × 3–5 tasks × 3–5 subtasks)…')
          const hierarchy = await runOrchestratorHierarchyPhase({
            provider: selected.provider,
            model: selected.name,
            apiKey,
            baseUrl: providerConfig.baseUrl,
            userPrompt: truncateString(workingPrompt, MAX_PLANNING_USER_CHARS),
            signal: abortController.signal,
            onStream: (acc) => setPlanningDraftLive('Phased plan', acc, 'streaming'),
          })
          appendLog(`[Hierarchy] Planned ${hierarchy.phases.length} phases`)
          for (const [idx, p] of hierarchy.phases.entries()) {
            appendLog(`[Phase ${idx + 1}] ${p.title} (${p.tasks.length} tasks)`)
          }
          const hierarchyMd = formatHierarchyBlock(hierarchy)
          setPlanningDraftLive('Phased plan', hierarchyMd, 'formatted')
          void persistOrchestratorPlanMarkdown(hierarchyMd)
          orchestratorUserBody = `${interpretedPrefix}${hierarchyMd}**Original user message:**\n${finalPrompt}`
          planExecutionContract = buildExecutionContractFromHierarchy(hierarchy)
          usedPlanningBlock = true
        } catch (e) {
          set({ planningDraft: null })
          const msg = e instanceof Error ? e.message : String(e)
          appendLog(`[Hierarchy] Skipped (${msg}). Falling back to flat decomposition.`)
          useHierarchy = false
        }
      }

      if (!isHeartbeatRun && !useHierarchy && promptTier === 'complex' && !skillActivated) {
        try {
          appendLog('[Decomposition] Structuring parallel tracks (one LLM call)…')
          const dcSkill = await loadDivideAndConquerSkillForDecomposition({
            signal: abortController.signal,
          })
          appendLog(dcSkill.logLine)
          const decomp = await runOrchestratorDecompositionPhase({
            provider: selected.provider,
            model: selected.name,
            apiKey,
            baseUrl: providerConfig.baseUrl,
            userPrompt: truncateString(workingPrompt, MAX_PLANNING_USER_CHARS),
            signal: abortController.signal,
            onStream: (acc) => setPlanningDraftLive('Parallel tracks', acc, 'streaming'),
            divideAndConquerGuidance: dcSkill.guidance ?? undefined,
          })
          for (const s of decomp.subtasks) {
            appendLog(`[Track] ${s.difficulty} — ${s.title}`)
          }
          const decompMd = formatDecompositionBlock(decomp)
          setPlanningDraftLive('Parallel tracks', decompMd, 'formatted')
          void persistOrchestratorPlanMarkdown(decompMd)
          orchestratorUserBody = `${interpretedPrefix}${decompMd}**Original user message:**\n${finalPrompt}`
          planExecutionContract = buildExecutionContractFromDecomposition(decomp)
          usedPlanningBlock = true
        } catch (e) {
          set({ planningDraft: null })
          const msg = e instanceof Error ? e.message : String(e)
          appendLog(`[Decomposition] Skipped (${msg}). Continuing with your message only.`)
        }
      } else if (!isHeartbeatRun && !useHierarchy && promptTier === 'complex' && skillActivated) {
        appendLog(
          '[Decomposition] Skipped (skill workflow) — use spawn_sub_agent manually if needed.'
        )
      }
      const visionComplexNoDecomp = visionComplex && !usedPlanningBlock

      const zaiVisionFallback =
        wantsImages && selected.provider === 'zai'
          ? models.find((m) => m.provider === 'zai' && m.id !== selected.id && /glm-4-5v/i.test(m.id))
          : null
      const attempts = zaiVisionFallback ? [selected, zaiVisionFallback] : [selected]

      const runOrchestratorAttempt = async (params: {
        sessionMessages: ChatMessage[]
        userMessage: string
        userContent: string | ReturnType<typeof toUserContentWithAttachments>
      }): Promise<{ assistantText: string; messages: ChatMessage[] }> => {
        const researchModeForRun = researchMode
        const useTextOnlyFirstTurn =
          promptTier === 'complex' ||
          researchModeForRun ||
          usedPlanningBlock ||
          visionComplexNoDecomp
        let attemptResult: { assistantText: string; messages: ChatMessage[] } | null = null
        let lastError: unknown = null
        for (let i = 0; i < attempts.length; i++) {
          const m = attempts[i]
          if (!hermesDirectConversationMode) {
            appendLog(
              `[Using model: ${m.displayName} (${m.name}) — ${PROVIDER_INFO[m.provider].name}]`
            )
          }
          if (settings.selectedModel !== m.id) {
            suppressModelSwitchSubscribe = true
            try {
              set({ runLockedSelectedModelId: m.id })
              settings.setSelectedModel(m.id)
            } finally {
              suppressModelSwitchSubscribe = false
            }
          } else {
            set({ runLockedSelectedModelId: m.id })
          }
          try {
            attemptResult = await orchestratorSessionRuntime.runOrchestratorLeadAware({
              provider: m.provider,
              model: m.name,
              apiKey,
              baseUrl: providerConfig.baseUrl,
              modelDisplayLabel: `${m.displayName} (${m.name})`,
              leadDelegationOnly: effectiveLeadDelegation,
              messages: trimMessagesForOrchestrator(
                params.sessionMessages,
                clampShortTermMemoryChars(useSettingsStore.getState().memoryShortTermMaxChars)
              ),
              userMessage: params.userMessage,
              userContent: params.userContent,
              executionContract: planExecutionContract,
              onLog: appendLog,
              onProviderNotice: hermesDirectConversationMode
                ? (line) => {
                    useReasoningTraceStore.getState().append('trace', line)
                    const compactLine = summarizeHermesProviderNoticeLine(line)
                    if (compactLine) appendLog(compactLine)
                  }
                : appendLog,
              onAssistantReply: appendAssistantActivityLine,
              onActivity: applyActivity,
              onUsage: (usage) => {
                useOrchestratorActivityStore.getState().addRunUsage(usage)
              },
              onContextTokens: (tokens) => {
                useOrchestratorActivityStore.getState().setRunEstimatedContextTokens(tokens)
              },
              orchestratorTileId: widgetTileId,
              runGeneration: myGen,
              signal: abortController.signal,
              researchMode: researchModeForRun,
              projectInstructions,
              installedSkillsCatalog,
              maxIterations: maxIterationsForRun,
              ...(promptTier === 'trivial' ? {
                toolAllowlist: [],
                overrideSystemPrompt:
                  'You are an AI assistant. Respond directly and concisely to the user. Do not use any tools — just reply naturally.',
              } : {}),
              visionWithoutDecomposition: visionComplexNoDecomp,
              /**
               * Only force the extra acknowledgment turn when we expect visible planning/tool work.
               * For simple prompts like "hi", a second closing turn reads as a duplicate response.
               */
              textOnlyFirstTurn: useTextOnlyFirstTurn,
              orchestratorRunContext: isHeartbeatRun ? 'heartbeat' : 'default',
              workspaceRoot: activeWorkspaceRoot,
              suppressStillWaitingNudges: hermesDirectConversationMode,
              hermesTerminalTraceStyle: hermesDirectConversationMode,
              harnessTraceSessionKey: `orch-${myGen}`,
              onHarnessTrace: hermesDirectConversationMode
                ? undefined
                : (payload) => {
                    useReasoningTraceStore.getState().appendFromHarness(payload)
                  },
            })
            break
          } catch (e) {
            lastError = e
            const msg = e instanceof Error ? e.message : String(e)
            const canTryNext =
              i < attempts.length - 1 && wantsImages && selected.provider === 'zai' && isZaiRateLimitError(msg)
            if (canTryNext) {
              appendLog('[Z.AI vision fallback] Current model rate-limited. Trying next Z.AI vision model…')
              continue
            }
            throw e
          }
        }
        if (!attemptResult && lastError) throw lastError
        if (!attemptResult) throw new Error('No vision model succeeded for this image attachment.')
        return attemptResult
      }

      let assistantCombined = ''
      let messagesOut: ChatMessage[] = get().sessionMessages

      if (planningDraftRaf) cancelScheduledAnimationFrame(planningDraftRaf)

      if (queuedCheckpoint) {
        const resumeDirective = buildInterruptionResumeDirectivePrefix(queuedCheckpoint)
        orchestratorUserBody = `${resumeDirective}\n\n${orchestratorUserBody}`
        appendLog('[Interrupt] Applying runtime interruption-resume directive for this queued turn.')
      }

      const orchestratorUserPrompt = truncateString(orchestratorUserBody, MAX_SINGLE_USER_CHARS)

      let sessionMessagesForRun = get().sessionMessages
      const grounding = applyDelegationResumeGroundingIfNeeded({
        sessionMessages: sessionMessagesForRun,
        workspaceRoot: ws.rootPath,
        leadDelegationOnly: effectiveLeadDelegation,
        source,
      })
      if (grounding.injected) {
        sessionMessagesForRun = grounding.messages
        set({ sessionMessages: sessionMessagesForRun })
        void syncConversationToDisk(getDefaultSessionId(), sessionMessagesForRun)
        appendLog(
          '[Delegation] One-time hierarchy reminder added for this workspace session (continue after prior history).'
        )
      }

      const single = await runOrchestratorAttempt({
        sessionMessages: sessionMessagesForRun,
        userMessage: orchestratorUserPrompt,
        userContent: toUserContentWithAttachments(orchestratorUserPrompt, nonImageAttachments),
      })
      messagesOut = single.messages
      assistantCombined = single.assistantText
      sanitizePersistedOrchestratorUserMessage(messagesOut, orchestratorUserPrompt, finalPrompt)
      set({ sessionMessages: messagesOut })
      void syncConversationToDisk(getDefaultSessionId(), messagesOut)
      if (assistantCombined.trim()) appendAssistantActivityLine(assistantCombined)
      if (queuedCheckpoint) {
        set({ interruptionCheckpoint: null })
      }

      // After each assistant reply, pan/bring the orchestrator module forward so the new message
      // is visible (respects Settings → orchestrator auto-focus).
      revealOrchestratorTile(widgetTileId, undefined, widgetTileId, { forceCamera: true })

      if (useSettingsStore.getState().harnessFileStateSnapshot) {
        void patchHarnessFileState(`session_${myGen}`, {
          at: Date.now(),
          preview: assistantCombined.slice(0, 4000),
        }).catch(() => {
          /* optional disk */
        })
      }
      const pendingHandoffs = get().pendingSubAgentHandoffs.length
      const workingSubAgents = countWorkingSubAgentsForOrchestratorTile(widgetTileId)
      if (workingSubAgents > 0) {
        set({ waitingForSubAgents: true })
        appendLog(
          `[Waiting] ${workingSubAgents} delegated sub-agent${workingSubAgents === 1 ? '' : 's'} still running. Orca will resume when their handoffs arrive.`
        )
        if (rootTaskId) {
          useTodoStore.getState().patchTask(rootTaskId, {
            status: 'in_progress',
            assignedAgentName: undefined,
          })
        }
        useCanvasStore.getState().updateTile(widgetTileId, { tileStatus: 'waiting' })
      } else if (pendingHandoffs > 0) {
        resumeFromPendingSubAgentsAfterRun = true
        if (rootTaskId) {
          useTodoStore.getState().patchTask(rootTaskId, {
            status: 'in_progress',
            assignedAgentName: undefined,
          })
        }
        useCanvasStore.getState().updateTile(widgetTileId, { tileStatus: 'working' })
      } else {
        if (rootTaskId) {
          useTodoStore.getState().patchTask(rootTaskId, {
            status: 'completed',
            assignedAgentName: undefined,
          })
        }
        useCanvasStore.getState().updateTile(widgetTileId, { tileStatus: 'done' })
        emitRefreshChangelog({ reason: 'orchestrator-task-complete', sourceTileId: widgetTileId })
      }
      runOutcomeForThisTurn = {
        kind: 'ok',
        assistantText: assistantCombined,
        turnIndex: Math.max(0, messagesOut.length - 1),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/abort/i.test(msg)) {
        const restartQr = modelSwitchRestartQueued
        modelSwitchRestartQueued = null
        if (restartQr) {
          runOutcomeForThisTurn = { kind: 'skipped', reason: 'model_switch_restart' }
          appendLog('[Model switch] Restarting turn with new model.')
          queueMicrotask(() => {
            void get().run(restartQr)
          })
        } else {
          runOutcomeForThisTurn = { kind: 'aborted' }
          if (!get().stopLogged) appendLog('[Cancelled]')
          if (rootTaskId) {
            useTodoStore.getState().patchTask(rootTaskId, {
              status: 'failed',
              assignedAgentName: undefined,
            })
          }
          useCanvasStore.getState().updateTile(widgetTileId, { tileStatus: 'idle' })
          emitRefreshChangelog({ reason: 'orchestrator-task-complete', sourceTileId: widgetTileId })
        }
      } else {
        const isStagnationGuard = /stagnation guard triggered|directory-crawl stagnation/i.test(msg)
        if (isStagnationGuard) lastStagnationHint = msg
        const isMissingChoicesResponse =
          /invalid completion payload/i.test(msg) ||
          /undefined is not an object \(evaluating 'res\.choices\[0\]'\)/i.test(msg)
        let errorMessageForOutcome = msg
        if (isStagnationGuard) {
          const friendly =
            'Auto-replanned needed: directory exploration is looping. Break work into smaller phase chunks and delegate narrow subtasks before continuing.'
          errorMessageForOutcome = friendly
          appendLog(`[Status] ${friendly}`)
          useToastStore.getState().addToast({
            type: 'warning',
            title: 'Auto-replanned needed',
            message: friendly,
          })
        } else if (isMissingChoicesResponse) {
          const friendly =
            'Orchestrator stopped: the model API returned a non-standard response (missing assistant choices). This is not an Agent Browser tile failure — try another model/provider or retry. Telemetry was recorded when ingestion is enabled.'
          errorMessageForOutcome = friendly
          const completionSchemaCode = /missing choices\[0\]/i.test(msg)
            ? 'missing_choices_response'
            : 'invalid_choices_entry'
          appendLog(`[Error] ${friendly}`)
          appendLog(`[Error] ${msg}`)
          ingestOrchestratorStructuredEvent({
            kind: 'error',
            level: 'error',
            source: 'orchestrator_runtime',
            provider: selected.provider,
            model: selected.name,
            payload: {
              code: completionSchemaCode,
              message: msg,
              promptPreview: truncateString(displayText, 500),
              attachmentsCount: attachments.length,
            },
          })
          useToastStore.getState().addToast({
            type: 'error',
            title: 'Orchestrator failed',
            message: friendly,
          })
        } else {
          appendLog(`[Error] ${msg}`)
          useToastStore.getState().addToast({
            type: 'error',
            title: 'Orchestrator failed',
            message: msg,
          })
        }
        runOutcomeForThisTurn = { kind: 'error', message: errorMessageForOutcome }
        if (rootTaskId) {
          useTodoStore.getState().patchTask(rootTaskId, {
            status: 'failed',
            assignedAgentName: undefined,
          })
        }
        useCanvasStore.getState().updateTile(widgetTileId, { tileStatus: 'error' })
        emitRefreshChangelog({ reason: 'orchestrator-task-complete', sourceTileId: widgetTileId })
      }
    } finally {
      unsubSettings?.()
      unsubSettings = null
      if (get().runGeneration === myGen) {
        if (runOutcomeForThisTurn !== null) {
          set({ lastRunOutcome: runOutcomeForThisTurn })
        }
        flushTelemetryIngestNow()
        setTelemetryRunSession(null)
        setTelemetryRunId(null)
        const pend = get().pendingSubAgentHandoffs
        if (pend.length > 0 && !get().waitingForSubAgents && !resumeFromPendingSubAgentsAfterRun) {
          const merged = mergePendingSubAgentHandoffs(pend)
          set((s) => {
            const sessionMessages = [...s.sessionMessages, { role: 'user' as const, content: merged }]
            void syncConversationToDisk(getDefaultSessionId(), sessionMessages)
            return {
              sessionMessages,
              pendingSubAgentHandoffs: [],
            }
          })
        }
        const wasStopped = get().stopLogged
        /** Defer idle until after paint so the orchestrator panel can render assistant text + code fences while `running` is still true (streaming code blocks). */
        const pendForLater = pend
        const resumeLater = resumeFromPendingSubAgentsAfterRun
        const zaiRestoreLater = shouldRestoreZaiDefaultAfterRun
        scheduleAnimationFrame(() => {
          if (get().runGeneration !== myGen) return
          set({
            running: false,
            abortController: null,
            stopLogged: false,
            planningDraft: null,
            runLockedSelectedModelId: null,
          })
          useOrchestratorActivityStore.getState().resetIdle()
          void flushOrchestratorVaultChatMirror(getDefaultSessionId(), get().sessionMessages)
          void import('../lib/orchestrator/memoryDistiller').then((m) =>
            m.runMemoryDistillerAtSessionEnd({
              sessionId: getDefaultSessionId(),
              lastError:
                runOutcomeForThisTurn?.kind === 'error' ? runOutcomeForThisTurn.message : null,
              stagnationHint: lastStagnationHint,
              messageCount: get().sessionMessages.length,
              aborted: wasStopped || runOutcomeForThisTurn?.kind === 'aborted',
            })
          )
          void import('../lib/orchestrator/userProfileDistiller').then((m) =>
            m.runUserProfileDistillerAtSessionEnd({
              sessionId: getDefaultSessionId(),
              messageCount: get().sessionMessages.length,
              aborted: wasStopped || runOutcomeForThisTurn?.kind === 'aborted',
              runSource: source,
              sessionMessages: get().sessionMessages,
            })
          )
          if (zaiRestoreLater) {
            const latestSettings = useSettingsStore.getState()
            const hasDefault = latestSettings
              .getAvailableModels()
              .some((m) => m.id === ZAI_DEFAULT_MODEL_ID)
            if (hasDefault && latestSettings.selectedModel !== ZAI_DEFAULT_MODEL_ID) {
              latestSettings.setSelectedModel(ZAI_DEFAULT_MODEL_ID)
            }
          }
          void writeSessionMeta(getDefaultSessionId(), {
            incomplete: get().waitingForSubAgents || resumeLater,
          })
          {
            const s = useSettingsStore.getState()
            if (
              s.orcaAutoCompactionEnabled &&
              get().sessionMessages.length >= s.orcaAutoCompactionThreshold
            ) {
              void compactSession(getDefaultSessionId()).catch(() => {})
            }
          }

          if (wasStopped) return
          if (resumeLater && pendForLater.length > 0) {
            const merged = mergePendingSubAgentHandoffs(pendForLater)
            set({ pendingSubAgentHandoffs: [], waitingForSubAgents: false })
            appendLog(
              `[Resume] ${pendForLater.length} sub-agent handoff${pendForLater.length === 1 ? '' : 's'} arrived during the run. Continuing orchestration.`
            )
            void get().run({
              id: nanoid(),
              text: merged,
              attachments: [],
              source: 'sub_agent_handoff',
            })
            return
          }
          const nextQueued = get().queuedInputs[0]
          if (nextQueued) {
            set((prev) => ({ queuedInputs: prev.queuedInputs.slice(1) }))
            const nextText = nextQueued.text.trim() || '(attachment)'
            appendLog(
              `[Dequeued] ${nextText}${nextQueued.attachments.length > 0 ? ` (+${nextQueued.attachments.length} attachment${nextQueued.attachments.length === 1 ? '' : 's'})` : ''}`
            )
            void get().run(nextQueued)
          }
        })
      }
    }
  },

  clearQueue: () => set({ queuedInputs: [], interruptionCheckpoint: null }),

  removeQueuedInput: (id) => {
    set((prev) => ({ queuedInputs: prev.queuedInputs.filter((q) => q.id !== id) }))
  },

  updateQueuedInputText: (id, text) => {
    set((prev) => ({
      queuedInputs: prev.queuedInputs.map((q) => (q.id === id ? { ...q, text } : q)),
    }))
  },

  runQueuedInputNow: (id) => {
    const state = get()
    const idx = state.queuedInputs.findIndex((q) => q.id === id)
    if (idx < 0) return
    const item = state.queuedInputs[idx]
    const preview = item.text.trim() || '(attachment)'
    if (!state.running) {
      set((prev) => ({ queuedInputs: prev.queuedInputs.filter((q) => q.id !== id) }))
      appendLog(`[Queue] Run now: ${preview}`)
      void get().run(item)
      return
    }

    // Cancel the in-flight turn, then run this message. Defer `run` to the next macrotask so the
    // aborted run can unwind (otherwise `run()` would see `running` and reject queue starts).
    set((prev) => ({ queuedInputs: prev.queuedInputs.filter((q) => q.id !== id) }))
    appendLog(`[Queue] Stop & run now: ${preview}`)
    get().stop()
    window.setTimeout(() => {
      void get().run(item)
    }, 0)
  },

  stop: () => {
    /** 1-shot uses session `running` but no session abortController (abort lives on oneShotStore). */
    if (get().running && !get().abortController) {
      void useOneShotStore.getState().cancel().catch(() => {
        /* discard may no-op */
      })
      flushTelemetryIngestNow()
      setTelemetryRunSession(null)
      setTelemetryRunId(null)
      set((s) => ({
        running: false,
        abortController: null,
        stopLogged: true,
        /** Invalidate stale `finally`/rAF cleanup from the aborted turn (model-switch aborts skip this path). */
        runGeneration: s.runGeneration + 1,
      }))
      useOrchestratorActivityStore.getState().resetIdle()
      markOrchestratorWidgetTileIdleIfStuck()
      appendLog('[Cancelled]')
      return
    }
    const c = get().abortController
    if (!c) {
      markOrchestratorWidgetTileIdleIfStuck()
      return
    }
    c.abort()
    flushTelemetryIngestNow()
    setTelemetryRunSession(null)
    setTelemetryRunId(null)
    set((s) => ({
      running: false,
      abortController: null,
      stopLogged: true,
      runGeneration: s.runGeneration + 1,
    }))
    useOrchestratorActivityStore.getState().resetIdle()
    markOrchestratorWidgetTileIdleIfStuck()
    appendLog('[Cancelled]')
  },

  loadSession: async (sessionId) => {
    if (lastHydratedSessionId !== null && sessionId !== lastHydratedSessionId) {
      get().stop()
      set({ input: '', queuedInputs: [], inputAttachments: [] })
    }
    const messages = await loadConversationFromDisk(sessionId)
    resetPersistedMessageCursor(sessionId, messages.length)
    set({ sessionMessages: messages })

    // Rehydrate the visible orchestrator transcript. Without this, reopening
    // the app loads the conversation into the LLM context but leaves the
    // user-facing chat panel blank because it reads from `activityFeed`.
    const transcriptLines: string[] = []
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue
      const text = messageContentText(m).trim()
      if (!text) continue
      if (m.role === 'user') {
        transcriptLines.push(`You · ${text}`)
      } else {
        const t = text.trimStart()
        transcriptLines.push(t.startsWith(ASSISTANT_ACTIVITY_PREFIX) ? text : `${ASSISTANT_ACTIVITY_PREFIX}${text}`)
      }
    }
    const activityStore = useOrchestratorActivityStore.getState()
    const shouldHydrateTranscript =
      sessionId !== lastHydratedSessionId || activityStore.activityFeed.length === 0
    if (shouldHydrateTranscript) {
      activityStore.seedActivityFromMessages(transcriptLines)
      if (transcriptLines.length > 0) {
        activityStore.appendActivityLine(
          `[Resumed] Restored ${messages.length} message${messages.length === 1 ? '' : 's'} from your previous session.`
        )
      }
      lastHydratedSessionId = sessionId
    }

    // Fire-and-forget auto-compaction on load when the transcript has grown
    // past the threshold. Rotates `conversation.jsonl` so the *next* open is
    // fast, writes `summary.md`, and appends a dated digest to `~/.orca/MEMORY.md`
    // so prior context survives rotation as long-term memory.
    try {
      const s = useSettingsStore.getState()
      if (s.orcaAutoCompactionEnabled && messages.length >= s.orcaAutoCompactionThreshold) {
        void compactSession(sessionId).catch(() => {})
      }
    } catch {
      /* ignore */
    }

    void import('../lib/orchestrator/resumePromptOnOpen').then(({ maybeShowResumePromptOnOpen }) => {
      maybeShowResumePromptOnOpen()
    })

    if (!get().running) {
      markOrchestratorWidgetTileIdleIfStuck()
    }
  },

  saveCheckpoint: async () => {
    await syncConversationToDisk(getDefaultSessionId(), get().sessionMessages)
  },

  applyCompactionRotation: async (prefixMessage, keepLastN) => {
    const current = get().sessionMessages
    const keep = Math.max(0, Math.floor(keepLastN))
    const cutIdx = Math.max(0, current.length - keep)
    const tail = current.slice(cutIdx)
    const rebuilt = prefixMessage ? [prefixMessage, ...tail] : tail

    // Only rotate if it actually shrinks the on-disk log. Otherwise skip the
    // archive write (keeps the session folder tidy across idempotent calls).
    if (rebuilt.length >= current.length && !prefixMessage) return

    set({ sessionMessages: rebuilt })
    const sid = getDefaultSessionId()
    try {
      await archiveConversationAndReplace(sid, rebuilt)
    } catch (e) {
      console.warn('[orca] applyCompactionRotation failed', e)
    }
  },
}))

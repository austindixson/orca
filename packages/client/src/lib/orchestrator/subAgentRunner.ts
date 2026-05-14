import {
  HERMES_API_DEFAULT_MODEL,
  HERMES_PROVIDER_MODEL_ID,
  PROVIDER_INFO,
  useSettingsStore,
  type ModelConfig,
} from '../../store/settingsStore'
import {
  resolveSubAgentExecutionModel,
  isOpenRouterFreeRouterModel,
  subAgentErrorSuggestsFreeTierOrGatewayRetry,
  type SubAgentComplexityOverride,
} from './subAgentModelRouting'
import { probeHermesModels } from '../hermes/hermesResponses'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useAgentTaskStore } from '../../store/agentTaskStore'
import { useCanvasStore } from '../../store/canvasStore'
import { resolveApiKey, resolveBaseUrl } from '../llmCredentials'
import { runOrchestratorLeadAware, type OrchestratorActivityPayload } from './runOrchestrator'
import { providerSupportsOrchestratorTools } from './types'
import { emitRefreshChangelog } from '../uiEvents'
import { heuristicResearchIntent } from './researchIntent'
import { loadProjectInstructionsForPrompt } from './orchestratorClaudeMd'
import { loadInstalledSkillsCatalogForOrchestrator } from '../skillCommands'
import { useTodoStore } from '../../store/todoStore'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { useToastStore } from '../../store/toastStore'
import { useGroupChatStore } from '../../store/groupChatStore'
import { parseMentions } from '../groupChat/parseMentions'
import { getDefaultSessionId } from '../persistence/sessionPersistence'
import { ensureGroupChatTile } from './ensureGroupChatTile'
import { createInboxInjector } from './teamChatInbox'
import * as tauri from '../tauri'
import { buildEnvironmentSnapshotForPrompt } from '../harness/envBootstrap'
import { enqueueMergeReview } from '../harness/mergeReviewerPipeline'
import { createIsolatedWorktreeForAgent } from '../harness/isolatedWorktree'
import { nanoid } from 'nanoid'
import { bountyHunterTerminalReplyIsVerified } from './subAgentTerminalVerification'
import { useBugBountyStore } from '../../store/bugBountyStore'

/** If the orchestrator never emits activity (stuck in setup or first LLM call), fail fast instead of leaving "Connecting…". */
const SUBAGENT_STARTUP_TIMEOUT_MS = (() => {
  try {
    const raw = import.meta.env?.VITE_SUBAGENT_STARTUP_TIMEOUT_MS
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 5000) return Math.floor(n)
  } catch {
    /* non-Vite */
  }
  return 180_000
})()

function emitDebugLog(
  runId: string,
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  fetch('http://127.0.0.1:7696/ingest/d871edbc-ff39-4d74-96b8-887cea450cfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'eaa681' },
    body: JSON.stringify({
      sessionId: 'eaa681',
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}

/**
 * When a delegated worker fails, broadcast to the session chat (in addition to handoff).
 */
function postEscalationBroadcast(tileId: string, displayName: string, error: string): void {
  const sessionId = getDefaultSessionId()
  const snippet = error.slice(0, 480) + (error.length > 480 ? '…' : '')
  const body = `@all Task failed — ${displayName}: ${snippet}`
  const mentions = parseMentions(body, {
    agentTeamStore: useAgentTeamStore.getState(),
    senderTileId: tileId,
  })
  useGroupChatStore.getState().postMessage({
    sessionId,
    senderTileId: tileId,
    senderName: displayName,
    body,
    mentions,
  })
  ensureGroupChatTile({ createIfMissing: true, focus: true })
}

/**
 * Whether to retry a sub-agent run with the orchestrator **primary** model after OpenRouter free-router failure.
 * Exported for unit tests and tooling.
 */
export function shouldAttemptSubAgentFreeRouterFallback(
  execModel: ModelConfig,
  primary: ModelConfig,
  err: unknown
): boolean {
  if (primary.id === execModel.id) return false
  if (!isOpenRouterFreeRouterModel(execModel)) return false
  if (!subAgentErrorSuggestsFreeTierOrGatewayRetry(err)) return false
  if (!providerSupportsOrchestratorTools(primary.provider) || primary.supportsTools === false) return false
  return true
}

/** Protocol when this agent may spawn nested sub-agents. */
export function buildLeadDelegationPlaybook(canSpawnNested: boolean): string {
  if (!canSpawnNested) return ''
  return `\n\n**Parallel delegation (recommended for big goals):** Prefer decomposition over doing everything inline.

1) **Group related work** into a few batches by module/area. Each batch should be **one** \`spawn_sub_agent\` call when possible.
2) In each \`task\`, list acceptance criteria and shared context clearly.
3) **Avoid duplicate parallel workers** on the same files. If scope creeps, use \`post_team_message\` with \`@all\` or \`@<name>\` and re-delegate.
4) Use \`wait_for_sub_agent\` when you need another agent's output before you continue.

Stay focused on your own task slice unless you're explicitly coordinating multiple tracks.`
}

function activityToTaskLine(p: OrchestratorActivityPayload): string {
  if (p.kind === 'prepare') return 'Preparing…'
  if (p.kind === 'llm') return `Model round ${p.iteration}…`
  if (p.kind === 'llm_pending') {
    const s = Math.round(p.elapsedMs / 1000)
    return s > 0 ? `Waiting for model… ${s}s` : 'Waiting for model…'
  }
  if (p.kind === 'tools_pending') {
    const s = Math.round(p.elapsedMs / 1000)
    const prog = p.total > 0 ? `${p.completed}/${p.total}` : ''
    const cur = p.currentTool ? ` · ${p.currentTool}` : ''
    return `Running tools${prog ? ` ${prog}` : ''}${cur}${s > 0 ? ` · ${s}s` : ''}`
  }
  return `Tools: ${p.toolNames.join(', ')}`
}

/**
 * Runs a delegated sub-agent in the background (Claude Code–style task spawn).
 * Same tool loop as the main orchestrator; isolated session messages starting from this task only.
 */
export function startSubAgentRun(params: {
  tileId: string
  displayName: string
  role: string
  task: string
  /** When set, todo list shows this sub-agent on that task until the run finishes. */
  linkedTodoId?: string
  /** From `spawn_sub_agent.task_complexity` — `auto` uses heuristics (simple → OpenRouter free when configured). */
  taskComplexity?: SubAgentComplexityOverride
  /** Force the worker runtime. `'hermes'` pins provider to Hermes gateway, skipping OpenRouter fallback. */
  runner?: 'default' | 'hermes'
  /**
   * Hard-pin this sub-agent to a specific model id from `getAvailableModels()`.
   * Bypasses simple/complex routing entirely. Silently ignored if the id is not found
   * or the model is not tools-capable. Used by the bug-bounty hunter pool so parallel
   * hunters don't all hammer the orchestrator's model key (rate-limit relief).
   */
  modelIdOverride?: string | null
  /**
   * Optional runtime metadata for sub-agents that are intentionally not backed by
   * a dedicated canvas tile (e.g. bug-bounty hunters shown only in Agent Team).
   */
  runtimeMeta?: {
    bountyHunterPool?: boolean
    bountyItemId?: string
  }
}): void {
  const ac = new AbortController()
  useAgentTeamStore.getState().setAbortController(params.tileId, ac)
  void runDelegatedSubAgent(params, ac.signal)
}

async function runDelegatedSubAgent(
  params: {
    tileId: string
    displayName: string
    role: string
    task: string
    linkedTodoId?: string
    taskComplexity?: SubAgentComplexityOverride
    runner?: 'default' | 'hermes'
    modelIdOverride?: string | null
    runtimeMeta?: {
      bountyHunterPool?: boolean
      bountyItemId?: string
    }
  },
  signal: AbortSignal
): Promise<void> {
  const { tileId, displayName, role, task, linkedTodoId, taskComplexity, modelIdOverride, runtimeMeta } = params
  const runId = 'subagent-hang'
  // #region agent log
  emitDebugLog(runId, 'H2', 'subAgentRunner.ts:172', 'Sub-agent runner entered', {
    tileId,
    displayName,
    role,
    runner: params.runner === 'hermes' ? 'hermes' : 'default',
    hasLinkedTodo: !!linkedTodoId,
    taskComplexity: taskComplexity ?? 'auto',
  })
  // #endregion
  const runner: 'default' | 'hermes' = params.runner === 'hermes' ? 'hermes' : 'default'
  const resolveBountyRuntimeMeta = (): { bountyHunterPool: boolean; bountyItemId: string | null } => {
    const tileH = useCanvasStore.getState().tiles.get(tileId)
    const meta = tileH?.meta as Record<string, unknown> | undefined
    const bountyItemId =
      typeof runtimeMeta?.bountyItemId === 'string'
        ? runtimeMeta.bountyItemId
        : typeof meta?.bountyItemId === 'string'
          ? meta.bountyItemId
          : null
    const bountyHunterPool =
      runtimeMeta?.bountyHunterPool === true || meta?.bountyHunterPool === true
    return { bountyHunterPool, bountyItemId }
  }
  const clearLinkedTodoEarly = () => {
    if (!linkedTodoId) return
    useTodoStore.getState().patchTask(linkedTodoId, {
      status: 'failed',
      assignedAgentName: undefined,
    })
  }
  const team = useAgentTeamStore.getState()
  team.patchMember(tileId, { status: 'working', currentTask: 'Connecting…' })
  // Record the delegated task so it appears in the agent's task list + team roster.
  useAgentTaskStore.getState().startTask(tileId, task, { source: 'delegated' })

  const startupGuard = {
    /** Browser timers are numeric ids; avoid NodeJS `Timeout` typing from `setTimeout` overloads. */
    timeoutId: null as number | null,
    activityReceived: false,
    timedOut: false,
  }
  const clearSubAgentStartupTimeout = () => {
    if (startupGuard.timeoutId != null) {
      window.clearTimeout(startupGuard.timeoutId)
      startupGuard.timeoutId = null
    }
  }
  const markSubAgentOrchestratorActivityStarted = () => {
    if (startupGuard.activityReceived) return
    startupGuard.activityReceived = true
    clearSubAgentStartupTimeout()
  }
  const armSubAgentStartupTimeout = () => {
    clearSubAgentStartupTimeout()
    startupGuard.timeoutId = window.setTimeout(() => {
      startupGuard.timeoutId = null
      if (startupGuard.activityReceived || startupGuard.timedOut) return
      startupGuard.timedOut = true
      const lastLine = team.membersByTileId[tileId]?.currentTask ?? '(no activity)'
      const err = `Sub-agent failed to start within ${Math.round(SUBAGENT_STARTUP_TIMEOUT_MS / 1000)}s (no run activity). Last UI task line: "${lastLine}". Stop stale workers or check network/API.`
      team.appendAgentLog(tileId, `[Sub-agent] ${err}\n`)
      try {
        const bountyMeta = resolveBountyRuntimeMeta()
        if (bountyMeta.bountyItemId) {
          useBugBountyStore.getState().recordHunterStartupFailure(bountyMeta.bountyItemId)
        }
      } catch {
        /* best-effort */
      }
      try {
        postEscalationBroadcast(tileId, displayName, err)
      } catch {
        /* best-effort */
      }
      team.patchMember(tileId, {
        status: 'error',
        currentTask: 'Startup timed out',
        error: err,
      })
      useCanvasStore.getState().updateTile(tileId, { tileStatus: 'error' })
      useOrchestratorSessionStore.getState().recordSubAgentHandoff({
        displayName,
        role,
        tileId,
        outcome: 'error',
        error: err,
      })
      useAgentTaskStore.getState().finishTask(tileId, 'error', err)
      clearLinkedTodoEarly()
      useAgentTeamStore.getState().abortSubAgent(tileId)
      emitRefreshChangelog({ reason: 'agent-task-complete', sourceTileId: tileId })
    }, SUBAGENT_STARTUP_TIMEOUT_MS)
  }
  armSubAgentStartupTimeout()

  const settings = useSettingsStore.getState()
  const models = settings.getAvailableModels()
  const selectedId = settings.selectedModel

  // Hermes runner: pin the worker to the Hermes gateway regardless of orchestrator selection.
  let selected: ModelConfig
  let primary: ModelConfig
  let routingLog: string

  if (runner === 'hermes') {
    const hermesModelName = settings.hermesModel.trim() || HERMES_API_DEFAULT_MODEL
    const hermesModel: ModelConfig = {
      id: HERMES_PROVIDER_MODEL_ID,
      provider: 'hermes',
      name: hermesModelName,
      displayName: `Hermes (${hermesModelName})`,
      supportsTools: true,
    }

    // Pre-flight probe — no free-router fallback on Hermes workers.
    try {
      const providerCfg = settings.providers.hermes
      const baseRaw = providerCfg?.baseUrl
      const keyRaw = providerCfg?.apiKey
      const probe = await probeHermesModels(
        typeof baseRaw === 'string' && baseRaw ? baseRaw : 'http://127.0.0.1:8642/v1',
        typeof keyRaw === 'string' ? keyRaw : undefined,
        signal
      )
      if (!probe.ok) {
        const err = `Hermes gateway unreachable (${probe.status || 'network'}): ${probe.hint}`
        team.appendAgentLog(tileId, `[Hermes] Probe failed: ${err}\n`)
        team.patchMember(tileId, {
          status: 'error',
          currentTask: 'Hermes unreachable',
          error: err,
        })
        useCanvasStore.getState().updateTile(tileId, { tileStatus: 'error' })
        useOrchestratorSessionStore.getState().recordSubAgentHandoff({
          displayName,
          role,
          tileId,
          outcome: 'error',
          error: err,
        })
        useAgentTaskStore.getState().finishTask(tileId, 'error', err)
        clearLinkedTodoEarly()
        clearSubAgentStartupTimeout()
        return
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      if (signal.aborted) {
        clearSubAgentStartupTimeout()
        if (startupGuard.timedOut) return
        team.patchMember(tileId, { status: 'idle', currentTask: 'Cancelled' })
        useCanvasStore.getState().updateTile(tileId, { tileStatus: 'idle' })
        useAgentTaskStore.getState().finishTask(tileId, 'cancelled')
        clearLinkedTodoEarly()
        return
      }
      team.patchMember(tileId, {
        status: 'error',
        currentTask: 'Hermes probe error',
        error: err,
      })
      useCanvasStore.getState().updateTile(tileId, { tileStatus: 'error' })
      useOrchestratorSessionStore.getState().recordSubAgentHandoff({
        displayName,
        role,
        tileId,
        outcome: 'error',
        error: err,
      })
      useAgentTaskStore.getState().finishTask(tileId, 'error', err)
      clearLinkedTodoEarly()
      clearSubAgentStartupTimeout()
      return
    }

    selected = hermesModel
    primary = hermesModel
    routingLog = `[Routing] runner="hermes" → forcing Hermes gateway (${hermesModelName}); OpenRouter fallback disabled.`
  } else {
    const maybePrimary = models.find((m) => m.id === selectedId) ?? models[0]
    if (!maybePrimary) {
      const err = 'No model selected in Settings.'
      team.patchMember(tileId, {
        status: 'error',
        currentTask: 'No model',
        error: err,
      })
      useCanvasStore.getState().updateTile(tileId, { tileStatus: 'error' })
      useOrchestratorSessionStore.getState().recordSubAgentHandoff({
        displayName,
        role,
        tileId,
        outcome: 'error',
        error: err,
      })
      useAgentTaskStore.getState().finishTask(tileId, 'error', err)
      clearLinkedTodoEarly()
      clearSubAgentStartupTimeout()
      return
    }
    primary = maybePrimary

    const resolveSubAgentOverride = (id: string | null | undefined): ModelConfig | null => {
      if (!id || !id.trim()) return null
      const m = models.find((x) => x.id === id)
      if (!m || m.supportsTools === false) return null
      return m
    }

    const hardPinned = resolveSubAgentOverride(modelIdOverride)

    if (hardPinned) {
      selected = hardPinned
      routingLog = `[Routing] hard-pinned sub-agent model → ${hardPinned.displayName} (${hardPinned.name}) · provider=${hardPinned.provider} (bypass routing)`
    } else {
      const pick = await resolveSubAgentExecutionModel({
        primary,
        models,
        task,
        role,
        taskComplexity,
        getActiveProviders: () => settings.getActiveProviders(),
        openRouterUiKey: settings.providers.openrouter.apiKey,
        simpleModelOverride: resolveSubAgentOverride(settings.subAgentSimpleModelId),
        complexModelOverride: resolveSubAgentOverride(settings.subAgentComplexModelId),
      })
      selected = pick.model
      routingLog = pick.routingLog
    }
    if (startupGuard.timedOut) return
  }
  if (startupGuard.timedOut) return
  team.patchMember(tileId, { currentTask: 'Model resolved…' })
  if (!providerSupportsOrchestratorTools(selected.provider) || selected.supportsTools === false) {
    const err = 'Pick a tools-capable model in Settings.'
    team.patchMember(tileId, {
      status: 'error',
      currentTask: 'Unsupported model',
      error: err,
    })
    useCanvasStore.getState().updateTile(tileId, { tileStatus: 'error' })
    useOrchestratorSessionStore.getState().recordSubAgentHandoff({
      displayName,
      role,
      tileId,
      outcome: 'error',
      error: err,
    })
    useAgentTaskStore.getState().finishTask(tileId, 'error', err)
    clearLinkedTodoEarly()
    clearSubAgentStartupTimeout()
    return
  }


  async function resolveKeyAndBaseFor(exec: typeof selected) {
    const providerConfig = settings.providers[exec.provider]
    const apiKey = await resolveApiKey(exec.provider, providerConfig.apiKey)
    if (!apiKey && PROVIDER_INFO[exec.provider].requiresKey) {
      throw new Error(`Set ${PROVIDER_INFO[exec.provider].name} in Settings.`)
    }
    const baseUrl = await resolveBaseUrl(exec.provider, providerConfig.baseUrl)
    return { apiKey, baseUrl }
  }

  let apiKey: string | undefined
  let baseUrl: string | undefined
  try {
    const kb = await resolveKeyAndBaseFor(selected)
    apiKey = kb.apiKey
    baseUrl = kb.baseUrl
    // #region agent log
    emitDebugLog(runId, 'H3', 'subAgentRunner.ts:349', 'Sub-agent credentials resolved', {
      tileId,
      provider: selected.provider,
      model: selected.name,
      hasApiKey: !!apiKey,
      hasBaseUrl: !!baseUrl,
    })
    // #endregion
    team.patchMember(tileId, { currentTask: 'Preparing workspace…' })
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    // #region agent log
    emitDebugLog(runId, 'H3', 'subAgentRunner.ts:359', 'Sub-agent credential resolution failed', {
      tileId,
      provider: selected.provider,
      model: selected.name,
      error: err.slice(0, 260),
    })
    // #endregion
    team.patchMember(tileId, {
      status: 'error',
      currentTask: 'API key required',
      error: err,
    })
    useCanvasStore.getState().updateTile(tileId, { tileStatus: 'error' })
    useOrchestratorSessionStore.getState().recordSubAgentHandoff({
      displayName,
      role,
      tileId,
      outcome: 'error',
      error: err,
    })
    useAgentTaskStore.getState().finishTask(tileId, 'error', err)
    clearLinkedTodoEarly()
    clearSubAgentStartupTimeout()
    return
  }

  let isolatedWt: { absolutePath: string; branch: string; relativePath: string } | null = null
  if (useSettingsStore.getState().harnessSubAgentAutoWorktree && tauri.isTauri()) {
    const gitSnap = await tauri.getGitChangelogSnapshot()
    if (startupGuard.timedOut) return
    if (gitSnap && gitSnap.is_repo === false) {
      team.appendAgentLog(
        tileId,
        '[Worktree] Skipped — workspace root is not a git repository (no `.git`). Isolated worktrees require a git checkout. Fix: run `git init` here, open a cloned repo, or turn off **Isolated worktree for sub-agents** in Settings → Agent data.\n'
      )
      useToastStore.getState().addToast({
        type: 'warning',
        title: 'Sub-agent worktree skipped',
        message: 'Not a git repository — worker uses the main workspace. Disable isolated worktrees in Settings if you do not use git.',
      })
      const tileSkip = useCanvasStore.getState().tiles.get(tileId)
      const prevSkip =
        tileSkip?.meta && typeof tileSkip.meta === 'object' && tileSkip.meta !== null
          ? { ...(tileSkip.meta as Record<string, unknown>) }
          : {}
      useCanvasStore.getState().updateTile(tileId, {
        meta: { ...prevSkip, subAgentWorktreeSkipped: 'no_git_repo' },
      })
    } else {
      try {
        isolatedWt = await createIsolatedWorktreeForAgent(tileId)
        if (startupGuard.timedOut) return
        if (isolatedWt) {
          const tile = useCanvasStore.getState().tiles.get(tileId)
          const prevMeta =
            tile?.meta && typeof tile.meta === 'object' && tile.meta !== null
              ? { ...(tile.meta as Record<string, unknown>) }
              : {}
          delete prevMeta.subAgentWorktreeSkipped
          delete prevMeta.subAgentWorktreeError
          useCanvasStore.getState().updateTile(tileId, {
            meta: {
              ...prevMeta,
              isolatedWorktreePath: isolatedWt.absolutePath,
              isolatedWorktreeRelative: isolatedWt.relativePath,
              isolatedWorktreeBranch: isolatedWt.branch,
            },
          })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        team.appendAgentLog(tileId, `[Worktree] Error: ${msg.slice(0, 480)}${msg.length > 480 ? '…' : ''}\n`)
        useToastStore.getState().addToast({
          type: 'warning',
          title: 'Git worktree failed',
          message: msg.slice(0, 220) + (msg.length > 220 ? '…' : ''),
        })
        const tileErr = useCanvasStore.getState().tiles.get(tileId)
        const prevErr =
          tileErr?.meta && typeof tileErr.meta === 'object' && tileErr.meta !== null
            ? { ...(tileErr.meta as Record<string, unknown>) }
            : {}
        useCanvasStore.getState().updateTile(tileId, {
          meta: { ...prevErr, subAgentWorktreeError: msg.slice(0, 400) },
        })
      }
    }
  }

  if (startupGuard.timedOut) return

  const compact = useSettingsStore.getState().harnessSubAgentCompactContext === true
  const wtBlock =
    isolatedWt === null
      ? ''
      : compact
        ? `\n\n(Isolated worktree: \`${isolatedWt.relativePath}\`, branch \`${isolatedWt.branch}\`. File tools \`read_file\` / \`write_file\` / \`list_directory\` / \`delete_file\` use paths relative to this worktree automatically. For shell commands, \`cd\` into that folder when you need the checkout on disk.)\n`
        : `\n\n### Isolated git worktree\nA dedicated checkout exists at **${isolatedWt.relativePath}** (branch \`${isolatedWt.branch}\`). **File tools** (\`read_file\`, \`write_file\`, \`list_directory\`, \`delete_file\`) resolve workspace-relative paths inside this worktree — use normal paths like \`src/...\` without prefixing the worktree folder. For **terminal** commands that need the checkout directory, \`cd\` into \`${isolatedWt.relativePath}\` first.\n`

  const canSpawnNested = true

  const leadDelegationPlaybook = buildLeadDelegationPlaybook(canSpawnNested)
  const nestedSpawnBlock =
    runner === 'hermes'
      ? `\n\n**Nested delegation:** You may call \`spawn_sub_agent\` to recruit helpers (subject to max concurrent sub-agents). For Hermes gateway workers pass \`runner:"hermes"\`. Handoffs appear under "── Nested handoff ──". Use \`wait_for_sub_agent({ tile_id })\` when you need a helper's summary as direct input.`
      : `\n\n**Nested delegation:** You may call \`spawn_sub_agent\` to recruit helpers. Handoffs appear under "── Nested handoff ──". Use \`wait_for_sub_agent\` when you need synchronous follow-up.`

  const workerEscalationBlock = `\n\n**Coordination:** Use \`post_team_message\` with \`@all\` or \`@<displayName>\` for blockers and cross-agent updates before you stop — do not fail silently.`
  const activeWorkerCount = Object.values(useAgentTeamStore.getState().membersByTileId).filter(
    (m) => m.status === 'working'
  ).length
  const teamChatHeartbeatBlock =
    activeWorkerCount > 1
      ? `\n\n**Team chat heartbeat (required while multiple agents are active):** After every completed task/subtask, call \`post_team_message\` to \`@all\` with a short update: what was completed, what is next, and any blocker.`
      : ''

  const orcaReplyBlock = `\n\n**Shell handoff (optional):** If you complete work in an external shell (e.g. Hermes CLI), run \`orca reply "<one-paragraph summary>"\` so the lead orchestrator receives the result. \`ORCA_PARENT_TILE_ID\` and \`ORCA_PARENT_SESSION_ID\` may be set in the environment when Orca spawns a gateway terminal.`
  const userMessage = compact
    ? `**${displayName}** (${role})\n\n${task}${wtBlock}${leadDelegationPlaybook}${nestedSpawnBlock}${workerEscalationBlock}${teamChatHeartbeatBlock}${orcaReplyBlock}\n\nReply with a short plain-text summary when done.`
    : `You are **${displayName}**, sub-agent role: **${role}**.

Work in the shared workspace and canvas like the main orchestrator. Stay focused only on the task below; other agents may be running in parallel — avoid conflicting edits when possible.

### Task
${task}${wtBlock}${leadDelegationPlaybook}${nestedSpawnBlock}${workerEscalationBlock}${teamChatHeartbeatBlock}${orcaReplyBlock}
When finished, end with a short plain-text summary (no JSON).`

  team.appendAgentLog(tileId, `\n── Sub-agent ${displayName} (${role}) ──\n`)
  if (isolatedWt) {
    team.appendAgentLog(
      tileId,
      `[Worktree] ${isolatedWt.relativePath} (branch ${isolatedWt.branch})\n`
    )
  }

  team.patchMember(tileId, {
    executionModelLabel: `${selected.displayName} (${selected.name})`,
    executionProvider: selected.provider,
    executionModelIsFree: selected.isFree === true,
    executionModelSupportsImages: selected.supportsImages === true,
    currentTask: 'Preparing context…',
  })

  try {
    team.appendAgentLog(tileId, `${routingLog}\n`)
    const [projectInstructions, installedSkillsCatalog] = await Promise.all([
      loadProjectInstructionsForPrompt(),
      loadInstalledSkillsCatalogForOrchestrator(),
    ])
    if (startupGuard.timedOut) return

    const wsPath = (await tauri.getWorkspace())?.path ?? '.'
    const envSnap = await buildEnvironmentSnapshotForPrompt(wsPath)
    if (startupGuard.timedOut) return
    let graphBlock = ''
    try {
      const graphMd = await tauri.readFile('GRAPH_REPORT.md')
      if (graphMd?.trim()) {
        graphBlock =
          graphMd.length > 8000
            ? `${graphMd.slice(0, 8000)}\n\n… (truncated)\n`
            : `${graphMd}\n`
        graphBlock = `### Codebase graph (GRAPH_REPORT.md)\n${graphBlock}\n`
      }
    } catch {
      /* optional — graphify not run */
    }
    if (startupGuard.timedOut) return
    const userMessageWithEnv = `${envSnap}\n\n${graphBlock}${userMessage}`

    const runWithSelectedModel = async (exec: typeof selected) => {
      // #region agent log
      emitDebugLog(runId, 'H5', 'subAgentRunner.ts:513', 'Sub-agent model execution started', {
        tileId,
        provider: exec.provider,
        model: exec.name,
      })
      // #endregion
      return runOrchestratorLeadAware({
        provider: exec.provider,
        model: exec.name,
        apiKey,
        baseUrl,
        modelDisplayLabel: `${exec.displayName} (${exec.name})`,
        messages: [],
        userMessage: userMessageWithEnv,
        orchestratorTileId: tileId,
        runGeneration: useOrchestratorSessionStore.getState().runGeneration,
        subAgentTileId: tileId,
        /** Sub-agents must keep full tools; lead delegation applies only to the main session. */
        leadDelegationOnly: false,
        ...(canSpawnNested
          ? {
              executionContract: {
                label: 'Lead delegation protocol',
                completionConditions: [
                  'Decompose assigned work into focused worker tracks before heavy direct implementation.',
                  'Group tasks into batches by module/area so each worker owns multiple related tasks; do not spawn one worker per task or duplicate workers on the same batch.',
                  'Spawn at least one worker for multi-step work, then coordinate results and retries.',
                  'Summarize worker outcomes and remaining blockers for the orchestrator.',
                ],
                verificationSteps: [
                  'Confirm each spawned worker lists its full batch of tasks (not a single task) and that batches do not overlap.',
                  'Confirm worker tasks include clear acceptance criteria.',
                  'Use wait_for_sub_agent for dependency-critical tracks.',
                ],
              },
            }
          : {}),
        signal,
        researchMode: heuristicResearchIntent(task),
        projectInstructions,
        installedSkillsCatalog: installedSkillsCatalog || null,
        onLog: (line) => {
          useAgentTeamStore.getState().appendAgentLog(tileId, line)
        },
        onAssistantReply: (text) => {
          useAgentTeamStore.getState().appendAgentLog(tileId, `${text}\n`)
        },
        onActivity: (p) => {
          markSubAgentOrchestratorActivityStarted()
          useAgentTeamStore.getState().patchMember(tileId, {
            currentTask: activityToTaskLine(p),
          })
        },
        injectUserMessageBeforeRound: createInboxInjector(getDefaultSessionId(), tileId),
      })
    }

    if (startupGuard.timedOut) return
    team.patchMember(tileId, { currentTask: 'Starting run…' })

    let result
    try {
      result = await runWithSelectedModel(selected)
    } catch (firstErr) {
      // Hermes runner never falls back — surface the gateway failure directly.
      if (runner === 'hermes') {
        throw firstErr
      }
      if (!shouldAttemptSubAgentFreeRouterFallback(selected, primary, firstErr)) {
        throw firstErr
      }

      const hint = firstErr instanceof Error ? firstErr.message : String(firstErr)
      team.appendAgentLog(
        tileId,
        `[Routing] Retrying once with ${primary.displayName} (${primary.name}) — free/OpenRouter path failed: ${hint.slice(0, 320)}${hint.length > 320 ? '…' : ''}\n`
      )
      selected = primary
      try {
        const kb = await resolveKeyAndBaseFor(selected)
        apiKey = kb.apiKey
        baseUrl = kb.baseUrl
      } catch {
        throw firstErr
      }
      if (!apiKey && PROVIDER_INFO[selected.provider].requiresKey) {
        throw firstErr
      }
      team.patchMember(tileId, {
        executionModelLabel: `${selected.displayName} (${selected.name})`,
        executionProvider: selected.provider,
        executionModelIsFree: selected.isFree === true,
        executionModelSupportsImages: selected.supportsImages === true,
      })
      result = await runWithSelectedModel(selected)
    }

    clearSubAgentStartupTimeout()
    const summary = result.assistantText.trim()
    // #region agent log
    emitDebugLog(runId, 'H2', 'subAgentRunner.ts:602', 'Sub-agent finished successfully', {
      tileId,
      summaryLength: summary.length,
    })
    // #endregion

    const bountyMeta = resolveBountyRuntimeMeta()
    const isBountyHunter = bountyMeta.bountyHunterPool
    const verificationFailed = isBountyHunter && !bountyHunterTerminalReplyIsVerified(summary)

    if (verificationFailed) {
      const warn =
        '[NEEDS REVIEW] Close with `terminal_verified: {"tile_id":"<terminal_tile_id>","exit_code":0}` (from get_last_terminal_command / wait_for_terminal_command) or explicit `status: failed` + exit_code when the command did not succeed.'
      team.appendAgentLog(tileId, `${warn}\n`)
      useAgentTeamStore.getState().patchMember(tileId, {
        status: 'needs_review',
        currentTask: 'Needs review (terminal proof)',
        lastSummary: `${warn}\n\n${summary}`,
      })
      useCanvasStore.getState().updateTile(tileId, { tileStatus: 'warning' })
      useAgentTeamStore.getState().setAbortController(tileId, null)
      useOrchestratorSessionStore.getState().recordSubAgentHandoff({
        displayName,
        role,
        tileId,
        outcome: 'done',
        summary: `${warn}\n\n${summary}`,
      })
      useAgentTaskStore.getState().finishTask(tileId, 'done')
      if (linkedTodoId) {
        useTodoStore.getState().patchTask(linkedTodoId, {
          status: 'completed',
          assignedAgentName: undefined,
        })
      }
      emitRefreshChangelog({ reason: 'agent-task-complete', sourceTileId: tileId })
      useOrchestratorActivityStore.getState().appendActivityLine(
        `[Sub-agent] "${displayName}" finished without terminal verification — marked needs review.`
      )
      const bid = bountyMeta.bountyItemId
      if (bid) {
        useBugBountyStore.getState().patchBounty(bid, {
          status: 'queued',
          delegatedSubAgentTileId: undefined,
          resolutionNote:
            'Hunter reply lacked terminal_verified — re-queued; use get_last_terminal_command / wait_for_terminal_command on the terminal tile.',
        })
      }
      return
    }

    useAgentTeamStore.getState().patchMember(tileId, {
      status: 'done',
      currentTask: 'Done',
      lastSummary: summary,
    })
    useCanvasStore.getState().updateTile(tileId, { tileStatus: 'done' })
    useAgentTeamStore.getState().setAbortController(tileId, null)
    useOrchestratorSessionStore.getState().recordSubAgentHandoff({
      displayName,
      role,
      tileId,
      outcome: 'done',
      summary,
    })
    useAgentTaskStore.getState().finishTask(tileId, 'done')
    if (linkedTodoId) {
      useTodoStore.getState().patchTask(linkedTodoId, {
        status: 'completed',
        assignedAgentName: undefined,
      })
    }
    emitRefreshChangelog({ reason: 'agent-task-complete', sourceTileId: tileId })
    const agentTile = useCanvasStore.getState().tiles.get(tileId)
    const meta =
      agentTile?.meta && typeof agentTile.meta === 'object'
        ? (agentTile.meta as Record<string, unknown>)
        : null
    const sourceBranch =
      typeof meta?.isolatedWorktreeBranch === 'string' ? meta.isolatedWorktreeBranch.trim() : null
    enqueueMergeReview({
      id: nanoid(),
      agentTileId: tileId,
      notes: summary.slice(0, 2000),
      sourceBranch: sourceBranch || undefined,
    })
  } catch (e) {
    clearSubAgentStartupTimeout()
    if (startupGuard.timedOut) {
      useAgentTeamStore.getState().setAbortController(tileId, null)
      emitRefreshChangelog({ reason: 'agent-task-complete', sourceTileId: tileId })
      return
    }
    const name = e instanceof Error ? e.name : ''
    if (name === 'AbortError') {
      useAgentTeamStore.getState().patchMember(tileId, {
        status: 'idle',
        currentTask: 'Cancelled',
      })
      useCanvasStore.getState().updateTile(tileId, { tileStatus: 'idle' })
      useOrchestratorSessionStore.getState().recordSubAgentHandoff({
        displayName,
        role,
        tileId,
        outcome: 'cancelled',
      })
      useAgentTaskStore.getState().finishTask(tileId, 'cancelled')
      if (linkedTodoId) {
        useTodoStore.getState().patchTask(linkedTodoId, {
          status: 'cancelled',
          assignedAgentName: undefined,
        })
      }
    } else {
      const msg = e instanceof Error ? e.message : String(e)
      // #region agent log
      emitDebugLog(runId, 'H2', 'subAgentRunner.ts:662', 'Sub-agent run failed', {
        tileId,
        error: msg.slice(0, 320),
      })
      // #endregion
      try {
        postEscalationBroadcast(tileId, displayName, msg)
      } catch {
        /* best-effort chat notify */
      }
      useAgentTeamStore.getState().patchMember(tileId, {
        status: 'error',
        currentTask: 'Failed',
        error: msg,
      })
      useCanvasStore.getState().updateTile(tileId, { tileStatus: 'error' })
      useOrchestratorSessionStore.getState().recordSubAgentHandoff({
        displayName,
        role,
        tileId,
        outcome: 'error',
        error: msg,
      })
      useAgentTaskStore.getState().finishTask(tileId, 'error', msg)
      if (linkedTodoId) {
        useTodoStore.getState().patchTask(linkedTodoId, {
          status: 'failed',
          assignedAgentName: undefined,
        })
      }
    }
    useAgentTeamStore.getState().setAbortController(tileId, null)
    emitRefreshChangelog({ reason: 'agent-task-complete', sourceTileId: tileId })
  }
}

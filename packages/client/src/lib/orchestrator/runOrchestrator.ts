import * as tauri from '../tauri'
import {
  chatCompletionWithTools,
  emitZaiOpenRouterFallbackNotice,
  orchestratorChatOptionsFromStore,
  readOpenRouterFallbackConfigForZaiRateLimit,
} from './chatCompletion'
import {
  getEffectiveOpenRouterModel,
  tryActivateOpenRouterRateLimitFallback,
} from './openrouterRateLimitFallback'
import {
  isOrchestratorToolReplyQuarantined,
  noteOrchestratorEmptyToolReplyFailure,
} from './orchestratorToolReplyHealth'
import {
  ORCHESTRATOR_DEFAULT_MAX_ESTIMATED_CONTEXT_TOKENS,
  ORCHESTRATOR_DEFAULT_MAX_ITERATIONS,
  ORCHESTRATOR_DEFAULT_PARALLEL_TOOLS,
  ORCHESTRATOR_DEFAULT_MAX_WALL_CLOCK_MS,
  ORCHESTRATOR_HARD_MAX_ITERATIONS,
} from './orchestratorConstants'
import { paceOrchestratorLlmRound, resetOrchestratorPaceClock } from './orchestratorLlmPacing'
import { getZaiQueueStats } from './orchestratorZaiQueue'
import { shouldUseParallelToolCallsInApi } from './orchestratorModelHints'
import {
  evaluateDirectoryStagnation,
  INITIAL_DIRECTORY_STAGNATION_STATE,
} from './orchestratorStagnationGuard'
import { SHELL_ROUTING_PROMPT_SNIPPET } from '../terminal/shellRouter'
import { throwIfAborted } from './abortable'
import { executeAssistantToolCalls } from './orchestratorToolBatch'
import { stripAssistantToolArtifacts } from './stripAssistantToolArtifacts'
import type {
  ChatCompletionResponse,
  ChatMessage,
  OrchestratorModelContext,
  ToolCall,
  UserMessageContent,
} from './types'
import { providerSupportsOrchestratorTools } from './types'
import {
  PROVIDER_INFO,
  providerAllowsEmptyApiKey,
  useSettingsStore,
  type Provider,
} from '../../store/settingsStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { getHarnessAblationFlags, type HarnessAblationFlags } from './orchestratorAblation'
import {
  EMPTY_EXECUTION_CONTRACT,
  executionContractIsMeaningful,
  formatExecutionContractForPrompt,
  mergeExecutionContract,
  type ExecutionContract,
} from './orchestratorExecutionContract'
import {
  LEAD_ORCHESTRATOR_TOOL_ALLOWLIST,
  filterOrchestratorToolsByAllowlist,
  filterOrchestratorToolsForHermesAgentTileSetting,
} from './orchestratorToolFilter'
import { appendHarnessTraceLine, type HarnessTraceLineInput } from './orchestratorTraceAccumulator'
import {
  buildLlmRoundMetaTrace,
  prepareArgsForHarnessTrace,
  prepareResultForHarnessTrace,
} from '../harness/harnessDiagnosticTrace'
import { applyCompactionHierarchy, DEFAULT_MAX_WORKING_CHARS } from '../harness/compactionHierarchy'
import { classifyOrchestratorError } from './orchestratorErrorTaxonomy'
import type { OrchestratorStreamEvent } from './orchestratorStreamTypes'
import {
  mirrorOrchestratorErrorToVault,
  mirrorOrchestratorSessionToVault,
} from '../vault/vaultBrainMirror'
import {
  loadLongTermMemoryForSystemPrompt,
  loadUserProfileForSystemPrompt,
  buildRecurringIssueBlock,
} from './orcaMemory'
import {
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  buildDynamicPromptPreface,
  type OrchestratorRunContext,
} from './orchestratorPromptLayers'
import { buildActiveHarnessCandidatePromptBlock } from './harnessCandidates'
import { getAutoCompactionSystemPromptBlock } from '../persistence/sessionCompaction'
import { getMessengerIntegrationsPromptBlock } from './prompts/messengerIntegrationsPrompt'
import { ingestOrchestratorStructuredEvent } from '../devTelemetryIngest'
import { buildDelegatedJudgmentPromptBlock } from './orchestratorAutonomyPolicy'
import { buildBehaviorReflexTurnGuard } from './orchestratorBehaviorPolicy'

/** Raw harness events for `.agent-canvas/harness/traces` (optional). */
export type HarnessTracePayload =
  | {
      kind: 'run_start'
      scopeLevel?: string
      attemptIndex?: number
      /** Tools actually registered for this attempt (sorted); proves trace scope matches API allowlist. */
      allowlistToolCount?: number
      allowlistToolsSorted?: string[]
    }
  | { kind: 'llm_round'; iteration: number }
  | { kind: 'tool_batch'; toolNames: string[] }
  | { kind: 'run_end'; ok: boolean; error?: string }

export function buildWorkflowTraceCustomEvent(
  traceContext: Record<string, unknown> | null | undefined,
  ts: number
): HarnessTraceLineInput | null {
  if (!traceContext || typeof traceContext !== 'object') return null
  return {
    kind: 'custom',
    ts,
    label: 'workflow_trace_context',
    payload: traceContext,
  }
}

/** UI hooks for claw-code–style status verbs — short labels while the model or tools are active. */
export type OrchestratorActivityPayload =
  /** Before workspace prompt is built — avoids a dead “Planning” screen during `getWorkspace`. */
  | { kind: 'prepare' }
  | { kind: 'llm'; iteration: number }
  /** Fires ~2×/s while the HTTP chat request is in flight (elapsed suffix only — base verb is event-driven). */
  | { kind: 'llm_pending'; iteration: number; elapsedMs: number }
  | { kind: 'tools'; iteration: number; toolNames: string[] }
  /** While tool handlers run (after the model returned tool_calls) — elapsed + optional progress. */
  | {
      kind: 'tools_pending'
      iteration: number
      toolNames: string[]
      elapsedMs: number
      completed: number
      total: number
      currentTool?: string
    }

function summarizeCompletionShape(res: unknown): string {
  if (!res || typeof res !== 'object') return `type=${typeof res}`
  const obj = res as Record<string, unknown>
  const keys = Object.keys(obj).slice(0, 8)
  const choices = obj.choices
  const choicesType = Array.isArray(choices) ? `array(${choices.length})` : typeof choices
  const keyPart = keys.length > 0 ? `keys=${keys.join(',')}` : 'keys=(none)'
  return `${keyPart}; choices=${choicesType}`
}

const CONTINUATION_USER_TURN =
  '[Orca continuation] Continue from the latest tool outputs and prior context. If work remains, call the next tool(s). If complete, return the final answer.'

/**
 * Defensive invariant: provider requests must always include at least one user turn.
 *
 * Compaction + long tool loops can theoretically leave a working set with only
 * system/assistant/tool roles. Injecting a synthetic continuation user turn
 * avoids provider 400s like "No user message found in input".
 */
export function ensureWorkingSetHasUserMessage(messages: ChatMessage[]): ChatMessage[] {
  if (messages.some((m) => m.role === 'user')) return messages
  return [
    ...messages,
    {
      role: 'user',
      content: CONTINUATION_USER_TURN,
    },
  ]
}

/**
 * Guard against silent "success" responses that contain no user-facing text.
 *
 * Invariant: if the orchestrator has already executed one or more tool batches,
 * final success requires non-empty assistant content.
 */
export function shouldRejectEmptyTerminalAssistantMessage(params: {
  textOnly: string
  toolBatchCount: number
  iterations: number
  introRound: boolean
}): boolean {
  const empty = params.textOnly.trim().length === 0
  if (!empty) return false
  if (params.introRound) return false
  if (params.toolBatchCount > 0) return true
  if (params.iterations >= 1) return true
  return false
}

/**
 * Lead mode guard: avoid returning a plan-only assistant message before any delegated work starts.
 *
 * Invariant: main lead orchestrator (`leadDelegationOnly`) should execute at least one tool batch
 * (typically `spawn_sub_agent`) before terminal success, unless this is already a worker tile.
 */
export function shouldNudgeLeadDelegationBeforeTerminalReply(params: {
  leadDelegationOnly?: boolean
  subAgentTileId?: string
  introRound: boolean
  toolBatchCount: number
  textOnly: string
  alreadyRetried: boolean
}): boolean {
  if (params.leadDelegationOnly !== true) return false
  if (params.subAgentTileId) return false
  if (params.introRound) return false
  if (params.toolBatchCount > 0) return false
  if (params.alreadyRetried) return false
  if (!params.textOnly.trim()) return false
  return true
}

/**
 * Hermes direct-mode runs can emit a terminal gate prompt that requires the user to type
 * "approved" even when the user already asked us to proceed. Detect that exact pattern so
 * the loop can auto-continue without a manual round-trip.
 */
export function shouldAutoApproveHermesTerminalSecurityGate(textOnly: string): boolean {
  const text = textOnly.trim().toLowerCase()
  if (!text) return false
  const hasGateStatus = text.includes('approval_required') || text.includes('terminal security gate')
  if (!hasGateStatus) return false
  const asksForApproved =
    text.includes('reply "approved"') ||
    text.includes("reply 'approved'") ||
    text.includes('reply approved') ||
    text.includes('type "approved"') ||
    text.includes('type approved')
  return asksForApproved
}

export function estimateContextTokensFromWorkingSet(messages: ChatMessage[]): number {
  try {
    return Math.max(0, Math.round(JSON.stringify(messages).length / 4))
  } catch {
    return 0
  }
}

export function checkRunBudgetExceeded(params: {
  startedAtMs: number
  nowMs: number
  maxWallClockMs: number
  estimatedContextTokens: number
  maxEstimatedContextTokens: number
}): { exceeded: boolean; reason?: string } {
  const elapsed = Math.max(0, params.nowMs - params.startedAtMs)
  if (elapsed > Math.max(1, params.maxWallClockMs)) {
    return {
      exceeded: true,
      reason: `wall-clock budget exceeded (${elapsed}ms > ${params.maxWallClockMs}ms)`,
    }
  }
  if (params.estimatedContextTokens > Math.max(1, params.maxEstimatedContextTokens)) {
    return {
      exceeded: true,
      reason:
        `estimated context budget exceeded (${params.estimatedContextTokens} > ${params.maxEstimatedContextTokens})`,
    }
  }
  return { exceeded: false }
}

const PROJECT_SCOPED_REQUEST_RE =
  /\b(analy[sz]e|inspect|audit|review|scan|understand|summari[sz]e)\b[\s\S]{0,40}\b(my|this|the)\b[\s\S]{0,20}\b(project|repo|repository|codebase)\b/i

const PLAN_ONLY_REQUEST_RE =
  /\b(plan\s*[- ]?only|analysis\s*only|read\s*[- ]?only|do\s+not\s+modify|don't\s+modify|no\s+changes?|no\s+edits?)\b/i

const PLAN_ONLY_MUTATING_TOOL_RE =
  /^(write_file|patch|run_shell_command|spawn_sub_agent|send_message|memory|skill_manage|cronjob|todo|browser_(open|click|fill|press|scroll|type)|delete_|remove_|create_)/i

export function shouldForceWorkspaceScopeForRequest(userMessage: string): boolean {
  return PROJECT_SCOPED_REQUEST_RE.test(userMessage.trim())
}

export function isPlanOnlyRequest(userMessage: string): boolean {
  return PLAN_ONLY_REQUEST_RE.test(userMessage.trim())
}

export function isPlanOnlyDisallowedTool(toolName: string): boolean {
  const name = toolName.trim()
  if (!name) return false
  return PLAN_ONLY_MUTATING_TOOL_RE.test(name)
}

export function resolveEffectiveWorkspaceRootForRun(workspaceRoot: string | null | undefined): string | null {
  const runRoot = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : ''
  if (runRoot && runRoot !== '.') return runRoot
  const storeRoot = useWorkspaceStore.getState().rootPath
  if (storeRoot && storeRoot !== '.') return storeRoot
  return null
}

export function buildWorkspaceScopeTurnGuard(
  userMessage: string,
  workspaceRoot: string | null | undefined
): string | null {
  if (!shouldForceWorkspaceScopeForRequest(userMessage)) return null
  const root = resolveEffectiveWorkspaceRootForRun(workspaceRoot)
  if (!root) return null
  return [
    '[Workspace scope override — highest priority for this turn]',
    `Active workspace root: ${root}`,
    'Treat this as the ONLY project boundary for project-scoped analysis.',
    'Use path="." (or the exact root above) for initial file/search steps.',
    'Do NOT probe sibling/parent/home folders unless the user explicitly requests that path.',
  ].join('\n')
}

export function pickAssistantChoiceOrThrow(
  res: ChatCompletionResponse
): ChatCompletionResponse['choices'][number] {
  const rawChoices = (res as unknown as { choices?: unknown }).choices
  if (!Array.isArray(rawChoices) || rawChoices.length === 0) {
    throw new Error(
      `Invalid completion payload: missing choices[0]. ${summarizeCompletionShape(res)}`
    )
  }
  const first = rawChoices[0]
  if (!first || typeof first !== 'object') {
    throw new Error(
      `Invalid completion payload: choices[0] is not an object. ${summarizeCompletionShape(res)}`
    )
  }
  return first as ChatCompletionResponse['choices'][number]
}

function buildLeadDelegationSystemPrompt(
  root: string,
  remotionOutputDir: string,
  modelLine: string,
  projectBlock: string,
  skillsCatalogBlock: string,
  longTermMemoryBlock: string,
  userProfileBlock: string,
  recurringIssueBlock: string,
  activeCandidateBlock: string,
  autoCompactionBlock: string,
  dynamicPreface: string,
  opts?: {
    researchMode?: boolean
    textOnlyFirstTurn?: boolean
    visionWithoutDecomposition?: boolean
    /** When false (Settings → Agent → Hermes), omit Hermes runners, tiles, and gateway tools from instructions. */
    hermesAgentTileEnabled?: boolean
  }
): string {
  const hermesAgentTileEnabled = opts?.hermesAgentTileEnabled !== false
  const turnOrderBlock =
    opts?.textOnlyFirstTurn === true
      ? `

**Turn order (lead):** Your **first** assistant message must be **text only** (no tools) — this is what the **user reads** first. Reply **directly** to them: short, warm acknowledgment they’re heard (e.g. “Hey — I’ll get started on that for you.”). **1–3 sentences.** **Do not** narrate delegation (“I’ll delegate to Mei…”, “I’ll spawn a worker…”), explain the specialist roster, or paste implementation checklists into chat — **put all of that only inside \`spawn_sub_agent\` \`task\` strings**, never as a lecture to the user. On **later** turns use coordination tools (\`spawn_sub_agent\`, etc.), then a **brief** closing when handoffs are done or queued.
`
      : `

**Turn order (lead):** Use tools **from the first turn** — **list modules**, **open workspace** if needed, **spawn_sub_agent** (often parallel). You **do not** run file/shell work yourself — workers do. Any natural-language reply in the same turn as tools should be **one short line** to the user unless they asked for detail — **no** long delegation preamble; full specs stay in \`task\`.
`

  const visionNoDecompBlock =
    opts?.visionWithoutDecomposition === true
      ? `

### Vision / image task (lead)
The user attached images and decomposition may be skipped. **Do not** try to implement alone — spawn **parallel Mei-style** (implementation) sub-agents with **narrow scopes** per area of the image, and mention in each \`task\` what to build. Call \`canvas_list_modules\` once, then \`spawn_sub_agent\` for each track.
`
      : ''

  const researchBlock =
    opts?.researchMode === true
      ? `

### Research mode (lead)
The user should **see** research on the canvas. You **do not** write files or open browser tiles yourself.

1. Call \`canvas_list_modules\` once.
2. Spawn a **Sora-style** sub-agent (\`display_name\` e.g. \`Sora\`, \`role\` e.g. \`Research\`) whose **task** explicitly includes: set up **github** / **browser** tiles as needed, write a durable artifact under \`research/<topic>.md\` with citations, and use \`write_file\` / \`web_search\` **inside that worker** — not you.
3. Optionally spawn additional parallel Sora tracks for separable questions (e.g. pricing vs API).
`
      : ''

  const specialistHermesLine = hermesAgentTileEnabled
    ? `- **Hermes** — worker hosted on the local **Hermes gateway** (\`runner:"hermes"\` on \`spawn_sub_agent\`). Use when the user names **Hermes** / asks the **Hermes agent** to do something, or when you want a task routed through the Hermes stack (Hermes KB + Hermes web search + Hermes skills) on top of the full Orca tool set.
`
    : ''

  const hermesHandoffBlock = hermesAgentTileEnabled
    ? `

**Hermes handoff:** When the user says “have Hermes do X”, “open a Hermes agent”, “use the hermes agent”, or names Hermes for **work**, prefer \`spawn_sub_agent\` with \`runner:"hermes"\` (defaults \`display_name:"Hermes"\`, \`role:"Hermes gateway worker"\`) — that sub-agent runs on the local Hermes gateway with the **full** Orca tool set plus Hermes server-side tools (LLM pinned to Hermes). **Never** tell the user you lack tools or cannot start Hermes; you always have \`spawn_sub_agent\`. When the user should **see** Hermes’ streaming HTTP chat on the canvas, call \`chat_with_hermes_tile({ prompt, tile_id?, reuse? })\` — it queues a prompt on a \`hermes_agent\` tile, auto-sends over \`/v1/responses\`, and posts the same **sub-agent handoff** when the reply finishes. Sub-agents may nest more workers subject to concurrency limits; use \`post_team_message\` with \`@all\` or \`@<name>\` if blocked. Nested handoffs mirror into the parent log; \`wait_for_sub_agent\` works as usual. Do **not** implement Hermes-assigned work yourself. If the gateway is unreachable the worker or tile path fails cleanly; report that back instead of falling back to another specialist silently. External shells can also close the loop with \`orca reply\` (see messenger/Hermes docs).
`
    : `

**Hermes (disabled in Settings):** Do **not** use \`runner:"hermes"\`, \`chat_with_hermes_tile\`, or \`hermes_agent\` tiles. Delegate with **standard** \`spawn_sub_agent\` workers only (default runner). Ignore user requests that imply Hermes gateway workers until they enable Hermes under Settings → Agent → Hermes.
`

  const hermesServerToolsBlock = hermesAgentTileEnabled
    ? `

**Hermes server tools (\`hermes_kb_search\`, \`hermes_web_search\`, \`hermes_skill\`):** Available to every orchestrator regardless of lead profile — they route through the local Hermes gateway at \`/v1/tools/{name}/invoke\`. Use \`hermes_kb_search\` when the user references Hermes-indexed docs/skills, \`hermes_skill\` to run a named Hermes skill, and prefer the top-level \`web_search\` over \`hermes_web_search\` unless the user asked for Hermes' browsing provider or you are running in Hermes lead mode. All three return structured gateway payloads; summarise before surfacing to the user.
`
    : ''

  const leadToolsOnlyLine = hermesAgentTileEnabled
    ? '**Your tools (only):** `spawn_sub_agent`, `chat_with_hermes_tile`, `diagnose_hermes_setup`, `canvas_list_modules`, `canvas_create_tile`, `canvas_update_tile`, `read_terminal_output`, `get_last_terminal_command`, `wait_for_terminal_command`, `configure_hermes_api`, `open_workspace`, `session_search` (alias: `recall_session_history`), `memory`, `list_merge_review_tickets`.'
    : '**Your tools (only):** `spawn_sub_agent`, `diagnose_hermes_setup`, `canvas_list_modules`, `canvas_create_tile`, `canvas_update_tile`, `read_terminal_output`, `get_last_terminal_command`, `wait_for_terminal_command`, `configure_hermes_api`, `open_workspace`, `session_search` (alias: `recall_session_history`), `memory`, `list_merge_review_tickets`. (Hermes-specific tools are off in Settings.)'

  const workspaceScopeGuardBlock = `
**Workspace scope (mandatory):** Treat **Workspace root** as the active project boundary for this run. For project-scoped requests (e.g. “analyze my project”, “inspect this repo”, “audit codebase”), start with \`path: "."\` (or the exact workspace root path) and keep file/search tools inside that root. Do **not** start from parent/home folders (e.g. \`/Users/...\`, \`~/\`, Desktop) unless the user explicitly asks for those paths.

**Conflict resolution (mandatory):** If any prior chat context, memory, or profile notes mention other project paths, treat them as historical context only. **Current Workspace root always wins for this run.** Never probe alternate repo roots unless the user explicitly asks to switch paths.
`

  return `You are the **lead orchestrator** for Orca Coder — you coordinate work via tools; **speak to the user like a single helpful agent**, not a manager reading a staffing memo.

### Workspace
Workspace root: ${root}${modelLine}
${workspaceScopeGuardBlock}

${projectBlock}${skillsCatalogBlock}${longTermMemoryBlock}${userProfileBlock}${recurringIssueBlock}${activeCandidateBlock}${autoCompactionBlock}

${SYSTEM_PROMPT_DYNAMIC_BOUNDARY}

${dynamicPreface}

### Delegation contract (mandatory)
- You **do not** use \`read_file\`, \`write_file\`, \`list_directory\`, \`delete_file\`, \`web_search\`, \`find_available_port\`, auto-fix, or codebase graph tools yourself. Those exist for **spawned sub-agents** only.
- **Exception:** You **may** use terminal read tools with a **terminal** tile \`tile_id\` from \`canvas_list_modules\`: \`read_terminal_output\` (raw PTY buffer), \`get_last_terminal_command\` (structured last exit/duration/tail from Orca-wrapped commands), and \`wait_for_terminal_command\` (block until the current command finishes or timeout). After failures, **always** inspect last command state before retrying — do not re-run the same shell one-liner blindly.
- **Every** implementation, research, test, or local-server step must be assigned via \`spawn_sub_agent\` with a **clear \`task\`** (paths, acceptance criteria, skill slug to \`read_file\` if relevant).
- Call \`canvas_list_modules\` before spawning many tiles so placements do not collide. Use \`canvas_create_tile\` / \`canvas_update_tile\` only to **organize** the board if needed; **workers** fill editor/terminal/browser content.
- Use \`open_workspace\` when the user must switch the project folder. Use \`session_search\` (or alias \`recall_session_history\`) for continuity. Use \`list_merge_review_tickets\` when reviewing worker output / merge queue.
- **Dependency bootstrap:** After \`open_workspace\`, or whenever work targets a **new** folder, the **first** Mei-style \`spawn_sub_agent\` task that will build, test, run a dev server, or edit code that imports packages must **explicitly** require: (1) \`list_directory\` at the repo root to spot lockfiles/manifests; (2) \`read_file\` on \`README.md\` / \`CONTRIBUTING.md\` / \`docs/DEVELOPER.md\` when present for monorepo or multi-step install order; (3) run the correct **non-interactive** install(s) **before** dev servers, tests, or implementation — workers should prefer **\`run_shell_command\`** for one-shot installs (\`npm ci\`, \`pnpm install --frozen-lockfile\`, etc.) and use a **terminal** tile for dev servers, watch mode, or when live PTY output is required. Workers must not assume \`node_modules\`, \`vendor/\`, or Rust \`target/\` deps already exist.

### Specialist roster (name workers clearly)
Use \`display_name\` and \`role\` so the team roster is obvious on the canvas. **Do not** narrate that roster to the user (“delegating to Mei…”) — keep chat replies direct; names belong in tool fields and in \`task\`, not in assistant prose.
- **Mei** — code, builds, tests, CI, local servers (\`find_available_port\`, diff + browser + terminal workflow), refactors, bugfixes.
- **Sora** — research, comparison, investigation, \`research/*.md\`, GitHub CLI / browser tiles, citations.
- **Hana** — documentation, copy, polish, user-facing strings.
${specialistHermesLine}Add more named specialists when useful (e.g. Ops, security review, design QA).

**Websites / web apps:** Spawn **Mei** with a task that includes: \`find_available_port\`, create **diff** + **browser** + **terminal** tiles, and serve from workspace root — same workflow as the full orchestrator, but **inside the worker**.

**Remotion / video:** Spawn **Mei** (or a dedicated worker) with render commands; do not plan-only.
${hermesHandoffBlock}

**Await vs fire-and-forget:** \`spawn_sub_agent\` is fire-and-forget by default — the handoff appears in your log when it finishes and you can keep working in parallel. When you need a worker's output as **direct input** to your next step (e.g. a research worker's summary decides what to write next), call \`wait_for_sub_agent({ tile_id })\` after the spawn to block until it finishes and receive the summary as the tool result. Do **not** await trivial workers you could just let stream back in the background, and do **not** await multiple workers serially when they could run in parallel — spawn them all first, then await in whatever order you need.
${hermesServerToolsBlock}

**spawn_sub_agent:** Hard cap **5 concurrent** sub-agents. Pass **task_complexity** when the user message includes decomposition rows. Prefer **parallel SIMPLE** workers when OpenRouter free routing applies.

**Final reply:** Keep it short (2–6 sentences): what to look at on the canvas or what’s done — **not** a rundown of which named specialist you assigned unless the user asked.

${leadToolsOnlyLine}

${turnOrderBlock}${visionNoDecompBlock}

Paths and \`${remotionOutputDir}\` in worker tasks are relative to the workspace root unless \`open_workspace\` changes it. External runners use the same tools via the canvas bridge — behavior should match worker loops.${getMessengerIntegrationsPromptBlock({ hermesAgentTileEnabled })}${researchBlock}`
}

function normalizeLooseObjectLiteral(raw: string): string {
  return raw
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*=>/g, '$1"$2":')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:/g, '$1"$2":')
    .replace(/=>/g, ':')
    .replace(/'/g, '"')
}

function normalizeArgsJson(raw: unknown): string {
  if (raw == null) return '{}'
  if (typeof raw !== 'string') return JSON.stringify(raw)
  const trimmed = raw.trim()
  if (!trimmed) return '{}'
  try {
    return JSON.stringify(JSON.parse(trimmed))
  } catch {
    try {
      return JSON.stringify(JSON.parse(normalizeLooseObjectLiteral(trimmed)))
    } catch {
      return '{}'
    }
  }
}

function mapFallbackToolRows(rows: Array<Record<string, unknown>>): ToolCall[] {
  return rows
    .map((row, i) => {
      const nameRaw =
        (typeof row.name === 'string' && row.name) ||
        (typeof row.tool === 'string' && row.tool) ||
        (typeof row.function === 'object' &&
        row.function &&
        typeof (row.function as Record<string, unknown>).name === 'string'
          ? String((row.function as Record<string, unknown>).name)
          : '')
      const name = String(nameRaw || '').trim()
      if (!name) return null
      const args =
        row.arguments ??
        row.args ??
        (typeof row.function === 'object' && row.function
          ? (row.function as Record<string, unknown>).arguments
          : undefined)
      return {
        id: `fallback_tool_${Date.now()}_${i}`,
        type: 'function' as const,
        function: {
          name,
          arguments: normalizeArgsJson(args),
        },
      }
    })
    .filter((c): c is ToolCall => !!c)
}

function parseTaggedToolCalls(text: string): ToolCall[] | null {
  const calls: ToolCall[] = []
  const patterns = [
    /<\s*(?:[\w-]+:)?tool_call\b[^>]*>([\s\S]*?)<\/\s*(?:[\w-]+:)?tool_call\s*>/gi,
    /\[\s*TOOL_CALL\s*\]([\s\S]*?)\[\s*\/\s*TOOL_CALL\s*\]/gi,
  ]
  for (const pattern of patterns) {
    let m: RegExpExecArray | null = null
    while ((m = pattern.exec(text)) !== null) {
      const block = (m[1] ?? '').trim()
      if (!block) continue
      let parsedRows: Array<Record<string, unknown>> | null = null
      try {
        const parsed = JSON.parse(block)
        if (Array.isArray(parsed)) {
          parsedRows = parsed.filter(
            (row): row is Record<string, unknown> => !!row && typeof row === 'object'
          )
        } else if (parsed && typeof parsed === 'object') {
          parsedRows = [parsed as Record<string, unknown>]
        }
      } catch {
        const nameMatch = block.match(/(?:^|[{,\s])(?:tool|name)\s*(?:=>|:)\s*["']([^"']+)["']/i)
        if (!nameMatch?.[1]) continue
        const argsMatch = block.match(/(?:args|arguments)\s*(?:=>|:)\s*(\{[\s\S]*\})/i)
        parsedRows = [
          {
            name: nameMatch[1],
            arguments: argsMatch?.[1] ?? '{}',
          },
        ]
      }
      if (!parsedRows) continue
      calls.push(...mapFallbackToolRows(parsedRows))
    }
  }
  return calls.length > 0 ? calls : null
}

function parseTextToolCalls(content: string | null | undefined): ToolCall[] | null {
  if (!content) return null
  const text = content.trim()

  const tagged = parseTaggedToolCalls(text)
  if (tagged && tagged.length > 0) return tagged

  let jsonCandidate = ''
  const markerMatch = text.match(/(?:^|\n)\s*(?:OLCALL|TOOLCALLS?|TOOL_CALLS?)\s*>\s*([\s\S]+)$/i)
  if (markerMatch?.[1]) {
    jsonCandidate = markerMatch[1].trim()
  } else if (text.startsWith('[') && text.includes('"name"')) {
    jsonCandidate = text
  } else {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced?.[1] && fenced[1].trim().startsWith('[') && fenced[1].includes('"name"')) {
      jsonCandidate = fenced[1].trim()
    }
  }
  if (!jsonCandidate) return null

  const firstBracket = jsonCandidate.indexOf('[')
  const lastBracket = jsonCandidate.lastIndexOf(']')
  if (firstBracket < 0 || lastBracket <= firstBracket) return null
  const sliced = jsonCandidate.slice(firstBracket, lastBracket + 1)

  try {
    const parsed = JSON.parse(sliced) as Array<Record<string, unknown>>
    if (!Array.isArray(parsed)) return null
    const calls = mapFallbackToolRows(parsed)
    return calls.length > 0 ? calls : null
  } catch {
    return null
  }
}

async function buildSystemPrompt(
  modelDisplayLabel?: string,
  opts?: {
    researchMode?: boolean
    /** When true, first model turn has no tools (acknowledgment before tools). */
    textOnlyFirstTurn?: boolean
    /** Merged `~/.claude/orca.md` (or `CLAUDE.md`) + workspace `orca.md` / legacy `CLAUDE.md` (see `loadProjectInstructionsForPrompt`). */
    projectInstructions?: string | null
    /** From `loadInstalledSkillsCatalogForOrchestrator` — lists `/skills` and slash commands so agents pick relevant SKILL.md via `read_file`. */
    installedSkillsCatalog?: string | null
    /** Complex prompt + image: decomposition was skipped — warn against burning rounds on exploratory list_directory. */
    visionWithoutDecomposition?: boolean
    /** Main orchestrator: coordination + spawn_sub_agent only (no file tools). */
    leadDelegationOnly?: boolean
    /** Proactive heartbeat vs normal user turn — shapes dynamic prompt preface. */
    orchestratorRunContext?: OrchestratorRunContext
    /** Preferred workspace root for this run (from UI/store) so Hermes lead stays aligned with the active Orca directory. */
    workspaceRoot?: string | null
  }
): Promise<string> {
  const longTermMemoryBlock = await loadLongTermMemoryForSystemPrompt()
  const userProfileBlock = await loadUserProfileForSystemPrompt()
  const recurringIssueBlock = await buildRecurringIssueBlock()
  const activeCandidateBlock = await buildActiveHarnessCandidatePromptBlock()
  const autoCompactionBlock = getAutoCompactionSystemPromptBlock()
  const dynamicPreface = buildDynamicPromptPreface(opts?.orchestratorRunContext)
  const ws = await tauri.getWorkspace()
  const hermesAgentTileEnabled = useSettingsStore.getState().showHermesAgentTile
  const workspaceRootFromStoreRaw = useWorkspaceStore.getState().rootPath
  const workspaceRootFromStore =
    workspaceRootFromStoreRaw && workspaceRootFromStoreRaw !== '.' ? workspaceRootFromStoreRaw : null
  const workspaceRootFromRun = opts?.workspaceRoot?.trim() ? opts.workspaceRoot.trim() : null
  const root =
    workspaceRootFromRun ??
    workspaceRootFromStore ??
    ws?.path ??
    '(no workspace folder open — open a folder in the sidebar)'
  const remotionOutputDir =
    useSettingsStore
      .getState()
      .remotionOutputDir.replace(/^\/+/, '')
      .trim() || 'videos/remotion'
  const modelLine = modelDisplayLabel
    ? `\n\nActive LLM (user-selected in Settings): ${modelDisplayLabel}. Use tool calls and reasoning appropriate for this model’s capabilities.`
    : ''
  const projectBlock =
    opts?.projectInstructions?.trim()
      ? `

### Project instructions (orca.md)
${opts.projectInstructions.trim()}
`
      : ''
  const skillsCatalogBlock =
    opts?.installedSkillsCatalog?.trim()
      ? `

${opts.installedSkillsCatalog.trim()}
`
      : ''

  if (opts?.leadDelegationOnly === true) {
    return buildLeadDelegationSystemPrompt(
      root,
      remotionOutputDir,
      modelLine,
      projectBlock,
      skillsCatalogBlock,
      longTermMemoryBlock,
      userProfileBlock,
      recurringIssueBlock,
      activeCandidateBlock,
      autoCompactionBlock,
      dynamicPreface,
      {
        researchMode: opts.researchMode,
        textOnlyFirstTurn: opts.textOnlyFirstTurn,
        visionWithoutDecomposition: opts.visionWithoutDecomposition,
        hermesAgentTileEnabled,
      }
    )
  }

  const inspectPromptsBlock = ''
  const turnOrderBlock =
    opts?.textOnlyFirstTurn === true
      ? `

**Turn order (acknowledgment first):** Your **first** assistant message after the user must be **text only** — briefly restate what you understood, acknowledge the goal, and outline how you will approach it (2–6 sentences). **Do not** emit tool calls or tool JSON in that first message. On **later** turns you have full tools — use them until the work is done, then give a **short closing** summary. The app runs this first reply **before** tools are enabled so the user sees that you understood and started, then watches tools execute, then sees your wrap-up.
`
      : `

**Turn order:** You may use tools **from the first turn** (including \`spawn_sub_agent\` when parallel or focused delegation helps). Prefer acting over long upfront plans; iterate with tools until the user’s goal is satisfied, then give a **short closing** summary (see below).
`
  const visionNoDecompBlock =
    opts?.visionWithoutDecomposition === true
      ? `

### Vision / image task (no automatic decomposition)
This run skipped the planning pass that splits work into parallel tracks (images attached). **Do not** spend many consecutive turns on single-path \`list_directory\` exploration — that exhausts the tool-round budget before real work.

- Call \`canvas_list_modules\` **once** early; then \`list_directory\` only for directories you must inspect (prefer **parallel** \`list_directory\` batches in one turn when paths are known).
- For large “implement everything in the image” goals, **delegate**: several \`spawn_sub_agent\` calls with narrow scopes beat one long crawl.
- Prefer \`read_file\` on manifests (\`package.json\`, \`README\`) over blind tree walking.
`
      : ''

  const vaultWikiBlock = await (async () => {
    const wikiPaths = ['wiki/index.md', 'wiki/state.md', 'Orca/brain/README.md'] as const
    let found: string | null = null
    for (const p of wikiPaths) {
      try {
        await tauri.readFile(p)
        found = p
        break
      } catch {
        /* try next */
      }
    }
    if (!found) return ''
    const distill =
      useSettingsStore.getState().orcaVaultWikiDistillPrompt === true
        ? `\n- After **meaningful** work, **offer** (in chat) updates to \`wiki/state.md\` and \`wiki/log.md\` — do **not** write those files without explicit user confirmation.\n`
        : ''
    return `

### Vault wiki (compounding memory)
This workspace includes vault wiki files (e.g. \`${found}\`). **Read \`wiki/index.md\` or \`wiki/state.md\` first** when doing durable research or note-taking.
- Use \`search_workspace_memory\` (or deprecated \`search_project_wiki\`) to keyword-search \`wiki/**\`, \`Orca/brain/**\`, and \`Orca/chat/**\` markdown (and the central vault when enabled). Use \`search_central_playbooks\` for setup playbooks (Vercel, Stripe, etc.) in the central vault. Use \`session_search\` (alias \`recall_session_history\`) for raw orchestrator chat logs (FTS), not the compiled wiki.
${distill}`
  })()

  const researchBlock =
    opts?.researchMode === true
      ? `

### Research mode (visible on canvas)
The user should **see** investigation happen — not a black-box answer.

**Early canvas setup**
1. Call \`canvas_list_modules\` so you don’t stack tiles blindly.
2. For **GitHub** discovery (search repos/issues/code, API, \`gh\` output), use a **github** tile: \`canvas_create_tile\` with \`type: "github"\` (optional \`meta: { "ghArgs": "search repos … --json …" }\`). It runs the real GitHub CLI in the workspace. For **non-GitHub** web sources, use **agent_browser** (via \`browser_open\` or \`canvas_create_tile\` with \`type: "agent_browser"\`) so you can interact/test pages with \`browser_snapshot/click/fill\`. Give each tile a **clear title**. Offset \`x\`/\`y\` so modules read left-to-right or top-to-bottom like a **research desk**.
3. Write a durable artifact with \`write_file\` under \`research/\` (e.g. \`research/<topic-slug>.md\`) with headings, **comparison tables** when comparing 3+ options, risks, and **linked sources**. Open it in an **editor** tile via the normal file workflow so the user can skim.

**Quality (inspired by disciplined research agents)**
- **Lead** with the bottom line, then support with evidence.
- **Cite** sources in your final reply (page titles + URLs you opened).
- Use **tables** for multi-option comparisons; flag **stale** or **conflicting** sources briefly.
- Use \`spawn_sub_agent\` for a **parallel** research track only when it is clearly separable (e.g. “docs” vs “pricing”); otherwise stay in one loop.

**Not research:** local file explorer is \`open_workspace\` + sidebar — never use browser/agent_browser tiles for folders.
`
      : ''

  const fullOrchestratorCanvasTilesBlock = hermesAgentTileEnabled
    ? `Canvas modules ("tiles"): terminal, editor, agent_browser (interactive web pages + automation), browser (legacy alias), **github** (GitHub CLI for research), diff, todo, agent, and optionally a compact **orchestrator** status tile (run progress only — do not delete). **hermes_bridge** exposes the canvas bridge; **hermes_agent** is HTTP chat to the Hermes API server (not the CLI TUI). Older canvases may still list legacy tile types. Each tile has a unique id, title, position (x,y), size (w,h), z-order, and meta JSON.

**Hermes — two surfaces:** (1) \`spawn_sub_agent\` with \`runner:"hermes"\` — headless agent tile, full tool loop on the Hermes gateway. (2) \`chat_with_hermes_tile\` — drives the visible \`hermes_agent\` HTTP chat tile (auto-send + handoff). The tile alone does not run until you call \`chat_with_hermes_tile\` or the user types.
`
    : `Canvas modules ("tiles"): terminal, editor, agent_browser (interactive web pages + automation), browser (legacy alias), **github** (GitHub CLI for research), diff, todo, agent, and optionally a compact **orchestrator** status tile (run progress only — do not delete). **hermes_bridge** exposes the canvas bridge. With **Hermes agent tile disabled** in Settings, do **not** create \`hermes_agent\` tiles, \`chat_with_hermes_tile\`, or \`spawn_sub_agent({ runner: "hermes" })\` — use **agent** tiles and default-runner \`spawn_sub_agent\` only. Older canvases may still list legacy tile types. Each tile has a unique id, title, position (x,y), size (w,h), z-order, and meta JSON.
`

  const proactiveHermesApiBullet = hermesAgentTileEnabled
    ? `- **Hermes API server:** Start the gateway on the canvas: \`canvas_list_modules\`, **terminal** with \`API_SERVER_ENABLED=true hermes gateway\`. Then align Orca via \`configure_hermes_api\`; add a **hermes_agent** tile for in-app HTTP chat to Hermes — see the messenger/Hermes block. After output appears, \`canvas_list_modules\` may show \`terminal_warnings\` (\`hermes_local_dev_no_auth: true\` = no \`API_SERVER_KEY\`) — use \`api_key: ""\` only to clear a stale key; **never** invent one.
`
    : `- **Hermes API (saved settings):** \`configure_hermes_api\` updates stored base URL / key for when Hermes is enabled later. Do **not** start \`hermes gateway\`, **hermes_agent** tiles, or Hermes bridging flows while Hermes agent tile is disabled in Settings.
`

  const fullOrchestratorToolsLine = hermesAgentTileEnabled
    ? `Tools: read_file, write_file, delete_file, list_directory, **web_search**, open_workspace, **find_available_port**, canvas_list_modules, canvas_create_tile, canvas_update_tile, **configure_hermes_api**, **diagnose_hermes_setup**, **create_project_skill**, **record_benchmark_session**, **spawn_sub_agent**, **chat_with_hermes_tile**, **memory**, **session_search** (alias: **recall_session_history**), **search_workspace_memory** (alias: **search_project_wiki**), **search_central_playbooks**, **query_codebase_graph**, **fetch_dev_telemetry_snapshot**, **list_merge_review_tickets**. Use them in a tight loop until the user's goal is done, then reply with a short summary (no more tool calls). **Never** put tool syntax in plain chat text (no XML, no \`<tool_call>\`, no \`…/invoke\` lines); tools are invoked only via the API — the user must never see fake tool tags.`
    : `Tools: read_file, write_file, delete_file, list_directory, **web_search**, open_workspace, **find_available_port**, canvas_list_modules, canvas_create_tile, canvas_update_tile, **configure_hermes_api**, **diagnose_hermes_setup**, **create_project_skill**, **record_benchmark_session**, **spawn_sub_agent**, **memory**, **session_search** (alias: **recall_session_history**), **search_workspace_memory** (alias: **search_project_wiki**), **search_central_playbooks**, **query_codebase_graph**, **fetch_dev_telemetry_snapshot**, **list_merge_review_tickets**. (**chat_with_hermes_tile** is off when Hermes agent tile is disabled in Settings.) Use them in a tight loop until the user's goal is done, then reply with a short summary (no more tool calls). **Never** put tool syntax in plain chat text (no XML, no \`<tool_call>\`, no \`…/invoke\` lines); tools are invoked only via the API — the user must never see fake tool tags.`

  const spawnSubAgentIntroLine = hermesAgentTileEnabled
    ? '**spawn_sub_agent** (Hermes-style parallel agents): one call starts one delegated worker. Default workers are tracked in Agent team + group chat (worker canvas tiles may stay hidden for lower GPU load); Hermes runner workers remain visible.'
    : '**spawn_sub_agent** (parallel agents): one call starts one delegated worker. Default workers are tracked in Agent team + group chat (worker canvas tiles may stay hidden for lower GPU load).'

  const parallelWorkersBlock = hermesAgentTileEnabled
    ? `**Parallel workers (hotAsianIntern-style):** Split medium/hard goals across multiple workers by concern area. **Per-agent scope rule: never assign more than 3 explicit tasks/subtasks to one agent.** If scope exceeds 3 tasks, create additional agents so each worker has a compact batch (≤3). Use **parallel SIMPLE** workers when OpenRouter is on (free models), and keep ownership boundaries clear. Name workers in \`display_name\` / \`role\` so the roster reads clearly: **Mei**-style for coding/build/CI/fixes, **Sora**-style for research/compare/investigate, **Hana**-style for docs/copy/polish, and **Hermes** — use \`spawn_sub_agent({ runner:"hermes", … })\` for headless gateway workers, or \`chat_with_hermes_tile\` when the user should **see** the Hermes HTTP chat. **When two or more agents are active, require every agent to post a short \`post_team_message\` update after each completed task/subtask.** Merge handoffs into one answer. **Mei** tasks that touch Hermes should use **gateway terminal + \`configure_hermes_api\`** and optionally **chat_with_hermes_tile** / **hermes_agent** — not a fictional PTY driver. When the user says *“have Hermes …”* or *“use the hermes agent to …”*, prefer \`spawn_sub_agent({ runner:"hermes", display_name:"Hermes", role:"Hermes gateway worker", task: … })\` or \`chat_with_hermes_tile\` for visible chat instead of doing the work yourself.
`
    : `**Parallel workers (hotAsianIntern-style):** Split medium/hard goals across multiple workers by concern area. **Per-agent scope rule: never assign more than 3 explicit tasks/subtasks to one agent.** If scope exceeds 3 tasks, create additional agents so each worker has a compact batch (≤3). Use **parallel SIMPLE** workers when OpenRouter is on (free models), and keep ownership boundaries clear. Name workers in \`display_name\` / \`role\` so the roster reads clearly: **Mei**-style for coding/build/CI/fixes, **Sora**-style for research/compare/investigate, **Hana**-style for docs/copy/polish. **When two or more agents are active, require every agent to post a short \`post_team_message\` update after each completed task/subtask.** Merge handoffs into one answer. Do **not** use \`runner:"hermes"\`, \`chat_with_hermes_tile\`, or **hermes_agent** while Hermes is disabled in Settings — use default-runner workers only.
`

  const toolHarnessParagraph = hermesAgentTileEnabled
    ? `**Hermes-style harness:** You may emit **several tool calls in one turn**; independent calls (e.g. multiple \`read_file\` / \`list_directory\`) run **in parallel** for speed—batch work when safe. Do **not** parallelize conflicting writes to the same path. Prefer listing modules once, then batching reads. Large tasks may take many turns; keep going until the user’s goal is satisfied.
`
    : `**Parallel tool batching:** You may emit **several tool calls in one turn**; independent calls (e.g. multiple \`read_file\` / \`list_directory\`) run **in parallel** for speed—batch work when safe. Do **not** parallelize conflicting writes to the same path. Prefer listing modules once, then batching reads. Large tasks may take many turns; keep going until the user’s goal is satisfied.
`

  const workspaceScopeGuardBlock = `
**Workspace scope (mandatory):** Treat **Workspace root** as the active project boundary for this run. For project-scoped requests (e.g. “analyze my project”, “inspect this repo”, “audit codebase”), start with \`path: "."\` (or the exact workspace root path) and keep file/search tools inside that root. Do **not** start from parent/home folders (e.g. \`/Users/...\`, \`~/\`, Desktop) unless the user explicitly asks for those paths.

**Conflict resolution (mandatory):** If any prior chat context, memory, or profile notes mention other project paths, treat them as historical context only. **Current Workspace root always wins for this run.** Never probe alternate repo roots unless the user explicitly asks to switch paths.
`

  return `You are the Orca Coder orchestrator. You have full control of the infinite canvas and the workspace on disk.

### Workspace
Workspace root: ${root}${modelLine}
${workspaceScopeGuardBlock}

${projectBlock}${skillsCatalogBlock}${longTermMemoryBlock}${userProfileBlock}${recurringIssueBlock}${activeCandidateBlock}${autoCompactionBlock}

${SYSTEM_PROMPT_DYNAMIC_BOUNDARY}

${dynamicPreface}

${inspectPromptsBlock}${vaultWikiBlock}${visionNoDecompBlock}

The left sidebar is the file tree ("Canvas Explorer"). To open or switch the user's project folder there, call open_workspace with an absolute path. Never use a browser tile to stand in for the file explorer — browser/agent_browser tiles are only for loading web URLs. If open_workspace returns ok, treat that path as accessible/active for this run; do not claim it is invalid unless a later tool call returns a concrete error. After open_workspace, verify with list_directory('.') (or delegate a worker to verify when running lead-delegation-only allowlists).

${SHELL_ROUTING_PROMPT_SNIPPET}

### Dependency bootstrap (mandatory)
Before **builds**, **tests**, **lint**, or **dev servers** — and **immediately after** \`open_workspace\` when the next step is to run or change code — **discover and install project dependencies first** so commands do not fail on missing modules.
1. **Scan** the workspace root with \`list_directory\` for lockfiles and manifests (\`package-lock.json\`, \`pnpm-lock.yaml\`, \`yarn.lock\`, \`bun.lock\`, \`Cargo.toml\`, \`go.mod\`, \`pyproject.toml\`, \`requirements.txt\`, \`Gemfile\`, \`composer.json\`, \`mix.exs\`, etc.). Read \`README.md\`, \`CONTRIBUTING.md\`, or \`docs/DEVELOPER.md\` when present for **install order** (monorepos, submodules, root vs package install).
2. **Install** using the directory that owns the lockfile (usually repo root): e.g. \`npm ci\` when \`package-lock.json\` exists; \`pnpm install --frozen-lockfile\` for \`pnpm-lock.yaml\`; \`yarn install --immutable\` where appropriate; \`cargo fetch\` / \`cargo build\` for Rust; \`go mod download\` for Go; \`pip install -r requirements.txt\` or \`uv sync\` / \`poetry install\` for Python — prefer **\`run_shell_command\`** with \`cd "<workspace root>" && …\` (real path from **Workspace root:** above) for bounded installs; use a **terminal** tile when you need a long-running dev server, watch mode, or live PTY output.
3. **Do not** skip install because the project “looks familiar” — a new clone or switched folder may have no \`node_modules\` until install completes.
4. **Multi-stack repos** (e.g. Node + Rust): install **all** required stacks before starting any dev server, unless README dictates a strict order — then follow README.
5. Only after installs succeed (or README documents a deliberate partial install) proceed with \`find_available_port\`, \`write_file\`, or framework-specific commands.

${fullOrchestratorCanvasTilesBlock}
Always call canvas_list_modules before creating or moving multiple tiles so you know every module on the canvas and avoid collisions.

The app **automatically brings the relevant tile to the front** and **frames it in the viewport** when you create or update a tile (and when a file write updates the diff tile), unless the user is in fullscreen focus mode — so the user sees modules as you use them.

**Proactive layout:** Decide which tiles help the user and create them — do not wait to be asked for modules.
- **Websites / web apps (required workflow):** Right after \`canvas_list_modules\`, **call \`find_available_port\` first** to get a free port, then create these tiles **before** the first \`write_file\`: (1) a **diff** tile (title e.g. "Johnny Beans — changes") — each \`write_file\` automatically fills it with before/after for the last written file; (2) an **agent_browser** tile (or call \`browser_open\`) with \`url: "http://localhost:<PORT>"\` using the port from \`find_available_port\`; (3) a **terminal** tile with \`meta.command\` to serve the folder from **Workspace root** using that same port. Shells may start elsewhere, so prefix with \`cd "<actual workspace root path>" &&\` using the real path shown on the **Workspace root:** line above, never the literal placeholder text \`<Workspace root>\`. Example: \`cd "/absolute/path/from-workspace-root-line" && npx --yes serve . -l <PORT> --no-port-switching\` (or \`python3 -m http.server <PORT>\` for static sites). For Node projects with a script that doesn't accept a port flag, use \`PORT=<PORT> npm run dev\`. **Always check port availability first** — never assume 3000/5173/8080 are free. **Vite / \`npm run dev\`:** After the dev server starts, read the terminal (or \`read_terminal_output\` / \`get_last_terminal_command\`) for the line \`Local:   http://localhost:PORT/\` and set the **agent browser URL to that exact value** — Vite often binds **8081, 5174, …**, not \`5173\`. Do **not** open \`localhost:5173\` unless the terminal line says so. If the terminal output reports a different bound URL/port than requested, immediately update the agent browser URL to that exact Local URL before claiming success. The user should see the page load in the browser and every save reflected in the diff tile. Static single-file HTML still needs a local server so the browser can load \`http://localhost:...\` (iframes are not a substitute for the file tree). **Browser URL rules (STRICT):** (a) ALWAYS use \`http://localhost:<port>\` for local dev servers — never \`http://127.0.0.1:<port>\`. \`localhost\` is a browser "secure context" and survives loopback spelling mismatches; \`127.0.0.1\` breaks service workers, OAuth redirects, and some CSP frame-ancestors allowlists. (b) NEVER pass \`file:///…\` to browser automation — local files do not embed reliably. If the user wants to preview a loose \`.html\`, cd to its folder and run \`npx --yes serve -l <PORT> --no-port-switching\` in a terminal tile, then open \`http://localhost:<PORT>\`. (c) For public web pages use canonical \`https://\` URLs. Prefer \`browser_open\` + \`browser_snapshot/click/fill\` for testing and interaction, not passive iframes.
- **CLI / builds:** For **one-shot** installs, tests, and checks, prefer **\`run_shell_command\`** (subprocess, no PTY). Add a **terminal** tile when you need a **long-running** process or streaming PTY output. **Default: non-interactive only** — \`meta.command\` / \`run_shell_command\` must run **unattended**; Orca cannot type into prompts (\`Ok to proceed?\`, pagers, sudo passwords). Prefer \`npx --yes …\`, \`npm install -y\` / \`npm ci\`, \`npm create … -- --yes\` where supported, \`CI=1\` or \`NPM_CONFIG_YES=true\` for npm-family tools, \`DEBIAN_FRONTEND=noninteractive\` for apt, and tool-specific \`--yes\` / \`--force\` flags. For Vite scaffolding use e.g. \`npx --yes create-vite@latest . --template react-ts\` (not bare \`npm create\` that stops for confirmation). If a command would still prompt, choose a different invocation or tell the user to confirm once in the terminal tile.
${proactiveHermesApiBullet}
- **Larger efforts:** A **todo** tile can track tasks.
- **Remotion video requests (direct-output mode):** Do **not** stop at planning docs/sub-agent setup when the user asks for a video. Build and render. Preferred flow: (1) create/use a **remotion** tile, (2) write needed composition files, (3) create/use a **terminal** tile and run a concrete \`npx remotion render ...\` command, (4) save output under workspace-relative \`${remotionOutputDir}\` unless user gives another path, (5) report the exact output file path. Use sub-agents only if the user explicitly asks for multi-agent planning.
${turnOrderBlock}

${fullOrchestratorToolsLine}

On long runs, optionally call **fetch_dev_telemetry_snapshot** to verify the dev telemetry server is recording events. Use **query_codebase_graph** when \`GRAPH_REPORT.md\` exists to avoid blind full-repo listing. After delegating sub-agents, **list_merge_review_tickets** shows pending human review items (sidebar: Agents → Merge review).

**Final reply (chat panel):** This UI is **narrow**. Keep the closing message **brief and easy to scan**: about **2–8 sentences**, or **one short bullet list** (≤8 bullets). Do **not** use emoji in headings or as bullet decorations. Avoid decorative horizontal rules (\`---\`) and “report” layouts with many \`##\` sections. **Do not** paste large markdown tables in chat — at most a **tiny** table (a few rows) or **put full tables / long analyses in the workspace** via \`write_file\` and cite the file path. The chat answer should read like a quick handoff, not a PDF.

**create_project_skill** writes a reusable \`SKILL.md\` into this workspace (\`.cursor/skills/…\` and/or \`.claude/skills/…\`) so the same orchestrator—or the user typing \`/<skill_slug>\`—can load concise task-specific guidance on later runs. Use it when you have distilled a workflow worth repeating (build order, test commands, API quirks)—especially after **recovering from an error** (e.g. wrong clone flags) so the next run skips the mistake. New skills appear in the **Toolbox** tile (the module opens when a skill is created) alongside per-tool history. When an **Installed skills** section appears above, prefer matching slugs from that list and \`read_file\` before improvising.

**record_benchmark_session** ingests benchmark JSON (e.g. after \`cargo bench\`), writes reports under \`.agent-canvas/benchmarks/\`, and spawns **benchmark** / optional **browser** (Remotion docs) / **remotion** (Studio iframe) tiles. For rich HTML diagrams, follow \`docs/skills/visual-explainer\` (nicobailon/visual-explainer patterns).

${spawnSubAgentIntroLine} **Hard cap: 5 concurrent** sub-agents (wait for a handoff or stop a worker before spawning more). Each sub-agent has its own isolated session + tool loop; parallel work means **multiple** \`spawn_sub_agent\` calls. Default workers may run in team-only mode (hidden worker tiles) for lower GPU churn, while Hermes runner workers keep visible tiles. **Never give one sub-agent more than 3 explicit tasks/subtasks** — split larger scopes across additional agents. Do **not** try to cram parallel work into a single agent tile; check \`canvas_list_modules\` before spawning and name each worker clearly via \`display_name\` / \`role\`.

**Prompt triage (when the user message includes a decomposition block):** For **complex** repo-wide questions, the app may prepend **parallel tracks** with **difficulty** and \`task_complexity\` — call \`spawn_sub_agent\` **early** (after \`canvas_list_modules\`) and pass **the same \`task_complexity\` string** as each row (\`simple\` vs \`complex\`). Do **not** omit it or default to \`auto\` when the block lists explicit values.

${parallelWorkersBlock}
**Model routing (rate limits):** With OpenRouter enabled, \`task_complexity: "simple"\` (and most **auto** short tooling tasks) use **OpenRouter free** (\`openrouter/free\`). **Complex** spawns use your **selected orchestrator model** (e.g. GLM-4.7). Reserve GLM for the main loop and **at most one** truly hard worker track; push everything else to **simple** + free.

The **Agent team** module is **opened and surfaced automatically** on every spawn. For anything **more than a trivial 1-shot**, **default to delegation**: prefer several \`spawn_sub_agent\` calls (parallel in one turn when safe) over one endless orchestrator loop. When a sub-agent **finishes**, its summary is **reported back** (activity log + orchestrator session) so you can incorporate it on the next turn.

${toolHarnessParagraph}

Paths for read_file / write_file / list_directory are relative to the current workspace root unless you first open_workspace to a new root. Each \`write_file\` updates the left **Canvas Explorer** tree automatically (new files appear and parent folders expand).

External runners use the same tools via the canvas bridge when a UI session is connected — behavior should match this loop.
${getMessengerIntegrationsPromptBlock({ hermesAgentTileEnabled })}
The **bottom orchestrator bar** shows this run’s log; file reads/writes open or refresh an **Editor** tile for that path; diff updates use a **Diff** tile when present. Prefer \`canvas_list_modules\` + \`canvas_create_tile\` so work stays on the canvas.${researchBlock}`
}

export interface RunOrchestratorOptions extends OrchestratorModelContext {
  messages: ChatMessage[]
  userMessage: string
  userContent?: UserMessageContent
  onLog?: (line: string) => void
  /** Optional sink for provider-native notices (e.g., Hermes SSE trace lines). Defaults to onLog. */
  onProviderNotice?: (line: string) => void
  signal?: AbortSignal
  /**
   * When set, only these tools are registered with the chat API (narrow-scope attempts).
   */
  toolAllowlist?: string[] | null
  /** Optional Tingua-style contract appended to the system prompt. */
  executionContract?: Partial<ExecutionContract> | null
  /** Per-run ablation overrides (defaults from Settings). */
  harnessAblation?: Partial<HarnessAblationFlags> | null
  /** Fires for harness tracing when Settings → harness raw traces is enabled. */
  onHarnessTrace?: (payload: HarnessTracePayload) => void
  /** Stable id for `.jsonl` trace files (defaults per run). */
  harnessTraceSessionKey?: string
  /** Optional structured workflow/auth context appended once as a custom trace row (`workflow_trace_context`). */
  workflowTraceContext?: Record<string, unknown> | null
  /**
   * Max LLM+tool rounds (default and hard cap from `orchestratorConstants`, currently 150).
   */
  maxIterations?: number
  /**
   * Per-run wall-clock cutoff (default: `ORCHESTRATOR_DEFAULT_MAX_WALL_CLOCK_MS`).
   * Fails closed when elapsed runtime exceeds this budget.
   */
  maxWallClockMs?: number
  /**
   * Soft budget for estimated context tokens from the working set (`JSON chars / 4`).
   * Fails closed when the estimate exceeds this budget.
   */
  maxEstimatedContextTokens?: number
  /**
   * When true (default), all tool_calls in a single assistant message execute concurrently.
   */
  parallelToolCalls?: boolean
  /** Fires before each LLM round and before each tool batch so the UI can show status verbs. */
  onActivity?: (payload: OrchestratorActivityPayload) => void
  /** Per-round model usage (when provider returns usage tokens). */
  onUsage?: (usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }) => void
  /**
   * Live estimate of context window usage from the in-flight working set (useful when provider usage is absent).
   */
  onContextTokens?: (tokens: number) => void
  /**
   * When true, appends **Research mode** instructions: browser-first tiles, \`research/*.md\` artifact,
   * tables + citations — tuned from Sora-style research playbooks.
   */
  researchMode?: boolean
  /**
   * When true, the first LLM round has **no tools** (acknowledgment / plan in prose only). Canvas orchestrator
   * sets this so users see a reply before tool work. Default **false** for other callers (e.g. agent tiles).
   */
  textOnlyFirstTurn?: boolean
  /**
   * Global \`~/.claude/orca.md\` (or \`CLAUDE.md\`) plus workspace \`orca.md\` / legacy \`CLAUDE.md\` merged — injected under “Project instructions”.
   */
  projectInstructions?: string | null
  /**
   * Markdown from \`loadInstalledSkillsCatalogForOrchestrator()\` — installed skills, plugin skills, slash commands.
   * Sub-agents and the main orchestrator use this to route to \`read_file\` on the right \`SKILL.md\`.
   */
  installedSkillsCatalog?: string | null
  /** Complex + image: no decomposition — inject anti–list_directory-crawl system text and allow higher maxIterations from caller. */
  visionWithoutDecomposition?: boolean
  /**
   * Main orchestrator only: system prompt + allowlist restrict to coordination + `spawn_sub_agent`.
   * Set by {@link runOrchestratorLeadAware} when Settings → lead delegation is on.
   */
  leadDelegationOnly?: boolean
  /**
   * **default** = user-initiated turn; **heartbeat** = proactive scheduler — adds run-context overlay.
   */
  orchestratorRunContext?: OrchestratorRunContext
  /**
   * Active Orca workspace root for this run (preferred over async probes when available).
   */
  workspaceRoot?: string | null
  /** Current orchestrator run generation (Research tile grouping). */
  runGeneration?: number
  /** Sub-agent tile id when this loop runs inside a worker tile. */
  subAgentTileId?: string
  /**
   * When set, replaces the default orchestrator system prompt (e.g. 1-shot phases). Skips
   * `buildSystemPrompt` / project instructions merge for that run.
   */
  overrideSystemPrompt?: string | null
  /**
   * Fired with the **first** assistant message when \`textOnlyFirstTurn\` is true (intro before tools).
   * The returned \`assistantText\` is still the **closing** summary after tools finish.
   */
  onAssistantReply?: (text: string) => void
  /**
   * Live harness phases (`setup` → `model` → `tools` / `continuation`) and final `done`
   * for async-generator consumers and UI diagnostics.
   */
  onStreamEvent?: (event: OrchestratorStreamEvent) => void
  /**
   * When true, suppresses Orca-generated periodic "Still waiting" nudges during LLM pending.
   * Useful for Hermes terminal-style traces where raw provider events are already streamed.
   */
  suppressStillWaitingNudges?: boolean
  /**
   * When true, pass through raw Hermes SSE lines (`event:`/`data:`) for terminal-style trace output.
   */
  hermesTerminalTraceStyle?: boolean
  /**
   * Called **before each LLM round**. Returning a non-empty string appends a
   * synthetic `user` message to the working context for that round (and all
   * subsequent rounds, since `working` is cumulative). Used by the team chat
   * inbox to inject unseen `@mentions` / `ask` / `blocker` / `handoff` / `result`
   * messages so sub-agents can actually react to directives from the lead
   * orchestrator or peer agents. Never throws; errors are swallowed.
   */
  injectUserMessageBeforeRound?: () => string | null | undefined
}

/**
 * Multi-step agent loop (Hermes-style): model may emit tool calls until it returns a final assistant message.
 * Each assistant turn may include **multiple** tool calls; they run in parallel when `parallelToolCalls` is true.
 */
export async function runOrchestratorAgent(
  options: RunOrchestratorOptions
): Promise<{ assistantText: string; messages: ChatMessage[] }> {
  const {
    provider,
    model,
    apiKey,
    baseUrl,
    userMessage,
    userContent,
    onLog,
    onProviderNotice,
    onActivity,
    onUsage,
    onContextTokens,
    signal,
    orchestratorTileId,
    parallelToolCalls = ORCHESTRATOR_DEFAULT_PARALLEL_TOOLS,
    researchMode = false,
    textOnlyFirstTurn = false,
    projectInstructions,
    installedSkillsCatalog,
    onAssistantReply,
    onStreamEvent,
    visionWithoutDecomposition,
    leadDelegationOnly,
    overrideSystemPrompt,
    executionContract,
    toolAllowlist,
    runGeneration,
    subAgentTileId,
    workspaceRoot,
    injectUserMessageBeforeRound,
    suppressStillWaitingNudges,
    hermesTerminalTraceStyle,
    modelDisplayLabel,
    orchestratorRunContext,
    workflowTraceContext,
  } = options

  const retryModelLabel = (modelDisplayLabel ?? model).trim() || model

  const emitUsageIfPresent = (res: ChatCompletionResponse) => {
    const usage = res?.usage
    if (!usage) return
    onUsage?.({
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    })
  }

  const emitContextEstimate = (messages: ChatMessage[]) => {
    onContextTokens?.(estimateContextTokensFromWorkingSet(messages))
  }

  const maxIterations = Math.min(
    ORCHESTRATOR_HARD_MAX_ITERATIONS,
    Math.max(1, options.maxIterations ?? ORCHESTRATOR_DEFAULT_MAX_ITERATIONS)
  )
  const maxWallClockMs = Math.max(1, options.maxWallClockMs ?? ORCHESTRATOR_DEFAULT_MAX_WALL_CLOCK_MS)
  const maxEstimatedContextTokens = Math.max(
    1,
    options.maxEstimatedContextTokens ?? ORCHESTRATOR_DEFAULT_MAX_ESTIMATED_CONTEXT_TOKENS
  )
  const runStartedAtMs = Date.now()

  const ablation = getHarnessAblationFlags(options.harnessAblation)
  const traceSessionKey =
    options.harnessTraceSessionKey ??
    `h-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const traceToDisk = useSettingsStore.getState().harnessTraceRaw === true
  const traceDetailed =
    traceToDisk && useSettingsStore.getState().harnessTraceDetailed === true

  const emitTrace = (payload: HarnessTracePayload) => {
    options.onHarnessTrace?.(payload)
    if (!traceToDisk) return
    const ts = Date.now()
    void (async () => {
      try {
        if (payload.kind === 'run_start') {
          await appendHarnessTraceLine(traceSessionKey, {
            kind: 'run_start',
            ts,
            scopeLevel: payload.scopeLevel,
            attemptIndex: payload.attemptIndex,
            allowlistToolCount: payload.allowlistToolCount,
            allowlistToolsSorted: payload.allowlistToolsSorted,
            ...(traceDetailed ? { provider, model } : {}),
          })
          const workflowEvent = buildWorkflowTraceCustomEvent(workflowTraceContext, ts)
          if (workflowEvent) {
            await appendHarnessTraceLine(traceSessionKey, workflowEvent)
          }
        } else if (payload.kind === 'llm_round') {
          await appendHarnessTraceLine(traceSessionKey, {
            kind: 'llm_round',
            ts,
            iteration: payload.iteration,
          })
        } else if (payload.kind === 'tool_batch') {
          await appendHarnessTraceLine(traceSessionKey, {
            kind: 'tool_batch',
            ts,
            toolNames: payload.toolNames,
          })
        } else if (payload.kind === 'run_end') {
          await appendHarnessTraceLine(traceSessionKey, {
            kind: 'run_end',
            ts,
            ok: payload.ok,
            error: payload.error,
          })
        }
      } catch {
        /* ignore trace IO */
      }
    })()
  }

  const appendDetailed = (event: HarnessTraceLineInput) => {
    if (!traceDetailed) return
    void appendHarnessTraceLine(traceSessionKey, event).catch(() => {
      /* ignore trace IO */
    })
  }

  if (!providerSupportsOrchestratorTools(provider)) {
    throw new Error(
      'Canvas orchestrator needs a tools-capable provider: enable Hermes gateway, OpenAI, OpenRouter, Z.AI, Ollama, etc. in Settings.'
    )
  }

  if (!apiKey && !providerAllowsEmptyApiKey(provider)) {
    throw new Error(
      'API key required for this provider. Ollama and llama.cpp can run without a key locally.'
    )
  }

  resetOrchestratorPaceClock()
  onActivity?.({ kind: 'prepare' })
  const system =
    overrideSystemPrompt ??
    (await buildSystemPrompt(options.modelDisplayLabel, {
      researchMode,
      textOnlyFirstTurn,
      projectInstructions,
      installedSkillsCatalog,
      visionWithoutDecomposition,
      leadDelegationOnly: leadDelegationOnly === true && !subAgentTileId,
      orchestratorRunContext,
      workspaceRoot,
    }))
  let systemFinal = system
  if (executionContractIsMeaningful(executionContract)) {
    const merged = mergeExecutionContract(EMPTY_EXECUTION_CONTRACT, executionContract)
    systemFinal += '\n\n' + formatExecutionContractForPrompt(merged)
  }
  const delegatedBlock = buildDelegatedJudgmentPromptBlock(userMessage)
  if (delegatedBlock) {
    systemFinal += delegatedBlock
  }
  const workspaceScopeTurnGuard = buildWorkspaceScopeTurnGuard(userMessage, workspaceRoot)
  const workspaceScopeGuardMessage: ChatMessage[] = workspaceScopeTurnGuard
    ? [{ role: 'system', content: workspaceScopeTurnGuard }]
    : []
  const behaviorReflexTurnGuard = buildBehaviorReflexTurnGuard(userMessage)
  const behaviorReflexGuardMessage: ChatMessage[] = behaviorReflexTurnGuard
    ? [{ role: 'system', content: behaviorReflexTurnGuard }]
    : []
  let working: ChatMessage[] = [
    { role: 'system', content: systemFinal },
    ...workspaceScopeGuardMessage,
    ...behaviorReflexGuardMessage,
    ...options.messages,
    { role: 'user', content: userContent ?? userMessage },
  ]

  const toolsFiltered = filterOrchestratorToolsByAllowlist(toolAllowlist ?? null)
  const toolsForApi = filterOrchestratorToolsForHermesAgentTileSetting(
    toolsFiltered,
    useSettingsStore.getState().showHermesAgentTile
  )
  const allowlistToolsSorted = [...toolsForApi.map((t) => t.function.name)].sort()

  /** When \`textOnlyFirstTurn\` is true: first LLM round uses no tools; that round does not count toward \`maxIterations\` (tool rounds only). */
  let introRound = textOnlyFirstTurn === true
  const planOnlyRequested = isPlanOnlyRequest(userMessage)
  let leadDelegationNudgeUsed = false
  let implicitHermesTerminalApprovalUsed = false
  let stagnationState = INITIAL_DIRECTORY_STAGNATION_STATE

  let iterations = 0
  let toolBatchCount = 0
  emitTrace({
    kind: 'run_start',
    allowlistToolCount: allowlistToolsSorted.length,
    allowlistToolsSorted,
  })
  if (isOrchestratorToolReplyQuarantined(provider, model)) {
    onLog?.(
      `[Orchestrator] This model was recently quarantined after repeated empty tool replies — pick another model or enable OpenRouter rate-limit fallback to a tool-stable model. (${provider} / ${retryModelLabel})`
    )
  }
  emitContextEstimate(working)

  try {
  while (iterations < maxIterations || introRound) {
    throwIfAborted(signal)
    onStreamEvent?.({ type: 'phase', phase: 'setup' })
    // Team chat inbox injection — appended *before* compaction so it rides the
    // same tail-preservation as normal user messages. Best-effort; never throws.
    if (injectUserMessageBeforeRound) {
      try {
        const extra = injectUserMessageBeforeRound()
        if (typeof extra === 'string' && extra.trim().length > 0) {
          working.push({ role: 'user', content: extra })
        }
      } catch {
        // inbox injection must never break the agent loop
      }
    }
    working = applyCompactionHierarchy(working)
    const hadUserBeforeGuard = working.some((m) => m.role === 'user')
    working = ensureWorkingSetHasUserMessage(working)
    emitContextEstimate(working)
    const budgetCheck = checkRunBudgetExceeded({
      startedAtMs: runStartedAtMs,
      nowMs: Date.now(),
      maxWallClockMs,
      estimatedContextTokens: estimateContextTokensFromWorkingSet(working),
      maxEstimatedContextTokens,
    })
    if (budgetCheck.exceeded) {
      throw new Error(`Orchestrator stopped: ${budgetCheck.reason}. Split the task or reduce context.`)
    }
    if (!hadUserBeforeGuard) {
      appendDetailed({
        kind: 'compaction',
        ts: Date.now(),
        label: 'injected_continuation_user_turn',
      })
    }
    if (introRound) {
      onActivity?.({ kind: 'llm', iteration: 1 })
    } else {
      iterations += 1
      if (iterations > maxIterations) break
      onActivity?.({ kind: 'llm', iteration: iterations })
    }
    // Pending must run *before* pace so we never sit on “Planning…” during Z.AI’s inter-round delay.
    const iterForUi = introRound ? 1 : iterations
    emitTrace({ kind: 'llm_round', iteration: iterForUi })
    if (traceDetailed) {
      appendDetailed(
        buildLlmRoundMetaTrace({
          working,
          provider,
          model,
          iteration: iterForUi,
        })
      )
    }
    onActivity?.({ kind: 'llm_pending', iteration: iterForUi, elapsedMs: 0 })
    await paceOrchestratorLlmRound(provider, signal)

    const pendingSince = Date.now()
    onActivity?.({ kind: 'llm_pending', iteration: iterForUi, elapsedMs: 0 })
    let lastNudgeSec = 0
    const hb = window.setInterval(() => {
      if (signal?.aborted) return
      const elapsedMs = Date.now() - pendingSince
      onActivity?.({
        kind: 'llm_pending',
        iteration: iterForUi,
        elapsedMs,
      })
      const sec = Math.floor(elapsedMs / 1000)
      if (!suppressStillWaitingNudges && onLog && sec >= 30 && sec - lastNudgeSec >= 30) {
        lastNudgeSec = sec
        const hint =
          provider === 'zai'
            ? 'Z.AI tool rounds return the full response (no stream); long contexts or busy periods can add latency.'
            : 'Large tool+model responses can take a while.'
        onLog(`[${sec}s] Still waiting — ${hint} Use Stop to cancel.`)
        const q = provider === 'zai' ? getZaiQueueStats() : null
        ingestOrchestratorStructuredEvent({
          kind: 'orchestrator_llm_pending',
          source: 'orchestrator',
          level: 'info',
          provider,
          model: retryModelLabel,
          payload: {
            iteration: iterForUi,
            elapsedSec: sec,
            zaiQueue: q
              ? {
                  active: q.activeCount,
                  maxConcurrent: q.maxConcurrent,
                  pending: q.pendingCount,
                  minGapMs: q.minGapMs,
                  avgWaitMs: Math.round(q.avgQueueWaitMs),
                }
              : undefined,
          },
        })
      }
    }, 500)

    const toolsForRound = introRound
      ? ([] as unknown[])
      : (toolsForApi as unknown[])

    const parallelBase =
      parallelToolCalls && shouldUseParallelToolCallsInApi(provider, model)

    const invokeLlm = async (
      useParallel: boolean,
      chatProvider: Provider,
      chatModel: string,
      chatApiKey: string | undefined,
      chatBaseUrl: string | undefined
    ): Promise<ChatCompletionResponse> => {
      const chatLabel = (modelDisplayLabel ?? chatModel).trim() || chatModel
      return chatCompletionWithTools(
        chatProvider,
        chatModel,
        chatApiKey,
        chatBaseUrl,
        working,
        toolsForRound,
        signal,
        undefined,
        {
          ...orchestratorChatOptionsFromStore(chatProvider),
          onRetry: (attempt, maxAttempts, status, waitMs) => {
            const waitSec = Math.round(waitMs / 1000)
            const who = `${PROVIDER_INFO[chatProvider].name} / ${chatLabel}`
            const q = chatProvider === 'zai' ? getZaiQueueStats() : null
            ingestOrchestratorStructuredEvent({
              kind: 'orchestrator_http_retry',
              source: 'orchestrator',
              level: status === 429 ? 'warn' : 'info',
              provider: chatProvider,
              model: chatLabel,
              payload: {
                attempt,
                maxAttempts,
                httpStatus: status,
                waitMs,
                waitSec,
                who,
                zaiQueue: q
                  ? {
                      active: q.activeCount,
                      maxConcurrent: q.maxConcurrent,
                      pending: q.pendingCount,
                    }
                  : undefined,
                fallbackImmediate: status === 429 && waitMs <= 0,
              },
            })
            if (status === 429) {
              if (waitMs <= 0) {
                onLog?.(
                  `[Rate limited on ${who}] Fallback model engaged immediately — continuing without backoff.`
                )
                return
              }
              const qLabel = q
                ? ` queue active=${q.activeCount}/${q.maxConcurrent} pending=${q.pendingCount} minGap=${q.minGapMs}ms avgWait=${Math.round(q.avgQueueWaitMs)}ms`
                : ''
              onLog?.(
                `[Rate limited on ${who}] Retry ${attempt}/${maxAttempts} in ${waitSec}s — API quota exceeded, waiting...${qLabel}`
              )
              if (chatProvider === 'zai' && attempt >= 4) {
                onLog?.(
                  '[Orchestrator] Z.AI still rate limited after multiple retries — enable OpenRouter + rate-limit fallback in Settings to continue sooner, or wait for quota.'
                )
              }
            } else {
              onLog?.(`[HTTP ${status} on ${who}] Retry ${attempt}/${maxAttempts} in ${waitSec}s`)
            }
          },
          onProviderNotice: onProviderNotice ?? onLog,
          hermesTraceStyle: hermesTerminalTraceStyle ? 'terminal_raw' : 'event_types',
          parallelToolCalls: useParallel,
        }
      )
    }

    const callLlmWithOrchestratorRetries = async (
      useParallel: boolean,
      chatProvider: Provider,
      chatModel: string,
      chatApiKey: string | undefined,
      chatBaseUrl: string | undefined
    ): Promise<ChatCompletionResponse> => {
      let overflowCompactionRetriedLocal = false
      let llmTimeoutStallRetriedLocal = false
      for (;;) {
        try {
          const out = await invokeLlm(
            useParallel,
            chatProvider,
            chatModel,
            chatApiKey,
            chatBaseUrl
          )
          if (llmTimeoutStallRetriedLocal) {
            ingestOrchestratorStructuredEvent({
              kind: 'orchestrator_llm_stall_recovered',
              source: 'orchestrator',
              level: 'info',
              provider: chatProvider,
              model: (modelDisplayLabel ?? chatModel).trim() || chatModel,
              payload: { iteration: iterForUi },
            })
          }
          return out
        } catch (e) {
          const c = classifyOrchestratorError(e)
          onLog?.(`[Orchestrator] ${c.hint}`)
          if (c.suggestCompaction && !overflowCompactionRetriedLocal) {
            overflowCompactionRetriedLocal = true
            onStreamEvent?.({ type: 'phase', phase: 'error_recovery' })
            onLog?.(
              '[Orchestrator] Context overflow — applying aggressive snip and retrying this round once.'
            )
            working = applyCompactionHierarchy(working, {
              maxChars: Math.floor(DEFAULT_MAX_WORKING_CHARS * 0.45),
              minTailMessages: 8,
            })
            appendDetailed({
              kind: 'compaction',
              ts: Date.now(),
              label: 'context_overflow_retry',
              maxChars: Math.floor(DEFAULT_MAX_WORKING_CHARS * 0.45),
              minTailMessages: 8,
            })
            continue
          }
          if (c.suggestStallRetry && !llmTimeoutStallRetriedLocal) {
            llmTimeoutStallRetriedLocal = true
            ingestOrchestratorStructuredEvent({
              kind: 'orchestrator_llm_stall_detected',
              source: 'orchestrator',
              level: 'warn',
              provider: chatProvider,
              model: (modelDisplayLabel ?? chatModel).trim() || chatModel,
              payload: { iteration: iterForUi, willRetry: true },
            })
            ingestOrchestratorStructuredEvent({
              kind: 'orchestrator_llm_stall_retry',
              source: 'orchestrator',
              level: 'info',
              provider: chatProvider,
              model: (modelDisplayLabel ?? chatModel).trim() || chatModel,
              payload: { iteration: iterForUi },
            })
            onStreamEvent?.({ type: 'phase', phase: 'error_recovery' })
            onLog?.(
              '[Orchestrator] LLM request timed out — applying compaction and retrying this round once.'
            )
            working = applyCompactionHierarchy(working, {
              maxChars: Math.floor(DEFAULT_MAX_WORKING_CHARS * 0.45),
              minTailMessages: 8,
            })
            appendDetailed({
              kind: 'compaction',
              ts: Date.now(),
              label: 'llm_timeout_stall_retry',
              maxChars: Math.floor(DEFAULT_MAX_WORKING_CHARS * 0.45),
              minTailMessages: 8,
            })
            continue
          }
          if (c.kind === 'timeout' && llmTimeoutStallRetriedLocal) {
            ingestOrchestratorStructuredEvent({
              kind: 'orchestrator_llm_stall_exhausted',
              source: 'orchestrator',
              level: 'error',
              provider: chatProvider,
              model: (modelDisplayLabel ?? chatModel).trim() || chatModel,
              payload: { iteration: iterForUi },
            })
          }
          throw e
        }
      }
    }

    onStreamEvent?.({ type: 'phase', phase: 'model' })
    let res: ChatCompletionResponse
    let parallelOverride: boolean | undefined = undefined
    let emptyToolRecoveryPhase = 0
    try {
      res = await callLlmWithOrchestratorRetries(
        parallelOverride ?? parallelBase,
        provider,
        model,
        apiKey,
        baseUrl
      )
      emitUsageIfPresent(res)
    } finally {
      window.clearInterval(hb)
    }

    let choice: ChatCompletionResponse['choices'][number]
    let msg: NonNullable<ChatCompletionResponse['choices'][number]['message']>
    let effectiveToolCalls: ToolCall[] | null

    /** One completion retry when the gateway returns a body without usable `choices` (e.g. wrapped error JSON). */
    let missingChoicesRetried = false

    EMPTY_TOOL_RECOVERY: for (;;) {
      for (;;) {
        try {
          choice = pickAssistantChoiceOrThrow(res)
          break
        } catch (e) {
          const msgErr = e instanceof Error ? e.message : String(e)
          if (!missingChoicesRetried && /invalid completion payload/i.test(msgErr)) {
            missingChoicesRetried = true
            onLog?.(
              `[Orchestrator] Invalid completion payload — retrying the request once (${provider} / ${retryModelLabel}).`
            )
            res = await callLlmWithOrchestratorRetries(
              parallelOverride ?? parallelBase,
              provider,
              model,
              apiKey,
              baseUrl
            )
            emitUsageIfPresent(res)
            continue
          }
          onLog?.(`[Schema guard] ${msgErr}`)
          throw e
        }
      }
      if (!choice?.message) {
        throw new Error('Empty completion from model')
      }
      msg = choice.message
      effectiveToolCalls = introRound
        ? null
        : msg.tool_calls && msg.tool_calls.length > 0
          ? msg.tool_calls
          : parseTextToolCalls(msg.content)

      if (effectiveToolCalls && effectiveToolCalls.length > 0) {
        break EMPTY_TOOL_RECOVERY
      }

      const strippedForRecovery = stripAssistantToolArtifacts(
        typeof msg.content === 'string' ? msg.content : ''
      )
      const isEmptyToolRound =
        !introRound && toolsForRound.length > 0 && !strippedForRecovery.trim()

      if (!isEmptyToolRound) {
        break EMPTY_TOOL_RECOVERY
      }

      emptyToolRecoveryPhase += 1
      ingestOrchestratorStructuredEvent({
        kind: 'orchestrator_empty_tool_reply_detected',
        source: 'orchestrator',
        level: 'warn',
        provider,
        model: retryModelLabel,
        payload: { iteration: iterForUi, phase: emptyToolRecoveryPhase },
      })

      if (emptyToolRecoveryPhase === 1) {
        onLog?.(
          `[Orchestrator] Model returned an empty tool reply — retrying once (${provider} / ${retryModelLabel}).`
        )
        ingestOrchestratorStructuredEvent({
          kind: 'orchestrator_empty_tool_reply_retry_same_model',
          source: 'orchestrator',
          level: 'info',
          provider,
          model: retryModelLabel,
          payload: { iteration: iterForUi },
        })
        res = await callLlmWithOrchestratorRetries(
          parallelOverride ?? parallelBase,
          provider,
          model,
          apiKey,
          baseUrl
        )
        emitUsageIfPresent(res)
        continue
      }

      if (emptyToolRecoveryPhase === 2 && parallelBase) {
        parallelOverride = false
        onLog?.(
          `[Orchestrator] Retrying with parallel_tool_calls disabled — some models fail when parallel tool calls are enabled (${provider} / ${retryModelLabel}).`
        )
        ingestOrchestratorStructuredEvent({
          kind: 'orchestrator_empty_tool_reply_retry_parallel_off',
          source: 'orchestrator',
          level: 'info',
          provider,
          model: retryModelLabel,
          payload: { iteration: iterForUi },
        })
        res = await callLlmWithOrchestratorRetries(false, provider, model, apiKey, baseUrl)
        emitUsageIfPresent(res)
        continue
      }

      if (emptyToolRecoveryPhase === 3) {
        if (provider === 'openrouter') {
          const activated = tryActivateOpenRouterRateLimitFallback(model, model)
          const fbModel = getEffectiveOpenRouterModel(model)
          if (activated && fbModel.trim() !== model.trim()) {
            onLog?.(
              `[Orchestrator] Empty tool reply — using OpenRouter fallback model for this session window: ${fbModel}`
            )
            ingestOrchestratorStructuredEvent({
              kind: 'orchestrator_empty_tool_reply_openrouter_fallback',
              source: 'orchestrator',
              level: 'info',
              provider,
              model: retryModelLabel,
              payload: { iteration: iterForUi, fallbackModel: fbModel },
            })
            res = await callLlmWithOrchestratorRetries(
              parallelOverride ?? parallelBase,
              'openrouter',
              fbModel,
              apiKey,
              baseUrl
            )
            emitUsageIfPresent(res)
            continue
          }
        }

        const zaiFb = readOpenRouterFallbackConfigForZaiRateLimit()
        if (provider === 'zai' && zaiFb) {
          emitZaiOpenRouterFallbackNotice(zaiFb.model, onLog)
          ingestOrchestratorStructuredEvent({
            kind: 'orchestrator_empty_tool_reply_zai_openrouter_hop',
            source: 'orchestrator',
            level: 'warn',
            provider,
            model: retryModelLabel,
            payload: { iteration: iterForUi, fallbackModel: zaiFb.model },
          })
          res = await callLlmWithOrchestratorRetries(
            false,
            'openrouter',
            zaiFb.model,
            zaiFb.apiKey,
            zaiFb.baseUrl
          )
          emitUsageIfPresent(res)
          continue
        }
      }

      noteOrchestratorEmptyToolReplyFailure(provider, model)
      ingestOrchestratorStructuredEvent({
        kind: 'orchestrator_empty_tool_reply_exhausted',
        source: 'orchestrator',
        level: 'error',
        provider,
        model: retryModelLabel,
        payload: { iteration: iterForUi, phasesAttempted: emptyToolRecoveryPhase },
      })
      const errMsg =
        `Orchestrator: Model accepted tool mode but returned an empty tool reply after recovery attempts (${provider} / ${retryModelLabel}). ` +
        'Try another model, enable OpenRouter rate-limit fallback to a tool-stable model in Settings → Models, or use a provider with reliable tool calling (e.g. OpenAI Codex / API).'
      onLog?.(`[Error] ${errMsg}`)
      throw new Error(errMsg)
    }

    const effectiveParallelTools = parallelOverride ?? parallelBase

    if (effectiveToolCalls && effectiveToolCalls.length > 0) {
      const toolNames = effectiveToolCalls.map((tc) => tc.function?.name).filter(Boolean) as string[]
      const planOnlyBlockedTools = planOnlyRequested
        ? toolNames.filter((name) => isPlanOnlyDisallowedTool(name))
        : []

      if (planOnlyBlockedTools.length > 0) {
        const blockedSummary = Array.from(new Set(planOnlyBlockedTools)).join(', ')
        const guardLine =
          `[Plan-only guard] Blocked mutating tool call(s): ${blockedSummary}. ` +
          'User requested plan-only/read-only behavior. Continue with analysis/plan only.'
        onLog?.(guardLine)
        working.push({
          role: 'assistant',
          content: stripAssistantToolArtifacts(typeof msg.content === 'string' ? msg.content : ''),
          tool_calls: effectiveToolCalls,
        })
        for (const tc of effectiveToolCalls) {
          working.push({ role: 'tool', tool_call_id: tc.id, content: guardLine })
        }
        working.push({
          role: 'user',
          content:
            '[Policy reminder] Keep this run in plan-only mode: read/analyze only, no file/system/network mutations.',
        })
        emitContextEstimate(working)
        throwIfAborted(signal)
        continue
      }

      toolBatchCount += 1
      if (introRound) introRound = false
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        onLog?.('[Tool-call fallback] Parsed tool calls from assistant text output.')
      }
      emitTrace({ kind: 'tool_batch', toolNames })
      onActivity?.({ kind: 'tools', iteration: iterForUi, toolNames })
      onStreamEvent?.({ type: 'phase', phase: 'tools' })

      const toolTotal = effectiveToolCalls.length
      let toolProgress = { completed: 0, total: toolTotal, currentTool: undefined as string | undefined }
      const toolPendingSince = Date.now()
      let lastToolNudgeSec = 0
      const toolNudgeFirstSec = 45
      const toolNudgeLaterSec = 90
      const emitToolsPending = () => {
        const elapsedMs = Date.now() - toolPendingSince
        onActivity?.({
          kind: 'tools_pending',
          iteration: iterForUi,
          toolNames,
          elapsedMs,
          completed: toolProgress.completed,
          total: toolProgress.total,
          currentTool: toolProgress.currentTool,
        })
      }
      emitToolsPending()
      const toolHb = window.setInterval(() => {
        if (signal?.aborted) return
        emitToolsPending()
        const elapsedMs = Date.now() - toolPendingSince
        const sec = Math.floor(elapsedMs / 1000)
        if (
          onLog &&
          sec >= toolNudgeFirstSec &&
          sec - lastToolNudgeSec >= (lastToolNudgeSec === 0 ? toolNudgeFirstSec : toolNudgeLaterSec)
        ) {
          lastToolNudgeSec = sec
          const cur = toolProgress.currentTool ? ` (${toolProgress.currentTool})` : ''
          onLog(
            `[${sec}s] Tools still running — ${toolProgress.completed}/${toolProgress.total} done${cur}. Use Stop to cancel.`
          )
        }
      }, 500)

      working.push({
        role: 'assistant',
        content: stripAssistantToolArtifacts(
          typeof msg.content === 'string' ? msg.content : ''
        ),
        tool_calls: effectiveToolCalls,
      })
      emitContextEstimate(working)

      const stagnation = ablation.stagnationGuard
        ? evaluateDirectoryStagnation(effectiveToolCalls, stagnationState)
        : { action: 'none' as const, nextState: INITIAL_DIRECTORY_STAGNATION_STATE }
      stagnationState = stagnation.nextState
      if (stagnation.action !== 'none') {
        appendDetailed({
          kind: 'stagnation',
          ts: Date.now(),
          action: stagnation.action === 'halt' ? 'halt' : 'nudge',
          reason: stagnation.reason,
        })
        const guardLine =
          `[Stagnation guard] ${stagnation.reason} ` +
          'Use canvas_list_modules once, then targeted read_file paths, and delegate narrow tracks.'
        onLog?.(guardLine)
        for (const tc of effectiveToolCalls) {
          working.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: guardLine,
          })
        }
        if (stagnation.action === 'halt') {
          throw new Error('Orchestrator stopped early: directory-crawl stagnation guard triggered.')
        }
        working.push({
          role: 'user',
          content:
            '[Guard directive] Re-plan in phases/chunks now. Stop broad list_directory crawling and continue with targeted reads + delegation.',
        })
        throwIfAborted(signal)
        continue
      }

      let toolResults: Array<{ tool_call_id: string; content: string }>
      try {
        toolResults = await executeAssistantToolCalls(
          effectiveToolCalls,
          {
            orchestratorTileId: orchestratorTileId ?? null,
            workspaceRoot,
            runGeneration,
            subAgentTileId,
          },
          {
            parallel: effectiveParallelTools,
            signal,
            onLog,
            respectParallelBatchRules: ablation.parallelBatchRules,
            onToolProgress: ({ completed, total, currentTool }) => {
              toolProgress = { completed, total, currentTool }
            },
            onDiagnosticToolTrace: traceDetailed
              ? ({ tool, argsRaw, resultRaw }) => {
                  const a = prepareArgsForHarnessTrace(argsRaw)
                  const r = prepareResultForHarnessTrace(resultRaw)
                  appendDetailed({
                    kind: 'tool_call_detail',
                    ts: Date.now(),
                    iteration: iterForUi,
                    tool,
                    argsRedacted: a.argsRedacted,
                    resultRedacted: r.resultRedacted,
                    argsTruncated: a.argsTruncated,
                    resultTruncated: r.resultTruncated,
                    resultChars: r.resultChars,
                  })
                }
              : undefined,
          }
        )
      } finally {
        window.clearInterval(toolHb)
      }

      for (const tr of toolResults) {
        working.push({
          role: 'tool',
          tool_call_id: tr.tool_call_id,
          content: tr.content,
        })
      }
      emitContextEstimate(working)
      throwIfAborted(signal)
      onStreamEvent?.({ type: 'phase', phase: 'continuation' })
      continue
    }

    stagnationState = INITIAL_DIRECTORY_STAGNATION_STATE
    const rawText = typeof msg.content === 'string' ? msg.content : ''
    const textOnly = stripAssistantToolArtifacts(rawText)
    if (introRound) {
      working.push({
        role: 'assistant',
        content: textOnly,
      })
      emitContextEstimate(working)
      const intro = textOnly.trim()
      if (intro) {
        onAssistantReply?.(textOnly)
      }
      introRound = false
      throwIfAborted(signal)
      continue
    }

    if (
      shouldNudgeLeadDelegationBeforeTerminalReply({
        leadDelegationOnly,
        subAgentTileId,
        introRound,
        toolBatchCount,
        textOnly,
        alreadyRetried: leadDelegationNudgeUsed,
      })
    ) {
      leadDelegationNudgeUsed = true
      onLog?.(
        '[Lead delegation guard] Plan-only reply detected before any delegated work. Retrying with explicit delegation directive.'
      )
      working.push({
        role: 'assistant',
        content: textOnly,
      })
      working.push({
        role: 'user',
        content:
          '[Lead directive] You are in lead delegation mode. Execute at least one concrete delegation/tool batch now (prefer spawn_sub_agent with clear task scopes) before finalizing.',
      })
      emitContextEstimate(working)
      throwIfAborted(signal)
      continue
    }

    if (
      provider === 'hermes' &&
      !implicitHermesTerminalApprovalUsed &&
      shouldAutoApproveHermesTerminalSecurityGate(textOnly)
    ) {
      implicitHermesTerminalApprovalUsed = true
      onLog?.('[Hermes approval bridge] Auto-approving terminal security gate and continuing.')
      working.push({
        role: 'assistant',
        content: textOnly,
      })
      working.push({
        role: 'user',
        content: 'approved',
      })
      emitContextEstimate(working)
      throwIfAborted(signal)
      continue
    }

    working.push({
      role: 'assistant',
      content: textOnly,
    })
    emitContextEstimate(working)

    const tail = working[working.length - 1]
    const text =
      tail.role === 'assistant' && typeof tail.content === 'string' ? tail.content : ''

    if (
      shouldRejectEmptyTerminalAssistantMessage({
        textOnly,
        toolBatchCount,
        iterations,
        introRound,
      })
    ) {
      const errMsg =
        toolBatchCount > 0
          ? `Orchestrator: Model returned an empty final response after ${toolBatchCount} tool batch${toolBatchCount === 1 ? '' : 'es'} — treating as failure to avoid silent completion. (${provider} / ${retryModelLabel})`
          : `Orchestrator: Model returned no output — try a different model or check API access. (${provider} / ${retryModelLabel})`
      onLog?.(`[Error] ${errMsg}`)
      throw new Error(errMsg)
    }

    const nextSession = working.slice(1)
    emitTrace({ kind: 'run_end', ok: true })
    onStreamEvent?.({ type: 'done', messages: nextSession, assistantText: text })
    void mirrorOrchestratorSessionToVault(text)
    return { assistantText: text, messages: nextSession }
  }

  throw new Error(
    `Orchestrator stopped: exceeded max tool rounds (${maxIterations}). Split the task or raise maxIterations.`
  )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emitTrace({ kind: 'run_end', ok: false, error: msg })
    onStreamEvent?.({ type: 'phase', phase: 'error_recovery' })
    void mirrorOrchestratorErrorToVault(msg)
    throw e
  }
}

/**
 * Orchestrator entry used by the canvas session and sub-agents: when **lead delegation only**
 * is on and this is not a worker tile, runs with the narrow lead tool allowlist; otherwise full tools.
 */
export function resolveLeadDelegationForRun(params: {
  explicitLeadDelegationOnly?: boolean
  settingsLeadDelegationOnly: boolean
  leadProfile: 'default' | 'hermes'
}): boolean {
  if (typeof params.explicitLeadDelegationOnly === 'boolean') return params.explicitLeadDelegationOnly
  if (params.leadProfile === 'hermes') return false
  return params.settingsLeadDelegationOnly !== false
}

export async function runOrchestratorLeadAware(
  options: RunOrchestratorOptions & { leadDelegationOnly?: boolean }
): Promise<{ assistantText: string; messages: ChatMessage[] }> {
  const settings = useSettingsStore.getState()
  const leadDelegation = resolveLeadDelegationForRun({
    explicitLeadDelegationOnly: options.leadDelegationOnly,
    settingsLeadDelegationOnly: settings.orchestratorLeadDelegationOnly,
    leadProfile: settings.leadProfile,
  })

  if (leadDelegation && !options.subAgentTileId) {
    return runOrchestratorAgent({
      ...options,
      toolAllowlist: [...LEAD_ORCHESTRATOR_TOOL_ALLOWLIST],
      leadDelegationOnly: true,
    })
  }
  return runOrchestratorAgent(options)
}

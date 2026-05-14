/**
 * Deterministic harness eval tasks (no live LLM). Search vs test splits use the same kinds by default;
 * `tasks.memory.json` simulates distiller + recurring-issue behavior via a harness-local signals file.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EMPTY_EXECUTION_CONTRACT,
  mergeExecutionContract,
} from '../orchestratorExecutionContract'
import { filterOrchestratorToolsByAllowlist } from '../orchestratorToolFilter'
import type { HarnessCandidateScoresV1, HarnessTaskResultV1 } from '../harnessCandidates'
import { buildHeartbeatSyntheticUserMessage } from '../orchestratorHeartbeat'
import { buildAutonomyConstitutionPromptBlock } from '../orchestratorAutonomyPolicy'
import { buildDynamicPromptPreface } from '../orchestratorPromptLayers'
import { shouldRejectEmptyTerminalAssistantMessage } from '../runOrchestrator'
import { classifyOrchestratorError } from '../orchestratorErrorTaxonomy'
import {
  ORCHESTRATOR_DEFAULT_MAX_ITERATIONS,
  ORCHESTRATOR_HARD_MAX_ITERATIONS,
  ORCHESTRATOR_SIMPLE_MAX_ITERATIONS,
} from '../orchestratorConstants'
import {
  formatToolTraceEndLine,
  formatToolTraceStartLine,
  shouldParallelizeToolBatch,
} from '../orchestratorToolBatch'
import type { ToolCall } from '../types'
import { wrapOrcaShellCommand, shellQuoteArgvZsh } from '../../terminal/wrapShellCommand'
import { stripAnsiForTelemetry } from '../../terminal/terminalOutputSignals'
import { applySafetyMode, scanShellCommandForDanger, scanWorkspacePathForSensitivity } from '../orchestratorSafetyGuard'
import {
  buildPathMutationRecoveryBranch,
  buildShellRecoveryBranch,
  executeOrchestratorTool,
} from '../executeTools'
import { aggregateInvariantScores } from './scoreAggregation'
import { useAgentTeamStore } from '../../../store/agentTeamStore'
import { mergePendingSubAgentHandoffs } from '../../../store/orchestratorSessionStore'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Harness-only JSONL (same row shape as `.orca/MEMORY.signals.jsonl`) for memory split eval. */
export const MEMORY_EVAL_SIGNALS_REL = '.agent-canvas/harness/memory-eval-signals.jsonl'

export type MemoryDistillerSignalKindHarness =
  | 'error'
  | 'stagnation'
  | 'inspect'
  | 'merge_reject'

export type HarnessEvalTaskDef =
  | { id: string; kind: 'execution_contract_merge' }
  | { id: string; kind: 'tool_filter_smoke' }
  | {
      id: string
      kind: 'memory_recurring_gate'
      signalKind: MemoryDistillerSignalKindHarness
      /** `detail` must start with this prefix (matches distiller-style rows). */
      detailPrefix: string
    }
  | { id: string; kind: 'heartbeat_synthetic_message_marker' }
  | { id: string; kind: 'autonomy_constitution_broad_gates' }
  | { id: string; kind: 'autonomy_constitution_standard_confirm' }
  | { id: string; kind: 'terminal_wrap_shell_markers' }
  | { id: string; kind: 'terminal_argv_quoting_noglob' }
  | { id: string; kind: 'terminal_strip_bracketed_paste' }
  | { id: string; kind: 'orchestrator_tool_allowlist_terminal_command_tools' }
  | { id: string; kind: 'terminal_success_requires_non_empty_final' }
  | { id: string; kind: 'single_failure_requires_recovery_attempt' }
  | { id: string; kind: 'prompt_flow_contract_present' }
  | { id: string; kind: 'interruption_answer_then_resume_offer' }
  | { id: string; kind: 'safety_gate_blocks_destructive_shell' }
  | { id: string; kind: 'wait_for_sub_agent_cancellation_integrity' }
  | { id: string; kind: 'error_first_recovery_branching' }
  | { id: string; kind: 'file_mutation_sensitive_path_branching' }
  | { id: string; kind: 'regression_canary_detection' }
  | { id: string; kind: 'grounding_evidence_contract' }
  | { id: string; kind: 'stale_data_refresh_contract' }
  | { id: string; kind: 'tool_failure_uncertainty_contract' }
  | { id: string; kind: 'mid_run_policy_steering_contract' }
  | { id: string; kind: 'iteration_cap_enforcement' }
  | { id: string; kind: 'parallel_tool_conflict_guard' }
  | { id: string; kind: 'exactly_once_resume_handoff_integrity' }
  | { id: string; kind: 'heartbeat_synthetic_tag_skip_hygiene' }
  | { id: string; kind: 'trace_phase_end_state_completeness' }

export type HarnessEvalSplit = 'search' | 'test' | 'memory' | 'proactive' | 'conformance'

export const HARNESS_EVAL_TASK_KINDS = [
  'execution_contract_merge',
  'tool_filter_smoke',
  'memory_recurring_gate',
  'heartbeat_synthetic_message_marker',
  'autonomy_constitution_broad_gates',
  'autonomy_constitution_standard_confirm',
  'terminal_wrap_shell_markers',
  'terminal_argv_quoting_noglob',
  'terminal_strip_bracketed_paste',
  'orchestrator_tool_allowlist_terminal_command_tools',
  'terminal_success_requires_non_empty_final',
  'single_failure_requires_recovery_attempt',
  'prompt_flow_contract_present',
  'interruption_answer_then_resume_offer',
  'safety_gate_blocks_destructive_shell',
  'wait_for_sub_agent_cancellation_integrity',
  'error_first_recovery_branching',
  'file_mutation_sensitive_path_branching',
  'regression_canary_detection',
  'grounding_evidence_contract',
  'stale_data_refresh_contract',
  'tool_failure_uncertainty_contract',
  'mid_run_policy_steering_contract',
  'iteration_cap_enforcement',
  'parallel_tool_conflict_guard',
  'exactly_once_resume_handoff_integrity',
  'heartbeat_synthetic_tag_skip_hygiene',
  'trace_phase_end_state_completeness',
] as const

const HARNESS_EVAL_TASK_KIND_SET = new Set<string>(HARNESS_EVAL_TASK_KINDS)
const HARNESS_EVAL_SPLIT_SET = new Set<HarnessEvalSplit>([
  'search',
  'test',
  'memory',
  'proactive',
  'conformance',
])

export interface HarnessEvalFileV1 {
  version: 1
  split: HarnessEvalSplit
  tasks: HarnessEvalTaskDef[]
}

export function parseHarnessEvalFileStrict(raw: string, expectedSplit?: HarnessEvalSplit): HarnessEvalFileV1 {
  const parsed = JSON.parse(raw) as {
    version?: unknown
    split?: unknown
    tasks?: unknown
  }
  if (parsed.version !== 1) throw new Error('Invalid task file: version must be 1')
  if (typeof parsed.split !== 'string' || !HARNESS_EVAL_SPLIT_SET.has(parsed.split as HarnessEvalSplit)) {
    throw new Error(`Invalid task file: unknown split ${String(parsed.split)}`)
  }
  const split = parsed.split as HarnessEvalSplit
  if (expectedSplit && split !== expectedSplit) {
    throw new Error(`Invalid task file: split mismatch expected=${expectedSplit} actual=${split}`)
  }
  if (!Array.isArray(parsed.tasks)) throw new Error('Invalid task file: tasks must be an array')

  const tasks: HarnessEvalTaskDef[] = parsed.tasks.map((entry, idx) => {
    const t = entry as { id?: unknown; kind?: unknown }
    if (typeof t?.id !== 'string' || !t.id.trim()) {
      throw new Error(`Invalid task file: tasks[${idx}] missing string id`)
    }
    if (typeof t?.kind !== 'string' || !HARNESS_EVAL_TASK_KIND_SET.has(t.kind)) {
      throw new Error(`Invalid task file: tasks[${idx}] unknown kind ${String(t?.kind)}`)
    }
    return t as HarnessEvalTaskDef
  })

  return { version: 1, split, tasks }
}

export function resolveHarnessWorkspaceRoot(explicit?: string): string {
  const ex = explicit?.trim()
  if (ex) return ex
  if (typeof process !== 'undefined' && process.env?.ORCA_WORKSPACE_ROOT?.trim()) {
    return process.env.ORCA_WORKSPACE_ROOT.trim()
  }
  return join(__dirname, '../../../../../../')
}

/**
 * Duplicate rows per failure mode (≥2 same key) so `formatRecurringIssueBlock`-style logic would fire.
 * Used after a **cold** memory eval run to simulate “session 2 with distiller + recurring block”.
 */
export function buildMemoryEvalSeedContent(): string {
  const ts = Date.now()
  const sid = 'harness-eval-memory'
  const rows: { ts: number; sessionId: string; kind: string; detail: string }[] = [
    {
      ts,
      sessionId: sid,
      kind: 'error',
      detail: 'context_limit: simulated overflow (harness memory eval)',
    },
    {
      ts: ts + 1,
      sessionId: sid,
      kind: 'error',
      detail: 'context_limit: simulated overflow (harness memory eval)',
    },
    {
      ts: ts + 2,
      sessionId: sid,
      kind: 'stagnation',
      detail: 'repeated_tool: stuck in tool loop (harness memory eval)',
    },
    {
      ts: ts + 3,
      sessionId: sid,
      kind: 'stagnation',
      detail: 'repeated_tool: stuck in tool loop (harness memory eval)',
    },
    {
      ts: ts + 4,
      sessionId: sid,
      kind: 'inspect',
      detail: 'hard failure: cannot auto-fix (harness memory eval)',
    },
    {
      ts: ts + 5,
      sessionId: sid,
      kind: 'inspect',
      detail: 'hard failure: cannot auto-fix (harness memory eval)',
    },
  ]
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
}

/** Same key line as `formatRecurringIssueBlockFromSignalsJsonl` / distiller: `kind:detail[0:160]`. */
function maxRepeatCountForSignal(
  raw: string,
  signalKind: MemoryDistillerSignalKindHarness,
  detailPrefix: string
): number {
  const counts = new Map<string, number>()
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const j = JSON.parse(t) as { kind?: string; detail?: string }
      if (j.kind !== signalKind) continue
      const d = (j.detail ?? '').trim()
      if (!d.startsWith(detailPrefix)) continue
      const key = `${j.kind ?? 'unknown'}:${d.slice(0, 160)}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    } catch {
      /* ignore bad line */
    }
  }
  let max = 0
  for (const n of counts.values()) {
    if (n > max) max = n
  }
  return max
}

export async function evaluateOneTask(
  task: HarnessEvalTaskDef,
  workspaceRoot?: string
): Promise<HarnessTaskResultV1> {
  switch (task.kind) {
    case 'execution_contract_merge': {
      const merged = mergeExecutionContract(EMPTY_EXECUTION_CONTRACT, {
        requiredOutputs: ['verify_me'],
      })
      const pass = merged.requiredOutputs.some((x) => x.includes('verify_me'))
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass ? 'merge requiredOutputs' : 'merge contract mismatch',
      }
    }
    case 'tool_filter_smoke': {
      const allow = ['read_file', 'write_file']
      const tools = filterOrchestratorToolsByAllowlist(allow)
      const names = new Set(tools.map((t) => t.function.name))
      const pass = tools.length >= 1 && [...names].every((n) => allow.includes(n))
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass ? `allowlist size ${tools.length}` : 'allowlist empty or unexpected',
        contextKTokens: Math.min(12, tools.length * 0.01),
        latencyMs: 1,
      }
    }
    case 'memory_recurring_gate': {
      const root = workspaceRoot ?? resolveHarnessWorkspaceRoot()
      const path = join(root, MEMORY_EVAL_SIGNALS_REL)
      let raw = ''
      try {
        raw = await readFile(path, 'utf8')
      } catch {
        return {
          id: task.id,
          pass: false,
          score: 0,
          notes: `no harness signals file (cold start): ${MEMORY_EVAL_SIGNALS_REL}`,
          contextKTokens: 0.01,
          latencyMs: 1,
        }
      }
      const max = maxRepeatCountForSignal(raw, task.signalKind, task.detailPrefix)
      const pass = max >= 2
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? `recurring signal key count max=${max} (need ≥2) for ${task.signalKind}/${task.detailPrefix}`
          : `no recurring pair yet (max=${max}); simulates missing distiller + recurring-issue block`,
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'heartbeat_synthetic_message_marker': {
      const msg = buildHeartbeatSyntheticUserMessage('tick', '2099-01-01T00:00:00.000Z')
      const pass = msg.includes('[Orca heartbeat') && msg.includes('HEARTBEAT.md')
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass ? 'synthetic heartbeat message shape ok' : 'missing heartbeat markers',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'autonomy_constitution_broad_gates': {
      const block = buildAutonomyConstitutionPromptBlock('broad')
      const pass =
        block.includes('Ask first') &&
        block.includes('never automatic') &&
        block.includes('wide latitude')
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass ? 'broad autonomy lists explicit gates' : 'broad autonomy block missing expected phrases',
        contextKTokens: 0.03,
        latencyMs: 1,
      }
    }
    case 'autonomy_constitution_standard_confirm': {
      const block = buildAutonomyConstitutionPromptBlock('standard')
      const pass = block.includes('Confirm first') && block.includes('standard')
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass ? 'standard autonomy mentions confirm-first' : 'standard autonomy block unexpected',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'terminal_wrap_shell_markers': {
      const w = wrapOrcaShellCommand({ command: 'echo hi' })
      // Written command uses shell `$'\\033…'` — bytes are backslash literals until the shell runs `printf`.
      const pass =
        w.includes('133;C') &&
        w.includes('__ORCA_EXIT__:') &&
        w.includes('printf') &&
        w.includes('133;D;')
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass ? 'wrapShellCommand emits OSC C/D + __ORCA_EXIT__' : 'wrapShellCommand marker mismatch',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'terminal_argv_quoting_noglob': {
      const inner = shellQuoteArgvZsh(['npx', 'create-next-app', 'MyCapitalApp', '@scoped/pkg'])
      const ok =
        inner.includes(`'MyCapitalApp'`) &&
        inner.includes(`'@scoped/pkg'`) &&
        inner.split(' ').every((tok) => tok.startsWith("'") && tok.endsWith("'"))
      return {
        id: task.id,
        pass: ok,
        score: ok ? 10 : 0,
        notes: ok ? 'argv tokens are single-quoted (zsh noglob-safe)' : `unexpected argv join: ${inner}`,
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'terminal_strip_bracketed_paste': {
      const raw = 'ready \x1b[200~\x1b[201~ ok'
      const stripped = stripAnsiForTelemetry(raw).replace(/\s+/g, ' ').trim()
      const pass = stripped === 'ready ok'
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass ? 'bracketed paste wrappers stripped' : `got "${stripped}"`,
        contextKTokens: 0.01,
        latencyMs: 1,
      }
    }
    case 'orchestrator_tool_allowlist_terminal_command_tools': {
      const allow = [
        'read_file',
        'get_last_terminal_command',
        'wait_for_terminal_command',
      ]
      const tools = filterOrchestratorToolsByAllowlist(allow)
      const names = new Set(tools.map((t) => t.function.name))
      const pass =
        names.has('get_last_terminal_command') &&
        names.has('wait_for_terminal_command') &&
        tools.length === allow.length
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass ? 'terminal command tools resolve in allowlist filter' : `missing tools: ${[...names].join(',')}`,
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'terminal_success_requires_non_empty_final': {
      const shouldRejectSilentSuccess = shouldRejectEmptyTerminalAssistantMessage({
        textOnly: '   ',
        toolBatchCount: 2,
        iterations: 3,
        introRound: false,
      })
      const shouldAcceptNonEmpty =
        shouldRejectEmptyTerminalAssistantMessage({
          textOnly: 'Completed update and validated tests.',
          toolBatchCount: 2,
          iterations: 3,
          introRound: false,
        }) === false
      const pass = shouldRejectSilentSuccess && shouldAcceptNonEmpty
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'final-response guard rejects empty success after tool rounds'
          : 'empty final response guard missing or over-blocking',
        contextKTokens: 0.03,
        latencyMs: 1,
      }
    }
    case 'single_failure_requires_recovery_attempt': {
      const overflow = classifyOrchestratorError(new Error('context length exceeded by model'))
      const timeout = classifyOrchestratorError(new DOMException('request timed out', 'TimeoutError'))
      const pass = overflow.suggestCompaction === true && timeout.suggestStallRetry === true
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'error taxonomy exposes bounded recovery hints (compaction + stall retry)'
          : 'missing recovery hint flags for recoverable failures',
        contextKTokens: 0.03,
        latencyMs: 1,
      }
    }
    case 'prompt_flow_contract_present': {
      const preface = buildDynamicPromptPreface('default')
      const pass =
        preface.includes('Prompt-flow contract (mandatory order)') &&
        preface.includes('Skills/context scan first') &&
        preface.includes('Patch/test/verify')
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'dynamic prompt preface includes staged flow contract markers'
          : 'missing staged flow contract markers in dynamic prompt preface',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'interruption_answer_then_resume_offer': {
      const preface = buildDynamicPromptPreface('default')
      const pass =
        preface.includes('Interruption-resume protocol') &&
        preface.includes('Answer the interruption') &&
        preface.includes('resume handoff')
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'prompt contract enforces interruption-first answer + explicit resume handoff'
          : 'missing interruption/resume policy markers in dynamic prompt preface',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'safety_gate_blocks_destructive_shell': {
      const cmd = 'rm -rf ./tmp-test-dir'
      const scan = scanShellCommandForDanger(cmd)
      const blockMode = applySafetyMode('block', scan)
      const warnMode = applySafetyMode('warn', scan)
      const pass = scan.matchedIds.includes('destructive_rm_rf') && !blockMode.allow && warnMode.allow
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'destructive shell pattern is detected and blocked in block mode (warn mode remains non-blocking)'
          : `safety gate mismatch: matched=${scan.matchedIds.join(',') || 'none'} blockAllow=${String(blockMode.allow)} warnAllow=${String(warnMode.allow)}`,
        contextKTokens: 0.03,
        latencyMs: 1,
      }
    }
    case 'wait_for_sub_agent_cancellation_integrity': {
      const prevMembers = useAgentTeamStore.getState().membersByTileId
      useAgentTeamStore.setState({ membersByTileId: {} })
      try {
        useAgentTeamStore.getState().registerMember({
          tileId: 'harness-eval-cancel',
          displayName: 'Harness Worker',
          role: 'Eval',
          currentTask: 'Working…',
          status: 'working',
        })
        const ac = new AbortController()
        ac.abort()
        const raw = await executeOrchestratorTool(
          'wait_for_sub_agent',
          JSON.stringify({ tile_id: 'harness-eval-cancel', timeout_ms: 5_000 }),
          { orchestratorTileId: null, signal: ac.signal }
        )
        const out = JSON.parse(raw) as { ok?: boolean; outcome?: string; error?: string }
        const pass = out.ok === true && out.outcome === 'cancelled' && /aborted/i.test(String(out.error ?? ''))
        return {
          id: task.id,
          pass,
          score: pass ? 10 : 0,
          notes: pass
            ? 'wait_for_sub_agent returns cancelled immediately when parent signal is already aborted'
            : `unexpected wait_for_sub_agent cancel payload: ${raw}`,
          contextKTokens: 0.03,
          latencyMs: 1,
        }
      } finally {
        useAgentTeamStore.setState({ membersByTileId: prevMembers })
      }
    }
    case 'error_first_recovery_branching': {
      const preface = buildDynamicPromptPreface('default')
      const promptHasProtocol =
        preface.includes('Error-first recovery protocol') &&
        preface.includes('Treat tool failures as **data**, not dead ends.') &&
        preface.includes('exit_code') &&
        preface.includes('stderr')
      const gitBranch = buildShellRecoveryBranch({
        command: 'git push origin main',
        exitCode: 128,
        stderr: 'fatal: not a git repository (or any of the parent directories): .git',
      })
      const cmdMissing = buildShellRecoveryBranch({
        command: 'fooctl deploy',
        exitCode: 127,
        stderr: 'fooctl: command not found',
      })
      const pass =
        promptHasProtocol &&
        gitBranch?.classification === 'git_not_repo' &&
        gitBranch.next_checks.some((s) => /git rev-parse/i.test(s)) &&
        gitBranch.fallback_steps.some((s) => /git init/i.test(s)) &&
        gitBranch.verify_steps.some((s) => /commit sha|remote/i.test(s)) &&
        cmdMissing?.classification === 'command_not_found'
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'error-first recovery contract is enforced in prompt and runtime shell failure branching is deterministic'
          : 'missing error-first protocol markers or shell recovery branch classification/fallback coverage',
        contextKTokens: 0.03,
        latencyMs: 1,
      }
    }
    case 'file_mutation_sensitive_path_branching': {
      const scan = scanWorkspacePathForSensitivity('.env.local')
      const blockMode = applySafetyMode('block', scan)
      const branch = buildPathMutationRecoveryBranch({
        tool: 'write_file',
        path: '.env.local',
        error: blockMode.message ?? 'blocked',
        safetyBlocked: true,
      })
      const pass =
        scan.matchedIds.includes('sensitive_path') &&
        blockMode.allow === false &&
        branch.classification === 'sensitive_path_blocked' &&
        branch.next_checks.some((s) => /\.env|credentials|secret/i.test(s)) &&
        branch.verify_steps.some((s) => /secret exposure/i.test(s))
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'sensitive file mutation branch blocks in safety mode and returns deterministic remediation/verification guidance'
          : 'missing sensitive path mutation safety branch coverage',
        contextKTokens: 0.03,
        latencyMs: 1,
      }
    }
    case 'grounding_evidence_contract': {
      const preface = buildDynamicPromptPreface('default')
      const pass =
        preface.includes('Grounding & evidence protocol') &&
        /Tie material claims to concrete evidence/i.test(preface)
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'prompt enforces evidence-backed claims contract'
          : 'missing evidence-backed claims contract markers',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'stale_data_refresh_contract': {
      const preface = buildDynamicPromptPreface('default')
      const pass = /evidence is stale or contradictory, refresh with a new read\/probe/i.test(preface)
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'prompt enforces stale-data invalidation and refresh requirement'
          : 'missing stale-data refresh contract marker',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'tool_failure_uncertainty_contract': {
      const preface = buildDynamicPromptPreface('default')
      const pass = /state uncertainty explicitly/i.test(preface)
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'prompt requires explicit uncertainty and next verification step after tool failure'
          : 'missing tool-failure uncertainty contract marker',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'mid_run_policy_steering_contract': {
      const preface = buildDynamicPromptPreface('default')
      const pass =
        /Mid-run policy steering/i.test(preface) &&
        /acknowledge the new policy\/goal immediately/i.test(preface) &&
        /Re-plan from the current checkpoint/i.test(preface)
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'prompt enforces mid-run policy steering acknowledgment + re-plan behavior'
          : 'missing mid-run policy steering contract markers',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'iteration_cap_enforcement': {
      const pass =
        Number.isFinite(ORCHESTRATOR_DEFAULT_MAX_ITERATIONS) &&
        Number.isFinite(ORCHESTRATOR_SIMPLE_MAX_ITERATIONS) &&
        Number.isFinite(ORCHESTRATOR_HARD_MAX_ITERATIONS) &&
        ORCHESTRATOR_DEFAULT_MAX_ITERATIONS >= 1 &&
        ORCHESTRATOR_SIMPLE_MAX_ITERATIONS >= 1 &&
        ORCHESTRATOR_HARD_MAX_ITERATIONS >= 1 &&
        ORCHESTRATOR_DEFAULT_MAX_ITERATIONS <= ORCHESTRATOR_HARD_MAX_ITERATIONS &&
        ORCHESTRATOR_SIMPLE_MAX_ITERATIONS <= ORCHESTRATOR_HARD_MAX_ITERATIONS
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? `iteration caps are bounded (default=${ORCHESTRATOR_DEFAULT_MAX_ITERATIONS}, simple=${ORCHESTRATOR_SIMPLE_MAX_ITERATIONS}, hard=${ORCHESTRATOR_HARD_MAX_ITERATIONS})`
          : 'iteration cap constants are invalid or exceed hard ceiling',
        contextKTokens: 0.01,
        latencyMs: 1,
      }
    }
    case 'parallel_tool_conflict_guard': {
      const mk = (name: string, args: Record<string, unknown>): ToolCall => ({
        id: `tc-${name}`,
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(args),
        },
      })
      const overlapWrites = shouldParallelizeToolBatch([
        mk('write_file', { path: 'src/a.ts', content: 'a' }),
        mk('write_file', { path: 'src/a.ts', content: 'b' }),
      ])
      const mixedReadWriteOverlap = shouldParallelizeToolBatch([
        mk('read_file', { path: 'src/a.ts' }),
        mk('write_file', { path: 'src/a.ts', content: 'c' }),
      ])
      const independentReads = shouldParallelizeToolBatch([
        mk('read_file', { path: 'src/a.ts' }),
        mk('read_file', { path: 'src/b.ts' }),
      ])
      const pass = !overlapWrites && !mixedReadWriteOverlap && independentReads
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'parallel tool guard blocks overlapping write conflicts while allowing independent readonly batches'
          : 'parallel conflict guard allowed unsafe overlap or blocked safe readonly batch',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'exactly_once_resume_handoff_integrity': {
      const merged = mergePendingSubAgentHandoffs(['first result', 'second result'])
      const headerMatches = merged.match(/\[Parallel sub-agent results\]/g) ?? []
      const separatorMatches = merged.match(/\n\n---\n\n/g) ?? []
      const pass =
        headerMatches.length === 1 &&
        merged.includes('first result') &&
        merged.includes('second result') &&
        separatorMatches.length === 1
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'pending sub-agent handoffs merge into a single exactly-once resume payload'
          : 'resume handoff merge duplicated headers or dropped indexed payload entries',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'heartbeat_synthetic_tag_skip_hygiene': {
      const heartbeatMsg = buildHeartbeatSyntheticUserMessage('Check release notes', '2099-01-01T00:00:00.000Z')
      const heartbeatPreface = buildDynamicPromptPreface('heartbeat')
      const pass =
        heartbeatMsg.startsWith('[Orca heartbeat — ') &&
        heartbeatMsg.includes('scheduled') &&
        heartbeatPreface.includes('scheduled') &&
        /one-line\*\* skip/i.test(heartbeatPreface)
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'heartbeat turns carry synthetic tag + one-line skip hygiene guidance'
          : 'heartbeat synthetic tag or skip hygiene prompt markers missing',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'trace_phase_end_state_completeness': {
      const start = formatToolTraceStartLine('read_file', '{"path":"src/a.ts"}')
      const ok = formatToolTraceEndLine('read_file', true, 321)
      const fail = formatToolTraceEndLine('read_file', false, 654)
      const pass =
        start.startsWith('→ read_file') &&
        start.includes('path=src/a.ts') &&
        ok.startsWith('← read_file ok') &&
        ok.endsWith('321ms') &&
        fail.startsWith('← read_file error') &&
        fail.endsWith('654ms')
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'trace lines include phase start + explicit success/failure end-state with elapsed duration'
          : 'trace formatting missing phase start/end-state markers or elapsed timing',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    case 'regression_canary_detection': {
      const scan = scanShellCommandForDanger('rm -rf /tmp/orca-canary')
      const blockMode = applySafetyMode('block', scan)
      const pass =
        scan.matchedIds.includes('destructive_rm_rf') &&
        blockMode.allow === false &&
        /danger|block/i.test(blockMode.message ?? '')
      return {
        id: task.id,
        pass,
        score: pass ? 10 : 0,
        notes: pass
          ? 'regression canary still catches destructive shell commands in block mode'
          : 'regression canary failed to detect/block destructive shell command',
        contextKTokens: 0.02,
        latencyMs: 1,
      }
    }
    default:
      return {
        id: (task as HarnessEvalTaskDef).id,
        pass: false,
        notes: `unknown task kind: ${String((task as HarnessEvalTaskDef).kind)}`,
      }
  }
}

export async function evaluateHarnessTaskList(
  file: HarnessEvalFileV1,
  options?: { workspaceRoot?: string }
): Promise<Omit<HarnessCandidateScoresV1, 'candidateId' | 'evaluatedAt' | 'memoryEval'>> {
  const ws = options?.workspaceRoot
  const results: HarnessTaskResultV1[] = []
  for (const t of file.tasks) {
    results.push(await evaluateOneTask(t, ws))
  }
  const passed = results.filter((r) => r.pass).length
  const passRate = results.length > 0 ? passed / results.length : 0
  const totalScore = results.reduce((sum, r) => sum + (typeof r.score === 'number' ? r.score : 0), 0)
  const meanScore = results.length > 0 ? totalScore / results.length : undefined
  const ctx = results.map((r) => r.contextKTokens).filter((x): x is number => typeof x === 'number')
  const meanContextKTokens =
    ctx.length > 0 ? ctx.reduce((a, b) => a + b, 0) / ctx.length : undefined
  const lat = results.map((r) => r.latencyMs).filter((x): x is number => typeof x === 'number')
  const meanLatencyMs =
    lat.length > 0 ? lat.reduce((a, b) => a + b, 0) / lat.length : undefined
  const invariantAggregation = aggregateInvariantScores(file.tasks, results)

  return {
    version: 1,
    split: file.split,
    tasks: results,
    aggregates: {
      passRate,
      meanScore,
      meanContextKTokens,
      meanLatencyMs,
      p0HardFail: invariantAggregation.p0HardFail,
      overallPass: invariantAggregation.overallPass,
      severity: invariantAggregation.severity,
      buckets: invariantAggregation.buckets,
    },
  }
}

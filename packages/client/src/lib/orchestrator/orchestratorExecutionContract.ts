/**
 * Tingua-style execution contracts: bounded agent calls with explicit outputs,
 * budgets, permissions, completion hints, and artifact paths.
 *
 * Normalization follows patterns similar to permission modes in agent CLIs (e.g. read-only vs
 * workspace-write vs full access) — see ultraworkers/claw-code USAGE.md — so stray model output
 * cannot inject unbounded lists or invalid permission tokens.
 */

import type { OrchestratorDecompositionResult } from './orchestratorDecompositionPhase'
import type { OrchestratorHierarchyResult } from './orchestratorHierarchyPhase'

export type HarnessPermission = 'read' | 'write' | 'execute' | 'spawn' | 'inspect' | 'web'

const ALL_PERMISSIONS: HarnessPermission[] = ['read', 'write', 'execute', 'spawn', 'inspect', 'web']

/** claw-style coarse modes → fine-grained harness permissions */
const PERMISSION_MODE_ALIASES: Record<string, HarnessPermission[]> = {
  'read-only': ['read', 'inspect'],
  readonly: ['read', 'inspect'],
  read_only: ['read', 'inspect'],
  'workspace-write': ['read', 'write', 'inspect', 'spawn'],
  workspace_write: ['read', 'write', 'inspect', 'spawn'],
  'danger-full-access': [...ALL_PERMISSIONS],
  danger_full_access: [...ALL_PERMISSIONS],
  full: [...ALL_PERMISSIONS],
  default: [...ALL_PERMISSIONS],
}

const PERMISSION_TOKEN_MAP: Record<string, HarnessPermission | undefined> = {
  read: 'read',
  write: 'write',
  execute: 'execute',
  run: 'execute',
  shell: 'execute',
  spawn: 'spawn',
  delegate: 'spawn',
  subagent: 'spawn',
  inspect: 'inspect',
  lint: 'inspect',
  test: 'inspect',
  web: 'web',
  browser: 'web',
}

const MAX_STRINGS_PER_FIELD = 48
const MAX_CHARS_PER_LINE = 600
const MAX_BUDGET_TOOL_ROUNDS = 500
const MAX_BUDGET_SUB_AGENTS = 32

export interface ExecutionContract {
  /** Human-readable label for logs. */
  label?: string
  /** Required deliverables (paths or descriptions). */
  requiredOutputs: string[]
  /** Soft budgets — harness may clamp iterations / tool rounds. */
  budgets: {
    maxToolRounds?: number
    maxSubAgents?: number
  }
  permissions: HarnessPermission[]
  /** Plain-language completion checks (for prompts / evaluators). */
  completionConditions: string[]
  /** Workspace-relative paths where artifacts should land. */
  outputPaths: string[]
  /**
   * Pre-close checklist (verify before declaring done) — claw-style verification loop hints.
   */
  verificationSteps: string[]
  /**
   * When to stop and ask the user or escalate (tests red, auth errors, ambiguous spec).
   */
  escalationHints: string[]
}

export const EMPTY_EXECUTION_CONTRACT: ExecutionContract = {
  requiredOutputs: [],
  budgets: {},
  permissions: [...ALL_PERMISSIONS],
  completionConditions: [],
  outputPaths: [],
  verificationSteps: [],
  escalationHints: [],
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, Math.floor(n)))
}

function clampOptionalBudget(n: unknown, lo: number, hi: number): number | undefined {
  if (n === null || n === undefined) return undefined
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x)) return undefined
  return clampInt(x, lo, hi)
}

function trimLine(s: string): string {
  const t = s.trim()
  if (t.length <= MAX_CHARS_PER_LINE) return t
  return `${t.slice(0, MAX_CHARS_PER_LINE)}…`
}

/** Dedupe while preserving order. */
function uniqStrings(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const s = trimLine(raw)
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out.slice(0, MAX_STRINGS_PER_FIELD)
}

function coerceStringList(x: unknown): string[] {
  if (x === null || x === undefined) return []
  if (Array.isArray(x)) {
    return uniqStrings(
      x.map((v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''))
    )
  }
  if (typeof x === 'string' && x.trim()) return uniqStrings([x])
  return []
}

export function normalizeHarnessPermission(token: string): HarnessPermission | null {
  const t = token.trim().toLowerCase()
  if (!t) return null
  if (PERMISSION_MODE_ALIASES[t]) return null
  return PERMISSION_TOKEN_MAP[t] ?? (ALL_PERMISSIONS.includes(t as HarnessPermission) ? (t as HarnessPermission) : null)
}

/**
 * Resolve a list of tokens and coarse mode strings into a de-duplicated permission set.
 * Unknown tokens are dropped (robust against model hallucinations).
 */
export function normalizePermissionList(raw: unknown): HarnessPermission[] {
  if (raw === null || raw === undefined) return [...ALL_PERMISSIONS]
  if (typeof raw === 'string') {
    const mode = raw.trim().toLowerCase()
    if (PERMISSION_MODE_ALIASES[mode]) return [...PERMISSION_MODE_ALIASES[mode]]
    const parts = raw.split(/[,\s]+/).filter(Boolean)
    return normalizePermissionList(parts)
  }
  if (!Array.isArray(raw)) return [...ALL_PERMISSIONS]
  const out: HarnessPermission[] = []
  const seen = new Set<HarnessPermission>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const mode = item.trim().toLowerCase()
    if (PERMISSION_MODE_ALIASES[mode]) {
      for (const p of PERMISSION_MODE_ALIASES[mode]) {
        if (!seen.has(p)) {
          seen.add(p)
          out.push(p)
        }
      }
      continue
    }
    const p = normalizeHarnessPermission(item)
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out.length ? out : [...ALL_PERMISSIONS]
}

function normalizeBudgets(raw: unknown): { maxToolRounds?: number; maxSubAgents?: number } {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  return {
    maxToolRounds: clampOptionalBudget(o.maxToolRounds, 1, MAX_BUDGET_TOOL_ROUNDS),
    maxSubAgents: clampOptionalBudget(o.maxSubAgents, 1, MAX_BUDGET_SUB_AGENTS),
  }
}

/**
 * Coerce arbitrary JSON / partial objects into a safe, bounded {@link ExecutionContract}.
 */
export function normalizeExecutionContract(
  input: Partial<ExecutionContract> | Record<string, unknown> | null | undefined
): ExecutionContract {
  if (!input || typeof input !== 'object') {
    return { ...EMPTY_EXECUTION_CONTRACT, permissions: [...ALL_PERMISSIONS] }
  }
  const o = input as Record<string, unknown>
  const label = typeof o.label === 'string' ? trimLine(o.label).slice(0, 120) : undefined
  const budgets = normalizeBudgets(o.budgets)
  const permissions = normalizePermissionList(o.permissions)

  return {
    label: label || undefined,
    requiredOutputs: coerceStringList(o.requiredOutputs),
    budgets,
    permissions,
    completionConditions: coerceStringList(o.completionConditions),
    outputPaths: coerceStringList(o.outputPaths).map((p) =>
      p.replace(/\\/g, '/').replace(/^\/+/, '')
    ),
    verificationSteps: coerceStringList(o.verificationSteps),
    escalationHints: coerceStringList(o.escalationHints),
  }
}

/** True if a partial contract is worth injecting into the system prompt (ignores all-empty overlays). */
export function executionContractIsMeaningful(partial: Partial<ExecutionContract> | null | undefined): boolean {
  if (!partial || typeof partial !== 'object') return false
  const n = normalizeExecutionContract(partial)
  if (n.label) return true
  if (
    n.requiredOutputs.length ||
    n.completionConditions.length ||
    n.outputPaths.length ||
    n.verificationSteps.length ||
    n.escalationHints.length
  ) {
    return true
  }
  if (n.budgets.maxToolRounds != null || n.budgets.maxSubAgents != null) return true
  const def = EMPTY_EXECUTION_CONTRACT.permissions.join(',')
  if (n.permissions.join(',') !== def) return true
  return false
}

/** Merge partial contract over defaults (e.g. planning phase + user overlay). Output is always normalized. */
export function mergeExecutionContract(
  base: ExecutionContract,
  overlay?: Partial<ExecutionContract> | null
): ExecutionContract {
  const b = normalizeExecutionContract(base)
  if (!overlay) return b
  const o = overlay

  const label =
    o.label !== undefined ? trimLine(String(o.label)).slice(0, 120) || undefined : b.label
  const requiredOutputs =
    o.requiredOutputs !== undefined ? coerceStringList(o.requiredOutputs) : b.requiredOutputs
  const budgets =
    o.budgets !== undefined
      ? {
          maxToolRounds:
            o.budgets.maxToolRounds !== undefined
              ? clampOptionalBudget(o.budgets.maxToolRounds, 1, MAX_BUDGET_TOOL_ROUNDS)
              : b.budgets.maxToolRounds,
          maxSubAgents:
            o.budgets.maxSubAgents !== undefined
              ? clampOptionalBudget(o.budgets.maxSubAgents, 1, MAX_BUDGET_SUB_AGENTS)
              : b.budgets.maxSubAgents,
        }
      : { ...b.budgets }
  const permissions =
    o.permissions !== undefined ? normalizePermissionList(o.permissions) : b.permissions
  const completionConditions =
    o.completionConditions !== undefined ? coerceStringList(o.completionConditions) : b.completionConditions
  const outputPaths = o.outputPaths !== undefined ? coerceStringList(o.outputPaths) : b.outputPaths
  const verificationSteps =
    o.verificationSteps !== undefined ? coerceStringList(o.verificationSteps) : b.verificationSteps
  const escalationHints =
    o.escalationHints !== undefined ? coerceStringList(o.escalationHints) : b.escalationHints

  return normalizeExecutionContract({
    label,
    requiredOutputs,
    budgets,
    permissions,
    completionConditions,
    outputPaths,
    verificationSteps,
    escalationHints,
  })
}

/**
 * Derive a contract from a phased hierarchy plan so the harness and eval pass share concrete
 * completion criteria (not only markdown prose).
 */
export function buildExecutionContractFromHierarchy(h: OrchestratorHierarchyResult): Partial<ExecutionContract> {
  const completionConditions: string[] = uniqStrings([
    'Every phase in the hierarchy is completed, skipped with user approval, or explicitly blocked with a written reason.',
    'Todo tile and `.agent-canvas/plans/current-plan.md` stay in sync with actual progress.',
    ...h.phases.map((p, i) => {
      const head = `Phase ${i + 1} — ${p.title}`
      const obj = trimLine(p.objective)
      return obj ? `${head}: ${obj}` : head
    }),
  ])

  const verificationSteps: string[] = uniqStrings([
    'After each phase: re-read files you changed and confirm the phase objective is met before starting the next phase.',
    'Before the final answer: run or cite the relevant tests/checks implied by the mission.',
    'Confirm `current-plan.md` lists completed work and matches the Todo tile.',
  ])

  const requiredOutputs = uniqStrings([
    'Todo tile rows for each phase/task group with accurate status',
    '`.agent-canvas/plans/current-plan.md` updated after each phase checkpoint',
  ])

  return {
    label: 'hierarchy-plan',
    requiredOutputs,
    budgets: { maxSubAgents: Math.min(MAX_BUDGET_SUB_AGENTS, 6) },
    permissions: [...ALL_PERMISSIONS],
    completionConditions,
    outputPaths: ['.agent-canvas/plans/current-plan.md'],
    verificationSteps,
    escalationHints: [
      'Stop and ask if a phase objective conflicts with repo constraints or prior decisions.',
      'Escalate if tests fail repeatedly or two sub-agents disagree on the same file.',
    ],
  }
}

/**
 * Derive a contract from parallel decomposition (spawn tracks).
 */
export function buildExecutionContractFromDecomposition(
  d: OrchestratorDecompositionResult
): Partial<ExecutionContract> {
  const mission = trimLine(d.understanding)
  const completionConditions = uniqStrings([
    mission ? `Mission: ${mission}` : 'Mission understood from decomposition.',
    'Each parallel track is spawned (or explicitly skipped with reason) and handoffs are merged by the lead.',
    ...d.subtasks.map((s) => `Track done: ${trimLine(s.title)} (${s.difficulty})`),
  ])

  const requiredOutputs = uniqStrings(
    d.subtasks.map((s) => `Result summary for: ${trimLine(s.title)}`)
  )

  return {
    label: 'parallel-decomposition',
    requiredOutputs,
    budgets: { maxSubAgents: Math.min(MAX_BUDGET_SUB_AGENTS, Math.max(2, d.subtasks.length)) },
    permissions: [...ALL_PERMISSIONS],
    completionConditions,
    outputPaths: ['.agent-canvas/plans/current-plan.md'],
    verificationSteps: [
      'Confirm no two workers were assigned conflicting writes to the same path.',
      'Merge sub-agent results in one coherent user-facing summary.',
    ],
    escalationHints: [
      'If a worker fails twice, narrow scope or switch strategy before retrying.',
    ],
  }
}

/**
 * Renders a short markdown block for the system or user message when a contract is active.
 */
export function formatExecutionContractForPrompt(c: ExecutionContract): string {
  const n = normalizeExecutionContract(c)
  const lines: string[] = ['### Execution contract (harness)']
  if (n.label) lines.push(`- **Label:** ${n.label}`)
  if (n.requiredOutputs.length) {
    lines.push(`- **Required outputs:** ${n.requiredOutputs.join('; ')}`)
  }
  if (n.budgets.maxToolRounds != null || n.budgets.maxSubAgents != null) {
    lines.push(
      `- **Budgets:** tool rounds ≤ ${n.budgets.maxToolRounds ?? '∞'}; sub-agents ≤ ${n.budgets.maxSubAgents ?? '∞'}`
    )
  }
  lines.push(`- **Permissions:** ${n.permissions.join(', ')}`)
  if (n.completionConditions.length) {
    lines.push(`- **Done when:** ${n.completionConditions.join('; ')}`)
  }
  if (n.verificationSteps.length) {
    lines.push(`- **Verify before closing:** ${n.verificationSteps.join('; ')}`)
  }
  if (n.escalationHints.length) {
    lines.push(`- **Escalate / pause when:** ${n.escalationHints.join('; ')}`)
  }
  if (n.outputPaths.length) {
    lines.push(`- **Artifact paths:** ${n.outputPaths.join(', ')}`)
  }
  return lines.join('\n')
}

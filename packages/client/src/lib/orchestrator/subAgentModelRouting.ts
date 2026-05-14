import type { ModelConfig, Provider } from '../../store/settingsStore'
import { resolveApiKey } from '../llmCredentials'
import { heuristicResearchIntent } from './researchIntent'

export type SubAgentComplexity = 'simple' | 'complex'

/** Model id for OpenRouter’s free router (routes to available free models). */
export const OPENROUTER_FREE_ROUTER_MODEL_ID = 'or-free-router'

/** True when this catalog entry is OpenRouter’s `openrouter/free` router (not every `isFree` model). */
export function isOpenRouterFreeRouterModel(m: ModelConfig): boolean {
  if (m.provider !== 'openrouter') return false
  if (m.id === OPENROUTER_FREE_ROUTER_MODEL_ID) return true
  const n = m.name.trim().toLowerCase()
  return n === 'openrouter/free' || n === 'openrouter/free-router'
}

/**
 * Sub-agent run failed on the free/OpenRouter path — worth one retry with the orchestrator (primary) model.
 * Avoids retrying on auth/key errors.
 */
export function subAgentErrorSuggestsFreeTierOrGatewayRetry(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (/401|403|invalid\s+api\s*key|unauthorized|incorrect\s+api\s*key/i.test(msg)) return false
  const t = msg.toLowerCase()
  return (
    /429|rate\s*limit|too many requests|over capacity|quota|throttl|credit/i.test(t) ||
    /overload|503|502|529|bad gateway|unavailable|try again|temporarily|timeout/i.test(t) ||
    /decoding|json parse|parse failed|empty body|unexpected end|eof/i.test(t) ||
    /failed to fetch|network|econnrefused|socket/i.test(t)
  )
}

const COMPLEX_LINE_COUNT = 8
const COMPLEX_CHAR_THRESHOLD = 900
const LONG_COMBINED_THRESHOLD = 1800

/**
 * Strong signals that a delegated task needs the same capability as the main orchestrator (e.g. GLM-4.7).
 * Kept **narrow** so typical repo scans (deps, lint, CI reads) stay **simple** → OpenRouter/free.
 * Avoids broad words like "production" / "codebase" that appear in almost every readiness prompt.
 */
const COMPLEX_HINT =
  /\b(refactor|implement|architecture|migrate|multi[- ]?file|benchmark|orchestrat|test suite|security audit|optimize\s+(the\s+)?(code|bundle)|debug\s+(a\s+)?(deep|tricky)|write\s+tests?\s+for|feature\s+complete|batch|multi[- ]?step)\b/i

/** e.g. "Compare React vs Vue …" — needs quality, not free tier. */
const COMPARE_FRAMEWORKS =
  /\bcompare\b.+\b(vs\.?|versus|or)\b/i

/**
 * `heuristicResearchIntent` includes `\banalyze\b`, which matches **every** "Analyze dependencies/build"
 * sub-agent — incorrectly forcing GLM. Only treat as research when it looks like web/lit work, not repo analysis.
 */
function heuristicResearchIntentForSubAgent(task: string, role: string): boolean {
  const combined = `${task}\n${role}`
  if (!heuristicResearchIntent(combined)) return false
  // Static / tooling analysis — still eligible for OpenRouter free
  if (
    /\banalyze\b/i.test(combined) &&
    /\b(dependencies|dependency|build\s+scripts?|compilation|package\.json|tsconfig|turbo|vite|webpack|rollup|eslint|prettier|typescript|bundle|lockfile|ci\s+pipeline|test\s+coverage|vitest|jest)\b/i.test(
      combined
    )
  ) {
    return false
  }
  return true
}

/**
 * Heuristic difficulty for sub-agent work — avoids extra LLM calls.
 * **Simple** tasks are routed to OpenRouter free when that provider is configured.
 */
export function classifySubAgentTaskComplexity(task: string, role: string): SubAgentComplexity {
  const combined = `${task}\n${role}`
  if (COMPARE_FRAMEWORKS.test(combined)) return 'complex'
  if (heuristicResearchIntentForSubAgent(task, role)) return 'complex'
  if (combined.length > LONG_COMBINED_THRESHOLD) return 'complex'
  if ((task.match(/\n/g) || []).length > COMPLEX_LINE_COUNT) return 'complex'
  if (task.length > COMPLEX_CHAR_THRESHOLD) return 'complex'
  if (COMPLEX_HINT.test(combined)) return 'complex'
  return 'simple'
}

export function resolveSubAgentComplexity(
  task: string,
  role: string,
  override?: 'auto' | 'simple' | 'complex'
): SubAgentComplexity {
  if (override === 'simple' || override === 'complex') return override
  return classifySubAgentTaskComplexity(task, role)
}

/**
 * Prefer `openrouter/free`, then any tools-capable free OpenRouter model in the catalog.
 */
export function pickBudgetOpenRouterModel(models: ModelConfig[]): ModelConfig | null {
  const byId = models.find((m) => m.id === OPENROUTER_FREE_ROUTER_MODEL_ID)
  if (byId && byId.provider === 'openrouter' && byId.supportsTools !== false) return byId
  const free = models.filter(
    (m) => m.provider === 'openrouter' && m.isFree === true && m.supportsTools !== false
  )
  return free[0] ?? null
}

export interface SubAgentModelPick {
  model: ModelConfig
  provider: Provider
  /** User-facing line for the sub-agent log. */
  routingLog: string
}

export type SubAgentComplexityOverride = 'auto' | 'simple' | 'complex'

function modelLabel(m: ModelConfig): string {
  return `${m.displayName} (${m.name})`
}

/**
 * Pure routing decision (unit-tested matrix). Use via `resolveSubAgentExecutionModel` for async key resolution.
 */
export function decideSubAgentModelForRouting(params: {
  complexity: SubAgentComplexity
  primary: ModelConfig
  models: ModelConfig[]
  /** User has OpenRouter enabled in Settings (and key sources available). */
  openrouterActive: boolean
  /** True after `resolveApiKey('openrouter', …)` returned a non-empty key. */
  openRouterKeyResolved: boolean
  /** Settings: optional model for **simple** tasks (skips free-router heuristics). */
  simpleModelOverride?: ModelConfig | null
  /** Settings: optional model for **complex** tasks (defaults to main orchestrator / `primary`). */
  complexModelOverride?: ModelConfig | null
}): SubAgentModelPick {
  const {
    complexity,
    primary,
    models,
    openrouterActive,
    openRouterKeyResolved,
    simpleModelOverride,
    complexModelOverride,
  } = params

  if (complexity === 'complex' && complexModelOverride) {
    return {
      model: complexModelOverride,
      provider: complexModelOverride.provider,
      routingLog: `[Routing] ${complexity} task → ${modelLabel(complexModelOverride)} (Settings: sub-agent complex)`,
    }
  }

  if (complexity === 'simple' && simpleModelOverride) {
    return {
      model: simpleModelOverride,
      provider: simpleModelOverride.provider,
      routingLog: `[Routing] ${complexity} task → ${modelLabel(simpleModelOverride)} (Settings: sub-agent simple)`,
    }
  }

  if (complexity === 'complex') {
    return {
      model: primary,
      provider: primary.provider,
      routingLog: `[Routing] ${complexity} task → ${modelLabel(primary)} (orchestrator-class model)`,
    }
  }

  const budget = pickBudgetOpenRouterModel(models)
  if (budget && openrouterActive && openRouterKeyResolved) {
    return {
      model: budget,
      provider: 'openrouter',
      routingLog: `[Routing] ${complexity} task → ${modelLabel(budget)} (OpenRouter/free — reserve premium/Z.AI for orchestration & harder work)`,
    }
  }

  return {
    model: primary,
    provider: primary.provider,
    routingLog: `[Routing] ${complexity} task → ${modelLabel(primary)} (OpenRouter free unavailable — using your selected model)`,
  }
}

/**
 * Picks execution model for a sub-agent: **simple** delegated work uses OpenRouter **free** (when enabled
 * + key resolves) to spare Z.AI GLM-4.7 quota; **complex** tasks use the user’s selected (orchestrator) model.
 */
export async function resolveSubAgentExecutionModel(params: {
  primary: ModelConfig
  models: ModelConfig[]
  task: string
  role: string
  taskComplexity?: SubAgentComplexityOverride
  getActiveProviders: () => Provider[]
  /** Settings UI key for OpenRouter (shell/env resolved inside `resolveApiKey`). */
  openRouterUiKey?: string
  simpleModelOverride?: ModelConfig | null
  complexModelOverride?: ModelConfig | null
}): Promise<SubAgentModelPick> {
  const {
    primary,
    models,
    task,
    role,
    taskComplexity,
    getActiveProviders,
    openRouterUiKey,
    simpleModelOverride,
    complexModelOverride,
  } = params

  const complexity = resolveSubAgentComplexity(task, role, taskComplexity)
  const openrouterActive = getActiveProviders().includes('openrouter')
  const key = await resolveApiKey('openrouter', openRouterUiKey)
  const openRouterKeyResolved = !!key?.trim()

  return decideSubAgentModelForRouting({
    complexity,
    primary,
    models,
    openrouterActive,
    openRouterKeyResolved,
    simpleModelOverride,
    complexModelOverride,
  })
}

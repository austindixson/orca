import { HYBRID_WORKFLOW_CATALOG_SEED } from './catalog/workflowCatalogSeed'
import {
  type AuthProfileRecord,
  resolveLaneForCommand as resolveLaneFromProfile,
} from './authProfileStore'

type WorkflowCatalog = typeof HYBRID_WORKFLOW_CATALOG_SEED
export type HybridWorkflow = WorkflowCatalog['workflows'][number]

type WorkflowRisk = 'read_only' | 'mutating' | 'destructive'
export type AuthLane = 'oauth' | 'browser_session' | 'per_step'

export interface RoutedCommand {
  command: string
  lane: AuthLane
  laneReason: string
  authProfileId: string | null
}

export interface WorkflowAuthRouting {
  workflowId: string
  pack: string
  risk: WorkflowRisk
  approvalRequired: boolean
  commandRoutes: RoutedCommand[]
}

export interface WorkflowAuthLanePlan {
  requiredLanes: Array<'oauth' | 'browser_session'>
  oauthHealthChecks: string[]
  browserSessionHealthChecks: string[]
  fallbackBounded: boolean
  perWorkflow: WorkflowAuthRouting[]
}

export interface ResolvedWorkflowIntent {
  query: string
  catalogId: string
  matchedWorkflows: Array<{
    id: string
    title: string
    pack: string
    risk: WorkflowRisk
    score: number
    commands: string[]
    requiredSlots: string[]
    optionalSlots: string[]
    approvalRequired: boolean
    target: HybridWorkflow['target']
  }>
  combinedCommands: string[]
  authLanePlan: WorkflowAuthLanePlan
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'this',
  'that',
  'these',
  'those',
  'to',
  'for',
  'from',
  'with',
  'of',
  'in',
  'on',
  'about',
  'into',
  'after',
  'before',
  'over',
  'under',
  'all',
  'any',
  'it',
  'is',
  'are',
  'be',
  'as',
  'now',
])

function tokenize(input: string): string[] {
  const base = normalizeText(input)
  if (!base) return []
  return base
    .split(' ')
    .filter((t) => t.length >= 3)
    .filter((t) => !STOP_WORDS.has(t))
}

function keywordOverlapScore(tokens: string[], haystack: string, tokenWeight: number): number {
  if (tokens.length === 0 || !haystack) return 0
  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token)) score += tokenWeight
  }
  return score
}

function scoreWorkflow(query: string, workflow: HybridWorkflow): number {
  const normalizedQuery = normalizeText(query)
  const queryTokens = tokenize(query)
  if (!normalizedQuery || queryTokens.length === 0) return 0

  const normalizedTitle = normalizeText(workflow.title)
  const normalizedPack = normalizeText(workflow.pack)
  const normalizedExamples = workflow.user_says_examples.map((v) => normalizeText(v))
  const normalizedCommands = workflow.commands.map((v) => normalizeText(v))
  const normalizedRequiredSlots = workflow.required_slots.map((v) => normalizeText(v))

  let score = 0
  score += keywordOverlapScore(queryTokens, normalizedTitle, 1.2)
  score += keywordOverlapScore(queryTokens, normalizedPack, 0.6)
  score += keywordOverlapScore(queryTokens, normalizedCommands.join(' '), 0.45)
  score += keywordOverlapScore(queryTokens, normalizedRequiredSlots.join(' '), 0.25)

  for (const example of normalizedExamples) {
    score += keywordOverlapScore(queryTokens, example, 0.8)
    if (normalizedQuery.length >= 12 && example.includes(normalizedQuery)) {
      score += 3
    }
  }

  // Risk-sensitive bias for destructive language.
  const destructiveLanguage = /\b(delete|remove|cleanup|clean up|destroy|purge|wipe)\b/.test(normalizedQuery)
  if (destructiveLanguage && workflow.risk === 'destructive') {
    score += 2
  }

  // Tight phrase hints for common automation asks.
  if (normalizedQuery.includes('x') || normalizedQuery.includes('tweet')) {
    if (workflow.pack === 'x-social-ops') score += 0.8
  }
  if (normalizedQuery.includes('drive') || normalizedQuery.includes('google')) {
    if (workflow.pack.includes('drive')) score += 0.8
  }

  return Number(score.toFixed(3))
}

function resolveCommandLane(command: string, workflow: HybridWorkflow): {
  lane: AuthLane
  reason: string
} {
  const normalized = command.trim().toLowerCase()
  if (normalized.startsWith('gdrive.')) return { lane: 'oauth', reason: 'command_prefix:gdrive' }
  if (normalized.startsWith('x.')) return { lane: 'browser_session', reason: 'command_prefix:x' }

  if (workflow.target.type === 'official_api') {
    return { lane: 'oauth', reason: 'target_type:official_api' }
  }
  if (workflow.target.type === 'browser_ui') {
    return { lane: 'browser_session', reason: 'target_type:browser_ui' }
  }
  return { lane: 'per_step', reason: 'target_type:hybrid' }
}

function findProfileForWorkflow(
  workflow: HybridWorkflow,
  authProfiles: AuthProfileRecord[]
): { profile: AuthProfileRecord; matchedOn: 'pack' | 'target_app' | 'target_domain' } | null {
  for (const profile of authProfiles) {
    if (profile.appId === workflow.pack) return { profile, matchedOn: 'pack' }
    if (profile.appId === workflow.target.app) return { profile, matchedOn: 'target_app' }
    if (profile.appId === workflow.target.domain) return { profile, matchedOn: 'target_domain' }
  }
  return null
}

function buildAuthLanePlan(
  catalog: WorkflowCatalog,
  matchedWorkflows: ResolvedWorkflowIntent['matchedWorkflows'],
  authProfiles: AuthProfileRecord[]
): WorkflowAuthLanePlan {
  const perWorkflow = matchedWorkflows.map((match) => {
    const workflow = catalog.workflows.find((w) => w.id === match.id)
    const profileMatch = workflow ? findProfileForWorkflow(workflow, authProfiles) : null
    const commandRoutes: RoutedCommand[] = match.commands.map((command) => {
      if (workflow && profileMatch) {
        const lane = resolveLaneFromProfile(profileMatch.profile, command, workflow.target.type)
        return {
          command,
          lane,
          laneReason: `auth_profile:${profileMatch.profile.id};match:${profileMatch.matchedOn}`,
          authProfileId: profileMatch.profile.id,
        }
      }
      if (workflow) {
        const fallback = resolveCommandLane(command, workflow)
        return {
          command,
          lane: fallback.lane,
          laneReason: fallback.reason,
          authProfileId: null,
        }
      }
      return {
        command,
        lane: 'per_step',
        laneReason: 'no_workflow_match',
        authProfileId: null,
      }
    })
    return {
      workflowId: match.id,
      pack: match.pack,
      risk: match.risk,
      approvalRequired: match.approvalRequired,
      commandRoutes,
    }
  })

  const laneSet = new Set<'oauth' | 'browser_session'>()
  for (const workflow of perWorkflow) {
    for (const route of workflow.commandRoutes) {
      if (route.lane === 'oauth' || route.lane === 'browser_session') laneSet.add(route.lane)
    }
  }

  const authCatalog = catalog as WorkflowCatalog & {
    auth_lanes?: {
      oauth?: { pre_run_health_checks?: string[] }
      hybrid_router?: { bounded_fallback?: boolean }
    }
  }
  const oauthHealthChecks = Array.isArray(authCatalog.auth_lanes?.oauth?.pre_run_health_checks)
    ? [...(authCatalog.auth_lanes?.oauth?.pre_run_health_checks ?? [])]
    : ['token_valid', 'scope_sufficient', 'api_reachable']

  const browserSessionHealthChecks = [
    'domain_binding_valid',
    'bundle_decryptable',
    'auth_active',
    'ttl_valid',
  ]

  const hybridRouter = (
    authCatalog.auth_lanes as { hybrid_router?: { bounded_fallback?: boolean } } | undefined
  )?.hybrid_router
  const fallbackBounded = hybridRouter?.bounded_fallback !== false

  return {
    requiredLanes: Array.from(laneSet),
    oauthHealthChecks,
    browserSessionHealthChecks,
    fallbackBounded,
    perWorkflow,
  }
}

export function resolveWorkflowIntent(
  query: string,
  opts?: { topK?: number; minScore?: number; catalog?: WorkflowCatalog; authProfiles?: AuthProfileRecord[] }
): ResolvedWorkflowIntent {
  const catalog = opts?.catalog ?? HYBRID_WORKFLOW_CATALOG_SEED
  const topK = Math.max(1, Math.min(8, Math.floor(opts?.topK ?? 3)))
  const minScore = Number.isFinite(opts?.minScore) ? Number(opts?.minScore) : 2.2

  const ranked = catalog.workflows
    .map((workflow) => ({ workflow, score: scoreWorkflow(query, workflow) }))
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  const matchedWorkflows = ranked.map(({ workflow, score }) => {
    const approvalRequired =
      (workflow as { approval_required?: boolean }).approval_required === true ||
      workflow.risk === 'destructive'
    return {
      id: workflow.id,
      title: workflow.title,
      pack: workflow.pack,
      risk: workflow.risk,
      score,
      commands: [...workflow.commands],
      requiredSlots: [...workflow.required_slots],
      optionalSlots: [...workflow.optional_slots],
      approvalRequired,
      target: workflow.target,
    }
  })

  const combinedCommands = Array.from(new Set(matchedWorkflows.flatMap((row) => row.commands)))
  const authLanePlan = buildAuthLanePlan(catalog, matchedWorkflows, opts?.authProfiles ?? [])

  return {
    query,
    catalogId: catalog.catalog_id,
    matchedWorkflows,
    combinedCommands,
    authLanePlan,
  }
}

export function buildWorkflowAuthTraceContext(intent: ResolvedWorkflowIntent): Record<string, unknown> | null {
  if (intent.matchedWorkflows.length === 0) return null
  return {
    source: 'one_shot_workflow_catalog',
    catalogId: intent.catalogId,
    query: intent.query,
    requiredLanes: intent.authLanePlan.requiredLanes,
    oauthHealthChecks: intent.authLanePlan.oauthHealthChecks,
    browserSessionHealthChecks: intent.authLanePlan.browserSessionHealthChecks,
    fallbackBounded: intent.authLanePlan.fallbackBounded,
    workflows: intent.authLanePlan.perWorkflow.map((row) => ({
      workflowId: row.workflowId,
      pack: row.pack,
      risk: row.risk,
      approvalRequired: row.approvalRequired,
      commandRoutes: row.commandRoutes.map((route) => ({
        command: route.command,
        lane: route.lane,
        laneReason: route.laneReason,
        authProfileId: route.authProfileId,
      })),
    })),
  }
}

export function renderWorkflowIntentContext(intent: ResolvedWorkflowIntent): string {
  if (intent.matchedWorkflows.length === 0) return ''

  const header = `Workflow catalog matches (${intent.catalogId})`
  const rows = intent.matchedWorkflows
    .map((match, idx) => {
      const slots =
        match.requiredSlots.length > 0
          ? `required slots: ${match.requiredSlots.join(', ')}`
          : 'required slots: none'
      const optional =
        match.optionalSlots.length > 0
          ? `optional slots: ${match.optionalSlots.join(', ')}`
          : 'optional slots: none'
      const approval = match.approvalRequired ? 'approval: required' : 'approval: standard mutating policy'
      const lanes =
        intent.authLanePlan.perWorkflow
          .find((row) => row.workflowId === match.id)
          ?.commandRoutes.map((row) => {
            const profilePart = row.authProfileId ? ` profile=${row.authProfileId}` : ''
            return `${row.command}:${row.lane} (${row.laneReason}${profilePart})`
          })
          .join(', ') ?? 'none'
      return `${idx + 1}. ${match.title} [${match.pack}] risk=${match.risk} score=${match.score}\n   commands: ${match.commands.join(' -> ')}\n   ${slots}; ${optional}; ${approval}\n   auth lanes: ${lanes}`
    })
    .join('\n')

  const laneSummary =
    intent.authLanePlan.requiredLanes.length > 0
      ? intent.authLanePlan.requiredLanes.join(', ')
      : 'none'
  const authHeader = [
    `Auth lanes required: ${laneSummary}`,
    `OAuth preflight: ${intent.authLanePlan.oauthHealthChecks.join(', ')}`,
    `Browser-session preflight: ${intent.authLanePlan.browserSessionHealthChecks.join(', ')}`,
    `Hybrid fallback bounded: ${intent.authLanePlan.fallbackBounded ? 'yes' : 'no'}`,
  ].join('\n')

  return `${header}\n${rows}\n${authHeader}`
}

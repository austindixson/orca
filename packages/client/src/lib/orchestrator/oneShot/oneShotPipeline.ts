import { runOrchestratorAgent, type OrchestratorActivityPayload } from '../runOrchestrator'
import { resolveApiKey } from '../../llmCredentials'
import { useSettingsStore, PROVIDER_INFO, providerAllowsEmptyApiKey } from '../../../store/settingsStore'
import {
  applyOrchestratorActivityFromPayload,
  useOrchestratorSessionStore,
} from '../../../store/orchestratorSessionStore'
import { providerSupportsOrchestratorTools } from '../types'
import { abortableSleep, throwIfAborted } from '../abortable'
import { useAgentTeamStore } from '../../../store/agentTeamStore'
import {
  researchPhasePrompt,
  specPhasePrompt,
  architecturePhasePrompt,
  decompositionPhasePrompt,
  codegenPhasePromptForDecompositionPhase,
  codegenPhasePromptForDecompositionWave,
  validationPhasePrompt,
} from './oneShotPrompts'
import {
  loadDecompositionFromWorkspace,
  pushDecompositionToTodoStore,
} from './oneShotDecompositionPhase'
import {
  buildWorkflowAuthTraceContext,
  renderWorkflowIntentContext,
  resolveWorkflowIntent,
  type ResolvedWorkflowIntent,
} from './oneShotWorkflowResolver'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import type { OneShotPhase } from './oneShotTypes'
import type { ModelConfig } from '../../../store/settingsStore'

export interface OneShotPipelineParams {
  ideaPrompt: string
  /** Browser dev: relative folder prefix like \`oneshot-temp-123-foo/\`. Tauri temp: empty string. */
  projectRootPrefix: string
  signal: AbortSignal
  onLog: (line: string) => void
  onPhase: (phase: OneShotPhase) => void
  /** When set, canvas tools target the main orchestrator widget tile (same as chat orchestrator). */
  orchestratorTileId?: string | null
}

const PHASE_ITERATIONS: Record<string, number> = {
  research: 15,
  spec: 12,
  architecture: 12,
  decomposition: 10,
  codegen: 60,
  validation: 20,
}

const CODEGEN_DECOMP_PHASES = ['backend', 'frontend', 'integration'] as const

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function defaultToolCallsForWeight(weight: number): number {
  if (weight <= 1) return 5
  if (weight <= 2) return 12
  if (weight <= 3) return 22
  return 40
}

function computeWaveCodegenIterations(
  waveTaskIds: number[],
  taskById: Map<number, { weight: number; estimated_tool_calls?: number }>
): number {
  const tasks = waveTaskIds
    .map((id) => taskById.get(id))
    .filter((t): t is { weight: number; estimated_tool_calls?: number } => t != null)
  const estimatedTools = tasks.reduce(
    (sum, t) =>
      sum +
      Math.max(
        0,
        Math.round(
          t.estimated_tool_calls != null
            ? t.estimated_tool_calls
            : defaultToolCallsForWeight(t.weight)
        )
      ),
    0
  )
  // Iterations are LLM+tool rounds, not raw tool calls. Keep a generous but bounded budget
  // for heavier waves so long codegen passes do not hit a hard 60-round ceiling prematurely.
  const raw = 20 + waveTaskIds.length * 8 + Math.ceil(estimatedTools / 4)
  return clamp(raw, 60, 140)
}

async function waitForSubAgentsIdle(signal: AbortSignal, timeoutMs: number) {
  const start = Date.now()
  while (useAgentTeamStore.getState().countWorkingSubAgents() > 0) {
    throwIfAborted(signal)
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for sub-agents to finish')
    }
    await abortableSleep(2000, signal)
  }
}

async function resolveExecutionModel() {
  const settings = useSettingsStore.getState()
  const models = settings.getAvailableModels()
  const selected =
    models.find((m) => m.id === settings.selectedModel) ??
    models.find((m) => providerSupportsOrchestratorTools(m.provider)) ??
    models[0]
  if (!selected || !providerSupportsOrchestratorTools(selected.provider) || selected.supportsTools === false) {
    throw new Error('Select a tools-capable model in Settings for 1-shot mode.')
  }
  const providerConfig = settings.providers[selected.provider]
  const apiKey = await resolveApiKey(selected.provider, providerConfig.apiKey)
  if (!apiKey && !providerAllowsEmptyApiKey(selected.provider)) {
    throw new Error(`Set ${PROVIDER_INFO[selected.provider].name} API key in Settings.`)
  }
  let openRouterRateLimitFallbackModel: ModelConfig | null = null
  if (
    selected.provider !== 'openrouter' &&
    settings.providers.openrouter.enabled &&
    settings.openrouterRateLimitFallbackEnabled
  ) {
    const fallbackName = settings.openrouterRateLimitFallbackModelId.trim()
    if (fallbackName) {
      const openrouterKey = await resolveApiKey('openrouter', settings.providers.openrouter.apiKey)
      if (openrouterKey?.trim()) {
        const catalogMatch =
          models.find((m) => m.provider === 'openrouter' && (m.name === fallbackName || m.id === fallbackName)) ??
          null
        openRouterRateLimitFallbackModel =
          catalogMatch ??
          ({
            id: `openrouter-fallback-${fallbackName}`,
            provider: 'openrouter',
            name: fallbackName,
            displayName: fallbackName,
            supportsTools: true,
          } as ModelConfig)
      }
    }
  }
  return { selected, providerConfig, apiKey, openRouterRateLimitFallbackModel }
}

function isRateLimitLikeError(message: string): boolean {
  const t = message.toLowerCase()
  return (
    /429|rate\s*limit|quota|too many requests|throttl|overload|capacity|retry later|busy|unavailable|503|529/.test(
      t
    ) || /code["']?\s*:\s*["']?(1302|1305)/.test(t)
  )
}

async function runPhase(
  label: string,
  systemPrompt: string,
  userMessage: string,
  maxIterations: number,
  signal: AbortSignal,
  onLog: (line: string) => void,
  onActivity: (p: OrchestratorActivityPayload) => void,
  orchestratorTileId: string | null,
  exec: Awaited<ReturnType<typeof resolveExecutionModel>>,
  workflowIntent?: ResolvedWorkflowIntent | null
) {
  const attempts = [exec.selected]
  if (exec.openRouterRateLimitFallbackModel) {
    attempts.push(exec.openRouterRateLimitFallbackModel)
  }

  let lastError: unknown = null
  for (let i = 0; i < attempts.length; i++) {
    const selected = attempts[i]!
    const providerConfig = useSettingsStore.getState().providers[selected.provider]
    const apiKey =
      i === 0
        ? exec.apiKey
        : await resolveApiKey(selected.provider, providerConfig.apiKey)
    if (!apiKey && !providerAllowsEmptyApiKey(selected.provider)) {
      throw new Error(`Set ${PROVIDER_INFO[selected.provider].name} API key in Settings.`)
    }

    if (i === 0) {
      onLog(`[1-shot] ${label} — ${selected.displayName}`)
    } else {
      onLog(
        `[1-shot] ${label} — rate limited on ${exec.selected.displayName}; switching to OpenRouter fallback (${selected.displayName}).`
      )
    }

    try {
      return await runOrchestratorAgent({
        provider: selected.provider,
        model: selected.name,
        apiKey,
        baseUrl: providerConfig.baseUrl,
        modelDisplayLabel: `${selected.displayName} (${selected.name})`,
        orchestratorTileId,
        runGeneration: useOrchestratorSessionStore.getState().runGeneration,
        messages: [],
        userMessage,
        userContent: userMessage,
        onLog,
        onActivity,
        signal,
        maxIterations,
        textOnlyFirstTurn: false,
        researchMode: false,
        projectInstructions: null,
        installedSkillsCatalog: null,
        overrideSystemPrompt: systemPrompt,
        workflowTraceContext: workflowIntent ? buildWorkflowAuthTraceContext(workflowIntent) : null,
      })
    } catch (e) {
      lastError = e
      const msg = e instanceof Error ? e.message : String(e)
      const hasAnotherAttempt = i < attempts.length - 1
      if (hasAnotherAttempt && isRateLimitLikeError(msg)) {
        continue
      }
      throw e
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '1-shot phase failed'))
}

/** Phase 1 only — research artifacts (e.g. research_context.json) for post-research clarification. */
export async function runOneShotResearchPhase(params: OneShotPipelineParams): Promise<void> {
  const { ideaPrompt, projectRootPrefix, signal, onLog, onPhase, orchestratorTileId: tileIdOpt } = params
  const orchestratorTileId = tileIdOpt ?? null
  const onActivity = (p: OrchestratorActivityPayload) => applyOrchestratorActivityFromPayload(p)
  const authProfiles = useSettingsStore.getState().hybridAuthProfiles
  const workflowIntent = resolveWorkflowIntent(ideaPrompt, { authProfiles })
  const workflowContext = renderWorkflowIntentContext(workflowIntent)
  const baseUser = workflowContext
    ? `**User idea (1-shot):**\n\n${ideaPrompt.trim()}\n\n**Workflow routing seed (catalog-driven):**\n${workflowContext}`
    : `**User idea (1-shot):**\n\n${ideaPrompt.trim()}`
  const exec = await resolveExecutionModel()
  const ml = `${exec.selected.displayName} (${exec.selected.name})`
  if (workflowIntent.matchedWorkflows.length > 0) {
    onLog(
      `[1-shot] Workflow catalog matched: ${workflowIntent.matchedWorkflows
        .map((w) => `${w.id} (${w.risk})`)
        .join(', ')}`
    )
    onLog(
      `[1-shot] Auth lanes: ${workflowIntent.authLanePlan.requiredLanes.join(', ') || 'none'} | OAuth checks: ${workflowIntent.authLanePlan.oauthHealthChecks.join(', ')} | Browser-session checks: ${workflowIntent.authLanePlan.browserSessionHealthChecks.join(', ')}`
    )
  }

  onPhase('research')
  await runPhase(
    'Phase 1 — Research',
    researchPhasePrompt(projectRootPrefix, ml),
    baseUser,
    PHASE_ITERATIONS.research,
    signal,
    onLog,
    onActivity,
    orchestratorTileId,
    exec,
    workflowIntent
  )
  throwIfAborted(signal)
}

/** Phases 2–6 + preview — spec through validation (after optional MC clarification). */
export async function runOneShotPipelineFromSpec(params: OneShotPipelineParams): Promise<void> {
  const { ideaPrompt, projectRootPrefix, signal, onLog, onPhase, orchestratorTileId: tileIdOpt } = params
  const orchestratorTileId = tileIdOpt ?? null
  const onActivity = (p: OrchestratorActivityPayload) => applyOrchestratorActivityFromPayload(p)
  const exec = await resolveExecutionModel()
  const ml = `${exec.selected.displayName} (${exec.selected.name})`

  const authProfiles = useSettingsStore.getState().hybridAuthProfiles
  const workflowIntent = resolveWorkflowIntent(ideaPrompt, { authProfiles })
  const workflowContext = renderWorkflowIntentContext(workflowIntent)
  const intentFollowUp = workflowContext
    ? `**User idea (1-shot; may include post-research clarifications):**\n\n${ideaPrompt.trim()}\n\n**Workflow routing seed (catalog-driven):**\n${workflowContext}\n\n**Mapped command hints:** ${workflowIntent.combinedCommands.join(', ')}`
    : `**User idea (1-shot; may include post-research clarifications):**\n\n${ideaPrompt.trim()}`

  onPhase('spec')
  await runPhase(
    'Phase 2 — Spec',
    specPhasePrompt(projectRootPrefix, ml),
    `Continue from the research phase. Produce SPEC.md as specified.\n\n${intentFollowUp}`,
    PHASE_ITERATIONS.spec,
    signal,
    onLog,
    onActivity,
    orchestratorTileId,
    exec,
    workflowIntent
  )
  throwIfAborted(signal)

  const archMode = useSettingsStore.getState().oneShotArchitectureDiagramMode
  const architectureUserFollowUp =
    archMode === 'cocoon_ai'
      ? 'Continue. Produce ARCHITECTURE.html (Cocoon-style: dark slate background, inline SVG diagram, semantic component colors, three summary cards) and FILE_MANIFEST.json.'
      : 'Continue. Produce ARCHITECTURE.html (self-contained visual page with Mermaid + manifest table) and FILE_MANIFEST.json.'

  onPhase('architecture')
  await runPhase(
    'Phase 3 — Architecture',
    architecturePhasePrompt(projectRootPrefix, ml, archMode),
    architectureUserFollowUp,
    PHASE_ITERATIONS.architecture,
    signal,
    onLog,
    onActivity,
    orchestratorTileId,
    exec,
    workflowIntent
  )
  throwIfAborted(signal)

  onPhase('decomposition')
  await runPhase(
    'Phase 4 — Decomposition',
    decompositionPhasePrompt(projectRootPrefix, ml),
    'Continue. Produce DECOMPOSITION.json **version 2**: flat `tasks` with numeric `id`, `depends_on`, `weight` (1–4), and `category` — dependency DAG for wave scheduling.',
    PHASE_ITERATIONS.decomposition,
    signal,
    onLog,
    onActivity,
    orchestratorTileId,
    exec,
    workflowIntent
  )
  throwIfAborted(signal)

  const workspaceRoot = useWorkspaceStore.getState().rootPath
  if (!workspaceRoot) {
    throw new Error('1-shot: workspace root is not set; cannot load DECOMPOSITION.json')
  }
  onLog('[1-shot] Loading DECOMPOSITION.json and syncing tasks to the sidebar…')
  const decomposition = await loadDecompositionFromWorkspace(workspaceRoot, projectRootPrefix)
  pushDecompositionToTodoStore(decomposition)
  const decompositionTaskCount =
    decomposition.format === 'v1'
      ? decomposition.doc.phases.reduce((n, p) => n + p.tasks.length, 0)
      : decomposition.doc.tasks.length
  onLog(`[1-shot] Decomposition: ${decompositionTaskCount} tasks`)

  onPhase('codegen')
  let lastCodegenLen = 0
  if (decomposition.format === 'v2') {
    const taskById = new Map(decomposition.doc.tasks.map((t) => [t.id, t] as const))
    onLog(`[1-shot] Codegen scheduling: ${decomposition.plan.totalWaves} wave(s) from v2 DAG`)
    for (const wave of decomposition.plan.waves) {
      throwIfAborted(signal)
      const taskList = wave.taskIds
        .map((id) => {
          const t = taskById.get(id)
          if (!t) return null
          return `[${id}] ${t.title} (weight ${t.weight}, category ${t.category})`
        })
        .filter((s): s is string => s != null)
      const waveIterations = computeWaveCodegenIterations(wave.taskIds, taskById)
      const userWaveMessage = [
        `Execute only Wave ${wave.number}/${decomposition.plan.totalWaves}.`,
        '',
        `Wave task ids: ${wave.taskIds.join(', ')}`,
        wave.dependsOnWaveNumbers.length > 0
          ? `Wave depends on prior waves: ${wave.dependsOnWaveNumbers.join(', ')}`
          : 'Wave has no prior-wave dependencies.',
        '',
        'Tasks in scope:',
        ...taskList.map((s) => `- ${s}`),
      ].join('\n')

      const codegen = await runPhase(
        `Phase 5 — Codegen (wave ${wave.number}/${decomposition.plan.totalWaves})`,
        codegenPhasePromptForDecompositionWave(
          projectRootPrefix,
          ml,
          wave.number,
          decomposition.plan.totalWaves
        ),
        userWaveMessage,
        waveIterations,
        signal,
        onLog,
        onActivity,
        orchestratorTileId,
        exec,
        workflowIntent
      )
      lastCodegenLen = codegen.assistantText.length
      onLog(
        `[1-shot] Codegen wave ${wave.number}/${decomposition.plan.totalWaves} finished (max rounds ${waveIterations}); assistant summary length: ${codegen.assistantText.length}`
      )
      onLog('[1-shot] Waiting for sub-agents to finish before next codegen wave…')
      await waitForSubAgentsIdle(signal, 30 * 60_000)
      throwIfAborted(signal)
    }
    onLog(`[1-shot] All codegen waves finished; last assistant summary length: ${lastCodegenLen}`)
  } else {
    for (const phaseName of CODEGEN_DECOMP_PHASES) {
      throwIfAborted(signal)
      const codegen = await runPhase(
        `Phase 5 — Codegen (${phaseName})`,
        codegenPhasePromptForDecompositionPhase(projectRootPrefix, ml, phaseName),
        `Execute only the "${phaseName}" section of DECOMPOSITION.json. Test-driven development; no simulated data; securityChecks on relevant tasks.`,
        PHASE_ITERATIONS.codegen,
        signal,
        onLog,
        onActivity,
        orchestratorTileId,
        exec,
        workflowIntent
      )
      lastCodegenLen = codegen.assistantText.length
      onLog(
        `[1-shot] Codegen (${phaseName}) finished; assistant summary length: ${codegen.assistantText.length}`
      )
      onLog('[1-shot] Waiting for sub-agents to finish before next codegen phase…')
      await waitForSubAgentsIdle(signal, 30 * 60_000)
      throwIfAborted(signal)
    }
    onLog(`[1-shot] All codegen phases finished; last assistant summary length: ${lastCodegenLen}`)
  }

  onPhase('validation')
  await runPhase(
    'Phase 6 — Validation',
    validationPhasePrompt(projectRootPrefix, ml),
    'Continue. Validate, polish README, and fix what you can.',
    PHASE_ITERATIONS.validation,
    signal,
    onLog,
    onActivity,
    orchestratorTileId,
    exec,
    workflowIntent
  )

  onPhase('preview')
}

/** Full pipeline without pausing for clarification (research → … → preview). */
export async function runOneShotPipeline(params: OneShotPipelineParams): Promise<void> {
  await runOneShotResearchPhase(params)
  await runOneShotPipelineFromSpec(params)
}

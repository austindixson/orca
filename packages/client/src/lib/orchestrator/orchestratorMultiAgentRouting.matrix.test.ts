/**
 * Matrix + E2E-style tests for sub-agent OpenRouter/free routing, parallel spawns, and parallel tool API hints.
 *
 * Run: `npm run test:orchestrator-matrix` in packages/client
 *
 * Capture structured logs: `npm run test:orchestrator-matrix 2> routing-matrix.jsonl`
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { ModelConfig } from '../../store/settingsStore.ts'
import { OPENROUTER_MODELS, ZAI_MODELS } from '../../store/settingsStore.ts'
import type { ToolCall } from './types.ts'
import { shouldParallelizeToolBatch } from './orchestratorToolBatch.ts'
import { shouldUseParallelToolCallsInApi } from './orchestratorModelHints.ts'
import {
  OPENROUTER_FREE_ROUTER_MODEL_ID,
  classifySubAgentTaskComplexity,
  decideSubAgentModelForRouting,
  pickBudgetOpenRouterModel,
  resolveSubAgentExecutionModel,
  resolveSubAgentComplexity,
} from './subAgentModelRouting.ts'
import { logRoutingMatrixEvent } from './orchestratorRoutingMatrixReport.ts'

const HAS_OPENROUTER_ENV_KEY = !!(
  process.env.OPENROUTER_API_KEY?.trim() ||
  process.env.VITE_OPENROUTER_API_KEY?.trim()
)

if (!HAS_OPENROUTER_ENV_KEY) {
  logRoutingMatrixEvent({
    phase: 'live_skip_notice',
    reason: 'LIVE test skipped — export OPENROUTER_API_KEY to enable live resolveSubAgentExecutionModel check',
  })
}

const glm47 = ZAI_MODELS.find((m) => m.id === 'zai-glm-4-7')!
const freeRouter = OPENROUTER_MODELS.find((m) => m.id === OPENROUTER_FREE_ROUTER_MODEL_ID)!

/** Catalog as if OpenRouter + Z.AI are both active in Settings. */
const MIXED_CATALOG: ModelConfig[] = [...ZAI_MODELS, ...OPENROUTER_MODELS]

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc-${name}-${Math.random().toString(36).slice(2)}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

describe('routing matrix (decideSubAgentModelForRouting)', () => {
  const matrix: Array<{
    id: string
    complexity: 'simple' | 'complex'
    openrouterActive: boolean
    openRouterKeyResolved: boolean
    expectProvider: 'openrouter' | 'zai'
    expectModelId?: string
  }> = []

  for (const complexity of ['simple', 'complex'] as const) {
    for (const openrouterActive of [true, false]) {
      for (const openRouterKeyResolved of [true, false]) {
        const expectProvider =
          complexity === 'complex'
            ? 'zai'
            : openrouterActive && openRouterKeyResolved
              ? 'openrouter'
              : 'zai'
        matrix.push({
          id: `c=${complexity}_or=${openrouterActive}_key=${openRouterKeyResolved}`,
          complexity,
          openrouterActive,
          openRouterKeyResolved,
          expectProvider,
          expectModelId:
            expectProvider === 'openrouter' ? OPENROUTER_FREE_ROUTER_MODEL_ID : 'zai-glm-4-7',
        })
      }
    }
  }

  for (const row of matrix) {
    test(row.id, () => {
      const t0 = performance.now()
      let err: string | undefined
      let pass = false
      let actualProvider: string | undefined
      let actualModelId: string | undefined
      try {
        const pick = decideSubAgentModelForRouting({
          complexity: row.complexity,
          primary: glm47,
          models: MIXED_CATALOG,
          openrouterActive: row.openrouterActive,
          openRouterKeyResolved: row.openRouterKeyResolved,
        })
        actualProvider = pick.provider
        actualModelId = pick.model.id
        assert.equal(pick.provider, row.expectProvider)
        assert.equal(pick.model.id, row.expectModelId)
        pass = true
      } catch (e) {
        err = e instanceof Error ? e.message : String(e)
        throw e
      } finally {
        logRoutingMatrixEvent({
          phase: 'matrix_decide',
          scenarioId: row.id,
          durationMs: Number(((performance.now() - t0) / 1).toFixed(3)),
          complexity: row.complexity,
          openrouterActive: row.openrouterActive,
          openRouterKeyResolved: row.openRouterKeyResolved,
          expectProvider: row.expectProvider,
          actualProvider,
          actualModelId,
          pass,
          error: err,
        })
      }
    })
  }
})

describe('settings overrides (sub-agent model picks)', () => {
  test('complexModelOverride wins for complex tasks', () => {
    const pick = decideSubAgentModelForRouting({
      complexity: 'complex',
      primary: glm47,
      models: MIXED_CATALOG,
      openrouterActive: true,
      openRouterKeyResolved: true,
      complexModelOverride: freeRouter,
    })
    assert.equal(pick.model.id, freeRouter.id)
  })

  test('simpleModelOverride wins for simple tasks', () => {
    const pick = decideSubAgentModelForRouting({
      complexity: 'simple',
      primary: glm47,
      models: MIXED_CATALOG,
      openrouterActive: true,
      openRouterKeyResolved: true,
      simpleModelOverride: glm47,
    })
    assert.equal(pick.model.id, glm47.id)
  })
})

describe('parallel tool batches (multi spawn + reads)', () => {
  test('three spawns parallel-safe', () => {
    const batch = [
      toolCall('spawn_sub_agent', { task: 'a', display_name: 'A', role: 'r' }),
      toolCall('spawn_sub_agent', { task: 'b', display_name: 'B', role: 'r' }),
      toolCall('spawn_sub_agent', { task: 'c', display_name: 'C', role: 'r' }),
    ]
    const ok = shouldParallelizeToolBatch(batch)
    logRoutingMatrixEvent({ phase: 'parallel_batch', kind: 'three_spawns', parallelOk: ok })
    assert.equal(ok, true)
  })

  test('parallel_tool_calls API: zai glm-4.7 on', () => {
    const on = shouldUseParallelToolCallsInApi('zai', 'GLM-4.7')
    logRoutingMatrixEvent({ phase: 'parallel_api', provider: 'zai', model: 'GLM-4.7', parallelToolCallsInApi: on })
    assert.equal(on, true)
  })

  test('parallel_tool_calls API: openrouter grok-code-fast off', () => {
    const on = shouldUseParallelToolCallsInApi('openrouter', 'x-ai/grok-code-fast-1')
    logRoutingMatrixEvent({
      phase: 'parallel_api',
      provider: 'openrouter',
      model: 'grok-code-fast-1',
      parallelToolCallsInApi: on,
    })
    assert.equal(on, false)
  })
})

describe('classification ↔ routing integration', () => {
  const cases: Array<{ task: string; role: string; want: 'simple' | 'complex' }> = [
    { task: "list_directory on '.' ; one sentence", role: 'Smoke', want: 'simple' },
    { task: 'Implement OAuth2 refresh token rotation across the codebase', role: 'Build', want: 'complex' },
    { task: 'Compare Postgres vs MySQL for our workload', role: 'Research', want: 'complex' },
  ]

  for (const c of cases) {
    test(`classify ${c.want}: ${c.task.slice(0, 40)}…`, () => {
      const got = classifySubAgentTaskComplexity(c.task, c.role)
      logRoutingMatrixEvent({ phase: 'classify', taskPreview: c.task.slice(0, 80), got, want: c.want })
      assert.equal(got, c.want)
      const complexity = resolveSubAgentComplexity(c.task, c.role, 'auto')
      const pick = decideSubAgentModelForRouting({
        complexity,
        primary: glm47,
        models: MIXED_CATALOG,
        openrouterActive: true,
        openRouterKeyResolved: true,
      })
      if (c.want === 'simple') {
        assert.equal(pick.model.id, freeRouter.id)
      } else {
        assert.equal(pick.model.id, glm47.id)
      }
    })
  }
})

describe('routing decision hot path performance', () => {
  test('10k decide calls < 500ms', () => {
    const n = 10_000
    const t0 = performance.now()
    for (let i = 0; i < n; i++) {
      decideSubAgentModelForRouting({
        complexity: 'simple',
        primary: glm47,
        models: MIXED_CATALOG,
        openrouterActive: true,
        openRouterKeyResolved: true,
      })
    }
    const ms = performance.now() - t0
    logRoutingMatrixEvent({ phase: 'perf', iterations: n, totalMs: Math.round(ms * 100) / 100, msPer1k: (ms / n) * 1000 })
    assert.ok(ms < 500, `expected <500ms for ${n} iterations, got ${ms.toFixed(1)}ms`)
  })
})

describe('async resolveSubAgentExecutionModel (integration)', () => {
  test('simple task + keyless openrouter → fallback to primary', async () => {
    const pick = await resolveSubAgentExecutionModel({
      primary: glm47,
      models: MIXED_CATALOG,
      task: 'Say hello in one sentence.',
      role: 'Test',
      taskComplexity: 'simple',
      getActiveProviders: () => ['zai', 'openrouter'],
      openRouterUiKey: '',
    })
    logRoutingMatrixEvent({
      phase: 'async_resolve',
      note: 'empty UI key — expect fallback unless shell env has key',
      modelId: pick.model.id,
      provider: pick.provider,
    })
    // Without a real key in this test process, usually falls back to primary
    assert.ok(pick.model.id === glm47.id || pick.model.id === freeRouter.id)
  })
})

describe('inspect tool routing complexity', () => {
  const inspectToolScenarios = [
    {
      tool: 'get_console_errors',
      task: 'Get recent console errors from browser inspect',
      role: 'Debugging',
      expectedComplexity: 'simple' as const,
      reason: 'Simple data retrieval from inspect store',
    },
    {
      tool: 'get_network_failures',
      task: 'Get failed network requests from inspect store',
      role: 'Debugging',
      expectedComplexity: 'simple' as const,
      reason: 'Simple data retrieval from inspect store',
    },
    {
      tool: 'get_inspect_summary',
      task: 'Get overall inspect summary statistics',
      role: 'Health check',
      expectedComplexity: 'simple' as const,
      reason: 'Simple summary retrieval',
    },
    {
      tool: 'search_console',
      task: 'Search console entries for specific error patterns',
      role: 'Debugging',
      expectedComplexity: 'simple' as const,
      reason: 'Simple search operation',
    },
    {
      tool: 'search_network',
      task: 'Search network requests for API failures',
      role: 'Debugging',
      expectedComplexity: 'simple' as const,
      reason: 'Simple search operation',
    },
    {
      tool: 'get_detected_issues',
      task: 'Get auto-detected issues from inspect store',
      role: 'Debugging',
      expectedComplexity: 'simple' as const,
      reason: 'Simple data retrieval',
    },
    {
      tool: 'export_inspect_data',
      task: 'Export all inspect data for analysis',
      role: 'Data export',
      expectedComplexity: 'simple' as const,
      reason: 'Simple data export',
    },
    {
      tool: 'run_auto_fix',
      task: 'Automatically fix a detected console error',
      role: 'Auto-fix',
      expectedComplexity: 'simple' as const,
      reason: 'Targeted fix for single issue',
    },
    {
      tool: 'run_auto_fix_batch',
      task: 'Fix multiple detected issues in batch',
      role: 'Auto-fix',
      expectedComplexity: 'complex' as const,
      reason: 'Multi-step batch operation with priority handling',
    },
  ]

  for (const scenario of inspectToolScenarios) {
    test(`inspect tool: ${scenario.tool}`, () => {
      const complexity = classifySubAgentTaskComplexity(scenario.task, scenario.role)
      assert.equal(
        complexity,
        scenario.expectedComplexity,
        `Tool "${scenario.tool}" should be ${scenario.expectedComplexity}: ${scenario.reason}`
      )
      logRoutingMatrixEvent({
        phase: 'inspect_tool_routing',
        tool: scenario.tool,
        complexity,
        expected: scenario.expectedComplexity,
        reason: scenario.reason,
      })
    })
  }

  test('inspect tool batch operations are complex', () => {
    const batchTask = 'Run batch auto-fix for all critical issues, then generate report with recommendations'
    const batchRole = 'Auto-debug specialist'
    const complexity = classifySubAgentTaskComplexity(batchTask, batchRole)
    assert.equal(complexity, 'complex', 'Batch operations should be complex')
    logRoutingMatrixEvent({
      phase: 'inspect_tool_routing',
      tool: 'run_auto_fix_batch',
      complexity,
      task: batchTask,
    })
  })

  test('inspect tool health checks are simple', () => {
    const healthCheckTask = 'Get inspect summary and check for any critical issues that need attention'
    const healthCheckRole = 'Health monitor'
    const complexity = classifySubAgentTaskComplexity(healthCheckTask, healthCheckRole)
    assert.equal(complexity, 'simple', 'Health checks should be simple')
    logRoutingMatrixEvent({
      phase: 'inspect_tool_routing',
      tool: 'get_inspect_summary',
      complexity,
      task: healthCheckTask,
    })
  })
})

describe('LIVE OpenRouter key (optional)', () => {
  test(
    'resolveSubAgentExecutionModel uses free router when key present',
    { skip: !HAS_OPENROUTER_ENV_KEY },
    async () => {
      const t0 = performance.now()
      try {
        const pick = await resolveSubAgentExecutionModel({
          primary: glm47,
          models: MIXED_CATALOG,
          task: 'Reply one word: ok',
          role: 'Live',
          taskComplexity: 'simple',
          getActiveProviders: () => ['zai', 'openrouter'],
          openRouterUiKey: process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY,
        })
        const ms = performance.now() - t0
        logRoutingMatrixEvent({
          phase: 'live_resolve',
          durationMs: Math.round(ms * 100) / 100,
          modelId: pick.model.id,
          provider: pick.provider,
          pass: pick.model.id === OPENROUTER_FREE_ROUTER_MODEL_ID,
        })
        assert.equal(pick.model.id, OPENROUTER_FREE_ROUTER_MODEL_ID)
        assert.equal(pick.provider, 'openrouter')
      } catch (e) {
        logRoutingMatrixEvent({
          phase: 'live_error',
          error: e instanceof Error ? e.message : String(e),
        })
        throw e
      }
    }
  )
})

describe('catalog invariants', () => {
  test('pickBudgetOpenRouterModel returns free router from mixed catalog', () => {
    const m = pickBudgetOpenRouterModel(MIXED_CATALOG)
    assert.ok(m)
    assert.equal(m!.id, OPENROUTER_FREE_ROUTER_MODEL_ID)
  })
})

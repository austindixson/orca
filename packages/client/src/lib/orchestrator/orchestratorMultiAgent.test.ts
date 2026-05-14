/**
 * Regression tests for Hermes-style multi-agent orchestration:
 * parallel tool batches, spawn_sub_agent in the tool manifest, and concurrent worker caps.
 *
 * Run: `npm test` in packages/client
 *
 * Manual smoke: import { MULTI_AGENT_ORCHESTRATOR_SMOKE_PROMPT } from './orchestratorMultiAgentSmoke.js'
 */
import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { ToolCall } from './types.ts'
import { pickAssistantChoiceOrThrow } from './runOrchestrator.ts'
import { shouldParallelizeToolBatch } from './orchestratorToolBatch.ts'
import { shouldUseParallelToolCallsInApi } from './orchestratorModelHints.ts'
import { MAX_CONCURRENT_SUB_AGENTS } from './orchestratorConstants.ts'
import { getEffectiveMaxConcurrentSubAgents } from './orchestratorZaiLimits.ts'
import { ZAI_DEFAULT_MODEL_ID } from '../../store/settingsStore.ts'
import { ORCHESTRATOR_TOOLS_OPENAI } from './toolDefinitions.ts'
import { useAgentTeamStore } from '../../store/agentTeamStore.ts'
import { useCanvasStore, type TileData } from '../../store/canvasStore.ts'
import {
  findReusableSubAgentTileId,
  MAX_SUBTASKS_PER_AGENT,
  shouldHideDelegatedSubAgentTile,
  validateSubAgentTaskScope,
} from './executeTools.ts'
import {
  MULTI_AGENT_ORCHESTRATOR_SMOKE_PROMPT,
  PRACTICAL_MULTI_AGENT_WORKFLOW_PROMPT,
} from './orchestratorMultiAgentSmoke.ts'
import {
  countWorkingSubAgentsForOrchestratorTile,
  mergePendingSubAgentHandoffs,
} from '../../store/orchestratorSessionStore.ts'
import { formatInstalledSkillsCatalogForOrchestrator } from '../skillCommands.ts'
import { classifyOrchestratorPrompt } from './orchestratorPromptTriage.ts'
import {
  classifySubAgentTaskComplexity,
  isOpenRouterFreeRouterModel,
  OPENROUTER_FREE_ROUTER_MODEL_ID,
  pickBudgetOpenRouterModel,
  resolveSubAgentComplexity,
  subAgentErrorSuggestsFreeTierOrGatewayRetry,
} from './subAgentModelRouting.ts'
import {
  formatHierarchyBlock,
  shouldUseHierarchicalPlanning,
  type OrchestratorHierarchyResult,
} from './orchestratorHierarchyPhase.ts'
import {
  evaluateDirectoryStagnation,
  INITIAL_DIRECTORY_STAGNATION_STATE,
} from './orchestratorStagnationGuard.ts'
import { OPENROUTER_MODELS } from '../../store/settingsStore.ts'
import { shouldAttemptSubAgentFreeRouterFallback } from './subAgentRunner.ts'

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc-${name}-${Math.random().toString(36).slice(2)}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  }
}

describe('multi-agent / parallel orchestration', () => {
  test('tool manifest includes spawn_sub_agent', () => {
    const names = ORCHESTRATOR_TOOLS_OPENAI.map((t) => t.function.name)
    assert.ok(names.includes('spawn_sub_agent'), 'spawn_sub_agent must be registered for delegation')
  })

  test('tool manifest includes chat_with_hermes_tile', () => {
    const names = ORCHESTRATOR_TOOLS_OPENAI.map((t) => t.function.name)
    assert.ok(
      names.includes('chat_with_hermes_tile'),
      'chat_with_hermes_tile must be registered for drivable Hermes HTTP chat'
    )
  })

  test('MULTI_AGENT_ORCHESTRATOR_SMOKE_PROMPT references spawn_sub_agent', () => {
    assert.match(MULTI_AGENT_ORCHESTRATOR_SMOKE_PROMPT, /spawn_sub_agent/i)
  })

  test('PRACTICAL_MULTI_AGENT_WORKFLOW_PROMPT covers research / build / test sub-agents', () => {
    const p = PRACTICAL_MULTI_AGENT_WORKFLOW_PROMPT
    assert.match(p, /spawn_sub_agent/i)
    assert.match(p, /Research/i)
    assert.match(p, /Implementation/i)
    assert.match(p, /Testing/i)
    assert.match(p, /\.agent-canvas\/practical-team/i)
  })

  test('shouldParallelizeToolBatch: multiple spawn_sub_agent in one batch is allowed', () => {
    const batch = [
      toolCall('spawn_sub_agent', { task: 'track A', display_name: 'A', role: 'r1' }),
      toolCall('spawn_sub_agent', { task: 'track B', display_name: 'B', role: 'r2' }),
      toolCall('spawn_sub_agent', { task: 'track C', display_name: 'C', role: 'r3' }),
    ]
    assert.equal(shouldParallelizeToolBatch(batch), true)
  })

  test('shouldParallelizeToolBatch: spawn + reads not parallel (exclusive mixed with FS reads)', () => {
    const batch = [
      toolCall('spawn_sub_agent', { task: 't', display_name: 'X', role: 'r' }),
      toolCall('read_file', { path: 'README.md' }),
      toolCall('list_directory', { path: '.' }),
    ]
    assert.equal(shouldParallelizeToolBatch(batch), false)
  })

  test('shouldParallelizeToolBatch: overlapping writes are not parallelized', () => {
    const batch = [
      toolCall('write_file', { path: 'same.txt', content: 'a' }),
      toolCall('write_file', { path: 'same.txt', content: 'b' }),
    ]
    assert.equal(shouldParallelizeToolBatch(batch), false)
  })

  test('non-Z.AI main model: spawn_sub_agent cap is MAX_CONCURRENT_SUB_AGENTS (5)', () => {
    assert.equal(MAX_CONCURRENT_SUB_AGENTS, 5)
    assert.equal(getEffectiveMaxConcurrentSubAgents('gpt-4o', 'pro'), 5)
  })

  test('Z.AI main model: sub-agent cap follows plan tier', () => {
    assert.equal(getEffectiveMaxConcurrentSubAgents(ZAI_DEFAULT_MODEL_ID, 'lite'), 2)
    assert.equal(getEffectiveMaxConcurrentSubAgents(ZAI_DEFAULT_MODEL_ID, 'pro'), 4)
    assert.equal(getEffectiveMaxConcurrentSubAgents(ZAI_DEFAULT_MODEL_ID, 'max'), 8)
  })

  test('shouldUseParallelToolCallsInApi: budget Grok off, other OpenRouter on', () => {
    assert.equal(shouldUseParallelToolCallsInApi('openrouter', 'x-ai/grok-code-fast-1'), false)
    assert.equal(shouldUseParallelToolCallsInApi('openrouter', 'x-ai/grok-3-mini'), false)
    assert.equal(shouldUseParallelToolCallsInApi('openrouter', 'anthropic/claude-3.5-sonnet'), true)
    assert.equal(shouldUseParallelToolCallsInApi('openai', 'gpt-4o'), true)
  })

  test('sub-agent complexity: short list_directory smoke → simple', () => {
    assert.equal(
      classifySubAgentTaskComplexity(
        "List the workspace root with list_directory on '.' only; reply with one sentence.",
        'Smoke A'
      ),
      'simple'
    )
  })

  test('sub-agent complexity: research / long tasks → complex', () => {
    assert.equal(classifySubAgentTaskComplexity('Compare React vs Vue for our dashboard', 'Research'), 'complex')
    assert.equal(classifySubAgentTaskComplexity('Refactor the auth module for OAuth2', 'Build'), 'complex')
  })

  test('sub-agent complexity: analyze dependencies/build is simple (not misclassified as research)', () => {
    assert.equal(
      classifySubAgentTaskComplexity(
        'Analyze dependencies and turbo.json for outdated packages; summarize only.',
        'Build Analyzer'
      ),
      'simple'
    )
  })

  test('resolveSubAgentComplexity respects explicit override', () => {
    assert.equal(resolveSubAgentComplexity('tiny', 'x', 'simple'), 'simple')
    assert.equal(resolveSubAgentComplexity('tiny', 'x', 'complex'), 'complex')
    assert.equal(resolveSubAgentComplexity('Refactor everything', 'x', 'auto'), 'complex')
  })

  test('pickBudgetOpenRouterModel prefers openrouter/free', () => {
    const m = pickBudgetOpenRouterModel(OPENROUTER_MODELS)
    assert.ok(m)
    assert.equal(m!.id, OPENROUTER_FREE_ROUTER_MODEL_ID)
  })

  test('classifyOrchestratorPrompt: production readiness → complex', () => {
    assert.equal(classifyOrchestratorPrompt('is my project production ready?'), 'complex')
  })

  test('classifyOrchestratorPrompt: short greeting → simple', () => {
    assert.equal(classifyOrchestratorPrompt('hi'), 'simple')
  })

  test('shouldUseHierarchicalPlanning: large vision task => true', () => {
    assert.equal(
      shouldUseHierarchicalPlanning({
        promptTier: 'complex',
        prompt: 'Build out and implement all modules shown in the attached image and make it production-ready.',
        wantsImages: true,
        skillActivated: false,
      }),
      true
    )
  })

  test('shouldUseHierarchicalPlanning: simple prompt => false', () => {
    assert.equal(
      shouldUseHierarchicalPlanning({
        promptTier: 'simple',
        prompt: 'rename one function',
        wantsImages: false,
        skillActivated: false,
      }),
      false
    )
  })

  test('shouldUseHierarchicalPlanning: skill workflow blocks hierarchy', () => {
    assert.equal(
      shouldUseHierarchicalPlanning({
        promptTier: 'complex',
        prompt: 'Build and ship everything end to end with all modules.',
        wantsImages: true,
        skillActivated: true,
      }),
      false
    )
  })

  test('formatHierarchyBlock includes phases/tasks/subtasks execution contract', () => {
    const plan: OrchestratorHierarchyResult = {
      understanding: 'Ship a full feature in controlled phases.',
      phases: [
        {
          title: 'Foundation',
          objective: 'Set up baseline architecture and scaffolding.',
          tasks: [
            { title: 'Scaffold', subtasks: ['Create folders', 'Add configs', 'Wire routes'] },
            { title: 'Data model', subtasks: ['Define schema', 'Add validation', 'Create migrations'] },
            { title: 'Bootstrap tests', subtasks: ['Set up test runner', 'Add fixtures', 'Add smoke test'] },
          ],
        },
        {
          title: 'Implementation',
          objective: 'Build core behaviors and integrate modules.',
          tasks: [
            { title: 'Backend', subtasks: ['Implement service', 'Add API handler', 'Add errors'] },
            { title: 'Frontend', subtasks: ['Build UI shell', 'Wire state', 'Hook API'] },
            { title: 'Integration', subtasks: ['Connect flows', 'Handle edge cases', 'Add telemetry'] },
          ],
        },
        {
          title: 'Hardening',
          objective: 'Validate quality and ship readiness.',
          tasks: [
            { title: 'QA', subtasks: ['Run unit tests', 'Run e2e tests', 'Fix regressions'] },
            { title: 'Security', subtasks: ['Scan secrets', 'Review auth', 'Review input handling'] },
            { title: 'Release', subtasks: ['Update docs', 'Prepare changelog', 'Draft rollout plan'] },
          ],
        },
      ],
    }
    const block = formatHierarchyBlock(plan)
    assert.match(block, /Large-task hierarchy/i)
    assert.match(block, /Phase 1: Foundation/)
    assert.match(block, /Task 1\.1: \*\*Scaffold\*\*/)
    assert.match(block, /1\.1\.1 Create folders/)
    assert.match(block, /Proceed with Phase 1 now\./)
  })

  test('formatInstalledSkillsCatalogForOrchestrator lists skills and read_file hint', () => {
    const block = formatInstalledSkillsCatalogForOrchestrator(
      [{ kind: 'skill', id: 's', name: 'e2e-testing', description: 'Playwright patterns' }],
      [{ kind: 'command', id: 'c', name: 'code-review', description: 'Review pass' }]
    )
    assert.ok(block.includes('read_file'))
    assert.ok(block.includes('/e2e-testing'))
    assert.ok(block.includes('/code-review'))
  })

  test('directory stagnation guard nudges on repetitive list_directory rounds', () => {
    let state = INITIAL_DIRECTORY_STAGNATION_STATE
    const listOnly = [toolCall('list_directory', { path: '.' })]
    let sawNudge = false
    for (let i = 0; i < 6; i++) {
      const d = evaluateDirectoryStagnation(listOnly, state)
      state = d.nextState
      if (d.action === 'nudge') sawNudge = true
    }
    assert.equal(sawNudge, true)
    assert.equal(state.nudgesSent, 1)
  })

  test('directory stagnation guard halts after continued repetition post-nudge', () => {
    let state = INITIAL_DIRECTORY_STAGNATION_STATE
    const listOnly = [toolCall('list_directory', { path: '.' })]
    let action: string = 'none'
    for (let i = 0; i < 12; i++) {
      const d = evaluateDirectoryStagnation(listOnly, state)
      state = d.nextState
      action = d.action
      if (action === 'halt') break
    }
    assert.equal(action, 'halt')
  })

  test('directory stagnation guard resets after non-list tool batch', () => {
    let state = INITIAL_DIRECTORY_STAGNATION_STATE
    const listOnly = [toolCall('list_directory', { path: '.' })]
    for (let i = 0; i < 3; i++) {
      const d = evaluateDirectoryStagnation(listOnly, state)
      state = d.nextState
    }
    const reset = evaluateDirectoryStagnation([toolCall('read_file', { path: 'README.md' })], state)
    assert.equal(reset.action, 'none')
    assert.equal(reset.nextState.consecutiveListDirectoryRounds, 0)
    assert.equal(reset.nextState.repeatedSameSignatureStreak, 0)
  })

  test('directory stagnation guard does not nudge when list_directory paths keep changing', () => {
    let state = INITIAL_DIRECTORY_STAGNATION_STATE
    let sawIntervention = false
    for (let i = 0; i < 12; i++) {
      const d = evaluateDirectoryStagnation(
        [toolCall('list_directory', { path: `src/dir-${i}` })],
        state
      )
      state = d.nextState
      if (d.action !== 'none') sawIntervention = true
    }
    assert.equal(sawIntervention, false)
  })

  test('completion schema guard throws clear error when choices are missing', () => {
    assert.throws(
      () => pickAssistantChoiceOrThrow({} as never),
      /Invalid completion payload: missing choices\[0\]/i
    )
    assert.throws(
      () => pickAssistantChoiceOrThrow({ choices: [] } as never),
      /Invalid completion payload: missing choices\[0\]/i
    )
  })

  test('completion schema guard accepts valid choices array', () => {
    const choice = pickAssistantChoiceOrThrow({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    } as never)
    assert.equal(typeof choice, 'object')
  })

  test('isOpenRouterFreeRouterModel detects free router catalog entry', () => {
    const free = OPENROUTER_MODELS.find((m) => m.id === OPENROUTER_FREE_ROUTER_MODEL_ID)
    assert.ok(free)
    assert.equal(isOpenRouterFreeRouterModel(free!), true)
    const glm = OPENROUTER_MODELS.find((m) => m.name.includes('glm') && m.provider === 'openrouter')
    if (glm) assert.equal(isOpenRouterFreeRouterModel(glm), false)
  })

  test('subAgentErrorSuggestsFreeTierOrGatewayRetry flags overload/parse/network, not 401', () => {
    assert.equal(subAgentErrorSuggestsFreeTierOrGatewayRetry(new Error('429 rate limit')), true)
    assert.equal(subAgentErrorSuggestsFreeTierOrGatewayRetry(new Error('error decoding response body')), true)
    assert.equal(subAgentErrorSuggestsFreeTierOrGatewayRetry(new Error('Chat response: JSON parse failed')), true)
    assert.equal(subAgentErrorSuggestsFreeTierOrGatewayRetry(new Error('401 Unauthorized')), false)
  })

  test('shouldAttemptSubAgentFreeRouterFallback: free exec + different primary + retryable err', () => {
    const free = OPENROUTER_MODELS.find((m) => m.id === OPENROUTER_FREE_ROUTER_MODEL_ID)
    assert.ok(free)
    const primary = OPENROUTER_MODELS.find((m) => m.id !== free!.id && m.provider === 'openrouter')
    assert.ok(primary)
    assert.equal(
      shouldAttemptSubAgentFreeRouterFallback(free!, primary!, new Error('429 Too Many Requests')),
      true
    )
  })

  test('shouldAttemptSubAgentFreeRouterFallback: false when exec === primary', () => {
    const free = OPENROUTER_MODELS.find((m) => m.id === OPENROUTER_FREE_ROUTER_MODEL_ID)
    assert.ok(free)
    assert.equal(shouldAttemptSubAgentFreeRouterFallback(free!, free!, new Error('429')), false)
  })

  test('shouldAttemptSubAgentFreeRouterFallback: false when error is not retry class (401)', () => {
    const free = OPENROUTER_MODELS.find((m) => m.id === OPENROUTER_FREE_ROUTER_MODEL_ID)
    const primary = OPENROUTER_MODELS.find((m) => m.id !== free!.id)
    assert.ok(free && primary)
    assert.equal(shouldAttemptSubAgentFreeRouterFallback(free, primary, new Error('401 Unauthorized')), false)
  })

  test('shouldAttemptSubAgentFreeRouterFallback: false when primary has supportsTools: false', () => {
    const free = OPENROUTER_MODELS.find((m) => m.id === OPENROUTER_FREE_ROUTER_MODEL_ID)
    assert.ok(free)
    const primary = { ...OPENROUTER_MODELS.find((m) => m.id !== free!.id)!, supportsTools: false as const }
    assert.equal(shouldAttemptSubAgentFreeRouterFallback(free, primary, new Error('429')), false)
  })

  test('sub-agent task scope rule: allows up to max explicit subtasks', () => {
    const ok = validateSubAgentTaskScope('Subtasks:\n- A\n- B\n- C')
    assert.equal(ok.ok, true)
    assert.equal(MAX_SUBTASKS_PER_AGENT, 3)
  })

  test('sub-agent task scope rule: over-cap subtasks are chunked for extra agents', () => {
    const over = validateSubAgentTaskScope('Subtasks:\n- A\n- B\n- C\n- D\n- E')
    assert.equal(over.ok, false)
    if (!over.ok) {
      assert.deepEqual(over.batches, [
        ['A', 'B', 'C'],
        ['D', 'E'],
      ])
    }
  })

  test('delegated worker visibility policy: default runners stay in group view, Hermes remains visible', () => {
    assert.equal(shouldHideDelegatedSubAgentTile('default'), true)
    assert.equal(shouldHideDelegatedSubAgentTile('hermes'), false)
  })

  describe('agentTeamStore concurrent workers', () => {
    beforeEach(() => {
      useAgentTeamStore.getState().clear()
      useCanvasStore.setState((s) => ({ ...s, tiles: new Map(), maxZIndex: 1 }))
    })

    test('countWorkingSubAgents tracks working status', () => {
      for (let i = 0; i < MAX_CONCURRENT_SUB_AGENTS; i++) {
        useAgentTeamStore.getState().registerMember({
          tileId: `tile-${i}`,
          displayName: `Agent ${i}`,
          role: 'worker',
          status: 'working',
        })
      }
      assert.equal(useAgentTeamStore.getState().countWorkingSubAgents(), MAX_CONCURRENT_SUB_AGENTS)

      useAgentTeamStore.getState().patchMember('tile-0', { status: 'done' })
      assert.equal(useAgentTeamStore.getState().countWorkingSubAgents(), MAX_CONCURRENT_SUB_AGENTS - 1)
    })

    test('findReusableSubAgentTileId reuses identical active worker', () => {
      useAgentTeamStore.getState().registerMember({
        tileId: 'tile-active',
        displayName: 'Mei — find path error definition',
        role: 'coding/build/CI',
        delegatedTask: 'Search the codebase for the exact error string.',
        status: 'working',
      })

      const reusable = findReusableSubAgentTileId({
        displayName: '  Mei — find   path error definition  ',
        role: 'coding/build/CI',
        task: 'Search the codebase for the exact error string.',
        now: 10_000,
      })

      assert.deepEqual(reusable, { tileId: 'tile-active', reason: 'active' })
    })

    test('findReusableSubAgentTileId reuses identical recently completed worker only within window', () => {
      useAgentTeamStore.getState().registerMember({
        tileId: 'tile-done',
        displayName: 'Mei — find path error definition',
        role: 'coding/build/CI',
        delegatedTask: 'Search the codebase for the exact error string.',
        status: 'working',
      })
      useAgentTeamStore
        .getState()
        .patchMember('tile-done', { status: 'done', statusUpdatedAt: 20_000 })

      const recent = findReusableSubAgentTileId({
        displayName: 'Mei — find path error definition',
        role: 'coding/build/CI',
        task: 'Search the codebase for the exact error string.',
        now: 45_000,
      })
      assert.deepEqual(recent, { tileId: 'tile-done', reason: 'recent' })

      const stale = findReusableSubAgentTileId({
        displayName: 'Mei — find path error definition',
        role: 'coding/build/CI',
        task: 'Search the codebase for the exact error string.',
        now: 60_100,
      })
      assert.equal(stale, null)
    })

    test('countWorkingSubAgentsForOrchestratorTile only counts delegated workers for that orchestrator', () => {
      const tiles = new Map<string, TileData>([
        [
          'tile-a',
          {
            id: 'tile-a',
            type: 'agent',
            x: 0,
            y: 0,
            w: 320,
            h: 240,
            zIndex: 1,
            title: 'A',
            meta: { parentOrchestratorTileId: 'orch-1' },
          },
        ],
        [
          'tile-b',
          {
            id: 'tile-b',
            type: 'agent',
            x: 0,
            y: 0,
            w: 320,
            h: 240,
            zIndex: 2,
            title: 'B',
            meta: { parentOrchestratorTileId: 'orch-2' },
          },
        ],
      ])
      useCanvasStore.setState({ tiles })
      useAgentTeamStore.getState().registerMember({
        tileId: 'tile-a',
        displayName: 'Mei',
        role: 'worker',
        delegatedTask: 'task a',
        status: 'working',
      })
      useAgentTeamStore.getState().registerMember({
        tileId: 'tile-b',
        displayName: 'Sora',
        role: 'worker',
        delegatedTask: 'task b',
        status: 'working',
      })
      useAgentTeamStore.getState().patchMember('tile-b', { status: 'done' })

      assert.equal(countWorkingSubAgentsForOrchestratorTile('orch-1'), 1)
      assert.equal(countWorkingSubAgentsForOrchestratorTile('orch-2'), 0)
    })

    test('mergePendingSubAgentHandoffs formats the resume payload once', () => {
      assert.equal(
        mergePendingSubAgentHandoffs(['first result', 'second result']),
        '[Parallel sub-agent results]\n\nfirst result\n\n---\n\nsecond result'
      )
    })
  })

  describe('team chat inbox delivery for sub-agents', () => {
    beforeEach(() => {
      useAgentTeamStore.getState().clear()
    })

    test('lead handoff reaches the addressed sub-agent inbox once, then cursor advances', async () => {
      const { useGroupChatStore } = await import('../../store/groupChatStore.ts')
      const { collectAndFormatInboxForTile } = await import('./teamChatInbox.ts')

      const SESSION = 'sess-multi-inbox'
      const LEAD = 'tile-lead-inbox'
      const WORKER = 'tile-worker-inbox'

      useGroupChatStore.getState().clearForSession(SESSION)
      useAgentTeamStore.getState().registerMember({
        tileId: LEAD,
        displayName: 'Red Lead',
        role: 'lead',
      })
      useAgentTeamStore.getState().registerMember({
        tileId: WORKER,
        displayName: 'Mei',
        role: 'coding',
      })

      useGroupChatStore.getState().postMessage({
        sessionId: SESSION,
        senderTileId: LEAD,
        senderName: 'Red Lead',
        body: '@Mei pick up ticket 42',
        mentions: [{ raw: 'Mei', kind: 'agent', tileId: WORKER }],
        kind: 'handoff',
      })

      const first = collectAndFormatInboxForTile(SESSION, WORKER)
      assert.ok(first && first.includes('ticket 42'), 'worker inbox must receive the handoff')
      assert.ok(first!.includes('[handoff]'), 'formatted line must tag the kind')

      const second = collectAndFormatInboxForTile(SESSION, WORKER)
      assert.equal(second, null, 'cursor must advance so the same message is not re-injected')

      const fromLead = collectAndFormatInboxForTile(SESSION, LEAD)
      assert.equal(fromLead, null, 'sender must not receive their own outgoing message')
    })
  })
})

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMemoryEvalSeedContent,
  evaluateHarnessTaskList,
  MEMORY_EVAL_SIGNALS_REL,
  parseHarnessEvalFileStrict,
} from './evaluateHarnessSuite'

describe('evaluateHarnessSuite', () => {
  it('passes search split smoke tasks', async () => {
    const out = await evaluateHarnessTaskList({
      version: 1,
      split: 'search',
      tasks: [
        { id: 'execution_contract_merge', kind: 'execution_contract_merge' },
        { id: 'tool_filter_smoke', kind: 'tool_filter_smoke' },
      ],
    })
    assert.equal(out.tasks.length, 2)
    assert.ok(out.tasks.every((t) => t.pass))
    assert.ok((out.aggregates?.passRate ?? 0) >= 1)
  })

  it('strict parser rejects unknown task kinds', () => {
    const raw = JSON.stringify({
      version: 1,
      split: 'search',
      tasks: [{ id: 'x', kind: 'definitely_unknown_kind' }],
    })
    assert.throws(() => parseHarnessEvalFileStrict(raw, 'search'), /unknown kind/i)
  })

  it('strict parser enforces split match', () => {
    const raw = JSON.stringify({
      version: 1,
      split: 'test',
      tasks: [{ id: 'ok', kind: 'tool_filter_smoke' }],
    })
    assert.throws(() => parseHarnessEvalFileStrict(raw, 'search'), /split mismatch/i)
  })

  it('includes zero score for unknown task kinds in meanScore aggregation', async () => {
    const out = await evaluateHarnessTaskList({
      version: 1,
      split: 'search',
      tasks: [
        { id: 'execution_contract_merge', kind: 'execution_contract_merge' },
        { id: 'unknown_probe', kind: 'definitely_unknown_kind' as never },
      ],
    })
    assert.equal(out.tasks.length, 2)
    assert.equal(out.tasks[0]?.score, 10)
    assert.equal(out.tasks[1]?.pass, false)
    assert.equal(out.tasks[1]?.score, undefined)
    assert.equal(out.aggregates?.meanScore, 5)
    assert.equal(out.aggregates?.passRate, 0.5)
  })

  it('passes proactive split tasks (heartbeat + autonomy constitution)', async () => {
    const out = await evaluateHarnessTaskList({
      version: 1,
      split: 'proactive',
      tasks: [
        { id: 'hb', kind: 'heartbeat_synthetic_message_marker' },
        { id: 'broad', kind: 'autonomy_constitution_broad_gates' },
        { id: 'std', kind: 'autonomy_constitution_standard_confirm' },
      ],
    })
    assert.equal(out.tasks.length, 3)
    assert.ok(out.tasks.every((t) => t.pass), `failed: ${JSON.stringify(out.tasks)}`)
    assert.ok((out.aggregates?.passRate ?? 0) >= 1)
  })

  it('passes conformance split tasks (non-empty final + recovery hints + safety/cancellation/error-branch invariants)', async () => {
    const out = await evaluateHarnessTaskList({
      version: 1,
      split: 'conformance',
      tasks: [
        { id: 'nonempty-final', kind: 'terminal_success_requires_non_empty_final' },
        { id: 'recovery-hints', kind: 'single_failure_requires_recovery_attempt' },
        { id: 'flow-contract', kind: 'prompt_flow_contract_present' },
        { id: 'interrupt-resume', kind: 'interruption_answer_then_resume_offer' },
        { id: 'safety-gate', kind: 'safety_gate_blocks_destructive_shell' },
        { id: 'cancel-integrity', kind: 'wait_for_sub_agent_cancellation_integrity' },
        { id: 'error-branching', kind: 'error_first_recovery_branching' },
        { id: 'file-sensitive-branching', kind: 'file_mutation_sensitive_path_branching' },
        { id: 'regression-canary', kind: 'regression_canary_detection' },
        { id: 'grounding-evidence', kind: 'grounding_evidence_contract' },
        { id: 'stale-refresh', kind: 'stale_data_refresh_contract' },
        { id: 'failure-uncertainty', kind: 'tool_failure_uncertainty_contract' },
        { id: 'policy-steering', kind: 'mid_run_policy_steering_contract' },
        { id: 'p2-iteration-cap', kind: 'iteration_cap_enforcement' },
        { id: 'p1-parallel-conflict', kind: 'parallel_tool_conflict_guard' },
        { id: 'p1-resume-once', kind: 'exactly_once_resume_handoff_integrity' },
        { id: 'p1-heartbeat-skip-hygiene', kind: 'heartbeat_synthetic_tag_skip_hygiene' },
        { id: 'p1-trace-phase-end-state', kind: 'trace_phase_end_state_completeness' },
      ],
    })
    assert.equal(out.tasks.length, 18)
    assert.ok(out.tasks.every((t) => t.pass), `failed: ${JSON.stringify(out.tasks)}`)
    assert.ok((out.aggregates?.passRate ?? 0) >= 1)
    assert.equal(out.aggregates?.p0HardFail, false)
    assert.equal(out.aggregates?.overallPass, true)
    assert.equal(out.aggregates?.severity?.p0?.failed, 0)
    assert.equal(out.aggregates?.buckets?.safety?.total, 2)
  })

  it('memory split: cold run fails then warm run passes after seed (recurring signal pairs)', async () => {
    const dir = join(tmpdir(), `orca-memory-eval-${Date.now()}`)
    mkdirSync(join(dir, '.agent-canvas/harness'), { recursive: true })
    const sigPath = join(dir, MEMORY_EVAL_SIGNALS_REL)
    writeFileSync(sigPath, '', 'utf8')

    const file = {
      version: 1 as const,
      split: 'memory' as const,
      tasks: [
        {
          id: 'mem_error_context',
          kind: 'memory_recurring_gate' as const,
          signalKind: 'error' as const,
          detailPrefix: 'context_limit',
        },
        {
          id: 'mem_stagnation_loop',
          kind: 'memory_recurring_gate' as const,
          signalKind: 'stagnation' as const,
          detailPrefix: 'repeated_tool',
        },
        {
          id: 'mem_inspect_hard',
          kind: 'memory_recurring_gate' as const,
          signalKind: 'inspect' as const,
          detailPrefix: 'hard failure',
        },
      ],
    }

    try {
      const cold = await evaluateHarnessTaskList(file, { workspaceRoot: dir })
      assert.equal(cold.aggregates?.passRate, 0)

      writeFileSync(sigPath, buildMemoryEvalSeedContent(), 'utf8')
      assert.ok(readFileSync(sigPath, 'utf8').includes('context_limit'))

      const warm = await evaluateHarnessTaskList(file, { workspaceRoot: dir })
      assert.equal(warm.aggregates?.passRate, 1)
      assert.ok(warm.tasks.every((t) => t.pass))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { aggregateInvariantScores } from './scoreAggregation'
import type { HarnessEvalTaskDef } from './evaluateHarnessSuite'
import type { HarnessTaskResultV1 } from '../harnessCandidates'

describe('aggregateInvariantScores', () => {
  it('marks overall fail when any p0 task fails', () => {
    const tasks: HarnessEvalTaskDef[] = [
      { id: 'p0-non-empty-final-after-tools', kind: 'terminal_success_requires_non_empty_final' },
      { id: 'p1-interruption-answer-then-resume-offer', kind: 'interruption_answer_then_resume_offer' },
    ]
    const results: HarnessTaskResultV1[] = [
      { id: 'p0-non-empty-final-after-tools', pass: false },
      { id: 'p1-interruption-answer-then-resume-offer', pass: true },
    ]

    const out = aggregateInvariantScores(tasks, results)
    assert.equal(out.p0HardFail, true)
    assert.equal(out.overallPass, false)
    assert.equal(out.severity.p0.failed, 1)
    assert.equal(out.severity.p1.failed, 0)
  })

  it('keeps overall pass when all p0 tasks pass even if p1 fails', () => {
    const tasks: HarnessEvalTaskDef[] = [
      { id: 'p0-safety-gate-destructive-shell', kind: 'safety_gate_blocks_destructive_shell' },
      { id: 'p1-prompt-flow-contract-present', kind: 'prompt_flow_contract_present' },
    ]
    const results: HarnessTaskResultV1[] = [
      { id: 'p0-safety-gate-destructive-shell', pass: true },
      { id: 'p1-prompt-flow-contract-present', pass: false },
    ]

    const out = aggregateInvariantScores(tasks, results)
    assert.equal(out.p0HardFail, false)
    assert.equal(out.overallPass, true)
    assert.equal(out.severity.p0.failed, 0)
    assert.equal(out.severity.p1.failed, 1)
  })

  it('produces deterministic bucket counts', () => {
    const tasks: HarnessEvalTaskDef[] = [
      { id: 'p0-non-empty-final-after-tools', kind: 'terminal_success_requires_non_empty_final' },
      { id: 'p0-error-first-recovery-branching', kind: 'error_first_recovery_branching' },
      { id: 'p0-safety-gate-destructive-shell', kind: 'safety_gate_blocks_destructive_shell' },
    ]
    const results: HarnessTaskResultV1[] = [
      { id: 'p0-non-empty-final-after-tools', pass: true },
      { id: 'p0-error-first-recovery-branching', pass: false },
      { id: 'p0-safety-gate-destructive-shell', pass: true },
    ]

    const out = aggregateInvariantScores(tasks, results)
    assert.equal(out.buckets.final_response.total, 1)
    assert.equal(out.buckets.recovery.total, 1)
    assert.equal(out.buckets.safety.total, 1)
    assert.deepEqual(out.buckets.recovery.failedIds, ['p0-error-first-recovery-branching'])
  })
})

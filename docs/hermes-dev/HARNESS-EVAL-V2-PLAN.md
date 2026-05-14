# Harness Eval v2 Plan

Status: Draft
Owner: Hermes
Date: 2026-04-20

## Objective
Upgrade eval from static shape/smoke checks to behavioral loop verification aligned with `LOOP-CONFORMANCE-SPEC.md`.

## Why now
Current eval splits (`search`, `test`, `memory`, `proactive`) are useful but shallow for loop quality.
We need tests that fail when loop behavior regresses, even if prompt text still looks correct.

## Deliverables
1. New task kinds in `evaluateHarnessSuite.ts` for loop behavior.
2. New task files for conformance scenarios.
3. Deterministic unit/integration tests covering P0/P1 invariants.
4. Enhanced scoring JSON with invariant buckets.

## Proposed invariant buckets
- termination
- final_response
- recovery
- safety
- cancellation
- queue_handoff
- proactive_hygiene
- observability

## v2 task matrix (first wave)

### P0 tasks (must pass)
1. `terminal_success_requires_non_empty_final`
- Simulate tool rounds followed by empty assistant terminal content.
- Expect: run returns error/recovery path, never `ok` with empty output.
- Maps to: I1, I2

2. `single_failure_requires_recovery_attempt`
- Inject recoverable model/tool failure once.
- Expect at least one bounded retry/fallback/replan before terminal error.
- Maps to: I4

3. `safety_gate_blocks_unconfirmed_destructive_action`
- Simulate destructive action under standard autonomy.
- Expect confirm-first behavior enforcement.
- Maps to: I5

4. `stop_unwinds_wait_for_sub_agent`
- Start wait tool, abort parent signal.
- Expect clean cancelled outcome, no ghost continuation.
- Maps to: I7

### P1 tasks
5. `iteration_cap_enforced`
- Force repeated tool-call loop.
- Expect deterministic max-iteration failure.
- Maps to: I6

6. `tool_batch_parallel_conflict_guard`
- Mixed write conflicts in one batch.
- Expect sequentialization/refusal of unsafe parallel batch.
- Maps to: I6, I8

7. `handoff_resume_exactly_once`
- Simulate concurrent sub-agent completion and parent resume.
- Expect exactly-once merged handoff injection.
- Maps to: I8

### P2 tasks
8. `heartbeat_run_tag_and_skip_hygiene`
- Empty heartbeat instructions -> no run.
- Non-empty -> synthetic marker present.
- Maps to: I9

9. `trace_contains_phase_and_end_state`
- Ensure trace includes start/phase/end with terminal state.
- Maps to: I10

## Implementation map
- `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
  - add new `HarnessEvalTaskDef` kinds
  - add deterministic evaluators
- `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json` (new)
- `packages/client/src/lib/orchestrator/harnessEval/cli.ts`
  - support `--split conformance`
- tests:
  - `runOrchestrator` focused regression file(s)
  - conformance eval suite tests

## Scoring model changes
Add to `scores.json`:
- `invariantBuckets`: { bucket: { passRate, failedTaskIds } }
- `severity`: { p0Pass, p1Pass, p2Pass }
- `gate`: overall fail if any P0 fails

## Suggested execution order
1. Implement P0 tasks and wire scoring gate.
2. Add conformance split CLI support.
3. Add P1 tasks.
4. Add P2 tasks + richer reporting.

## Success criteria
- Conformance split exists and runs deterministically without live LLM.
- Any P0 regression blocks candidate acceptance.
- Score output directly identifies invariant failures.

# Orca Wave 1 + Wave 2 Execution Log

Date: 2026-04-21

## Scope
Implemented sequential hardening waves based on `ORCA-25-TASK-ADVERSARIAL-FIX-MAP.md`.

## Wave 1 (P0 hardening) completed

### Runtime guardrails
- Added run-budget guard helper to orchestrator loop:
  - wall-clock budget enforcement
  - estimated-context-token budget enforcement
- Files:
  - `packages/client/src/lib/orchestrator/orchestratorConstants.ts`
  - `packages/client/src/lib/orchestrator/runOrchestrator.ts`
  - `packages/client/src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts`

### Conformance integrity canary
- Added new harness conformance task kind: `regression_canary_detection`
- Canary asserts destructive shell pattern (`rm -rf`) is detected and blocked in safety `block` mode.
- Files:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
  - `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts`

## Wave 2 (P1 contract hardening) completed

### Prompt contract upgrades
Added explicit protocol clauses in dynamic prompt preface:
- grounding/evidence-backed claims
- stale-data refresh requirement
- explicit uncertainty on tool failure/missing evidence
- mid-run policy steering (ack + re-plan from checkpoint)

File:
- `packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts`

### Conformance checks for new protocol clauses
Added new harness conformance task kinds:
- `grounding_evidence_contract`
- `stale_data_refresh_contract`
- `tool_failure_uncertainty_contract`
- `mid_run_policy_steering_contract`

Files:
- `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
- `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`
- `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts`

## Validation run
Command:
- `NODE_ENV=test npm exec -- c8 node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts src/lib/orchestrator/orchestratorPromptLayers.test.ts`

Result:
- 25/25 tests passed

Conformance eval run:
- `npm run harness:eval --workspace=@agent-canvas/client -- --candidate wave2-hardening --split conformance`
- Output candidate: `.agent-canvas/harness/candidates/wave2-hardening/scores.json`
- passRate=1.0, meanScore=10.0, p0HardFail=false

## Notes
- This execution improved Orca-side conformance contracts and runtime fail-closed behavior.
- The external 25-task adversarial suite that uses intentionally corrupted/empty traces remains intentionally harsh by design; these changes target Orca behavior and contract guarantees.
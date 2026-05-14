# Skills Integration Breakdown for Orca

Date: 2026-04-20 17:16:53 PDT
Owner: Hermes
Purpose: Break down key skills and map each to concrete Orca harness implementation points.

## Why this doc
You called out that skills are being loaded but not yet fully operationalized in Orca behavior. This doc translates skill intent into harness-level mechanics and conformance tests.

## Skill 1: systematic-debugging

What the skill does (intent):
- Forces root-cause investigation before fixes.
- Prevents thrash/guessing loops.
- Enforces a phased flow: investigate -> pattern analysis -> hypothesis test -> implementation.

What Orca should do (implementation):
1) Debug-mode execution contract
- Add a debug contract stage in orchestrator planning output:
  - repro step
  - evidence capture step
  - root-cause hypothesis
  - minimal fix
  - verification

2) Tool-sequencing policy for debugging
- When in debug mode, enforce order:
  - search/read/log inspection before write_file/run_shell mutating actions.
- Block direct fix attempts when no evidence artifact exists.

3) Evidence requirements
- Require at least one evidence artifact before mutating code:
  - failing test output
  - stack trace snippet
  - targeted grep/read proof

4) Anti-thrash detector
- If 2+ failed fix attempts without new evidence, automatically route back to investigation phase.

Conformance tasks to add:
- `debug_requires_evidence_before_mutation`
- `debug_repro_step_present`
- `debug_second_fix_requires_new_hypothesis`

## Skill 2: phase-completion-verification

What the skill does (intent):
- Prevents duplicate work by verifying existing implementation before coding/delegating.
- Reduces unnecessary API/tool spend and rate-limit thrash.

What Orca should do (implementation):
1) Mandatory preflight for “implement/complete phase” intents
- Before writes/delegation, run:
  - file discovery
  - key file reads
  - gap analysis summary

2) Gap report artifact
- Persist a short structured gap report in run state:
  - existing features
  - missing pieces
  - work decision (none/patch/new)

3) Delegation gate
- `spawn_sub_agent` for feature work requires a non-empty gap report unless user explicitly overrides.

Conformance tasks to add:
- `phase_completion_verifies_before_delegate`
- `phase_completion_detects_already_complete`
- `phase_completion_limits_unnecessary_writes`

## Skill 3: verify-existing-implementation

What the skill does (intent):
- Avoids re-implementing existing functionality.
- Ensures new code follows existing project patterns.

What Orca should do (implementation):
1) Existing-code check macro
- Automatically invoke a “verify-existing” mini-plan when user says implement/create/add.

2) Pattern anchoring
- Require implementation proposals to cite at least one existing pattern file.

3) Duplicate function detector
- Pre-write static check for likely duplicates (name + semantic overlap heuristics).

Conformance tasks to add:
- `verify_existing_runs_before_new_feature`
- `new_code_references_existing_pattern`
- `duplicate_api_endpoint_prevented`

## Skill 4: writing-plans / plan

What the skills do (intent):
- Produce explicit, executable plans with verification steps.
- Avoid vague implementation and hidden assumptions.

What Orca should do (implementation):
1) Plan-mode state
- Add explicit run mode: `plan_only` (no mutating tools).

2) Plan quality rubric
- Plan must include:
  - exact files
  - steps
  - tests
  - risks

3) Plan-to-execution handoff
- Convert approved plan items into bounded todo/execution contracts.

Conformance tasks to add:
- `plan_mode_blocks_mutations`
- `plan_contains_file_paths_and_tests`
- `execution_contract_generated_from_plan`

## Cross-skill orchestration policy

Priority order when multiple skills apply:
1) phase-completion-verification / verify-existing-implementation
2) systematic-debugging (if failure/bug context)
3) writing-plans / plan (if multi-step or user asks to plan)
4) execution/delegation

Fail-safe rule:
- If prerequisites from higher-priority skill are missing, lower-priority execution steps are blocked.

## Orca implementation map

Likely touch points:
- `packages/client/src/lib/orchestrator/runOrchestrator.ts`
- `packages/client/src/lib/orchestrator/orchestratorExecutionContract.ts`
- `packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts`
- `packages/client/src/lib/orchestrator/executeTools.ts`
- `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
- `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`

## Metrics to prove skills are implemented (not just loaded)

- % of phase-completion tasks that produce a gap report before mutation
- % of debugging runs with evidence artifact before first fix
- Duplicate-work rate (should decline)
- Mean tool calls per completed task (should decline)
- Retry-without-new-evidence rate (should decline)

## Rollout

Phase A: Add evaluators + passive telemetry checks
Phase B: Add soft warnings
Phase C: Enforce hard gates for P0 behaviors

## Definition of done

1) Skills influence run behavior deterministically.
2) Skill-specific conformance tasks pass in harness eval.
3) Tool efficiency improves measurably with no regression in completion quality.

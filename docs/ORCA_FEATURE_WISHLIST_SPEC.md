# Orca Feature Wishlist Spec (Open Items Only)

Owner: Hermes-led Orca roadmap
Scope: Non-Hermes mode core harness + shared reliability/runtime + UX platform priorities
Status: Active working spec

## 1) Purpose

This spec converts the consolidated Hermes research wishlist into an implementation-ready execution artifact.

It is intentionally:
- open-only (excludes already completed work),
- de-duplicated across NEXT-STEPS + blueprint/spec docs,
- prioritized by reliability and user-visible impact,
- mapped to concrete code targets and acceptance criteria.

## 2) Planning Principles

1. P0 items gate releases for candidate acceptance.
2. Any failed P0 invariant hard-fails overall conformance.
3. Evidence-first workflow required before mutation/delegation.
4. Interruption behavior must be deterministic and checkpoint-based.
5. Visualization/UX additions must stay within strict runtime budgets.

## 3) Open Backlog by Track

### Track A — Core orchestrator harness (non-Hermes-lead relevant)

A1. P0 conformance expansion
- Add destructive file-path/write guard evaluator coverage for non-shell side effects.
- Ensure deterministic evaluators + fixtures + thresholds for all P0 invariants.
- Keep strict hard-block behavior for candidate acceptance.

A2. Scoring and gating upgrades
- Add invariant-bucket scoring in score aggregation output:
  - termination
  - final_response
  - recovery
  - safety
  - cancellation
  - queue_handoff
  - proactive_hygiene
  - observability
- Add severity rollups (p0/p1/p2 pass flags).
- Add global hard-fail gate (any P0 fail => overall fail).

A3. P1/P2 evaluator wave
- iteration cap enforcement
- parallel tool conflict guard
- exactly-once handoff/resume integrity
- heartbeat synthetic-tag + skip hygiene
- trace phase/end-state completeness

A4. Skills-to-runtime policy enforcement
- Debug contract before mutation (evidence-first).
- Phase-completion verification before delegate/write.
- Verify-existing implementation macro before net-new feature creation.
- Plan-only mode that blocks mutation paths.
- Enforce cross-skill prerequisite order.

A5. Interrupt/resume deterministic behavior
- checkpoint capture on interruption
- answer interruption first
- explicit resume handoff
- resume from checkpoint (not restart)
- preserve todo state through interruption

### Track B — Harness knob optimization wave

B1. Tool-use strictness tuning
B2. Iteration budget + early-stop/stagnation tuning
B3. Context budget allocator improvements (chat/memory/tool/system split)
B4. Memory write/retrieval gating
B5. Tool-output budgeting/truncation tuning
B6. Recovery/fallback policy tuning
B7. Parallelism limits and safeguards
B8. Side-effect safety gates hardening
B9. Phase-based model routing
B10. Prompt-layer architecture hardening

### Track C — Reliability/runtime integrity

C1. Fresh QA sweep to verify:
- no post-completion tool-call replay
- no “No user message found in input”
- explicit cancellation source
- no browser-policy mismatch
- status-strip elapsed/context behavior remains correct

C2. Add missing E2E queued-path interruption regression.

C3. Maintain telemetry row-level parsing and invariant-linked failure classification.

### Track D — UX/platform features

D1. In-canvas tool-call bubbles/nodes (no standalone graph page)
- state coloring: queued/running/success/error
- tool-category token styling
- budgets: max nodes, TTL collapse, FPS throttle

D2. Final cleanup of standalone graph-only code paths.

D3. Narrow-width readability QA (tile + sidebar).

### Track E — Design extraction workflow (screenshot -> JSON -> regenerate)

E1. Strict schema/types for style-guide JSON.

E2. Prompt-template builders for full + scoped extraction modes.

E3. JSON normalize/repair pass for malformed model output.

E4. Provider-agnostic extraction orchestration API.

E5. UI flow:
- upload
- mode select
- inspect/edit JSON
- regenerate

E6. Eval fixtures + drift/fidelity scoring harness.

E7. Operator docs/runbook + troubleshooting + quality gates.

### Track F — Memory system rebuild (major wishlist track)

P0 must-have:
F1. Unified canonical typed memory store (stable IDs + metadata)
F2. Unified retrieval API across memory domains
F3. Deterministic write governance (confidence/dedupe/redaction/supersession)
F4. Memory usefulness scoring + behavior-change benchmarks
F5. Safety/privacy controls per scope/category

P1 important:
F6. Two-stage distillation pipeline (extract -> normalize/classify/score/dedupe)
F7. Memory debugger panel (provenance, score, retrieval rationale)
F8. TTL/retention by memory type

P2 quality:
F9. Learned ranking features
F10. Conflict-resolution assistant prompts for high-confidence contradictions

### Track G — Secondary backlog item

G1. GitHub Rising Radar hardening
- second-source signals
- weekly digest cron + trend deltas
- optional evidence-grounded LLM narratives

## 4) Execution Board (P0/P1/P2)

## P0 Board (must ship first)

1) Bucket scoring + hard-fail aggregation
- Priority: P0
- Depends on: existing conformance task manifest
- File targets:
  - Create: `packages/client/src/lib/orchestrator/harnessEval/scoreAggregation.ts`
  - Create: `packages/client/src/lib/orchestrator/harnessEval/scoreAggregation.test.ts`
  - Modify: `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
  - Modify: `packages/client/src/lib/orchestrator/harnessEval/cli.ts`
- Acceptance:
  - Any P0 fail sets overall candidate fail.
  - Output includes bucket + severity rollups.

2) Deterministic queued interruption E2E
- Priority: P0
- Depends on: current interruption checkpoint path
- File targets:
  - Modify: `packages/client/src/lib/orchestrator/interruptionResume.ts`
  - Modify: `packages/client/src/lib/orchestrator/interruptionResume.test.ts`
  - Create: `packages/client/src/lib/orchestrator/interruptionResume.queuedPath.integration.test.ts`
- Acceptance:
  - Interrupt -> queued follow-up -> resume from checkpoint -> clear checkpoint all pass.

3) Skills policy runtime gates
- Priority: P0
- Depends on: skills integration breakdown
- File targets:
  - Modify: `packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts`
  - Modify: `packages/client/src/lib/orchestrator/runOrchestrator.ts`
  - Modify: `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`
  - Modify: `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts`
- Acceptance:
  - Missing required skill contract markers fail conformance.
  - Plan-only mode blocks mutation/delegation operations.

4) Fresh reliability QA evidence pass
- Priority: P0
- Depends on: none
- File targets:
  - Modify: `hermes-dev/NEXT-STEPS.md`
  - Modify: `hermes-dev/WORKLOG.md`
  - Modify: `packages/client/src/lib/orchestrator/activityLineParsing.ts`
  - Modify: `packages/client/src/lib/orchestrator/activityLineParsing.test.ts`
- Acceptance:
  - QA checklist run recorded with evidence references.
  - Row-level parsing catches replay/cancel-source regressions.

## P1 Board

5) In-canvas tool-call bubbles with budgets
- Priority: P1
- File targets:
  - Modify: `packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.tsx`
  - Modify: `packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.test.tsx`
  - Create: `packages/client/src/lib/orchestrator/traceNodeBudget.ts`
  - Create: `packages/client/src/lib/orchestrator/traceNodeBudget.test.ts`
- Acceptance:
  - Node state colors + tool category tokens render.
  - Node caps, TTL collapse, FPS throttle enforce budget.

6) Narrow-width trace/layout regression pack
- Priority: P1
- File targets:
  - Modify: `packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.test.tsx`
  - Modify: `packages/client/src/lib/orchestrator/hermesTracePresentation.test.ts`
- Acceptance:
  - No overlap/clipping in narrow width snapshots.

7) Design extraction workflow v1
- Priority: P1
- File targets:
  - Modify: `hermes-dev/DESIGN-EXTRACTION-JSON-TOOL.md`
  - Modify: `hermes-dev/DESIGN-EXTRACTION-JSON-TOOL-IMPLEMENTATION-PLAN.md`
  - Create: `packages/client/src/lib/orchestrator/designExtraction/schema.ts`
  - Create: `packages/client/src/lib/orchestrator/designExtraction/schema.test.ts`
  - Create: `packages/client/src/lib/orchestrator/designExtraction/normalizer.ts`
- Acceptance:
  - Strict schema validator + repair pass operational.
  - Scoped extraction templates documented and test-covered.

## P2 Board

8) Harness knobs -> evaluator translation completion
- Priority: P2
- File targets:
  - Modify: `hermes-dev/HARNESS-KNOBS-PRIORITIES.md`
  - Modify: `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`
  - Modify: `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
- Acceptance:
  - Each high-impact knob has deterministic evaluator mapping.

9) Memory rebuild phase bridge (policy to runtime)
- Priority: P2
- File targets:
  - Modify: `hermes-dev/MEMORY-SYSTEM-REBUILD.md`
  - Modify: `packages/client/src/lib/orchestrator/orcaMemory.ts`
  - Modify: `packages/client/src/lib/orchestrator/memoryDistiller.ts`
  - Modify: `packages/client/src/lib/orchestrator/orcaMemory.test.ts`
- Acceptance:
  - Typed schema fields + governance gates enforced in runtime path.

## 5) Recommended Next 7-Task Sprint (exact targets)

Sprint theme: Close deterministic conformance and interruption reliability first, then unlock UX parity.

Task 1 — Add score aggregation module
- Files:
  - `packages/client/src/lib/orchestrator/harnessEval/scoreAggregation.ts` (new)
  - `packages/client/src/lib/orchestrator/harnessEval/scoreAggregation.test.ts` (new)
- Outcome:
  - Bucket/severity rollups and P0 hard-fail logic implemented.

Task 2 — Wire aggregation into harness eval CLI
- Files:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
  - `packages/client/src/lib/orchestrator/harnessEval/cli.ts`
- Outcome:
  - `harness:eval` emits deterministic score summary for gating.

Task 3 — Add queued-path interruption integration regression
- Files:
  - `packages/client/src/lib/orchestrator/interruptionResume.queuedPath.integration.test.ts` (new)
  - `packages/client/src/lib/orchestrator/interruptionResume.ts`
- Outcome:
  - Checkpoint capture/handoff/clear is protected by failing test first.

Task 4 — Enforce skill prerequisite ordering at runtime
- Files:
  - `packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts`
  - `packages/client/src/lib/orchestrator/runOrchestrator.ts`
  - `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`
- Outcome:
  - Policy now executable; skipped prerequisites fail conformance.

Task 5 — Add trace node budget utility
- Files:
  - `packages/client/src/lib/orchestrator/traceNodeBudget.ts` (new)
  - `packages/client/src/lib/orchestrator/traceNodeBudget.test.ts` (new)
- Outcome:
  - Node cap + TTL + FPS controls are centralized and testable.

Task 6 — Implement in-canvas node rendering updates
- Files:
  - `packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.tsx`
  - `packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.test.tsx`
- Outcome:
  - Tool-call bubbles visible with status/category styling.

Task 7 — Reliability QA pass + evidence logging
- Files:
  - `packages/client/src/lib/orchestrator/activityLineParsing.ts`
  - `packages/client/src/lib/orchestrator/activityLineParsing.test.ts`
  - `hermes-dev/NEXT-STEPS.md`
  - `hermes-dev/WORKLOG.md`
- Outcome:
  - Replay/cancel-source/no-user-message checks rerun and documented.

## 6) Validation Commands (post-sprint)

- `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split conformance`
- `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts src/lib/orchestrator/interruptionResume.test.ts src/components/tiles/agent-tile/AgentTraceDrawer.test.tsx`
- `npm run -s build --workspace=packages/client`

## 7) Definition of Done

The sprint is done only if:
1. P0 hard-fail gate is active and proven by failing fixture.
2. Queued interruption resume path has deterministic integration regression coverage.
3. Skill prerequisite policy is runtime-enforced and conformance-tested.
4. In-canvas trace nodes render with budget protections enabled.
5. QA evidence is logged in hermes-dev docs with references and outcomes.

## 8) Governance

- Re-rank weekly in `hermes-dev/NEXT-STEPS.md`.
- Keep this spec open-only (move completed history to `hermes-dev/WORKLOG.md`).
- Any completed item must include:
  - modified file list,
  - validation command output summary,
  - conformance task IDs added/updated.

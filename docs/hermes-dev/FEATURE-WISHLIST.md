# Orca Feature Wishlist (Living Backlog — Synced to Root Spec)

Last updated: 2026-04-21 18:53:29 PDT
Owner: Hermes-led Orca roadmap
Source of truth: `/Users/ghost/Desktop/orca/ORCA_FEATURE_WISHLIST_SPEC.md`

Scope lock:
- Orca harness + orchestrator reliability/UX only
- world-model/dreaming feature expansion is out of scope for Orca

Purpose:
- keep a concise, open-only execution board in `hermes-dev`
- mirror the full root-level spec without duplicating deep implementation detail
- preserve strict P0/P1/P2 prioritization for sprint planning
- track full parity status for every wishlist item in `FEATURE-WISHLIST-PARITY.md`

---

## P0 — Must ship first (release-gating)

1) Invariant bucket scoring + P0 hard-fail aggregation
- DONE (2026-04-21): added deterministic score aggregation module + tests; harness eval now emits `p0HardFail`, `overallPass`, severity rollups, and bucket rollups.
- Add bucketed scoring and severity rollups.
- Any failed P0 invariant must hard-fail overall candidate status.
- Target areas:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
  - `packages/client/src/lib/orchestrator/harnessEval/cli.ts`
  - new score aggregation module + tests

2) Queued-path interruption/resume deterministic regression
- DONE (2026-04-21): added `interruptionResume.queued.integration.test.ts` covering checkpoint capture, interrupt-first answer, queued resume directive application, and checkpoint clear.
- Add E2E/integration coverage for:
  - checkpoint capture on interruption
  - answer interruption first
  - resume from checkpoint
  - checkpoint clear after resume
- Target areas:
  - `packages/client/src/lib/orchestrator/interruptionResume.ts`
  - `packages/client/src/lib/orchestrator/interruptionResume.test.ts`
  - new queued-path integration test

3) Skills-to-runtime policy enforcement gates
- DONE (2026-04-21): prompt/runtime contract extended with grounding + mid-run policy steering; added runtime plan-only mutation guard in `runOrchestrator.ts`; conformance manifest/evaluator coverage added for evidence/policy contracts.
- Enforce evidence-first debug contract before mutation/delegate/write.
- Enforce verify-existing and phase-completion prerequisites.
- Enforce plan-only mode mutation blocking.
- Target areas:
  - `packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts`
  - `packages/client/src/lib/orchestrator/runOrchestrator.ts`
  - conformance task manifest + tests

4) Fresh reliability QA sweep + telemetry evidence
- Verify no tool-call replay, no missing-user-input regressions, explicit cancel source, browser-policy consistency.
- Maintain row-level telemetry parsing for invariant-linked diagnostics.
- Record proof in `WORKLOG.md`.

5) World-model/dreaming decommission completion in Orca harness
- DONE (2026-04-21): removed residual dream-gate coupling from browser tool execution path in `executeTools.ts`; browser actions now run without dream preflight dependencies.
- Remove remaining runtime coupling and stale config surface area tied to dreaming preflight.
- Keep fail-open/no-op behavior only where compatibility transition is required.
- Add/refresh regression coverage proving normal orchestration path has no dream-gate dependency.
- Target areas:
  - `packages/client/src/lib/orchestrator/executeTools.ts`
  - `packages/client/src/store/settingsStore.ts`
  - dream-related tests/docs cleanup in `packages/client/src/lib/orchestrator/*` + `hermes-dev/*`

---

## P1 — High-impact UX and workflow capability

6) In-canvas tool-call bubbles/nodes (no standalone graph)
- DONE (2026-04-21): trace drawer now renders node-style chips with state colors and category tokens; node budget + overflow behavior wired through `traceNodeBudget.ts` with tests.
- state colors: queued/running/success/error
- tool-category token styling
- budgets: max nodes, TTL collapse, FPS throttle

7) Narrow-width trace readability regression coverage
- DONE (2026-04-21): added focused `AgentTraceDrawer.test.tsx` regression coverage for narrow-width wrapping/collapse/spacing plus overflow controls.
- Add focused tile + sidebar tests for wrapping/collapse/spacing.

8) Design extraction workflow v1 (screenshot -> JSON -> controlled regen)
- DONE (2026-04-21): added `designExtraction/` module with strict schema validator, full/scoped prompt templates, JSON normalization/repair, provider-agnostic service API, and full test suite.
- strict style-guide schema + validator
- prompt templates (full + scoped extraction)
- normalize/repair pass
- provider-agnostic orchestration API
- operator runbook + troubleshooting + quality gates

---

## P1/P2 — Memory rebuild (major track)

P0 must-have:
- unified canonical typed memory store (stable IDs + metadata)
- unified retrieval API
- deterministic write governance (confidence/dedupe/redaction/supersession)
- usefulness scoring + behavior-change benchmarks
- safety/privacy controls

P1:
- two-stage distillation pipeline
- memory debugger panel
- TTL/retention by memory type

P2:
- learned ranking features
- contradiction resolution assistant prompts

---

## P2 — Policy/completeness and platform hardening

9) Harness knobs -> deterministic evaluator translation completion
- Convert high-leverage knobs into objective evaluator tasks/thresholds.

10) Remaining P1/P2 conformance wave
- IN_PROGRESS (2026-04-21): shipped deterministic evaluators + conformance manifest coverage for:
  - iteration cap enforcement
  - parallel tool conflict guard
  - exactly-once handoff/resume integrity
  - heartbeat synthetic-tag + skip hygiene
  - trace phase/end-state completeness
- Implemented in `harnessEval/evaluateHarnessSuite.ts` + `tasks.conformance.json` with bucket mapping updates in `harnessEval/scoreAggregation.ts`.
- Validation: targeted harness-eval tests pass; conformance split run passes with `p0HardFail=false`, `overallPass=true`.

11) Standalone graph cleanup completion
- remove residual standalone graph-only code paths; keep in-canvas surface only.

12) Workspace switching resilience pass
- prevent stale-root behavior during fast switches and resumed runs.

13) Canvas bridge timeout architecture cleanup
- reduce opaque timeout collapses and improve provenance.

---

## Secondary backlog

14) GitHub Rising Radar hardening
- second-source signals
- weekly digest cron + trend deltas
- optional evidence-grounded LLM narratives

---

## Next 7-task sprint (synced summary)

1. Add score aggregation module + tests
2. Wire aggregation into harness eval CLI outputs
3. Add queued interruption integration regression
4. Enforce skill prerequisite ordering at runtime
5. Complete world-model/dreaming decommission cleanup in Orca harness path
6. Run reliability QA sweep and log evidence in `WORKLOG.md`
7. Implement in-canvas node rendering updates + budget tests

## Sprint card pack (actionable now)

Card P0-A — Bucket scoring + hard fail
- Scope:
  - create `scoreAggregation.ts` and `scoreAggregation.test.ts`
  - wire into `evaluateHarnessSuite.ts` + `cli.ts`
- Proof:
  - conformance run emits bucket + severity rollups
  - injected P0 failure flips overall candidate to fail

Card P0-B — Queued interruption deterministic resume
- Scope:
  - add queued-path integration test for checkpoint capture/handoff/clear
  - patch interruption runtime only as needed to satisfy failing test
- Proof:
  - deterministic pass over interrupt -> answer -> resume -> clear flow

Card P0-C — Skills runtime policy gate
- Scope:
  - enforce prerequisite-order markers in prompt/runtime contract
  - add conformance tasks that fail when ordering/plan-only constraints are violated
- Proof:
  - negative fixture fails; compliant fixture passes

Card P0-D — Reliability evidence sweep
- Scope:
  - run fresh telemetry-backed QA pass for replay/cancel-source/no-user-input invariants
  - log evidence pointers in `WORKLOG.md`
- Proof:
  - checklist complete with row-level telemetry confirmation

Card P0-E — Orca dreaming/world-model cleanup hardening
- Scope:
  - remove residual dreaming config/runtime coupling in Orca harness path
  - keep compatibility no-op only where transition-safe
  - add/update regression checks to prove no dream-gate dependency in normal orchestrator flow
- Proof:
  - search scan shows no active runtime dream gating path
  - targeted tests + client build pass

Detailed file-by-file task specs remain in:
- `/Users/ghost/Desktop/orca/ORCA_FEATURE_WISHLIST_SPEC.md`

---

## Dependency map (execution-critical)

- P0-1 bucket scoring depends on stable conformance task IDs in `tasks.conformance.json`.
- P0-2 interruption queued-path regression should land before broader interrupt/resume protocol expansion.
- P0-3 skills-runtime gates should run after bucket scoring is wired, so gate failures are severity-scored immediately.
- P1-5 trace-node rendering should not start until P0 reliability sweep confirms baseline stability.
- P1-7 design extraction workflow depends on schema lock before UI/operator flow work.

---

## Release gate checklist (must all pass)

- [ ] `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split conformance`
- [ ] P0 bucket severity output present in `scores.json`
- [ ] any P0 violation flips overall candidate to fail
- [ ] queued interruption-resume integration test green
- [ ] telemetry QA confirms no replay and explicit cancellation source
- [ ] `npm run -s build --workspace=packages/client`

---

## Defer-until-later (explicitly not now)

- major new world-model/dreaming complexity in Orca runtime path
- speculative UX effects that reduce trace readability or add heavy animation cost
- broad refactors of unrelated tile systems while P0 reliability gates remain open

---

## Future waves (harness roadmap view)

Wave F1 (next 2 weeks): deterministic release gate closure
- complete P0-A/P0-B/P0-C/P0-E implementation cards
- add P0 bucketed scoring and hard-fail candidate aggregation
- close queued interruption-resume deterministic integration coverage
- finish decommission cleanup scan and remove residual dream-gate coupling

Wave F2 (following 2–4 weeks): trace parity and operator confidence
- ship in-canvas tool-call bubbles with strict budgets
- lock narrow-width trace regressions with stable snapshots
- execute reliability QA sweeps on a recurring cadence and publish evidence deltas

Wave F3 (month 2+): memory and policy hardening
- move memory rebuild M-P0 to implementation-ready contracts
- complete harness-knob -> evaluator mapping across remaining high-leverage knobs
- deliver remaining P1/P2 conformance wave and tighten pass/fail reason quality

Wave F4 (after gate stability): platform resilience cleanup
- workspace switching hardening under rapid project changes
- canvas bridge timeout architecture cleanup with improved failure provenance
- standalone graph path retirement validation and cleanup completion

---

## Governance

- Re-rank weekly in `NEXT-STEPS.md`.
- Keep this file open-only; move completed history to `WORKLOG.md`.
- Every completed item must include:
  - files changed
  - validation commands/results
  - conformance task IDs added/updated

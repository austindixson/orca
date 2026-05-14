# Orca Feature Wishlist Parity Board (Full Coverage)

Last updated: 2026-04-21 18:53:29 PDT
Scope: Full parity tracking for every open item in `FEATURE-WISHLIST.md`
Source docs:
- `hermes-dev/FEATURE-WISHLIST.md`
- `/Users/ghost/Desktop/orca/ORCA_FEATURE_WISHLIST_SPEC.md`

Definition of parity:
- an item has implementation coverage in runtime + tests/evaluators + docs/worklog evidence
- and passes the relevant validation commands for its tier

Status legend:
- NOT_STARTED: no implementation wave started
- IN_PROGRESS: implementation started, parity evidence incomplete
- PARITY_READY: implementation + tests + docs evidence complete

---

## P0 parity board (release gating)

1) Invariant bucket scoring + P0 hard-fail aggregation
- Status: PARITY_READY
- Runtime parity target:
  - add score aggregation module with bucket + severity rollups
  - hard-fail overall candidate on any P0 invariant failure
- Test/eval parity target:
  - deterministic tests for bucket mapping + hard-fail behavior
- Evidence target:
  - conformance run output + `scores.json` sample in worklog
- Evidence (2026-04-21):
  - new `harnessEval/scoreAggregation.ts` + `scoreAggregation.test.ts`
  - `evaluateHarnessSuite.ts` now emits `aggregates.p0HardFail`, `aggregates.overallPass`, `aggregates.severity`, `aggregates.buckets`
  - conformance CLI now prints `p0HardFail` + `overallPass`

2) Queued-path interruption/resume deterministic regression
- Status: PARITY_READY
- Runtime parity target:
  - deterministic checkpoint capture/handoff/resume/clear path
- Test/eval parity target:
  - dedicated queued-path integration regression test
- Evidence target:
  - test output proving interrupt-first + resume correctness

3) Skills-to-runtime policy enforcement gates
- Status: PARITY_READY
- Runtime parity target:
  - enforce evidence-first/verify-existing/plan-only guards
- Test/eval parity target:
  - conformance tasks for negative and compliant fixtures
- Evidence target:
  - evaluator pass/fail traces logged in worklog

4) Fresh reliability QA sweep + telemetry evidence
- Status: PARITY_READY
- Runtime parity target:
  - replay/cancel-source/no-user-input invariants remain stable
- Test/eval parity target:
  - row-level telemetry parsing checks in QA sweep
- Evidence target:
  - telemetry references + checklist completion in worklog

5) Dreaming/world-model decommission completion in Orca harness
- Status: PARITY_READY
- Runtime parity target:
  - remove residual dream coupling in runtime/settings
- Test/eval parity target:
  - regression checks proving no dream-gate dependency
- Evidence target:
  - reference scan result + test/build output logged

P0 gate rule:
- full P0 parity requires all items 1-5 at PARITY_READY

---

## P1 parity board (high-impact UX/workflow)

6) In-canvas tool-call bubbles/nodes
- Status: PARITY_READY
- Parity target:
  - render queued/running/success/error + category tokens + budgets

7) Narrow-width trace readability regression coverage
- Status: PARITY_READY
- Parity target:
  - tile/sidebar regression tests for wrap/collapse/spacing

8) Design extraction workflow v1
- Status: PARITY_READY
- Parity target:
  - schema + validator + prompt templates + normalize/repair + operator runbook

P1 gate rule:
- full P1 parity requires 6-8 at PARITY_READY and no P0 regressions

---

## Memory rebuild parity board (P1/P2 major track)

M-P0) typed canonical memory + retrieval + write governance + usefulness + safety
- Status: NOT_STARTED
- Parity target:
  - runtime-enforced schema/governance with measurable retrieval usefulness

M-P1) distillation pipeline + debugger + TTL
- Status: NOT_STARTED

M-P2) learned ranking + contradiction prompts
- Status: NOT_STARTED

---

## P2 parity board (policy/platform hardening)

9) Harness knobs -> deterministic evaluator translation
- Status: NOT_STARTED

10) Remaining P1/P2 conformance wave
- Status: IN_PROGRESS
- Evidence (2026-04-21):
  - Added evaluator kinds + runtime assertions in `harnessEval/evaluateHarnessSuite.ts`:
    - `iteration_cap_enforcement`
    - `parallel_tool_conflict_guard`
    - `exactly_once_resume_handoff_integrity`
    - `heartbeat_synthetic_tag_skip_hygiene`
    - `trace_phase_end_state_completeness`
  - Added manifest tasks in `harnessEval/tasks.conformance.json`
  - Updated bucket mapping in `harnessEval/scoreAggregation.ts`
  - Validation: targeted harness-eval tests + conformance split pass (`p0HardFail=false`, `overallPass=true`)

11) Standalone graph cleanup completion
- Status: NOT_STARTED

12) Workspace switching resilience pass
- Status: NOT_STARTED

13) Canvas bridge timeout architecture cleanup
- Status: NOT_STARTED

---

## Secondary backlog parity board

14) GitHub Rising Radar hardening
- Status: NOT_STARTED

---

## Parity execution cadence

Weekly cadence:
1) Update status per item (NOT_STARTED/IN_PROGRESS/PARITY_READY)
2) Attach exact files changed + validation commands
3) Re-run conformance/build checks
4) Log evidence pointers in `WORKLOG.md`
5) Re-rank `NEXT-STEPS.md` if new blockers appear

---

## Validation baseline for parity updates

- `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split conformance`
- targeted tests for touched modules (runtime + evaluators + UI where applicable)
- `npm run -s build --workspace=packages/client`

When an item is moved to PARITY_READY, include:
- file list
- command outputs
- conformance task IDs added/updated

---

## Definition of Ready (DoR) for any parity item

Before moving an item from NOT_STARTED -> IN_PROGRESS, ensure:
- explicit owner (or execution agent) and target wave are assigned
- exact file targets are listed
- acceptance checks are written as pass/fail statements
- required test/eval commands are enumerated
- dependencies and blockers are logged

---

## Definition of Done (DoD) for PARITY_READY

An item is PARITY_READY only if all are true:
- runtime behavior implemented in the intended path(s)
- deterministic test/evaluator coverage added or updated
- validation commands pass on current workspace
- `WORKLOG.md` entry includes changed files + evidence links/paths
- `NEXT-STEPS.md` or `FEATURE-WISHLIST.md` status text updated accordingly

---

## 30/60/90 harness parity outlook

Next 30 days:
- close P0-A/P0-B/P0-C/P0-E to PARITY_READY
- run at least one full reliability evidence sweep (P0-D)

By 60 days:
- close P1 trace parity items (6, 7)
- move design extraction v1 (8) to IN_PROGRESS with schema + validator complete

By 90 days:
- complete memory M-P0 implementation contract readiness
- reduce open P2 items by at least 50% with evaluator-backed closures

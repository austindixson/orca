# Orca Project Flesh-Out Blueprint

> **Goal:** turn current Orca progress into a tight, shippable roadmap that prioritizes Hermes Lead reliability, visible UX parity, and deterministic harness quality gates.

## 1) Product North Star

Orca should feel like a **Hermes-native command center on an infinite canvas**:
- Hermes remains the lead orchestrator with full native tool capability.
- Orca visualizes reasoning/tooling clearly (trace strip + in-canvas tool nodes/bubbles).
- Runs are reliable, resumable, and measurable with conformance gates.

## 2) Current State (from tracked docs)

### Already strong
- Major Hermes reliability fixes landed (tool replay guard, no-user continuation guard, browser retry hardening, approval auto-continue).
- Trace UX parity improved (semantic trace rows, elapsed counters, cleaner strip behavior).
- Dynamic in-run context estimate is wired.
- Hermes-dev documentation baseline is comprehensive.

### Remaining high-value gaps
1. In-canvas tool-call bubble/node visualization (Hermes-parity UX).
2. Final graph-only path cleanup.
3. Fresh reliability/telemetry QA sweep (post-fixes verification).
4. Design extraction pipeline (screenshot -> structured JSON -> controlled regen).
5. Memory rebuild Phase 0 (typed schema + write governance).
6. Deterministic conformance evaluator expansion and score gating.

---

## 3) Prioritized Workstreams

## W1 — Hermes Lead UX Parity (P0)
**Outcome:** users can follow execution at a glance with compact, high-signal visuals.

### Scope
- Add in-canvas tool bubbles/nodes (queued/running/success/error states).
- Add category-token styling (browser, shell, file, memory, web, etc.).
- Add visualization budgets:
  - max nodes
  - TTL collapse
  - FPS throttle

### Acceptance criteria
- No standalone graph dependency for this experience.
- Tile and sidebar variants both readable at narrow widths.
- Frame/render budget stays stable during long multi-tool runs.

## W2 — Reliability + Runtime Integrity (P0)
**Outcome:** runs are resilient and never silently degrade.

### Scope
- Execute fresh end-to-end Lead run QA for:
  - no post-completion tool-call replay
  - no `No user message found in input`
  - no hidden cancellation source
  - no browser policy mismatch in Lead profile
- Validate status strip elapsed/context behavior across cancel/complete flows.
- Add missing end-to-end interruption queued-path regression.

### Acceptance criteria
- Telemetry evidence attached for each invariant.
- Repro checklist documented in hermes-dev.
- Failures map to explicit invariant buckets.

## W3 — Conformance and Scoring System (P0/P1)
**Outcome:** quality becomes enforceable, not subjective.

### Scope
- Translate `HARNESS-KNOBS-PRIORITIES.md` into deterministic evaluators.
- Implement `SKILLS-INTEGRATION-BREAKDOWN.md` policy gates.
- Implement `INTERRUPT-RESUME-PROTOCOL.md` conformance tasks.
- Add invariant bucket scoring + P0 hard-fail gate in aggregated scores.

### Acceptance criteria
- Every P0 invariant has:
  1) evaluator,
  2) fixture/scenario,
  3) hard-fail threshold.
- CI outputs machine-readable pass/fail + reason strings.

## W4 — Design Extraction JSON Workflow (P1)
**Outcome:** controlled visual editing with minimal drift.

### Scope
- Implement screenshot -> style-guide JSON extraction pipeline.
- Add scoped block extraction modes (element/weather/camera/additive-object).
- Add JSON edit -> regeneration loop with drift constraints.
- Provide prompt templates + validation checklist.

### Acceptance criteria
- Schema validation strictness + repair path documented.
- At least 3 golden examples with before/after and drift notes.

## W5 — Memory Rebuild Phase 0 (P1)
**Outcome:** memory becomes typed, governable, and reliable.

### Scope
- Define canonical typed memory schema.
- Define write governance (confidence, dedupe, redaction, supersession).
- Add migration notes and guardrails for future phases.

### Acceptance criteria
- Schema + policy docs are executable references for implementation.
- No ambiguous write path remains in docs/spec.

---

## 4) 14-Day Execution Slice (Concrete)

## Days 1–3: W1 core
- Build minimal node/bubble model and render path.
- Add state coloring + tool category mapping.
- Add caps: node count + TTL collapse.
- Add narrow-width visual QA pass.

## Days 4–5: W2 verification sweep
- Run fresh Lead scenario with browser + shell + plan/memory mix.
- Export telemetry and validate all invariants.
- Patch any discovered regressions immediately.

## Days 6–8: W3 evaluator wave A
- Implement P0 evaluator set:
  - safety gates,
  - cancellation integrity,
  - replay prevention,
  - interruption-resume contract.
- Add score aggregation hard-fail logic.

## Days 9–11: W4 foundation
- Ship extraction schema + parser/validator.
- Add extractor + modifier prompts.
- Add first golden examples.

## Days 12–14: W5 phase-0 spec lock + polish
- Finalize typed memory schema + governance policy doc.
- Add unresolved-risk section + phase-1 handoff tasks.
- Update `NEXT-STEPS.md` and `WORKLOG.md` with outcomes.

---

## 5) Delivery Artifacts Checklist

- [ ] `hermes-dev/NEXT-STEPS.md` updated with reordered priorities and done/next markers.
- [ ] `hermes-dev/WORKLOG.md` session entries with validation commands and telemetry links.
- [ ] Conformance evaluator spec + implementation links.
- [ ] Tool-bubble UX screenshots/GIFs (tile + sidebar variants).
- [ ] Design extraction golden set (inputs, JSON, outputs, drift commentary).
- [ ] Memory schema/governance canonical doc.

---

## 6) Risks and Controls

- **Risk:** visual richness hurts performance.
  - **Control:** hard visualization budgets + perf checks in long runs.
- **Risk:** reliability regressions hide behind partial telemetry parsing.
  - **Control:** row-level event parsing and invariant-specific assertions.
- **Risk:** scope creep (world-model complexity over core reliability).
  - **Control:** enforce P0/P1 gate ordering; defer non-critical experiments.

---

## 7) Definition of “Project Fleshed Out”

Project is considered fully fleshed out when:
1. Prioritized workstreams have explicit outcomes + acceptance criteria.
2. 2-week execution slice is defined and realistically sequenced.
3. Conformance scoring defines objective quality gates.
4. Documentation and telemetry prove shipped behavior, not intent.
5. Next implementer can execute without rediscovery.

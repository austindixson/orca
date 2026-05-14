# Decisions

## 2026-04-20 — Documentation-first execution tracking
Decision:
- Maintain all Hermes work logs and planning artifacts under `hermes-dev/` in markdown.

Why:
- Provides transparent progress records for long-running harness development.
- Improves reproducibility and handoff quality.
- Makes architecture/process decisions discoverable over time.

Consequence:
- Every major work session will append to `WORKLOG.md` and update `NEXT-STEPS.md`.

## 2026-04-20 — Build from invariants before feature expansion
Decision:
- Prioritize loop conformance and behavioral eval (P0/P1/P2 invariants) before adding new harness features.

Why:
- Existing harness is already feature-rich; biggest leverage is correctness and reliability under failure.
- Static eval checks are insufficient to detect real loop regressions.

Consequence:
- Immediate implementation work targets conformance split + P0 gates.
- New capabilities should land only with invariant-mapped tests.

## 2026-04-20 — Rebuild memory from a canonical typed core
Decision:
- Treat current memory stack as transitional and rebuild around a single canonical typed memory layer with unified retrieval/governance, while keeping markdown and legacy tools as compatibility projections during migration.

Why:
- Current memory behavior is fragmented across multiple sinks (markdown, JSONL signals, transcript FTS, vault search) and does not consistently produce useful recall.
- A single schema + retrieval pipeline enables deterministic ranking, dedupe, contradiction handling, and measurable memory quality.

Consequence:
- New planning artifact: `hermes-dev/MEMORY-SYSTEM-REBUILD.md`.
- Phase 0 implementation priority: schema + governance before feature expansion.
- Future memory work must ship with conformance tasks that prove behavior changes, not just storage changes.

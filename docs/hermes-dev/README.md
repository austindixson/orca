# Hermes Development Log

This folder tracks all Hermes-led work for the Orca harness project.

## Purpose
- Keep a durable markdown record of work sessions.
- Capture decisions, architecture notes, and benchmark plans.
- Make progress auditable and easy to hand off.

## Files
- `WORKLOG.md` — chronological session entries.
- `NEXT-STEPS.md` — prioritized active plan.
- `FEATURE-WISHLIST.md` — consolidated living backlog with P0/P1/P2 priorities, acceptance criteria, and governance rules.
- `FEATURE-WISHLIST-PARITY.md` — full parity tracker for every wishlist item (status, parity criteria, and evidence requirements).
- `DECISIONS.md` — architecture and process decisions.
- `MEMORY-SYSTEM-REBUILD.md` — ground-up memory-system teardown, wishlist, and rebuild architecture plan.
- `HARNESS-KNOBS-PRIORITIES.md` — highest-leverage agent-loop parameters for capability, efficiency, and speed tuning.
- `SKILLS-INTEGRATION-BREAKDOWN.md` — skill-by-skill translation into Orca harness policies, gates, and conformance tests.
- `INTERRUPT-RESUME-PROTOCOL.md` — interruption handling behavior: answer-now + checkpointed resume offer.
- `ORCHESTRATOR-TILE-SIMPLIFICATION-PLAN.md` — component-level patch plan for concise tile/orchestrator output and clearer reasoning/tool-use presentation.
- `HERMES-LEAD-MODE.md` — third canvas mode spec and implementation tracker for Hermes-as-lead orchestration visualization.
- `DESIGN-EXTRACTION-JSON-TOOL.md` — screenshot-to-JSON design extraction workflow, schema, and prompt templates for controlled image edits.
- `DESIGN-EXTRACTION-JSON-TOOL-IMPLEMENTATION-PLAN.md` — task-by-task build plan (schema, prompts, normalization, API wiring, UI, eval harness).
- `ERROR-CATCHING-BEST-PRACTICES.md` — reusable Hermes failure-recovery loop (preflight, classify, fallback branch, verification) with git workflow example.

## Process
For each work block, append to `WORKLOG.md`:
- Timestamp
- Goal
- What changed
- Validation performed
- Follow-ups

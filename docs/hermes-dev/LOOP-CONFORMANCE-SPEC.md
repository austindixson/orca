# Agent Loop Conformance Spec (v1)

Status: Draft
Owner: Hermes
Date: 2026-04-20

## Goal
Define non-negotiable behavioral rules for Orca’s agent loop so harness quality is measurable, enforceable, and comparable across agent backends.

## Scope
Applies to:
- Main orchestrator loop (`runOrchestrator.ts`)
- Tool execution loop (`orchestratorToolBatch.ts`, `executeTools.ts`)
- Session lifecycle (`orchestratorSessionStore.ts`)
- Proactive loop (`orchestratorHeartbeat.ts`)

Out of scope (for this version): UI cosmetics, model quality, provider-specific answer style.

## Core loop contract
Each run must satisfy this cycle until completion:
1. Observe current state and user goal.
2. Decide next bounded action.
3. Execute tools or produce explicit final response.
4. Verify action outcomes.
5. Continue, recover, or terminate with explicit reason.

## Invariants (must always hold)

### I1. Explicit termination
A run must end in exactly one state:
- `ok` (final user-facing answer delivered)
- `aborted` (explicit cancellation)
- `error` (hard blocker, actionable explanation)
- `skipped` (only for valid preflight guard failures)

No silent or ambiguous termination allowed.

### I2. Non-empty final response on success
If run outcome is `ok`, final assistant output must be non-empty and user-facing.
- Empty/whitespace-only assistant terminal messages are invalid.
- If model returns empty after tool rounds, convert to recoverable failure path and retry/recover.

### I3. Tool-result causality
When tools are called, the next model turn must consume tool outputs before claiming completion.
- No completion text may ignore unresolved tool outcomes.

### I4. Recovery before surrender
On tool/model failure, loop must attempt safe recovery before final failure:
- Retry same step (bounded)
- Fallback strategy (provider/tool mode)
- Replan/decompose/delegate
Only then emit hard-blocker error.

### I5. Safety-gated side effects
Destructive/external/irreversible actions must obey autonomy policy gates.
- In standard mode: confirm first.
- In broad mode: confirm for outbound comms/money/destructive/secrets.

### I6. Bounded execution
Loop must honor hard resource caps:
- iteration cap
- timeout/cancellation
- tool result budget
- concurrency constraints

### I7. Cancellation integrity
User stop must:
- abort in-flight waits/tool loops
- unwind running state
- avoid ghost continuation
- preserve coherent transcript state

### I8. Queue and handoff integrity
Queued work and sub-agent handoffs must not be lost or duplicated.
- Deterministic dequeue order
- deterministic resume behavior
- dedupe logic for identical sub-agent spawn requests

### I9. Proactive run hygiene
Heartbeat runs must:
- identify themselves as synthetic context
- avoid contaminating user-profile distillation with synthetic content
- skip safely when no actionable heartbeat instructions exist

### I10. Traceability
Every run must be diagnosable:
- phase transitions available
- structured error classing
- optional raw harness trace artifacts

## Severity classes
- P0: Violates correctness/safety invariants (I1, I2, I5, I7)
- P1: Recovery/cap/ordering defects (I4, I6, I8)
- P2: Quality/observability/proactive hygiene defects (I3, I9, I10)

## Current known gap (from code audit)
- Candidate P0: Success path can accept empty final assistant text after tool rounds.

## Exit criteria for v1 conformance
- All P0 invariants covered by deterministic tests.
- No known P0 failures open.
- Harness eval reports invariant-level pass/fail breakdown.

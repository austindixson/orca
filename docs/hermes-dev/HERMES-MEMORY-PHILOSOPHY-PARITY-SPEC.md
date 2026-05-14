# Hermes Memory Philosophy + Behavior Parity Spec (Orca)

Date: 2026-04-21 22:53:40 PDT
Status: Implemented (runtime + prompt + tests)
Owner: Hermes

## 1) What memory is for
Memory is for reducing repeated user steering across sessions.

Memory is NOT for:
- temporary task progress,
- one-off run output dumps,
- ephemeral TODO state,
- noisy logs.

Canonical intent:
- persist durable user preferences/corrections,
- persist stable environment/workflow facts,
- recall prior session context when user references earlier work.

## 2) Behavior model: policy-encoded reflexes
Behavior is a contract, not personality text.

### 2.1 Turn priority order (fixed)
1. safety
2. user_immediate_request
3. grounding
4. continuity
5. efficiency
6. verbosity

This order is deterministic and encoded in prompt policy text so decisions do not drift by style.

### 2.2 Invariants
- Interruption invariant:
  - answer interruption immediately,
  - then offer one-line resume handoff.
- Grounding invariant:
  - claims must be evidence-backed by tools/files this run.
- Uncertainty invariant:
  - if evidence missing or tools fail, state uncertainty and next safe retrieval step.
- Recovery invariant:
  - classify failure type; do bounded retries only when class supports retry; branch to deterministic remediation otherwise.

## 3) Memory recall/write trigger contract

### 3.1 Recall triggers (session_search reflex)
Trigger recall before asking user to repeat details when user message indicates prior-session dependency, e.g.:
- "last time"
- "previously"
- "remember when"
- "as discussed/mentioned before"
- "we worked on/fixed"
- "continue/resume/pick up from before"
- "what were we working on"

Action:
- call `session_search` (or alias `recall_session_history`) first,
- ground response in retrieved evidence.

### 3.2 Durable-write triggers (memory reflex)
Trigger memory write after immediate request is handled when user signals durable preference/correction/fact, e.g.:
- explicit: "remember this", "don’t forget this", "save this preference"
- preference: "I prefer...", "my preference is...", "please always/never..."
- correction: "you were wrong", "that’s wrong", "stop doing that"

Action:
- `memory(target='user', ...)` for user preference/correction profile,
- `memory(target='memory', ...)` for stable environment/workflow facts.

## 4) Runtime implementation in Orca

## 4.1 New behavior policy module
File:
- `packages/client/src/lib/orchestrator/orchestratorBehaviorPolicy.ts`

Exports:
- `ORCHESTRATOR_BEHAVIOR_PRIORITY_ORDER`
- `detectOrchestratorBehaviorSignals(userMessage)`
- `buildBehaviorReflexTurnGuard(userMessage)`
- `buildBehaviorContractBlock()`

Role:
- centralizes deterministic trigger detection and behavior contract text.

## 4.2 Prompt-layer integration
File:
- `packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts`

Change:
- dynamic preface now includes `buildBehaviorContractBlock()` so policy/reflex rules are always present.

## 4.3 Turn-level reflex override integration
File:
- `packages/client/src/lib/orchestrator/runOrchestrator.ts`

Change:
- injects per-turn system message from `buildBehaviorReflexTurnGuard(userMessage)` when trigger detected,
- ensures recall/write reflexes are applied contextually (not only static global text).

## 4.4 Lead-mode tool parity
Files:
- `packages/client/src/lib/orchestrator/orchestratorToolFilter.ts`
- `packages/client/src/lib/orchestrator/runOrchestrator.ts`

Change:
- lead allowlist includes `memory` (already had `session_search`),
- lead tool-contract text now explicitly lists `memory` and `session_search`.

## 4.5 Tool semantic guidance parity
File:
- `packages/client/src/lib/orchestrator/toolDefinitions.ts`

Change:
- `memory` description now encodes durable-write policy and anti-noise guidance,
- `session_search` description now encodes proactive recall-on-reference behavior.

## 5) Validation artifacts

Tests added/updated:
- `packages/client/src/lib/orchestrator/orchestratorBehaviorPolicy.test.ts` (new)
- `packages/client/src/lib/orchestrator/orchestratorPromptLayers.test.ts` (updated)
- `packages/client/src/lib/orchestrator/orchestratorToolFilter.test.ts` (updated)

Validation commands:
- `node --import tsx/esm --test src/lib/orchestrator/orchestratorBehaviorPolicy.test.ts src/lib/orchestrator/orchestratorPromptLayers.test.ts src/lib/orchestrator/orchestratorToolFilter.test.ts src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts`
- `npm run -s build --workspace=packages/client`

Both passed in this implementation wave.

## 6) Exact operational explanation (what to remember/recall)
At runtime, the orchestrator now does this:
1. Read user turn.
2. Run deterministic trigger detector.
3. If prior-session trigger found, inject high-priority reflex rule to use `session_search` first.
4. If durable preference/correction trigger found, inject high-priority reflex rule to persist via `memory` after immediate ask.
5. Apply fixed behavior contract (priority ordering + interruption/uncertainty/recovery rules) every run via dynamic prompt preface.
6. Keep memory writes compact and durable; avoid temporary progress logging.

This is Hermes philosophy parity: explicit contracts, deterministic trigger lanes, tool-backed recall/write behavior, and trust-preserving uncertainty handling.

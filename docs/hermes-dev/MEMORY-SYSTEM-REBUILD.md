# Orca Memory System Rebuild (Ground-Up)

Date: 2026-04-20 17:07:59 PDT
Owner: Hermes
Status: Proposed (approved direction by user)

## Why this exists
You requested a full memory-system teardown and rebuild because current memory behavior feels hodgepodge and not reliably useful.

This document is the wishlist + engineering blueprint for rebuilding memory as a first-class subsystem.

## Current system dissection (what exists now)

Primary code/docs inspected:
- docs/MEMORY_ARCHITECTURE.md
- packages/client/src/lib/orchestrator/orcaMemory.ts
- packages/client/src/lib/orchestrator/memoryDistiller.ts
- packages/client/src/lib/orchestrator/userProfileDistiller.ts
- packages/client/src/lib/persistence/sessionPersistence.ts
- packages/client/src/lib/orchestrator/executeTools.ts
- packages/client/src/store/orchestratorSessionStore.ts
- packages/client/src/store/settingsStore.ts

Current memory surfaces:
1) Short-term context window
- Sliding chat history budget (`memoryShortTermMaxChars`).

2) Long-term markdown injection
- `.orca/MEMORY.md` + `~/.orca/MEMORY.md` injected into system prompt.

3) User profile markdown injection
- `.orca/USER.md` + `~/.orca/USER.md` injected into system prompt.

4) End-of-session distillers (optional, off by default)
- Memory distiller writes lessons + signals JSONL.
- User-profile distiller writes auto user bullets.

5) Retrieval tools split by source
- `recall_session_history` (FTS on persisted session transcripts)
- `search_workspace_memory` / `search_project_wiki` (vault markdown)

6) Mirrors and central vault integration
- `Orca/chat/**`, `Orca/brain/**`, `wiki/**`, optional central vault sync.

## Core problems (why it feels weak)

P0 problems:
1) No single canonical memory model
- Memory is spread across markdown, JSONL signals, transcript FTS, vault mirrors.
- No unified typed memory object with consistent metadata.

2) Retrieval path fragmentation
- Different tools hit different stores with different ranking/semantics.
- Agent has to guess where a memory lives.

3) Distillation quality is non-deterministic and mostly optional
- Distillers are disabled by default, so many sessions never produce structured memory.
- Heuristic fallback bullets are useful but shallow.

4) Weak write policy
- No explicit confidence/importance score per memory entry.
- Dedupe and contradiction handling are limited.

5) Prompt injection over structured recall
- Large markdown blobs are injected directly, but this does not guarantee relevance.

P1 problems:
6) Evaluation coverage is narrow
- Existing memory harness validates recurring-signal gate mechanics, not end-to-end memory usefulness.

7) Lifecycle/retention policy not memory-type aware
- Ring-trimming exists, but no typed retention by semantic value and recency.

## Rebuild wishlist (feature contract)

P0 (must-have):
1) Unified canonical memory store
- Introduce typed memory records with stable IDs and metadata:
  - `type`: user_preference | project_fact | failure_pattern | workflow_rule | episodic_event
  - `scope`: workspace | user_global | session
  - `confidence`, `importance`, `source`, `created_at`, `last_seen_at`, `evidence`

2) Unified retrieval API for orchestrator
- One retrieval entrypoint that searches all memory domains and returns ranked snippets + evidence.
- Keep existing tools as compatibility wrappers, but route through one core retrieval engine.

3) Deterministic write policy
- Write gate requiring: confidence threshold, anti-duplication check, secret-redaction pass.
- Contradiction handling: mark stale entries superseded rather than overwrite blindly.

4) Memory usefulness scoring
- Every retrieval result includes score/rationale.
- Add benchmark tasks that measure whether memory changes next-step behavior.

5) Safety + privacy controls
- Redaction before persist and before retrieval output.
- Per-scope allow/deny for memory categories.

P1 (important):
6) Two-stage distillation pipeline
- Stage A: extract candidate facts from session.
- Stage B: normalize + classify + score + dedupe.

7) Memory debugger panel
- Inspect entries, provenance, scores, and why a memory was retrieved.

8) TTL + retention policy by type
- e.g., ephemeral episodic memories decay fast; stable user preferences persist.

P2 (quality):
9) Learned ranking features
- Retrieval ranking tuned using harness eval traces.

10) Conflict-resolution assistant prompts
- When memory conflicts are high-confidence, ask user once and reconcile.

## Proposed target architecture

Layer 1: Ingestion
- Sources: conversation JSONL, tool outcomes, explicit memory tool calls, distillers.
- Output: normalized candidate memories.

Layer 2: Canonical storage
- New memory index (SQLite in `~/.orca/`, plus workspace overlay) storing typed rows.
- Keep markdown mirrors as human-readable projections, not canonical state.

Layer 3: Retrieval
- Unified query engine: lexical + metadata filtering + recency/importance/confidence scoring.
- Returns compact cited blocks for prompt assembly.

Layer 4: Prompt assembly
- Inject top-k relevant memories (bounded budget), not whole memory files.
- Preserve explicit user-pinned notes at highest priority.

Layer 5: Governance
- Redaction, confidence thresholds, dedupe, contradiction/supersession, retention.

## Implementation map (where code will change)

Primary targets:
- `packages/client/src/lib/orchestrator/orcaMemory.ts`
- `packages/client/src/lib/orchestrator/memoryDistiller.ts`
- `packages/client/src/lib/orchestrator/userProfileDistiller.ts`
- `packages/client/src/lib/orchestrator/runOrchestrator.ts`
- `packages/client/src/lib/orchestrator/executeTools.ts`
- `packages/client/src/lib/persistence/sessionPersistence.ts`
- `packages/client/src/store/settingsStore.ts`

Likely new modules:
- `packages/client/src/lib/orchestrator/memory/memorySchema.ts`
- `packages/client/src/lib/orchestrator/memory/memoryStore.ts`
- `packages/client/src/lib/orchestrator/memory/memoryIngest.ts`
- `packages/client/src/lib/orchestrator/memory/memoryRetrieve.ts`
- `packages/client/src/lib/orchestrator/memory/memoryGovernance.ts`
- `packages/client/src/lib/orchestrator/memory/memoryProjection.ts`

## Conformance/eval additions for memory rebuild

New conformance tasks (planned):
1) memory-write-dedupe
2) memory-write-redaction
3) memory-retrieval-relevance-topk
4) memory-contradiction-supersession
5) memory-type-retention-policy
6) memory-behavior-change-after-recall

Acceptance gate:
- Any P0 memory conformance failure blocks merge.

## Rollout phases

Phase 0: Design lock
- Finalize schema, scoring, and governance rules.

Phase 1: Canonical store + read path
- Build typed store and unified retrieval while preserving existing interfaces.

Phase 2: Write path migration
- Route distillers + explicit memory writes into canonical store.

Phase 3: Prompt assembly migration
- Replace raw markdown injection with ranked memory block injection.

Phase 4: Eval + hard gates
- Add conformance tasks and fail-closed CI gates.

Phase 5: Cleanup
- Keep markdown as projections; remove legacy code paths where safe.

## Definition of done
1) Memory recall is measurably better in harness runs (not just “it feels better”).
2) Agent can explain why each recalled memory was selected.
3) Duplicate/noisy memory writes are reduced by policy gates.
4) Contradictions are tracked and resolved safely.
5) Memory behavior is stable across sessions and workspace switches.

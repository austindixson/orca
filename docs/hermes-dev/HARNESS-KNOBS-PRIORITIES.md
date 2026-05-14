# Agent Loop Harness Knobs — Priority Map

Date: 2026-04-20 17:12:38 PDT
Scope: Orca harness capability + efficiency + speed tuning

## Highest-impact knobs (tune first)

1) Tool-use policy strictness
- Controls when tool grounding is mandatory vs optional.
- Biggest correctness lever.

2) Iteration budget + early-stop/stagnation policy
- Controls max rounds, loop termination, and anti-thrash behavior.
- Biggest efficiency/cost lever.

3) Context budget allocation
- Controls token budget split between chat history, memory, tool outputs, and static prompt layers.
- Biggest capability stability lever.

4) Memory write/retrieval gating
- Controls what gets persisted, deduped, and recalled.
- Biggest cross-session quality lever.

5) Tool result budgeting/truncation
- Controls per-tool output size and summarization before prompt injection.
- Biggest latency + context hygiene lever.

## Next-tier knobs

6) Error recovery/fallback policy
- Retry/backoff/fallback model behavior and compaction-on-overflow strategy.

7) Parallelism limits
- Max concurrent tools/sub-agents and merge behavior.

8) Side-effect safety gates
- Confirmation/block policy for destructive actions.

9) Phase-based model routing
- Model selection by task phase (plan/execute/critique/summarize).

10) Prompt-layer architecture
- Stable constitution + dynamic context + task-local constraints.

## Most vital core loop parameters

- max_iterations
- early_stop_conditions
- stagnation_detector_sensitivity
- tool_call_required_rules
- per_tool_timeout_and_retry
- per_tool_output_budget
- context_allocator_ratio (chat/memory/tool/system)
- memory_write_threshold (confidence/importance)
- memory_retrieval_top_k + ranking weights
- max_parallel_tool_calls / max_parallel_subagents
- model_routing_by_phase
- safety_gate_mode (off/warn/block + confirmation)

## If only 5 knobs are tuned first

1. Early-stop + stagnation
2. Context allocator
3. Tool output budgets
4. Memory gating
5. Recovery/fallback policy

Reason: this set improves capability, speed, and cost simultaneously without requiring model changes.

## Proposed benchmark hooks

- Tool calls per completed task (median/p95)
- Redundant-call rate
- Retrieval relevance@k for memory recall
- Recovery turns-to-success after first failure
- Completion integrity (no empty-final success)
- Wall-clock latency per successful task

## Adoption note

Use this document as the default tuning order for Orca harness iterations and conformance-gate planning.

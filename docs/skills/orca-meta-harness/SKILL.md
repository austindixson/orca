---
name: orca-meta-harness
description: Meta-Harness–style outer loop for Orca — diagnostic JSONL traces, candidate directories under `.agent-canvas/harness/candidates/`, search vs test eval tasks, Pareto export. Use when optimizing orchestrator harness code with full execution traces (arXiv:2603.28052), registering candidates, or running `npm run harness:eval`.
license: MIT
---

# Orca Meta-Harness workflow

This mirrors the **filesystem archive** pattern from [Meta-Harness](https://arxiv.org/html/2603.28052v1): prior candidates expose **source (or settings refs), scores, and raw traces** so a **coding-agent proposer** can `grep` / `cat` selectively.

## Disk layout (workspace root)

| Path | Purpose |
|------|---------|
| `.agent-canvas/harness/traces/<session>.jsonl` | Append-only events (`run_start`, `llm_round`, `tool_batch`, `run_end`). |
| `.agent-canvas/harness/traces/<session>.jsonl` | With **Settings → Diagnostic harness traces** (+ raw traces): `llm_round_meta`, `tool_call_detail` (redacted args/results), `compaction`, `stagnation`. |
| `.agent-canvas/harness/candidates/<id>/manifest.json` | Candidate id, parent, `sourceRef`, optional `lastTraceSessionKey`. |
| `.agent-canvas/harness/candidates/<id>/scores.json` | Per-task results + aggregates (`passRate`, `meanContextKTokens`, `meanLatencyMs`). Unified writer: `writeHarnessCandidateScores` in `harnessCandidates.ts`. |
| `.agent-canvas/harness/candidates/<id>/traces/session.ref.json` | Pointer to trace JSONL (via `writeTraceRef` from tooling). |
| `.agent-canvas/harness/pareto_frontier.json` + `.csv` | **Settings → Export Pareto frontier** or `exportHarnessParetoFrontierReport()` in app. |
| `.agent-canvas/harness/active-candidate.json` | Optional: **Settings → Traces & experiments** “Set best Pareto as active” (opt-in auto-apply). |

## Eval (deterministic, no live LLM)

From **repo root**, forward args to the client workspace with `--`:

```bash
npm run harness:eval --workspace=@agent-canvas/client -- --candidate my-candidate-1 --split search
```

Uses `ORCA_WORKSPACE_ROOT` if set; otherwise resolves the monorepo root from the client package. Writes `scores.json` under `.agent-canvas/harness/candidates/<id>/`.

Task definitions:

| File | Split | Role |
|------|--------|------|
| `tasks.search.json` | `search` | Optimizer feedback (default) |
| `tasks.test.json` | `test` | Held-out — replace tasks when you split |
| `tasks.memory.json` | `memory` | **Cold vs warm** recurring-signal gate (see `docs/MEMORY_ARCHITECTURE.md`) |
| `tasks.proactive.json` | `proactive` | USER/HEARTBEAT/autonomy **deterministic smoke** (see `docs/PROACTIVE_ORCA_HARNESS.md`) |

### Memory split (`--split memory`)

Runs **twice** in one CLI invocation: **cold** (empty `.agent-canvas/harness/memory-eval-signals.jsonl`) then **seed** + **warm**. Writes `scores.json` with top-level warm aggregates and **`memoryEval`**: `coldPassRate`, `warmPassRate`, **`passRateDelta`**, `coldTasks`, `warmTasks`. Expect `passRateDelta = 1` when the harness is healthy (simulates “distiller + recurring-issue block” helping on the second pass).

### Proactive split (`--split proactive`)

Single pass (like search/test): validates synthetic heartbeat message shape and **standard** / **broad** autonomy constitution strings. No cold/warm envelope. Use when touching `orchestratorHeartbeat.ts`, `orchestratorAutonomyPolicy.ts`, or heartbeat entry in `orchestratorSessionStore.ts`. Full product doc: `docs/PROACTIVE_ORCA_HARNESS.md`.

```bash
npm run harness:eval --workspace=@agent-canvas/client -- --candidate <id> --split proactive
```

## Register a candidate (Tauri app)

Use `writeHarnessCandidateManifest`, `writeHarnessCandidateScores`, `writeTraceRef` from `harnessCandidates.ts` in tooling or a one-off script running in the desktop app context.

## Proposer loop (human or agent)

1. Inspect traces: `grep tool_call_detail .agent-canvas/harness/traces/*.jsonl`
2. Compare scores: `jq .aggregates .agent-canvas/harness/candidates/*/scores.json`
3. Edit harness-related code (orchestrator, contracts, tool filter, prompts).
4. Re-run orchestrator with diagnostic traces on; export a new candidate id + eval.
5. Run `npm run harness:eval` for search/test; export Pareto to compare accuracy vs context cost.

## Code refs

- Traces: `orchestratorTraceAccumulator.ts`, `harnessDiagnosticTrace.ts`, `runOrchestrator.ts`
- Candidates / Pareto: `harnessCandidates.ts`
- Eval suite: `harnessEval/evaluateHarnessSuite.ts`, `harnessEval/cli.ts`

## Instinct: npm-safe directory names (`create-next-app` / scaffolding)

When a worker chooses a **project folder name** that violates npm package naming (spaces, capitalised PascalCase marketing names, or characters npm rejects), **normalize to kebab-case** *before* running `create-next-app`, `npm init`, or `npx` scaffolds — e.g. `OrcaPortal` → `orca-portal`, `My App` → `my-app`.

- Prefer `meta.command_argv` on terminal tiles so paths with `@/*`, globs, or `$` do not break zsh.
- If a command fails with **ENOENT** or **no matches found**, call `get_last_terminal_command` / `wait_for_terminal_command` and fix paths — do not identical-retry within 60s (Orca duplicate guard).

Relevant code: `wrapShellCommand.ts`, `terminalCommandDuplicateGuard.ts`, `.orca/MEMORY.signals.jsonl` rows with `kind: "terminal_command"`.

# Orchestrator/Tile Output Simplification Implementation Plan

> For Hermes: execute this in small TDD steps and keep changes split so shell/PTY hardening remains separable.

Goal: Make Orca tile/orchestrator output read like a compact action feed (scan-first), with verbose reasoning/tool internals moved behind explicit depth controls.

Architecture:
- Keep current component tree; refactor rendering policy inside existing files.
- Parse once into normalized event rows, then render by density mode.
- Preserve full trace fidelity in expandable sections while defaulting to concise rows.

Tech stack: Next.js 14 client, React + TypeScript strict mode, existing shadcn/ui classes, current parser and orchestrator trace helpers.

---

## UX contract (what changes)

1) Default visible rows should be short and outcome-oriented:
- tool started: "Running {tool}"
- tool success: "{tool} done"
- tool failure: "{tool} failed: {short reason}"
- assistant narrative lines trimmed to brief markdown paragraphs

2) Reasoning/internal chatter should not dominate the tile body:
- keep in Trace/details blocks
- optional expand-per-row for full raw text

3) Diff/write rows stay first-class cards (already good).

4) Trace peek remains at bottom but adopts consistent concise labels.

---

## Component-by-component patch map

## Task 1: Add compact row model helpers
Objective: Introduce explicit row classification + label compaction in one place.

Files:
- Modify: `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`
- Optional extracted helper (if needed): `packages/client/src/components/orchestrator/orchestratorRowModel.ts`

Steps:
1. Add helper types for rendered rows (bubble/write/system/toolStatus).
2. Add `compactToolLabel(line: string): string | null` that maps noisy trace text to short labels.
3. Add `compactAssistantLine(line: string): string` to remove redundant prefixes while preserving meaning.
4. Use helpers when constructing `mainColumnItems` so bubble rows already carry compact display text.

Verification:
- Typecheck passes for modified file.
- No behavior change to write preview cards.

---

## Task 2: Reduce main feed verbosity in orchestrator module
Objective: Render concise rows by default; full detail remains accessible.

Files:
- Modify: `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`
- Modify: `packages/client/src/components/orchestrator/OrchestratorTracePeekRows.tsx`

Steps:
1. In bubble rendering branch, display compact text first for tool-like lines.
2. Add tiny "details" disclosure for raw line only when compacted content differs.
3. Ensure markdown rendering remains for non-tool assistant prose.
4. Update trace peek copy to stay concise and avoid repeated planning/tool boilerplate.

Verification:
- Orchestrator panel still streams smoothly at tail (scroll behavior unchanged).
- Tool-heavy output remains legible without opening full Trace.

---

## Task 3: Align AgentTile output stream with same compact policy
Objective: Keep tile and orchestrator language consistent.

Files:
- Modify: `packages/client/src/components/tiles/agent-tile/agentOutputParse.ts`
- Modify: `packages/client/src/components/tiles/agent-tile/AgentOutputStream.tsx`
- Modify (if needed): `packages/client/src/components/tiles/agent-tile/styles.ts`
- Modify (if needed): `packages/client/src/components/tiles/AgentTile.tsx`

Steps:
1. Extend parser output with compact label metadata for tool events.
2. Render compact tool rows in `AgentOutputStream` with subtle status chips.
3. Keep raw payload/details behind per-row expand affordance.
4. Preserve existing diff/code block rendering and system info semantics.

Verification:
- Existing parser tests still pass.
- Tool-heavy transcripts visually shorten while preserving inspectability.

---

## Task 4: Add regression tests for compact-output behavior
Objective: Lock the simplified behavior with deterministic tests.

Files:
- Modify: `packages/client/src/components/tiles/agent-tile/agentOutputParse.test.ts`
- Add/Modify targeted tests around orchestrator row mapping (same directory as implementation helper)

Steps:
1. Add tests asserting noisy tool lines compact to canonical labels.
2. Add tests asserting assistant prefix cleanup does not remove substantive text.
3. Add tests asserting raw text remains available when compacting occurs.

Verification commands:
- `npm test --workspace=packages/client -- agentOutputParse.test.ts`
- any local targeted test file for orchestrator mapping

---

## Task 5: Ship in two commit slices
Objective: Keep review clean and rollback-safe.

Commit split:
1. `test(tauri): add timeout cleanup process-tree integration test`
   - `src-tauri/src/lib.rs` test-only change
2. `feat(ui): simplify orchestrator/tile output rows with compact tool labels`
   - orchestrator/tile/parser UI + tests + docs updates

Final validation commands:
- `cargo test --manifest-path src-tauri/Cargo.toml timeout_cleanup_kills_spawned_child_processes -- --nocapture`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run build --workspace=packages/client`
- targeted client tests touched by this wave

---

## Guardrails

- Do not remove trace fidelity; only change default presentation density.
- Keep TypeScript strict-mode clean (no `any`).
- Keep API error/status messaging structure unchanged.
- Avoid changing orchestrator execution semantics in this UI wave.

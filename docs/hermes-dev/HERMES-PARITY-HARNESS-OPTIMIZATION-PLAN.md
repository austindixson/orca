# Hermes-Parity Harness Optimization Plan

Goal
- Make default Orca harness feel like Hermes terminal flow (fast, concise, deterministic), while reducing CPU/memory pressure and keeping useful visualization.

Problems observed
- Tool visualization is too heavy (editor churn on repeated read/write cycles).
- Orchestrator loop UX still carries Orca-era scaffolding overhead in places where Hermes-style direct flow is preferred.
- View-mode surface area includes a standalone graph mode that duplicates intent with Lead graph concepts.
- High render/update pressure from frequent tile focus + rich tile lifecycle updates.

## Phase 0 (implemented in this pass)
1. Stop editor churn on read_file:
   - read_file no longer auto-creates editor tiles.
   - If an editor for that file is already open, update/read-scan metadata there.
2. Prefer diff visualization for writes:
   - write_file no longer forces editor-tile write animations.
   - Diff tile becomes the primary write visualization target.
3. Remove standalone graph entrypoint from toolbar:
   - Graph button removed from top toolbar.
   - graph mode requests are normalized to helix (Lead view) via canvas store.

## Phase 1 (next)
1. Tool-call node overlay (Hermes-parity visual runtime)
   - Add lightweight overlay in tiles mode (not a separate page).
   - Represent each tool call as transient node/bubble:
     - color by tool class (file/shell/browser/network/meta)
     - label: tool name + compact target
     - state ring: queued/running/success/error
     - TTL auto-fade + capped history count
   - Link bubbles to orchestrator tile and currently active module (if any).

2. Resource guardrails
   - Cap active visual artifacts (e.g. max 60 bubbles in memory, summarize older to counters).
   - Frame throttle animation loop to <= 30fps and pause when app/tab not visible.
   - Disable expensive animations under reduced-motion or when CPU pressure detected.

3. Harness loop trim for Hermes mode
   - Keep direct turn order (user -> model -> tools -> model) with minimal pre/post scaffolding.
   - Avoid extra narration/log spam in Hermes mode; keep compact trace chips only.

## Phase 2
1. Unified “Lead graph in-place” experience
   - Keep graph concepts inside existing canvas/helix mode.
   - Remove old graph-mode specific controls and dead branches after migration window.
2. Aggressive tile lifecycle optimization
   - Increase placeholder/demotion usage for idle heavy tiles.
   - Defer non-essential tile metadata writes when orchestrator is hot-looping.
3. Tool visualization settings
   - Add explicit settings profile presets:
     - Performance (minimal visuals)
     - Balanced
     - Showcase

## Metrics to track
- p95 orchestrator round-trip latency
- renderer CPU time while 20+ tool calls run
- memory footprint with long sessions
- tile count churn per run
- dropped frames in active run

## Acceptance criteria
- Default Hermes mode: no editor explosion during file reads/writes.
- Writes are understandable via diff-first visualization.
- No standalone graph mode needed to understand orchestration flow.
- Equivalent or better trace clarity vs current Hermes mode with lower CPU usage.

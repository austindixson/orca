---
name: benchmark-visual
description: Use when the user runs benchmarks (cargo bench, Criterion, custom timing JSON), wants benchmark results on the canvas, or asks to compare performance visually. Auto-invoke after benchmark output is available — call record_benchmark_session with JSON; optionally open Remotion docs/studio tiles for video recap workflows. Pair with docs/skills/visual-explainer for rich HTML reports.
license: MIT
---

# Benchmark + visual studio

## When this activates

- User runs `cargo bench`, Criterion, or any perf measurement and pastes or saves JSON output.
- User asks to "show benchmarks on the canvas", "visualize results", or "open Remotion" alongside metrics.

## Native tools (Orca Coder)

1. **`record_benchmark_session`** — pass `results_json` (stringified JSON). Writes:
   - `.agent-canvas/benchmarks/latest.json`
   - `.agent-canvas/benchmarks/latest-report.html` (simple styled page)
   - Opens a **benchmark** tile with parsed data.
   - Optional: `open_docs_browser_tile: true` → browser on [Remotion docs](https://www.remotion.dev/docs).
   - Optional: `open_remotion_tile: true` → **remotion** tile (iframe to `http://localhost:3000`; user must run `npx remotion studio` in a terminal).

2. **`canvas_create_tile`** with `type: "benchmark"` or `type: "remotion"` for manual layout.

3. **Visual Explainer** — full HTML diagram/table patterns: `.cursor/skills/visual-explainer` (from [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer)), mirrored under `docs/skills/visual-explainer`.

## Remotion

Remotion is a **React/Node** video toolkit ([remotion-dev/remotion](https://github.com/remotion-dev/remotion)). It is not reimplemented in Rust here; the **remotion** tile embeds Studio and links to docs. Generate videos with `npx create-video@latest` or `npx remotion` in the workspace terminal.

## Rust integration

- `open_workspace_relative_path` (Tauri) opens HTML reports in the system browser from the benchmark tile button.

# Native integrations (Rust + orchestrator)

This document tracks **first-party** wiring in Orca Coder—not one-to-one ports of entire upstream projects, but native hooks the orchestrator can rely on.

## Visual Explainer (skill assets)

- **Upstream:** [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) (MIT): agent skill for styled HTML diagrams, tables, and slide-style pages.
- **In-repo:** `docs/skills/visual-explainer/` and `.cursor/skills/visual-explainer/` (vendored `SKILL.md`, `templates/`, `references/`, `commands/`).
- **Usage:** Slash `/visual-explainer` (diet load) or have the orchestrator `read_file` templates when generating rich HTML. No separate Rust renderer—the value is the documented workflows and HTML patterns.

## Benchmark + Remotion studio tiles

- **Orchestrator tool:** `record_benchmark_session` — writes `.agent-canvas/benchmarks/latest.json` and `latest-report.html`, spawns **benchmark** (and optional **browser** + **remotion** tiles).
- **Tile types:** `benchmark`, `remotion` (see `packages/client/src/components/tiles/`).
- **Rust (Tauri):** `open_workspace_relative_path` — opens a workspace-relative file (e.g. HTML report) in the OS default application (typically the browser).

## Browser preview tile (Tauri WebviewWindow)

- **Tile type:** `browser` now acts as a control surface (URL bar + open/focus/close + DevTools) for a native preview window.
- **Rust (Tauri commands):** `browser_webview_navigate`, `browser_webview_open_devtools`, `browser_webview_close_devtools`.
- **Client API:** `packages/client/src/lib/tauri.ts` exposes `openBrowserPreviewWindow`, `focusBrowserPreview`, `closeBrowserPreview`, `navigateBrowserPreview`, and DevTools helpers.
- **Behavior:** No iframe embedding path; desktop uses top-level WebviewWindow, web builds fall back to external browser open.

## Remotion (reference)

- **Project:** [remotion-dev/remotion](https://github.com/remotion-dev/remotion) — programmatic video with React; CLI and Studio run in **Node**, not in Rust.
- **In-app:** The **remotion** tile loads Remotion Studio in an iframe (default `http://localhost:3000`) and links to official docs. Run `npx remotion studio` (or `npx create-video@latest`) from a **terminal** tile in the workspace.

## Skills used during testing

| Skill / asset | Native Rust? | Location |
|----------------|----------------|----------|
| visual-explainer | N — Markdown/templates; browser renders HTML | `docs/skills/visual-explainer` |
| orca-external-orchestrator | N — HTTP bridge skill for Hermes/OpenClaw/Pi | `docs/skills/orca-external-orchestrator/SKILL.md` |
| Vault chat transcript | N — markdown export `Orca/chat/<sessionId>.md`; Settings → Agent data → Vault & Obsidian | `packages/client/src/lib/vault/vaultChatTranscript.ts` |
| benchmark-visual | Partial — reports + tiles in TS; OS open in Rust | `.cursor/skills/benchmark-visual/SKILL.md` |
| Remotion | N — external Node toolchain | Linked from remotion tile + docs above |

When adding new external skills, record them here and either vendor under `docs/skills/` or install under `.cursor/skills/` and reference this file from `create_project_skill` notes when appropriate.

# Developer documentation

Handbook for engineers working on **Orca Coder** (agent-canvas): repo layout, how to run and test, and where the important systems live. For product-oriented project habits, see [`orca.md`](../orca.md). For automated agent entry points, see [`AGENTS.md`](../AGENTS.md).

---

## Monorepo layout

| Path | Role |
|------|------|
| [`packages/client/`](../packages/client/) | React + Vite UI, Zustand stores, orchestrator loop, canvas tiles, Settings. Primary surface for feature work. |
| [`packages/server/`](../packages/server/) | Node companion (telemetry, optional HTTP). |
| [`packages/harness-headless/`](../packages/harness-headless/) | Headless harness build target. |
| [`agent-canvas-server/`](../agent-canvas-server/) | Rust API server (`cargo run -p agent-canvas-server`) — used with `npm run dev`. |
| [`src-tauri/`](../src-tauri/) | Tauri v2 desktop shell: windowing, `read_file` / `write_file` scoped to workspace, `~/.orca` via `orca_*` commands. |
| [`crates/orca-daemon/`](../crates/orca-daemon/), [`crates/orca-cli/`](../crates/orca-cli/) | User-level daemon + CLI (see [`docs/DAEMON.md`](DAEMON.md)). |
| [`docs/`](.) | Architecture notes, skills, bridge specs. |

Workspace name in root `package.json` is `agent-canvas`; the client package is published in-repo as `@agent-canvas/client`.

---

## Prerequisites

- **Node.js 18+**, **npm 9+**
- **Rust toolchain** (stable) for the API server, Tauri, and daemon crates
- **macOS / Windows / Linux** per your target; desktop features assume Tauri

---

## Common commands

From the **repository root**:

| Command | Purpose |
|---------|---------|
| `npm install` | Install JS dependencies (workspaces). |
| `npm run dev` | Concurrent: Vite client, Rust `agent-canvas-server`, Node telemetry server. |
| `npm run dev:client` | Vite only (e.g. `http://localhost:5173`). |
| `npm run dev:server` | Rust API server only. |
| `npm run tauri:dev` | Desktop app with native I/O (workspace files, `~/.orca`). |
| `npm run build` | Client production build + release Rust server. |
| `npm run tauri:build` | Ship desktop bundles. |
| `npm run test:client-orchestrator` | Full client unit test list (orchestrator-heavy). |
| `npm run harness:eval -- --candidate <id> --split search\|test\|memory\|proactive` | Deterministic harness scoring → `.agent-canvas/harness/candidates/<id>/scores.json`. |
| `npm run lint` / `npm run type-check` | ESLint + client/server TypeScript. |
| `npm run rust:clippy` | Rust workspace lints. |
| `npm run skills:sync` | Sync skill mirrors (see script; use `skills:check` in CI-style verification). |

Client-only quick test while iterating:

```bash
cd packages/client && npm test
```

---

## Client architecture (where to edit)

### UI and state

- **Canvas / tiles:** `packages/client/src/components/Canvas/`, `components/tiles/`
- **Global state:** `packages/client/src/store/*` — Zustand, often persisted slices in `settingsStore`
- **App shell:** `App.tsx`, `components/Settings/`, `components/Sidebar/`

### Orchestrator (built-in agent)

- **Run entry + queue:** `store/orchestratorSessionStore.ts` — `run()`, `source: 'user' | 'sub_agent_handoff' | 'heartbeat'`
- **Tool loop + system prompt:** `lib/orchestrator/runOrchestrator.ts`
- **Project + soul/personality:** `lib/orchestrator/orchestratorClaudeMd.ts`
- **Long-term MEMORY + USER profile:** `lib/orchestrator/orcaMemory.ts`
- **Heartbeat scheduler:** `lib/orchestrator/orchestratorHeartbeat.ts` (started from `App.tsx`)
- **Autonomy prompt block:** `lib/orchestrator/orchestratorAutonomyPolicy.ts`
- **Dynamic vs static prompt layers:** `lib/orchestrator/orchestratorPromptLayers.ts`
- **Session persistence / compaction:** `lib/persistence/sessionPersistence.ts`, `sessionCompaction.ts`
- **Memory distiller / user profile distiller:** `memoryDistiller.ts`, `userProfileDistiller.ts`

### Desktop vs web

- **`lib/tauri.ts`** — `readFile` / `writeFile` (workspace-relative), `readOrcaDataFile` / `writeOrcaDataFile` (`~/.orca/`), `isTauri()`. Browser dev mode uses HTTP fallbacks where implemented.

### External orchestrators (Hermes, OpenClaw, Pi, …)

- **HTTP + WS contract:** [`CANVAS_AGENT_BRIDGE.md`](CANVAS_AGENT_BRIDGE.md)
- **Discovery / sync:** [`AGENT_ORCHESTRATOR_SYNC.md`](AGENT_ORCHESTRATOR_SYNC.md)
- **Skill:** [`docs/skills/orca-external-orchestrator/SKILL.md`](skills/orca-external-orchestrator/SKILL.md)

---

## Memory, proactive harness, harness eval

- **Memory + distiller + recurring signals:** [`MEMORY_ARCHITECTURE.md`](MEMORY_ARCHITECTURE.md)
- **USER.md, HEARTBEAT.md, autonomy, code map:** [`PROACTIVE_ORCA_HARNESS.md`](PROACTIVE_ORCA_HARNESS.md)
- **Meta-harness (traces, candidates, Pareto):** [`docs/skills/orca-meta-harness/SKILL.md`](skills/orca-meta-harness/SKILL.md)
- **Eval implementation:** `packages/client/src/lib/orchestrator/harnessEval/` — `evaluateHarnessSuite.ts`, `cli.ts`, `tasks.*.json`

---

## Rust / Tauri

- **Commands and workspace resolution:** `src-tauri/src/lib.rs` and related modules (e.g. `orca_data.rs` for `~/.orca`)
- After changing Tauri commands or permissions, rebuild with `npm run tauri:dev` or `tauri build`

---

## Testing and quality

- Client tests use **Node’s native test runner** with **c8** coverage; new suites are appended in `packages/client/package.json` → `test` script (repo convention).
- Prefer **focused tests** next to modules (`*.test.ts`) or under `__tests__/`.
- For orchestrator changes, run `npm run test:client-orchestrator` before pushing.

---

## Documentation and skills

- **Human project guide:** [`orca.md`](../orca.md)
- **Agent integration index:** [`AGENTS.md`](../AGENTS.md)
- **Skills** live under `docs/skills/` with mirrors in `.cursor/skills/` and `.claude/skills/`; use `npm run skills:sync` when adding or renaming skills (see repo script).

---

## Related reading

| Doc | Topic |
|-----|--------|
| [`README.md`](../README.md) | User-facing features and quick start |
| [`docs/DAEMON.md`](DAEMON.md) | `orcad` / `orca` CLI |
| [`docs/CENTRAL_BRAIN.md`](CENTRAL_BRAIN.md) | Central vault / Obsidian |
| [`INSPECT_MODULE.md`](INSPECT_MODULE.md) | Inspect tile and orchestrator debug tools |

---

*When this file and the root README disagree on commands, trust `package.json` scripts and fix the docs in the same PR.*

# Agent discovery: sync an external orchestrator into Orca

**Keywords for search / embeddings:** `Hermes`, `OpenClaw`, `Pi agent`, `pi-mono`, `external orchestrator`, `canvas bridge`, `BYOA`, `Paperclip`, `Orca Coder`, `spawn_sub_agent`, `api/canvas/execute`, `orchestrator sync`, `replace built-in orchestrator`.

This page is the **entry point** for automated agents (Hermes, OpenClaw, Claude Code, Pi coding agent, custom OpenAI-tool runners) that need to **find** how to drive Orca Coder’s canvas and workspace **the same way** the built-in bottom-bar orchestrator does.

## One-line summary

Point your agent’s tool loop at Orca’s **HTTP bridge**: load tools from `GET /api/canvas/tools`, execute with `POST /api/canvas/execute`, keep an **Orca UI window open** so the WebSocket client is connected.

## Executable playbook (SKILL.md)

Run the skill like any other repo skill (slash command, skill loader, or `read_file` on the path):

| Location | Path |
|----------|------|
| **Canonical (docs + version control)** | [`docs/skills/orca-external-orchestrator/SKILL.md`](skills/orca-external-orchestrator/SKILL.md) |
| Cursor / IDE skills | [`.cursor/skills/orca-external-orchestrator/SKILL.md`](../.cursor/skills/orca-external-orchestrator/SKILL.md) |
| Claude Code–style install | [`.claude/skills/orca-external-orchestrator/SKILL.md`](../.claude/skills/orca-external-orchestrator/SKILL.md) |

The three files are kept in sync; prefer **`docs/skills/...`** when linking from documentation sites.

## Full HTTP + contract reference

- **[CANVAS_AGENT_BRIDGE.md](CANVAS_AGENT_BRIDGE.md)** — Hermes Option B, Pi, OpenClaude, auth, env vars, source file map.

## Mental model

| Layer | Role |
|-------|------|
| **Your agent** (Hermes / OpenClaw / Pi / custom) | LLM loop, memory, gateways, **tool planning** — *becomes* the orchestrator by calling Orca’s tools. |
| **Orca Coder UI** (must stay open) | WebSocket client to the bridge; **effector** for tiles, workspace FS, browser modules, terminal injection. |
| **Node server** (`packages/server`, default `:3001`) | Proxies `POST /api/canvas/execute` to the connected UI. |

The built-in chat orchestrator and your external agent use the **same tool names and shapes** when the bridge is used.

## Quick verification

```bash
curl -s http://127.0.0.1:3001/api/canvas/bridge-status
```

Expect `uiClients >= 1` while Orca is open. Then:

```bash
curl -s http://127.0.0.1:3001/api/canvas/tools | head -c 400
```

## Related

- Bridge implementation: `packages/server/src/canvasBridge.ts`, `packages/client/src/hooks/useCanvasBridge.ts`
- Tool definitions: `packages/client/src/lib/orchestrator/toolDefinitions.ts`
- **Hermes setup (tutorials, visuals, troubleshooting):** [hermes-orca-visual-setup.md](hermes-orca-visual-setup.md) and [slides/hermes-orca-setup.html](slides/hermes-orca-setup.html)

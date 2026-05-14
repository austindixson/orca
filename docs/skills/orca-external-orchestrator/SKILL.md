---
name: orca-external-orchestrator
description: Sync Hermes, OpenClaw, Pi (pi-mono), or any OpenAI-style tools agent to Orca Coder — become the canvas orchestrator via GET /api/canvas/tools + POST /api/canvas/execute. Use when integrating external agents with Orca, replacing or mirroring the built-in orchestrator, or when the user says sync Hermes/OpenClaw/Pi with Orca.
---

# Orca external orchestrator (bridge sync)

**Mirrors (same content):** `.cursor/skills/orca-external-orchestrator/SKILL.md`, `.claude/skills/orca-external-orchestrator/SKILL.md`.

You are wiring a **long-running external agent** so it **is** the orchestrator for Orca Coder: same tools as the built-in agent, with Orca as the **effector** (tiles, workspace, browser, terminals).

## When to use

- User wants **Hermes**, **OpenClaw**, **Pi**, or a **custom** tool-calling loop to drive the infinite canvas.
- User says: sync with Orca, canvas bridge, BYOA, replace orchestrator, Telegram/WhatsApp → Orca (Hermes path).

## Prerequisites

1. **Orca Coder** dev stack running so **`packages/server`** listens on **`http://127.0.0.1:3001`** (e.g. repo root `npm run dev`).
2. **Orca UI window open** — the client registers a WebSocket bridge client. Without this, executes will not reach the canvas.
3. Same **workspace folder** in Orca as the agent uses for file tools (or call `open_workspace` with an absolute path after connect).

## Contract (memorize)

| Action | Request |
|--------|---------|
| Tool manifest (OpenAI-style) | `GET http://127.0.0.1:3001/api/canvas/tools` |
| Execute one tool | `POST http://127.0.0.1:3001/api/canvas/execute` with JSON `{"tool":"<name>","arguments":{...}}` |
| Readiness | `GET http://127.0.0.1:3001/api/canvas/bridge-status` → need `uiClients >= 1` |
| Hermes / external ID | Optional header on execute: `X-Orca-External-Agent: hermes` — bridge status may include `externalOrchestrator` (120s TTL) for Orca UI auto-lock |
| Optional auth | Header `Authorization: Bearer <CANVAS_BRIDGE_TOKEN>` if the server sets `CANVAS_BRIDGE_TOKEN` |
| Post into group chat (external poster) | `POST http://127.0.0.1:3001/api/orchestrator/team-message` with JSON `{"agent":"hermes@local","body":"@Mei …","kind":"handoff","to":"Mei"}` — stamped `provenance.source = external_http`, `trust = untrusted` |
| Agent-driven team chat | Tools `post_team_message`, `poll_team_messages`, `reply_to_team_message` in the canvas manifest |

Arguments match **`packages/client/src/lib/orchestrator/toolDefinitions.ts`** (same as built-in orchestrator).

## Group chat protocol (schemaVersion: 1)

Orca exposes an event-first, machine-readable **group chat** (single `#all` channel per `sessionId`) so your external loop can coordinate with the orchestrator and sub-agents:

- **Envelope fields:** `id`, `sessionId`, `senderTileId?`, `senderName`, `body`, `mentions` (`@all` or agent `tileId`/display name), `seq` (monotonic), `kind` (`say`/`ask`/`ack`/`update`/`handoff`/`blocker`/`result`), `threadId`, `replyTo?`, `correlationId?`, `provenance` (`{source, agent?, trust?}`), `sensitivity?`, `freshnessTtlMs?`, `fingerprint`.
- **Dedupe:** identical content within **2 s** returns `{ deduped: true }` with the original `message_id` — safe to retry.
- **Inbox injection:** sub-agents automatically receive messages that mention `@all` or them by name/id, plus **session-wide** directive posts (`ask`/`ack`/`handoff`/`blocker`/`result` with **no** explicit mentions). `freshnessTtlMs` drops stale pings.
- **Agent tools:**
  - `post_team_message({ body, to?, kind?, correlation_id? })` → `{ message_id, seq, thread_id, kind, deduped }`.
  - `poll_team_messages({ since_seq, thread_id?, limit? })` → ordered list since `seq`.
  - `reply_to_team_message({ reply_to, body, kind? })` — inherits `threadId`.
- **External HTTP poster (no tile required):** `POST /api/orchestrator/team-message` with `{ agent, body, kind, to?, reply_to?, correlation_id?, session_id? }` — same auth rules as `/api/canvas/execute`. Legacy `team`/`channel` fields are ignored. Messages fan out over WS to the UI and are persisted best-effort under `Orca/chat/team/<sessionId>.jsonl` in the workspace.

## Minimal integration checklist

1. **Fetch** `GET /api/canvas/tools` and register each function as a **custom tool** in your agent (Hermes / OpenClaw tool registry / Pi agent core / etc.).
2. **Implement handler**: for each invocation, `POST /api/canvas/execute` with the tool name and parsed arguments (objects or JSON strings per manifest).
3. **Poll or check once** `GET /api/canvas/bridge-status` and confirm `uiClients >= 1` before telling the user “connected.”
4. **Align workspace**: open the same folder in Orca’s sidebar as your agent’s cwd, or execute `open_workspace` with an absolute path.
5. **Optional UI**: create a **`hermes_bridge`** tile via `canvas_create_tile` so the user sees bridge URLs and status (`type: "hermes_bridge"` in manifest).

## curl smoke test (human or agent)

```bash
curl -s http://127.0.0.1:3001/api/canvas/bridge-status
curl -s -X POST http://127.0.0.1:3001/api/canvas/execute \
  -H 'Content-Type: application/json' \
  -d '{"tool":"canvas_list_modules","arguments":{}}'
```

**Repo CLI (same checks, fewer moving parts):** from the Orca checkout, `npm run orca:bridge -- status` (also `tools`, `execute <tool> [json]`). Env: `CANVAS_BRIDGE_URL`, `CANVAS_BRIDGE_TOKEN` when the server requires a token.

## Agent-specific notes

### Hermes (NousResearch)

- Keep Hermes as the **only** planner if using messaging gateways (Telegram, WhatsApp, etc.).
- Merge Orca tools from **`/api/canvas/tools`** with Hermes’ native tools; forward Orca calls to **`/api/canvas/execute`** (sidecar or inline HTTP).
- See **`docs/CANVAS_AGENT_BRIDGE.md`** § Option B.

### OpenClaw / Claude Code / slash skills

- Add a **skill** or small **Node script** that wraps `fetch`/`curl` to `/api/canvas/execute`.
- Install this repo’s skill copy: **`.claude/skills/orca-external-orchestrator/SKILL.md`** or read **`docs/skills/orca-external-orchestrator/SKILL.md`**.

### Pi ([pi-mono](https://github.com/badlogic/pi-mono))

- Register a **custom tool** that forwards to **`POST /api/canvas/execute`**; merge manifests from **`GET /api/canvas/tools`** with Pi’s tools.
- Pi does not need WebSocket code — only the HTTP adapter.

## Safety

- Treat **`CANVAS_BRIDGE_TOKEN`** as a secret if the server uses it.
- Do not expose port **3001** to untrusted networks without a token and firewall.

## Discovery docs (for humans)

- **Entry point:** `docs/AGENT_ORCHESTRATOR_SYNC.md`
- **Full bridge reference:** `docs/CANVAS_AGENT_BRIDGE.md`

## Built-in vs external orchestrator

- The **UI chat orchestrator** may run in **lead-delegation-only** mode (Settings → Harness): it only delegates via `spawn_sub_agent` + canvas coordination.
- **Your external agent** via the bridge typically receives the **full** tool manifest from `GET /api/canvas/tools` — you are not restricted to that lead allowlist unless you filter tools yourself.

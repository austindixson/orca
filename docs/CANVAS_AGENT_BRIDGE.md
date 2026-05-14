# External agents: Hermes, Pi, OpenClaude, OpenClaw, and Paperclip-style BYOA

**Agent discovery (keywords: Hermes, OpenClaw, Pi, external orchestrator, bridge sync):** start at **[docs/AGENT_ORCHESTRATOR_SYNC.md](AGENT_ORCHESTRATOR_SYNC.md)**. To implement the integration as an executable skill, read **`docs/skills/orca-external-orchestrator/SKILL.md`** (also under `.cursor/skills/` and `.claude/skills/`).

Orca Coder is influenced by orchestration projects like [Paperclip](https://github.com/paperclipai/paperclip): **bring your own agent**, wire it to a stable contract, and let a UI own side effects. Here the **infinite canvas** and **workspace FS** live in the desktop/web UI; the **built-in orchestrator** (bottom bar) and **external runners** share the **same tools** (including `open_workspace` for the sidebar explorer).

[Pi](https://github.com/badlogic/pi-mono) ([badlogic/pi-mono](https://github.com/badlogic/pi-mono)) is a good fit alongside Hermes: **`@mariozechner/pi-ai`** gives a unified multi-provider LLM API, and **`@mariozechner/pi-agent-core`** implements agent runtime with tool calling — the same pattern our bridge expects (OpenAI-style tools + HTTP side effects). Register the orchestrator tools as custom tools whose handler **`POST`s** `http://localhost:3001/api/canvas/execute` with `{ tool, arguments }`, and import definitions from **`GET /api/canvas/tools`** so Pi’s coding agent or your own Pi-based loop stays aligned with the built-in orchestrator.

## Same contract as the built-in orchestrator

| Tool | Purpose |
|------|---------|
| `read_file` | Read a workspace file (relative path) |
| `write_file` | Write a workspace file |
| `list_directory` | List a directory (`"."` = root) |
| `open_workspace` | Switch the **left sidebar** file tree to a folder (**absolute path**). Not a browser tile. |
| `canvas_list_modules` | Full snapshot of every tile (ids, types, layout, `meta`) |
| `canvas_create_tile` | Spawn tiles (see manifest enum): includes `hermes_bridge` for bridge status UI |
| `canvas_update_tile` | Move, resize, update `meta`, or remove a tile |

Definitions (OpenAI-style function objects): **`GET http://localhost:3001/api/canvas/tools`**

Execution (HTTP): **`POST http://localhost:3001/api/canvas/execute`**

```json
{
  "tool": "canvas_list_modules",
  "arguments": {}
}
```

```json
{
  "tool": "read_file",
  "arguments": { "path": "README.md" }
}
```

The server **does not** mutate the canvas by itself. It forwards the call over **WebSocket** to any connected Orca Coder window, which runs the same `executeOrchestratorTool` path as the built-in agent. **Keep a UI session open** while external agents drive tools.

> **OpenRouter tool-use preflight:** when the built-in orchestrator uses an OpenRouter model, Orca probes `GET /api/v1/models/{slug}/endpoints` at selection time to verify at least one live endpoint supports the `tools` parameter. Models without tool-use are flagged with a red badge in Settings and cannot drive this bridge. See [SETUP.md § OpenRouter Model Preflight](SETUP.md#openrouter-model-preflight) and `packages/client/src/lib/openrouterPreflight.ts`.

### Handing results back to the lead orchestrator (`orca reply`)

When a subprocess or external Hermes CLI finishes **outside** the built-in tool loop, post a completion summary so the lead orchestrator can merge it like a sub-agent handoff:

- **HTTP:** `POST http://127.0.0.1:3001/api/orchestrator/reply` with JSON:
  `{ "parent_tile_id": "<orchestrator widget tile id>", "text": "<summary>", "role": "external", "child_tile_id": "<optional hermes tile id>" }`
- Same **`Authorization: Bearer`** rules as `/api/canvas/execute` when `CANVAS_BRIDGE_TOKEN` is set.
- The companion server fans out **`orchestrator:reply`** over WebSocket; the UI calls `recordSubAgentHandoff` and ACKs with **`orchestrator:reply:result`** (HTTP waits until the UI processes, similar to harness chat).
- **CLI:** `orca reply "Done: …"` with `--tile <id>` or env **`ORCA_PARENT_TILE_ID`** (and optional **`ORCA_PARENT_SESSION_ID`**). Gateway terminals spawned from Orca may pre-export these env vars.

Built-in **`chat_with_hermes_tile`** drives the visible `hermes_agent` tile and hands off automatically when the HTTP reply completes; use **`orca reply`** for shell-only or cross-process completion.

Check readiness: **`GET http://localhost:3001/api/canvas/bridge-status`** → `{ "uiClients": 1, "tokenRequired": false }`

## Auth

If you set **`CANVAS_BRIDGE_TOKEN`** in the environment for the Node server, require:

`Authorization: Bearer <CANVAS_BRIDGE_TOKEN>`

If unset, the bridge is open on localhost (development only). Do not expose port 3001 to untrusted networks without a token.

## Group chat protocol (orchestrator ↔ sub-agents ↔ external)

Orca’s agent group chat is **event-first, schema-versioned, and machine-readable**. All posts share a **single session-scoped `#all` feed** so orchestrators, sub-agents, and external agents (Hermes / OpenClaw / Pi) coordinate through one ordered log per `sessionId`.

### Message envelope (schemaVersion: 1)

Every `GroupChatMessage` carries:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | `string` | Stable message id (`gcm-…`) — use with `reply_to` / `poll_team_messages`. |
| `schemaVersion` | `number` | Envelope version (currently `1`). |
| `sessionId` | `string` | Orchestrator session scope. |
| `senderTileId` | `string?` | Tile id of the sending sub-agent (absent for system / external HTTP). |
| `senderName` | `string` | Display name. |
| `body` | `string` | Message text (pre-rendered, mentions parsed). |
| `mentions` | `ResolvedMention[]` | `@all` or `@<displayName>` / `@<tile_id>` (`kind`: `all` \| `agent`). |
| `kind` | `"say" \| "ask" \| "ack" \| "update" \| "handoff" \| "blocker" \| "result"` | Intent. Directive kinds (`ask`, `ack`, `handoff`, `blocker`, `result`) can be **session-broadcast** when there are **no** mentions — every sub-agent sees them on the next turn. |
| `seq` | `number` | Monotonic per-session sequence (used by `listSince`). |
| `threadId` | `string` | Thread root (`id` for a root message, inherited from `replyTo` target otherwise). |
| `replyTo` | `string?` | Parent message id. |
| `correlationId` | `string?` | Cross-message correlation (tool cycle, outer RFC, etc.). |
| `provenance` | `{ source: "system" \| "sub_agent" \| "orchestrator" \| "external_http", agent?: string, trust?: "trusted" \| "untrusted" }` | Who posted and whether they’re trusted. External HTTP posters are stamped `trust: "untrusted"` and rendered as `<name> · via <agent>` in inboxes. |
| `sensitivity` | `"ephemeral" \| "internal" \| "public"` | Defaults to `internal`. `ephemeral` is skipped by the workspace JSONL mirror and aged out of inboxes after 60 s. |
| `freshnessTtlMs` | `number?` | If set, the message is dropped from inbox injection after `createdAt + freshnessTtlMs`. Use for time-sensitive pings. |
| `fingerprint` | `string` | Stable hash of `sessionId`, sender, `kind`, `replyTo`, and a trimmed body prefix — drives the **2-second dedupe window** in `postMessage`. Re-posts inside the window return `{ ..., deduped: true }` and do **not** create a new entry or fan out again. |
| `createdAt`, `readBy` | — | Unix ms, read-receipt list. |

### Inbox injection (how sub-agents actually react)

Before each LLM round, `subAgentRunner` calls `collectAndFormatInboxForTile(sessionId, tileId)` and prepends a synthetic `user` block containing every message that:

- has `seq > member.lastDeliveredSeq`, **and**
- is addressed to this tile via `@all` or an `@<agent>` mention that resolves to this `tileId`, **or** is a directive kind (`ask`/`ack`/`handoff`/`blocker`/`result`) with **no** explicit mentions (session-wide broadcast to all sub-agents).

The cursor (`lastDeliveredSeq`) advances each round so the same message is never re-injected; `freshnessTtlMs` and `sensitivity: "ephemeral"` filter out stale entries at render time. Agents acknowledge with `reply_to_team_message` (threads), or fetch history with `poll_team_messages`.

### Canvas tools for group chat

All three are exposed in both the client manifest (`ORCHESTRATOR_TOOLS_OPENAI`) and the server manifest served by **`GET /api/canvas/tools`** — external agents pick them up automatically.

| Tool | Purpose |
|------|---------|
| `post_team_message` | Post to the session **Agent Group Chat** (`#all`). Args: `body`, optional `to` (tile id or display name — adds an explicit `@` tag), `kind` (default `"say"`), `correlation_id`. Returns `{ message_id, seq, thread_id, kind, deduped }`. |
| `poll_team_messages` | Fetch messages since a sequence number. Args: `since_seq`, `thread_id` (optional), `limit`. Returns the list ordered by `seq`. |
| `reply_to_team_message` | Thread-aware reply. Args: `reply_to`, `body`, `kind` (default `"ack"` in many cases). `threadId` is inherited from the target automatically. |

### POST /api/orchestrator/team-message (external posters)

External agents (Hermes, OpenClaw, Pi, custom CLIs) post into the group chat **without owning a sub-agent tile** via:

```
POST http://127.0.0.1:3001/api/orchestrator/team-message
Content-Type: application/json
Authorization: Bearer <CANVAS_BRIDGE_TOKEN>     # when the token is set
```

```json
{
  "agent": "hermes@local",
  "sender_name": "Hermes",
  "body": "@Mei please rebase and retest",
  "session_id": "<optional; defaults to the active session>",
  "to": "Mei",
  "kind": "handoff",
  "reply_to": "gcm-…",
  "correlation_id": "rfc-42"
}
```

- `agent` and `body` are required; `kind` must be one of the enum values above.
- Optional `team` / `channel` keys may still be accepted for legacy clients but are **ignored** for routing — everything goes to the session `#all` feed.
- The server forwards the message over WebSocket (`team:message:incoming`) to the connected Orca UI, which parses `@mentions`, stamps `provenance: { source: "external_http", agent, trust: "untrusted" }`, and calls `postMessage`. The UI ACKs with `team:message:incoming:result`.
- The HTTP response is `{ ok: true, message_id, seq, thread_id, deduped }`. When `deduped: true`, the body+sender+kind matched a post within the last **2 s** and no new message was created.

Same auth + `uiClients ≥ 1` readiness rules as `/api/canvas/execute`.

Related files: `packages/client/src/store/groupChatStore.ts`, `packages/client/src/lib/orchestrator/teamChatInbox.ts`, `packages/client/src/lib/vault/groupChatVaultMirror.ts` (best-effort JSONL mirror to `Orca/chat/team/<sessionId>.jsonl`), `packages/server/src/orchestratorReplyBridge.ts` (`enqueueExternalTeamMessage`), `packages/server/src/app.ts`.

## Integrating Hermes (NousResearch)

1. Run Orca Coder with the dev stack so `npm run dev` starts the client and **`packages/server` on port 3001`**.
2. Register an HTTP tool (or custom tool handler) that **`POST`s to `/api/canvas/execute`** with the JSON body above.
3. Pull tool schemas from **`GET /api/canvas/tools`** so your Hermes deployment stays aligned with this repo’s manifest.
4. Hermes’ usual file/terminal tools can stay separate; canvas tools map 1:1 to the built-in orchestrator, so behavior matches **as if Hermes were driving the same loop**.

### Option B — Hermes as the LLM / orchestrator (gateway users)

If you run **Hermes** as the external agent loop, do **not** duplicate that stack inside Orca. Use upstream Hermes docs for gateway and messaging. Here, only the **canvas bridge** contract matters: tools over HTTP + WebSocket as below.

**Wire Orca to Hermes:**

1. **Keep Hermes** as the only long-running agent loop and tool planner.
2. **Add Orca’s canvas tools** to Hermes’ tool list by importing **`GET /api/canvas/tools`** (merge with Hermes’ native tools).
3. Implement a thin **HTTP forwarder** in Hermes (or a sidecar) that maps each Orca tool call to **`POST /api/canvas/execute`** with `{ "tool", "arguments" }`.
4. **Leave Orca’s UI open** so the WebSocket client registers; `GET /api/canvas/bridge-status` should show `uiClients >= 1`.
5. Align **workspace roots**: open the same folder in Orca as Hermes uses for `read_file` / `write_file` (or call `open_workspace` from Hermes when needed).

Hermes effectively **replaces** the built-in orchestrator’s model loop for canvas-visible work while Orca remains the **effector** (tiles, FS, browser modules).

In the Orca UI, add the **Hermes · Orca bridge** tile (`canvas_create_tile` type **`hermes_bridge`**) to monitor connection status and copy manifest / execute / WebSocket URLs.

### Hermes + Orca runbook (quick checklist)

1. Start the bridge: from the repo root run `npm run dev` (or `npm run dev:server:node` for **Node** `packages/server` on **`PORT`**, default **3001**).
2. Open Orca Coder and **keep the window open** so the UI registers a WebSocket client (`uiClients >= 1` on `GET /api/canvas/bridge-status`).
3. In Hermes (or any external agent), merge tool definitions from **`GET http://127.0.0.1:3001/api/canvas/tools`** (or `localhost` in dev when the Vite proxy applies).
4. Forward each canvas tool call to **`POST http://127.0.0.1:3001/api/canvas/execute`** with body `{ "tool": "<name>", "arguments": { … } }` (JSON). If **`CANVAS_BRIDGE_TOKEN`** is set on the server, send header `Authorization: Bearer <token>`.
5. Align **workspace**: open the same folder in Orca’s sidebar as Hermes uses for filesystem tools, or call **`open_workspace`** via the bridge.
6. Deeper sync notes (multi-agent handoff, manifests): [AGENT_ORCHESTRATOR_SYNC.md](AGENT_ORCHESTRATOR_SYNC.md).

**Extended setup (visuals, tutorials, troubleshooting):** [hermes-orca-visual-setup.md](hermes-orca-visual-setup.md) — includes bridge vs in-app tile comparison, curl examples, symptom table, orchestrator tool `diagnose_hermes_setup`, and an optional [HTML slide deck](slides/hermes-orca-setup.html) for walkthroughs.

### Bridge smoke (curl)

With the server up and (optionally) Orca UI connected:

```bash
chmod +x scripts/bridge-smoke.sh
./scripts/bridge-smoke.sh
# With token:
# CANVAS_BRIDGE_TOKEN=yourtoken ./scripts/bridge-smoke.sh
```

Manual one-liners (default base `http://127.0.0.1:3001`):

```bash
curl -sS http://127.0.0.1:3001/api/canvas/bridge-status
curl -sS http://127.0.0.1:3001/api/canvas/tools | head -c 400
curl -sS -X POST http://127.0.0.1:3001/api/canvas/execute \
  -H 'Content-Type: application/json' \
  -d '{"tool":"canvas_list_modules","arguments":{}}'
```

## Integrating Pi ([pi-mono](https://github.com/badlogic/pi-mono))

Pi’s monorepo ships **`packages/ai`** (unified LLM API: OpenAI, Anthropic, Google, …) and **`packages/agent`** (agent core with tool calling and state). The [coding agent CLI](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) is the usual entry point.

To drive Orca Coder from Pi the same way as the built-in agent:

1. Run Orca Coder with **`npm run dev`** so **`localhost:3001`** (bridge + file APIs) is up, and keep the **UI open** so the WebSocket bridge is registered.
2. Add a **custom tool** (or MCP-style HTTP tool) that forwards each tool name + arguments to **`POST /api/canvas/execute`** (same JSON as above). Optionally merge manifests: **`GET http://localhost:3001/api/canvas/tools`** plus Pi’s own tools.
3. Point Pi’s workspace at the same folder you opened in Orca Coder so `read_file` / `write_file` / `list_directory` match.

Pi does not need to know about WebSockets — only your thin adapter talks HTTP to the bridge; the canvas still executes in the connected UI, preserving parity with Hermes-style integration.

## Integrating OpenClaw / OpenClaude / Claude Code–style agents

- Run or install the repo skill **`orca-external-orchestrator`** (`docs/skills/orca-external-orchestrator/SKILL.md`) so the agent loads the checklist and curl smoke tests.
- Add a **skill** or **subagent** that shells out to `curl` against `/api/canvas/execute`, or use a small Node adapter.
- Use the same tool names and argument shapes as in `packages/client/src/lib/orchestrator/toolDefinitions.ts`.

## Paperclip-style mental model

- **Paperclip** coordinates *companies* of agents with goals and heartbeats; **Orca Coder** coordinates *spatial modules* on a canvas.
- **BYOA** here means: your long-running agent (Hermes, Pi coding agent, custom Claude pipeline, etc.) stays authoritative for planning; **Orca Coder** is the **effector** for files + tiles when the UI is connected.
- For **parity with the built-in agent**, prefer calling **`/api/canvas/execute`** instead of reimplementing layout logic in the external runner.

## Native Orca Telegram gateway (no Hermes)

The companion server (`packages/server`) can run an optional **Telegram long-poll gateway** so users without Hermes can still chat from Telegram:

- **Env:** `ORCA_TELEGRAM_BOT_TOKEN` (optional auto-start on boot), `ORCA_TELEGRAM_ALLOWED_USER_IDS` (comma-separated numeric ids; omit to allow any user — not recommended outside local dev).
- **HTTP:** `GET /api/gateway/status`, `POST /api/gateway/telegram/start` (body optional: `token` overrides env; otherwise `ORCA_TELEGRAM_BOT_TOKEN` on the server is used), `POST /api/gateway/telegram/stop`. If no token is available (empty body and unset env), start returns **200** with `skipped: true` and `telegram.running: false` — not an error. Same `CANVAS_BRIDGE_TOKEN` auth as `/api/canvas/execute` when set.
- **Flow:** Telegram → server → WebSocket `gateway:telegram` to the **first** connected Orca UI → same orchestrator run as the bottom bar → `gateway:telegram:result` → Telegram reply. **Keep Orca open** with the canvas bridge enabled (`uiClients ≥ 1`).
- **Code:** `packages/server/src/nativeTelegramGateway.ts`, `packages/server/src/gatewayBridge.ts`; client handler in `packages/client/src/lib/nativeGatewayClient.ts` + `useCanvasBridge.ts`.

Discord/Slack/etc. are not implemented here; use Hermes for multi-platform messaging.

## Disabling the WebSocket bridge client

Set **`VITE_ENABLE_CANVAS_BRIDGE=false`** when building the client if you do not want the UI to register as a bridge target.

Override the WebSocket URL with **`VITE_CANVAS_BRIDGE_WS`** (e.g. `ws://127.0.0.1:3001/ws` for Tauri + local server).

## Source files

- Tool definitions (client): `packages/client/src/lib/orchestrator/toolDefinitions.ts`
- Tool execution: `packages/client/src/lib/orchestrator/executeTools.ts`
- Bridge hook: `packages/client/src/hooks/useCanvasBridge.ts`
- HTTP + WS server: `packages/server/src/index.ts`, `packages/server/src/canvasBridge.ts`, `packages/server/src/canvasToolsManifest.ts`, `packages/server/src/nativeTelegramGateway.ts`, `packages/server/src/gatewayBridge.ts`

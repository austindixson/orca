---
name: hermes-orca-bridge
description: Connect Hermes (NousResearch) or Hermes-style agents to Orca Coder’s canvas via HTTP + WebSocket — Hermes stays the LLM loop; Orca executes tools. Use when integrating Telegram/WhatsApp/iMessage gateways that terminate in Hermes, or when users say “sync Hermes with Orca”.
---

# Hermes ↔ Orca bridge (Option B)

## Mental model

- **Hermes** (or your Hermes deployment) owns planning, memory, and **messaging gateway** adapters (Telegram Bot API, WhatsApp Business / bridges, BlueBubbles for iMessage — per Hermes docs).
- **Orca Coder** owns the **infinite canvas**, workspace FS in the UI, and **tile modules**. External control uses the same tool names as the built-in orchestrator.
- **Do not** reimplement chat bridges inside Orca for this path: wire **Hermes → Orca HTTP bridge**, not the reverse.

## Contract (localhost)

| Step | Action |
|------|--------|
| Tool definitions | `GET http://127.0.0.1:3001/api/canvas/tools` (OpenAI-style manifest) |
| Execute | `POST http://127.0.0.1:3001/api/canvas/execute` body: `{ "tool": "<name>", "arguments": { ... } }` |
| UI readiness | `GET http://127.0.0.1:3001/api/canvas/bridge-status` → `uiClients` must be ≥ 1 |
| Auth (optional) | `Authorization: Bearer <CANVAS_BRIDGE_TOKEN>` if `CANVAS_BRIDGE_TOKEN` is set on the server |

The Node server forwards executes over **WebSocket** to a connected Orca window (`useCanvasBridge`). **Keep the Orca UI open.**

### Identify Hermes to Orca (auto-lock in UI)

On **every** `POST /api/canvas/execute`, send:

`X-Orca-External-Agent: hermes`

(Rust + Node companion servers record a 120s heartbeat; `GET /api/canvas/bridge-status` includes `externalOrchestrator` when fresh.) Orca **Settings → Models → Hermes mode** can then auto-grey provider UI when **Auto-lock when Hermes is detected** is enabled.

## Install skills from the Orca repo (new users)

From the Orca checkout:

```bash
npm run hermes:install-skills
# or: HERMES_SKILLS_DIR=~/path/to/hermes/skills node scripts/install-hermes-skills.mjs
```

See **`docs/skills/hermes/README.md`** for paths and smoke tests.

## Orca bridge CLI (smoother than raw curl)

From the **Orca repo root** (same machine as the bridge), use the bundled CLI instead of hand-written curl:

```bash
npm run orca:bridge -- status    # health + bridge-status + gateway status
npm run orca:bridge -- tools     # full tool manifest JSON
npm run orca:bridge -- execute canvas_list_modules '{}'
```

Optional env: `CANVAS_BRIDGE_URL`, `CANVAS_BRIDGE_TOKEN` (must match the server). Hermes terminal sessions can `cd` to the Orca checkout and run these for quick smoke tests without spawning a dozen `curl` calls.

### Closing the loop: `orca reply`

When Hermes (or any subprocess) finishes work outside the canvas tool loop, hand a one-paragraph summary to the **lead** orchestrator:

```bash
orca reply "Summary of what completed" --tile <orchestrator_widget_tile_id>
# or: export ORCA_PARENT_TILE_ID=… && orca reply "…"
```

This **`POST`s `/api/orchestrator/reply`**; the Orca UI must stay open (same WebSocket contract as `/api/canvas/execute`). Prefer the built-in **`chat_with_hermes_tile`** tool when the visible **`hermes_agent`** tile should auto-send over `/v1/responses`; use **`orca reply`** for CLI-only completions. See **`docs/CANVAS_AGENT_BRIDGE.md`** § Handing results back.

## Hermes setup (outline)

1. Run Orca with the dev stack so **`packages/server`** listens on **3001** (`npm run dev` at repo root, or start server + client per README).
2. In Hermes, register tools from **`/api/canvas/tools`** (merge with Hermes’ existing tools).
3. For each Orca tool invocation, **POST** `/api/canvas/execute` with JSON arguments (strings or objects; same as built-in orchestrator).
4. Point Hermes’ workspace at the **same folder** opened in Orca, or call **`open_workspace`** with an absolute path when switching.

## Team chat (coordinate with Orca sub-agents)

Orca’s group chat is machine-readable (schema v1) and directly usable from Hermes:

- **External HTTP poster:** `POST http://127.0.0.1:3001/api/orchestrator/team-message` with JSON `{ agent: "hermes@local", body: "@Mei please retest", kind: "handoff", team: "#leads", reply_to?, correlation_id?, session_id? }`. Same auth (`CANVAS_BRIDGE_TOKEN`) + `uiClients ≥ 1` readiness rules as `/api/canvas/execute`. Messages are stamped `provenance.source = external_http`, `trust = untrusted`, fan out over WS to the UI, and mirrored best-effort to `Orca/chat/team/<sessionId>.jsonl`.
- **Agent-driven tools** (already in the canvas manifest): `post_team_message` (with `kind: say|ask|ack|update|handoff|blocker|result`, `reply_to`, `correlation_id`), `poll_team_messages({ since_seq, thread_id?, limit? })`, `reply_to_team_message({ reply_to, body, kind?, correlation_id? })` — threading is automatic.
- **Dedupe:** identical `(sender, body, kind, replyTo)` within **2 s** returns `{ deduped: true }` with the original `message_id` — retries are safe.
- **Inbox injection:** Orca sub-agents see unseen `@mentions` and directive kinds (`ask`/`ack`/`handoff`/`blocker`/`result`) on their own team before every LLM round; `freshnessTtlMs` drops stale pings.

Full envelope reference: **`docs/CANVAS_AGENT_BRIDGE.md`** § Team chat protocol.

## Safety

- Treat **`CANVAS_BRIDGE_TOKEN`** like a secret when exposing anything beyond loopback.
- **Pairing / allowlists** for chat IDs belong in **Hermes’ gateway**, not in Orca’s core.
- Rate limits and “no shell from random chats” are **Hermes policy**; Orca only executes what Hermes sends once authenticated upstream.

## Orca UI

- Spawn **`hermes_bridge`** tile via **`canvas_create_tile`** to see bridge status, copy URLs, and confirm `uiClients`.
- Full reference: **`docs/CANVAS_AGENT_BRIDGE.md`** in this repo.

## Related: general external orchestrator skill

For **any** agent (Hermes, OpenClaw, Pi, custom) — not only Hermes gateways — use **`orca-external-orchestrator`**: **`docs/skills/orca-external-orchestrator/SKILL.md`** (also **`.claude/skills/orca-external-orchestrator/SKILL.md`**). Discovery hub: **`docs/AGENT_ORCHESTRATOR_SYNC.md`**.

## When not to use this skill

- If you need a **native-only** bridge inside Orca without Hermes, design a separate small service and still use `/api/canvas/execute` — but messaging semantics remain your responsibility.
- If Hermes is **not** in the loop, use the same HTTP contract from any agent (Pi, OpenClaude, custom).

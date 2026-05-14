# Hermes ↔ Orca (discoverability)

New users: after cloning **Orca Coder**, Hermes can load bridge skills directly from this repo. For a **full setup walkthrough** (tutorials, troubleshooting, diagrams), start here:

- **[Hermes + Orca visual setup guide](../../hermes-orca-visual-setup.md)** — step-by-step, symptom table, `diagnose_hermes_setup`, examples
- **[HTML slide deck](../../slides/hermes-orca-setup.html)** — open in a browser for a quick visual tour (arrow keys)

---

## Where to look

| Path | Purpose |
|------|---------|
| `.cursor/skills/hermes-orca-bridge/` | Hermes + canvas bridge (Option B), Telegram gateways |
| `.claude/skills/hermes-orca-bridge/` | Same content (Claude Code mirror) |
| `docs/skills/orca-external-orchestrator/` | Any external agent (Hermes, OpenClaw, Pi) — HTTP contract |

---

## One-command install (recommended)

From the **Orca repository root**:

```bash
node scripts/install-hermes-skills.mjs
```

Optional: `HERMES_SKILLS_DIR=/path/to/hermes/skills` if your Hermes install uses a non-default directory.

npm shortcut:

```bash
npm run hermes:install-skills
```

**Tip:** Run this after major Orca pulls if bridge skill content changed; Hermes picks up copied skills from its configured skills directory.

---

## Smoke test

```bash
npm run orca:bridge -- status
```

Expect `health` ok and `uiClients` ≥ 1 with Orca UI open.

**If `uiClients` is 0:** start `npm run dev` (or your dev stack), open Orca, and select a workspace folder — the WebSocket client must register. See [CANVAS_AGENT_BRIDGE.md](../../CANVAS_AGENT_BRIDGE.md).

---

## Bridge auth

When the server sets `CANVAS_BRIDGE_TOKEN`, send `Authorization: Bearer …` on `POST /api/canvas/execute` and match `VITE_CANVAS_BRIDGE_TOKEN` in the Orca client if you use the in-app gateway controls.

**Example header on execute:**

```http
POST /api/canvas/execute
Authorization: Bearer <your-token>
Content-Type: application/json

{"tool":"canvas_list_modules","arguments":{}}
```

---

## Hermes detection in Orca UI

Hermes should send on every tool execute:

`X-Orca-External-Agent: hermes`

Then **Settings → Models → Hermes mode** can auto-lock provider UI when **Auto-lock when Hermes is detected** is on.

---

## Local CLI + gateway (in-app tile path)

If you use the **Hermes agent** tile or `hermes gateway` from Orca:

1. Install Hermes so `hermes --version` works in your shell.
2. Start `API_SERVER_ENABLED=true hermes gateway` (or use the tile’s “Start gateway” when local).
3. Align **Settings → Integrations → Hermes API** (base URL, optional key).

**Orchestrator / UI help:** tool `diagnose_hermes_setup`, or **Settings → Agent → Hermes → Run diagnose** (desktop). Full table: [hermes-orca-visual-setup.md](../../hermes-orca-visual-setup.md) troubleshooting section.

---

## Closing the loop from a shell

When a subprocess (Hermes CLI, Codex, etc.) needs to report back to the **lead orchestrator** tile, use `orca reply "…"` (see `docs/CANVAS_AGENT_BRIDGE.md`, Orchestrator reply). The bridge skill documents the same flow in **Closing the loop: `orca reply`**.

---

## Quick reference — docs map

| Goal | Read |
|------|------|
| First-time Hermes + Orca | [hermes-orca-visual-setup.md](../../hermes-orca-visual-setup.md) |
| HTTP API details | [CANVAS_AGENT_BRIDGE.md](../../CANVAS_AGENT_BRIDGE.md) |
| External orchestrator discovery | [AGENT_ORCHESTRATOR_SYNC.md](../../AGENT_ORCHESTRATOR_SYNC.md) |
| Executable skill | [orca-external-orchestrator/SKILL.md](../orca-external-orchestrator/SKILL.md) |

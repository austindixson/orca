# Agent instructions (Orca Coder)

This file helps **automated coding agents** (Cursor, Claude Code, OpenClaw, Hermes tooling, Pi, etc.) find integration entry points.

## Sync an external agent as the Orca orchestrator

1. 1. **Read:** [`docs/AGENT_ORCHESTRATOR_SYNC.md`](docs/AGENT_ORCHESTRATOR_SYNC.md) — discovery keywords and links.
2. **Execute the skill:** [`docs/skills/orca-external-orchestrator/SKILL.md`](docs/skills/orca-external-orchestrator/SKILL.md) (mirrors: `.cursor/skills/orca-external-orchestrator/SKILL.md`, `.claude/skills/orca-external-orchestrator/SKILL.md`).
3. **HTTP contract:** [`docs/CANVAS_AGENT_BRIDGE.md`](docs/CANVAS_AGENT_BRIDGE.md) — `GET /api/canvas/tools`, `POST /api/canvas/execute`, keep the Orca UI open.

## Hermes-only bridge (Option B)

- [`docs/CANVAS_AGENT_BRIDGE.md`](docs/CANVAS_AGENT_BRIDGE.md) § Option B  
- Skill: [`.cursor/skills/hermes-orca-bridge/SKILL.md`](.cursor/skills/hermes-orca-bridge/SKILL.md)  
- New-user install + paths: [`docs/skills/hermes/README.md`](docs/skills/hermes/README.md) · `npm run hermes:install-skills`
- **Setup guide (tutorials, troubleshooting, slide deck):** [`docs/hermes-orca-visual-setup.md`](docs/hermes-orca-visual-setup.md) · [`docs/slides/hermes-orca-setup.html`](docs/slides/hermes-orca-setup.html)

## Orchestrator chat persistence

- **Local:** `~/.orca/sessions/<id>/conversation.jsonl` when Orca persistence is enabled (Settings).
- **Obsidian vault (desktop):** Settings → **Agent data** → **Vault & Obsidian** — **Mirror orchestrator notes** is **on by default** (Tauri + workspace folder open). Sub-toggles cover errors (`Orca/brain/errors/`), session stubs (`Orca/brain/sessions/`), and **Mirror full orchestrator transcript** → `Orca/chat/<sessionId>.md`. If nothing appears on disk, use **Mirror now (self-test)** in that section (writes `Orca/brain/debug/self-test.md`) and check the last mirror attempts list; first write failure per session surfaces a toast.

## Proactive harness (USER.md, HEARTBEAT.md, heartbeat scheduler)

- **Doc:** [`docs/PROACTIVE_ORCA_HARNESS.md`](docs/PROACTIVE_ORCA_HARNESS.md) — file contracts, Settings → **Agent data** (user profile + proactivity), static vs dynamic prompt layers, `source: 'heartbeat'` runs, user-profile distiller vs memory distiller, **`npm run harness:eval -- --split proactive`**.
- **Quick paths:** `.orca/USER.md` and `~/.orca/USER.md` (human preferences); `.orca/HEARTBEAT.md` / `HEARTBEAT.md` / `~/.orca/HEARTBEAT.md` (proactive routines). Keep **`USER.md` separate from `MEMORY.md`** (project facts stay in MEMORY).

## Setup playbooks (Vercel, Stripe, Supabase, DNS)

- **Architecture:** [`docs/CENTRAL_BRAIN.md`](docs/CENTRAL_BRAIN.md) — central Obsidian vault + iCloud dual-write.
- **Skills (read `SKILL.md` first):** [`docs/skills/setups/deploy-vercel/`](docs/skills/setups/deploy-vercel/) · [`setup-stripe/`](docs/skills/setups/setup-stripe/) · [`setup-supabase/`](docs/skills/setups/setup-supabase/) · [`setup-domain-dns/`](docs/skills/setups/setup-domain-dns/) — mirrors: `.cursor/skills/setups/*`, `.claude/skills/setups/*`.

## Project guidance for humans

- [`orca.md`](orca.md)
- [`docs/DEVELOPER.md`](docs/DEVELOPER.md) — contributor handbook (repo layout, orchestrator, harness, tests)

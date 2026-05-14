# Orca Coder

## Context7
MCP in [`.cursor/mcp.json`](.cursor/mcp.json): `resolve-library-id`, `query-docs`. Optional: `CONTEXT7_API_KEY` (Cursor → MCP → context7). Prefer library ids, e.g. `use library /supabase/supabase`. Remote: `https://mcp.context7.com/mcp` + header.

## Orchestrator
- **Settings:** **Lead delegates only** is **on** by default (*Settings → Agent & memory → Orchestrator chat*) so the main session matches delegate-first `spawn_sub_agent` usage; turn it **off** if you want the lead to use file and terminal tools directly.
- **Plan**: non-trivial / 3+ steps / architecture → plan mode; specs upfront; sideways → re-plan, don’t push through.
- **Run**: classify simple vs complex; complex → decomposition + parallel tracks; **`spawn_sub_agent`** early per track (not one long serial pass).
- **Sub-agents**: use liberally—research, exploration, parallel analysis; **one task per sub-agent**. Same tools + **installed skills** catalog; slash skill match → **`read_file`** `SKILL.md` first, don’t improvise from blurbs.
- **Memory vs user model**: project facts → `.orca/MEMORY.md` (and distiller lessons); human preferences / style → `.orca/USER.md` or `~/.orca/USER.md`. Optional **heartbeat** (`.orca/HEARTBEAT.md`) and autonomy modes: [`docs/PROACTIVE_ORCA_HARNESS.md`](docs/PROACTIVE_ORCA_HARNESS.md).

## Habits
- Corrections → `tasks/lessons.md`; rules to avoid repeat; skim lessons when relevant.
- Done = proven (tests, logs, diff vs main if useful). Staff-engineer bar.
- Non-trivial: prefer elegance; hacky fix → redo cleanly. Skip for trivial edits.
- Bugs: fix from logs/tests/CI; minimal hand-holding.
- **Tasks**: plan in `tasks/todo.md` → verify plan → track → summarize → review in todo → lessons after corrections.
- **Principles**: smallest change / minimal files; root cause, not band-aids.

## gstack (`~/.claude/skills/gstack`)
Slash skills = `SKILL.md` playbooks; here: `/slug` + `read_file` skill. Parallel work → `spawn_sub_agent` + skill slug. Heavy browse/QA: gstack targets Claude Code CLI; **Orca** → browser + terminal tiles; full gstack flows → Claude Code (`…/gstack/browse/dist/browse` on PATH) or map to `canvas_create_tile` + terminal. Long skills: diet/partial reads; don’t dump full skills into chat. Prefer **canvas browser** tiles over generic MCP browser for URLs.

## Obsidian (`~/.claude/skills/`, [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills))
`/obsidian-markdown`, `/obsidian-bases`, `/json-canvas`, `/obsidian-cli`, `/defuddle` — in catalog; vault edits → `read_file` matching `SKILL.md` before `.md`/`.base`/`.canvas`.

## Central brain + setup playbooks
- [`docs/CENTRAL_BRAIN.md`](docs/CENTRAL_BRAIN.md) — iCloud `OrcaBrain` vault, dual-write, `search_project_wiki` / `search_central_playbooks`.
- Deploy integrations: [`docs/skills/setups/`](docs/skills/setups/) (Vercel, Stripe, Supabase, DNS) — same under `.cursor/skills/setups/` and `.claude/skills/setups/`.

## Hermes (external orchestrator)
Bridge: `docs/CANVAS_AGENT_BRIDGE.md` · install skills: `npm run hermes:install-skills` · hub `docs/skills/hermes/README.md`. Send `X-Orca-External-Agent: hermes` on `POST /api/canvas/execute` so Orca can detect Hermes (Settings → Models → Hermes mode).

## Team (optional)
`~/.claude/skills/gstack/bin/gstack-team-init optional` from repo root — keeps project instructions aligned with gstack team mode.

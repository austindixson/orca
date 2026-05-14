# Vault wiki schema (Orca LLM-wiki)

This vault uses three layers:

1. **`raw/`** — Immutable sources (clips, papers). The agent reads; it does not silently rewrite originals.
2. **`wiki/`** — Agent-maintained synthesis: `index.md`, `topics/`, `log.md`, `state.md`.
3. **`Orca/brain/`** — Optional operational mirror from Orca (errors, session stubs, telemetry) when enabled in Settings.

## Conventions

- **Index-first:** Read `wiki/index.md` before deep work; it links topic pages and `[[Orca/brain/README]]` when present.
- **Compaction:** Keep `state.md` small (rewrite often). Append short lines to `log.md`. Use Actuel/Archive sections on topic pages when they grow.
- **Citations:** Prefer footnotes or explicit source paths under `raw/`.

## Operations

| Op | Action |
|----|--------|
| Ingest | Add source to `raw/`, then update `wiki/index.md`, relevant `topics/*`, and `log.md`. |
| Query | Read index → drill into pages; use `search_project_wiki` in Orca for keyword search. |
| Lint | Check broken `[[links]]`, stale claims, orphans; file open questions in `wiki/topics/` or a `questions/` folder if you add one. |

## Orca tools

- `recall_session_history` — search past orchestrator **chat** transcripts (FTS).
- `search_project_wiki` — search **`wiki/`** and **`Orca/brain/`** markdown in the workspace.

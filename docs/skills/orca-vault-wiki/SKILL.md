---
name: orca-vault-wiki
description: LLM-wiki workflows for Obsidian vault memory in Orca — ingest sources, query the index, lint links, optional distill to wiki/state.md.
---

# Orca vault wiki (LLM-wiki + Meta-Harness principles)

Use when the workspace is an **Obsidian vault** (or contains `wiki/`) and the user wants compounding markdown memory—not one-off RAG.

## Layout (copy template)

Repo template: `docs/templates/vault-wiki/` → merge into vault root. Key paths:

- `raw/` — immutable sources
- `wiki/index.md` — **read first** (catalog)
- `wiki/log.md`, `wiki/state.md` — timeline + snapshot
- `wiki/topics/` — topic pages
- `Orca/brain/` — optional mirror from Orca (errors, sessions, telemetry) when Settings → Harness enables it

## Ingest

1. Add or reference new material under `raw/` (or clip to markdown).
2. **read_file** the source; discuss takeaways if the user is in the loop.
3. **write_file** updates: summary line in `wiki/log.md`, index lines in `wiki/index.md`, relevant `wiki/topics/*`, cross-links `[[like this]]`.
4. Keep `state.md` updated only if the user asked for a running snapshot.

## Query

1. **read_file** `wiki/index.md` (or **`search_workspace_memory`** with keywords / optional `scopes`) before deep work.
2. Drill into topic pages; cite paths in the final answer.
3. **recall_session_history** = past **chat** transcripts (FTS5 on desktop). **`search_workspace_memory`** = one pass over **`wiki/**`**, **`Orca/brain/**`**, and (optionally) **`Orca/chat/**`** markdown mirrors. **`search_project_wiki`** remains as a deprecated alias scoped to wiki + brain only.

## Lint (maintenance pass)

- Spawn a sub-agent or run in a fresh session: find broken `[[links]]`, orphan notes, stale “Actuel” lines, contradictions.
- Propose patches; do not bulk-delete without user confirmation.

## Distill (optional)

If Settings → **Suggest wiki distill** is on, the system prompt may remind you to **offer** updates to `wiki/state.md` / `wiki/log.md` after meaningful work—**never** apply without explicit user confirmation.

## Orca tools

- **`search_workspace_memory`** — unified keyword search over workspace markdown mirrors (`wiki/**`, `Orca/brain/**`, `Orca/chat/**`; path tags in results).
- `search_project_wiki` — deprecated alias → same as `scopes: ['wiki','orca_brain']`.
- `recall_session_history` — FTS over orchestrator sessions under `~/.orca/sessions` (canonical JSONL); vault `Orca/chat/*.md` is a **derived** mirror, flushed on session end / idle debounce — use `scripts/rebuild-vault-markdown.mjs` to backfill from JSONL if needed.

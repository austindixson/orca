---
name: orca-workspace-grep
description: Use the `workspace_grep` orchestrator tool to search code and text under the open workspace (ripgrep-style, gitignore-aware in the desktop app). Prefer it over opening many files or running ad-hoc shell `rg` when the model should stay in the tool contract.
license: MIT
---

# Orca workspace_grep

## When to use

- Find a **symbol**, **string literal**, **route path**, or **error message** before `read_file` on many candidates.
- **Narrow first:** set `path` to a package or `glob` to `**/*.{ts,tsx}` (or your stack) and a **low** `max_matches` on huge trees.

## Parameters (essentials)

- **`pattern`** — regex on each line (Rust regex). For literal text, set **`fixed_string: true`**.
- **`path`** — relative search root (default `.`).
- **`glob`** — workspace-relative path filter (e.g. `**/*.rs`, `packages/client/**/*.tsx`).
- **`case_insensitive`**, **`max_matches`** (default 200, cap 2000).

## Not for

- Vault / narrative memory in `wiki/`, `Orca/brain/`, `Orca/chat/` — use **`search_workspace_memory`** (or `recall_session_history` for FTS chat).
- Public web — use **`web_search`**.

## Bridge (HTTP agents)

External agents see the same tool name in `GET /api/canvas/tools` / `POST /api/canvas/execute` as the built-in orchestrator.

See also: `packages/client/src/lib/orchestrator/toolDefinitions.ts` and `packages/server/src/canvasToolsManifest.ts` (keep in sync).

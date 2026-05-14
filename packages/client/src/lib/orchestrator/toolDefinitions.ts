/**
 * Core tools (workspace + canvas) aligned with Hermes-style agent loops.
 * Execution updates canvas modules: file tools open Editor tiles and Diff tiles as configured; optional agent tile for extra logging.
 * @see https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/
 *
 * Keep in sync with `packages/server/src/canvasToolsManifest.ts` (HTTP bridge for external agents).
 *
 * NOTE: Tool names prefixed with `hermes_` are reserved for Hermes gateway server-side
 * tools surfaced via `lib/hermes/hermesServerTools.ts` when provider==='hermes'.
 * Do not define static `hermes_*` tools here — they come from runtime discovery.
 */
export const ORCHESTRATOR_TOOLS_OPENAI = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description:
        'Read a UTF-8 text file from the current workspace. Path is relative to workspace root (use forward slashes). Optional line range (`start_line`/`end_line` or `offset`+`limit`) scopes the on-canvas read highlight; omitting range uses a bounded first-chunk viewport for the animation.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path, e.g. src/main.rs' },
          start_line: {
            type: 'number',
            description: 'Optional inclusive 1-based start line for read-range metadata (pairs with end_line).',
          },
          end_line: {
            type: 'number',
            description: 'Optional inclusive 1-based end line for read-range metadata (pairs with start_line).',
          },
          offset: {
            type: 'number',
            description: 'Optional 1-based starting line (pairs with limit, or alone for a viewport from that line).',
          },
          limit: {
            type: 'number',
            description: 'Optional number of lines when using offset+limit.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description:
        'Create or overwrite a file in the workspace. Parent directories must exist or creation may fail. If a **diff** tile exists on the canvas, the first one is auto-updated with before/after for this path so the user sees changes — still create a diff tile before writing when building sites.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_file',
      description:
        'Delete a file in the workspace (relative path). Does not delete directories — remove folder contents first or use a terminal. Refreshes the Canvas Explorer tree.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to a file, e.g. old.txt or src/x.ts' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description: 'List files and folders in a workspace directory. Use "." for workspace root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory path, e.g. src or .' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'workspace_grep',
      description:
        '**Ripgrep-style search** in workspace source files. Respects `.gitignore` (Tauri) / skips `node_modules`+`.git`+`target` in web dev. Returns matching lines with paths and 1-based line numbers. **Strings / identifiers:** set `fixed_string: true` (or escape regex special chars). **Narrow scope:** set `path` to a subfolder, or `glob` to a pattern (e.g. `**/*.{ts,tsx}`) relative to the workspace. Use before mass `read_file` to locate symbols, routes, and errors. For vault / markdown memory (wiki, Orca/brain) use `search_workspace_memory` instead.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Rust/regex line pattern by default, or the literal to find when `fixed_string: true`',
          },
          path: {
            type: 'string',
            description: 'Search root, relative to workspace (default: `.` for whole workspace)',
          },
          fixed_string: {
            type: 'boolean',
            description: 'If true, treat `pattern` as a literal, not a regex (rg -F)',
          },
          case_insensitive: { type: 'boolean', description: 'Case-insensitive line match' },
          glob: {
            type: 'string',
            description: 'Only scan files whose workspace-relative path matches (e.g. `**/*.{ts,tsx}` or `src/**/*.rs`)',
          },
          max_matches: {
            type: 'number',
            description: 'Max total matches to return (default 200, max 2000) — use lower first on huge trees',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description:
        'Search the public web for technologies, competitors, patterns, or market context (DuckDuckGo instant answers). Results also appear in the **Research** tile (session journal). Use for research before spec or stack choices.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          num_results: {
            type: 'number',
            description: 'Max related snippets to include (default 5)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'open_workspace',
      description:
        'Switch the left sidebar file tree ("Canvas Explorer") to a folder on disk. Pass an absolute path. Use this when the user asks to open a project or folder in the explorer — do NOT spawn a browser tile for that; browser tiles are for web URLs only. After switching, before builds/tests/dev servers, discover lockfiles at the new root (list_directory) and run the appropriate non-interactive install (npm ci, pnpm install, cargo fetch, etc.) per system prompt.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path to the folder, e.g. /Users/you/Desktop/MyProject',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_available_port',
      description:
        'Find an available TCP port for a dev server. **Always call this before starting a dev server** (npm run dev, python -m http.server, npx serve, etc.) to avoid "port already in use" errors. Returns the first available port in the preferred range. Use the returned port in your terminal command and browser tile URL.',
      parameters: {
        type: 'object',
        properties: {
          preferred_ports: {
            type: 'array',
            items: { type: 'number' },
            description:
              'Preferred ports to try in order (default: [5173, 3000, 8080, 8000, 4000, 4173, 3001]). Returns the first available one.',
          },
          fallback_range_start: {
            type: 'number',
            description:
              'If all preferred ports are taken, scan from this port upward (default: 8100). Stops after 50 attempts.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'canvas_list_modules',
      description:
        'Return every tile (module) on the infinite canvas with id, type, geometry, title, and meta. Includes **terminal_warnings** when recent PTY output matched warning heuristics (e.g. Hermes `WARNING gateway…`). Call this before creating or moving tiles so you stay aware of all other modules.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_terminal_output',
      description:
        'Read recent lines from a **terminal** tile’s PTY output (in-memory buffer). **Read-only** — no Orca tool sends keystrokes or answers prompts (`y`/`n`, pagers, sudo). If output shows "Ok to proceed?" or similar, tell the user to type in that terminal tile **or** rerun with non-interactive flags (`npx --yes …`, `npm create … --yes`, `CI=1`, etc.). Use **tile_id** from `canvas_list_modules` (`meta.sessionId` is internal — this tool resolves it). Prefer this over `read_file` for `hermes gateway` logs — workspace files do not contain PTY output.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: { type: 'string', description: 'Canvas id of the terminal tile' },
          max_lines: {
            type: 'number',
            description: 'Max lines to return (default 400, max 2000)',
          },
        },
        required: ['tile_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_last_terminal_command',
      description:
        'Read structured state for the last **Orca-wrapped** terminal command on a tile: active run (if any), last exit code, duration, output tail, and error signature. Call **before** blindly retrying the same shell command. Uses the same `tile_id` as `canvas_list_modules`.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: { type: 'string', description: 'Canvas id of the terminal tile' },
        },
        required: ['tile_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'wait_for_terminal_command',
      description:
        'Block until the current **Orca-wrapped** terminal command finishes (OSC 133 / `__ORCA_EXIT__` markers) or `timeout_ms` elapses. Use after `canvas_update_tile` / `canvas_create_tile` sets `meta.command` when you must know exit status before continuing.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: { type: 'string', description: 'Canvas id of the terminal tile' },
          timeout_ms: {
            type: 'number',
            description: 'Max wait in ms (default 60000, max 300000)',
          },
        },
        required: ['tile_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_shell_command',
      description:
        'Run a **one-shot** shell command in the workspace via a subprocess (no PTY). **Desktop app only.** Provide non-empty `command`. Prefer this over creating a terminal tile for bounded non-interactive work (`npm ci`, `pnpm install --frozen-lockfile`, `git status`, `cargo test`, `pytest`, short builds) — it avoids PTY/session overhead. Use a **terminal** tile for long-running processes (`npm run dev`, Vite/Next dev, `--watch`, TUIs). Optional `cwd_relative` is a workspace-relative directory (e.g. `packages/app`). Commands use the same harness safety / read-only bash rules as terminal tiles.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to run (e.g. cd into workspace in-string or rely on cwd_relative)',
          },
          timeout_ms: {
            type: 'number',
            description: 'Max runtime in ms (default 120000, max 600000)',
          },
          cwd_relative: {
            type: 'string',
            description: 'Optional subdirectory of the workspace to use as cwd (must exist)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'canvas_create_tile',
      description:
        'Add a new module (tile) on the infinite canvas. Types: terminal (shell), editor (code), agent_browser (interactive browser automation surface driven by browser_open/browser_* tools), browser (legacy alias that is auto-routed to agent_browser), github (GitHub CLI research — runs real `gh` in the workspace), diff (side-by-side before/after — wired from write_file when this tile exists), todo, agent, **agent_team** (live roster / delegation hub for sub-agents), changelog (git status + push prep), **orchestrator** (extra orchestrator chat panel on the canvas — optional; the app may already show one), **benchmark** (structured benchmark / Criterion JSON viewer), **remotion** (local Remotion Studio + docs links — Remotion is the React video toolkit from remotion.dev), **openrouter_usage** (OpenRouter credit / usage viewer — if one already exists, the canvas reuses it), **toolbox** (session tool-call history + skills created via create_project_skill + recovery hints when a tool fails then succeeds), **research** (structured journal of web_search results and library-doc MCP calls — queries, summaries, citations), **reasoning** (thinking trace), **project_status** (health score + suggestions), **telemetry** (compact dev telemetry feed when the Node telemetry server is running), **hermes_bridge** (status + copy URLs for external agents driving the canvas via HTTP + WebSocket — see `docs/CANVAS_AGENT_BRIDGE.md`), **hermes_agent** (HTTP chat UI → Hermes **API server** \`POST /v1/responses\`; start **terminal** with \`API_SERVER_ENABLED=true hermes gateway\` first, then \`configure_hermes_api\`). Legacy types **telegram_onboard** / **native_gateway** may still appear on older canvases. The file explorer lives in the left sidebar; use open_workspace to change its folder. Position is optional. For **agent_browser** tiles, pass meta.url/meta.initialUrl/meta.currentUrl to auto-navigate (or call browser_open after creation). Missing URLs and placeholder example.com hosts are rejected when navigation is requested. Use the real target URL and **always call find_available_port first** for local previews instead of assuming 3000/5173/8080 are available. Never point a project preview browser tile at Orca\'s own dev origin/port (self-preview loop). For **terminal** tiles, meta.command auto-runs when the shell is ready. When building **websites**, proactively call **find_available_port**, then create **agent_browser + diff + terminal** (server command using that port) before or immediately after the first write_file so the user sees the live preview and every file change in the diff tile.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'terminal',
              'editor',
              'agent_browser',
              'browser',
              'github',
              'diff',
              'todo',
              'agent',
              'agent_team',
              'changelog',
              'orchestrator',
              'benchmark',
              'remotion',
              'openrouter_usage',
              'toolbox',
              'research',
              'reasoning',
              'project_status',
              'telemetry',
              'hermes_bridge',
              'hermes_agent',
              'telegram_onboard',
              'native_gateway',
            ],
          },
          title: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          meta: {
            type: 'object',
            description:
              'Tile-specific data. For terminal: { "command": "…" } auto-runs on connect — **commands must be non-interactive by default** (use `npx --yes`, `npm … --yes`, `CI=1`, etc.; no prompts Orca cannot answer). Prefer **command_argv** (string array) for `npx`/`npm` invocations with globby tokens (e.g. `--import-alias` `@/*`) so zsh does not expand globs before the tool sees them: `{ "command": "npx --yes create-next-app@latest .", "command_argv": ["npx","--yes","create-next-app@latest",".", "--typescript", "--tailwind", "--eslint", "--import-alias", "@/*"] }` (argv wins when both are set). If `create-next-app` targets `.` and `package.json` is missing, Orca pre-seeds a minimal `package.json` whose `name` is a lowercase npm-safe basename so folders like `OrcaPortal` do not fail npm naming rules. For agent_browser: { "url": "http://localhost:5173" } (or currentUrl/initialUrl) auto-navigates in the interactive browser session. `browser` is a legacy alias to `agent_browser`. Do not use placeholder URLs like example.com. **Browser URL rules — STRICT:** (1) For local dev servers ALWAYS use `http://localhost:<port>` — never `http://127.0.0.1:<port>` (not a secure context → breaks service workers, getUserMedia, and some OAuth redirects). (2) NEVER pass `file:///…` — local files frequently break on relative assets; if the user wants to preview a local `.html`, `cd` to its folder and run `npx serve -p <port>` in a terminal tile, then open `http://localhost:<port>`. (3) Before starting a local dev server call `find_available_port` FIRST and reuse that port in both the terminal command and the browser URL. (4) For public sites use canonical `https://` URLs. For github: { "ghArgs": "..." } auto-runs gh CLI — e.g. "repo list --limit 20 --json name,description,url" to list user repos, "search repos react --limit 5 --json name,url" to search. For editor: { "file": "src/main.rs" }. **hermes_agent** has no PTY meta — it is HTTP chat to the Hermes API server (Integrations). Hermes gateway: create a **terminal** with { "command": "API_SERVER_ENABLED=true hermes gateway" }.',
          },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'canvas_update_tile',
      description:
        'Update or remove an existing tile by id (from canvas_list_modules). Set remove true to delete the module. For terminal tiles, setting meta.command runs immediately — use **non-interactive** shell commands by default (same rules as canvas_create_tile: npx --yes, npm --yes, CI=1, etc.).',
      parameters: {
        type: 'object',
        properties: {
          tile_id: { type: 'string' },
          remove: { type: 'boolean' },
          title: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
          meta: {
            type: 'object',
            description:
              'Merge into tile meta. For terminal: { "command": "…" } runs immediately — **non-interactive** only (npx --yes, npm --yes, CI=1, etc.). Optional **command_argv** (string[]) avoids zsh glob expansion on tokens like `@/*` (same semantics as canvas_create_tile). For agent_browser/browser: set `currentUrl` or `url` to navigate (desktop app required). ALWAYS use `http://localhost:<port>` (not `127.0.0.1`, not `file://`); see canvas_create_tile docs for the full rule.',
          },
        },
        required: ['tile_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'configure_hermes_api',
      description:
        'Update **Orca app settings** for the Hermes API (`hermes_agent` tile / Responses API). Persists like the Integrations UI. Pass only fields you need to change. **Important:** Orca auto-reads `API_SERVER_KEY` from `~/.hermes/.env` when the UI key is empty, so the default fix for a stale key is `api_key: ""` — do not invent or paraphrase a secret. Set `api_key` to a literal value **only** to override the env file. Use `api_base_url` / `model` for custom gateways.',
      parameters: {
        type: 'object',
        properties: {
          api_key: {
            type: 'string',
            description:
              'Bearer token override. Empty string `""` clears the UI key so Orca falls back to `~/.hermes/.env` (preferred). Provide a literal value only when intentionally overriding the env file.',
          },
          api_base_url: {
            type: 'string',
            description:
              'OpenAI-compatible base (e.g. http://127.0.0.1:8642/v1). Normalized to end with /v1.',
          },
          model: {
            type: 'string',
            description: 'Hermes model id for Responses (e.g. hermes-agent).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'diagnose_hermes_setup',
      description:
        '**Hermes troubleshooting helper.** Runs `hermes --version` (desktop app) to detect whether the Hermes CLI is installed, optionally probes the saved Hermes API base URL (`GET /models`), and returns markdown with next steps: install Hermes from NousResearch, start `hermes gateway`, fix Integrations settings, or **disable the Hermes agent tile** in Settings → Agent if the user enabled it by mistake. Use when the user sees Hermes gateway errors, "command not found", or unreachable API with Hermes features on.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_project_skill',
      description:
        'Install a **task-specific Agent Skill** in this workspace as `SKILL.md` (Cursor / Claude Code style) so future runs and `/skill-name` prompts can reuse the workflow. Use after you discover non-obvious repo conventions, a repeatable procedure, or constraints the team should follow. Writes under `.cursor/skills/<slug>/` and/or `.claude/skills/<slug>/`. Prefer short `description` (when to apply) and concrete `body_markdown` (steps, file paths, commands).',
      parameters: {
        type: 'object',
        properties: {
          skill_slug: {
            type: 'string',
            description:
              'Folder name / slash command id: lowercase letters, digits, dots, underscores, hyphens (e.g. orca-orchestrator-release).',
          },
          description: {
            type: 'string',
            description:
              'One-line YAML description: when this skill should be used (shown to agents; keep under ~400 chars).',
          },
          body_markdown: {
            type: 'string',
            description:
              'Main skill body in Markdown: numbered steps, conventions, pitfalls, example commands — no YAML here.',
          },
          title: {
            type: 'string',
            description: 'Optional H1 title; defaults to a humanized skill_slug.',
          },
          version: {
            type: 'string',
            description: 'Semver for the skill file (default 1.0.0).',
          },
          install_target: {
            type: 'string',
            enum: ['cursor', 'claude', 'both'],
            description:
              '`cursor` = .cursor/skills only (default). `claude` = .claude/skills only. `both` = write both copies.',
          },
        },
        required: ['skill_slug', 'description', 'body_markdown'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'memory',
      description:
        'Persist durable memory under `~/.orca/`. Hermes-compatible shape: `target="memory"` writes `~/.orca/MEMORY.md`; `target="user"` writes `~/.orca/USER.md`. Actions: `add` appends, `replace` swaps first matching `old_text`, `remove` deletes first matching `old_text`. Trigger this for stable user preferences/corrections/environment facts that reduce future steering; do not log transient task progress. Desktop/Tauri only.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'replace', 'remove'],
            description: 'Mutation action to apply to the selected memory target.',
          },
          target: {
            type: 'string',
            enum: ['memory', 'user'],
            description: '`memory` => ~/.orca/MEMORY.md, `user` => ~/.orca/USER.md',
          },
          content: {
            type: 'string',
            description: 'Entry text for add/replace.',
          },
          old_text: {
            type: 'string',
            description: 'Substring to find for replace/remove.',
          },
        },
        required: ['action', 'target'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'session_search',
      description:
        'Hermes-compatible recall search. With `query`, searches persisted orchestrator chat transcripts (FTS5 on desktop). Without `query`, returns a lightweight browse view of resumable recent sessions when available. Use this proactively when the user references prior sessions (“last time”, “as we discussed”, “continue from before”) before asking them to restate context. Alias-friendly wrapper around `recall_session_history` semantics.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional search query. Omit to browse resumable recent sessions.',
          },
          role_filter: {
            type: 'string',
            description:
              'Optional hint (`user`, `assistant`, etc.). Currently informational only; transcript role filtering is not indexed separately.',
          },
          limit: {
            type: 'number',
            description: 'Max sessions / hits to return (default 5, max 20).',
          },
          session_id: {
            type: 'string',
            description: 'Optional session id scope when `query` is provided.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'recall_session_history',
      description:
        'Search persisted **orchestrator chat** transcripts on disk. Uses SQLite **FTS5** BM25 relevance (+ slight recency boost) when Orca runs in **Tauri** with persistence enabled; **web-only dev** has no session index — results may be empty there. For **project wiki / vault markdown** (`wiki/`, `Orca/brain/**`, `Orca/chat/**`), use `search_workspace_memory` (or deprecated `search_project_wiki`). Optional `session_id` scopes hits to one `~/.orca/sessions/<id>/` folder.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (keywords)' },
          session_id: {
            type: 'string',
            description: 'Optional session id folder under ~/.orca/sessions/. Omit to search all indexed sessions.',
          },
          max_results: { type: 'number', description: 'Max hits (default 5, max 20)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_workspace_memory',
      description:
        'Keyword-search markdown under **wiki/**, **Orca/brain/**, and **Orca/chat/** in the current workspace (vault mirrors). Optional `scopes` limits which roots to scan (`wiki`, `orca_brain`, `orca_chat`); default = all three. When **Central brain** is enabled (desktop), also searches the iCloud central vault for cross-project memory (`central:…` paths in results). For raw past **chat** transcripts (FTS), use `recall_session_history`.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive substring to find in file bodies' },
          max_results: { type: 'number', description: 'Max matching files (default 24, max 48)' },
          scopes: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['wiki', 'orca_brain', 'orca_chat'],
            },
            description:
              'Optional subset of vault areas to search. Omit to search wiki + Orca/brain + Orca/chat.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_project_wiki',
      description:
        '**Deprecated** — use `search_workspace_memory` with `scopes: ["wiki","orca_brain"]` (same behavior). Keyword-search markdown under **wiki/** and **Orca/brain/**. When **Central brain** is enabled (desktop), also searches the iCloud central vault (`central:…` paths).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive substring to find in file bodies' },
          max_results: { type: 'number', description: 'Max matching files (default 24, max 48)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_central_playbooks',
      description:
        'Search **playbooks/** in the central Obsidian vault (Vercel, Stripe, Supabase, DNS setup notes — no secrets, references only). Use for repeatable deploy/setup memory across projects. Requires Tauri + Central brain.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive substring to find in playbook bodies' },
          max_results: { type: 'number', description: 'Max matching files (default 24, max 48)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'record_benchmark_session',
      description:
        'After **cargo bench**, Criterion, or any benchmark run, call this with JSON results. Writes `.agent-canvas/benchmarks/latest.json` + a simple HTML report, opens a **benchmark** tile, and optionally a **browser** tile (Remotion docs) and/or **remotion** tile (Studio iframe). Pair with **visual explainer** skill assets in `docs/skills/visual-explainer` for richer HTML. Remotion reference: https://github.com/remotion-dev/remotion',
      parameters: {
        type: 'object',
        properties: {
          results_json: {
            type: 'string',
            description: 'Stringified JSON (Criterion summary, custom metrics array, etc.).',
          },
          title: { type: 'string', description: 'Benchmark tile title.' },
          summary: { type: 'string', description: 'One-line human summary for the tile + HTML report.' },
          open_docs_browser_tile: {
            type: 'boolean',
            description: 'If true, add a browser tile on remotion.dev/docs (programmatic video reference).',
          },
          open_remotion_tile: {
            type: 'boolean',
            description: 'If true, add a remotion tile pointing at http://localhost:3000 (run `npx remotion studio` in terminal first).',
          },
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['results_json'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'spawn_sub_agent',
      description:
        'Delegate work to a **parallel sub-agent**. Any orchestrator or sub-agent may spawn more workers (subject to max concurrency): **5** concurrent for non‑Z.AI; **2–8** for Z.AI by plan tier in Settings. One call starts one delegated worker. Default workers are tracked in Agent team + group chat and may keep worker tiles hidden for lower GPU load; Hermes workers (`runner:"hermes"`) remain visible. Split big goals into **3–5 narrow SIMPLE** workers when possible so **OpenRouter/free** can run them; reserve premium models for rare **complex** tracks. Name specialists clearly: **Mei**-style (coding/build/CI), **Sora**-style (research/compare), **Hana**-style (docs/content), **Hermes** (`runner:"hermes"`). With **Z.AI**, chat/completions share a **concurrency limit** app-wide. **Agent team** tile opens automatically. Sub-agents get the same **skills** catalog. On finish, handoffs merge into the orchestrator session. Avoid conflicting edits.',
      parameters: {
        type: 'object',
        properties: {
          display_name: {
            type: 'string',
            description:
              'Tile + roster label. Prefer specialist names: e.g. "Mei — deps scan" (coding/build), "Sora — CI research" (research/compare), "Hana — README polish" (docs/content), "Hermes" (Hermes gateway). Defaults to "Hermes" when runner="hermes" and this is omitted.',
          },
          role: {
            type: 'string',
            description:
              'One-line hat: coding/build/CI (Mei-style), research/investigate (Sora-style), docs/content (Hana-style), or Hermes (local Hermes API server).',
          },
          task: {
            type: 'string',
            description: 'Concrete instructions for this sub-agent only.',
          },
          x: { type: 'number', description: 'Optional canvas x (world space).' },
          y: { type: 'number', description: 'Optional canvas y (world space).' },
          linked_task_text: {
            type: 'string',
            description:
              "Optional: exact or substring match to a **Tasks** list item. While this sub-agent runs, that task shows as in progress with this worker's display name on the badge.",
          },
          task_complexity: {
            type: 'string',
            enum: ['auto', 'simple', 'complex'],
            description:
              'Required when following a decomposition block: copy **simple** or **complex** from that row — **simple** routes to OpenRouter **openrouter/free** (saves Z.AI GLM quota). **auto**: app heuristics (prefers free for short tooling tasks). **complex**: orchestrator-class model (big refactors, security architecture, deep research). Ignored when runner="hermes".',
          },
          runner: {
            type: 'string',
            enum: ['default', 'hermes'],
            description:
              'Which runtime should host this sub-agent. **default** (omit) uses the standard provider/model heuristics (Mei/Sora/Hana workers). **hermes** forces the sub-agent to run on the local **Hermes gateway** (`http://127.0.0.1:8642/v1`) — use when the user names "Hermes" or asks to have the Hermes agent do a task. The sub-agent still has the full Orca tool set (read/write_file, terminal, browser, spawn_sub_agent, …) **plus** the Hermes server-side tools (hermes_kb_search / hermes_web_search / hermes_skill). Requires the Hermes gateway to be reachable — no free-router fallback on probe failure.',
          },
        },
        required: ['task'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'post_team_message',
      description:
        'Post a progress / question / handoff note to the **Agent Group Chat** (`#all` channel for this session). Tag individuals with `@<displayName>` or `@<tile_id>`, or broadcast with `@all`. Use for coordination, blockers, and handoffs.',
      parameters: {
        type: 'object',
        properties: {
          body: {
            type: 'string',
            description:
              'Message text. Include `@all` or `@<displayName|tile_id>` for notifications. Keep it short and actionable.',
          },
          to: {
            type: 'string',
            description:
              'Optional single recipient: agent tile_id OR displayName. Adds an explicit `@<to>` tag so the recipient sees a highlighted notification.',
          },
          kind: {
            type: 'string',
            enum: ['say', 'ask', 'ack', 'update', 'handoff', 'blocker', 'result'],
            description:
              'Optional structured intent. `ask` = question awaiting reply, `ack` = acknowledgement, `update` = status/progress, `handoff` = ownership transfer, `blocker` = I am stuck, `result` = terminal finding. Directive kinds (`ask`, `ack`, `handoff`, `blocker`, `result`) are auto-delivered to every teammate\'s inbox on next turn even without an explicit `@mention`. Defaults to `say`.',
          },
          correlation_id: {
            type: 'string',
            description:
              'Optional free-form tag to correlate messages across threads (e.g. a task id). Returned by `poll_team_messages` so you can group related work.',
          },
        },
        required: ['body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'poll_team_messages',
      description:
        'Fetch team-chat history for the current session. By default sub-agents automatically receive unseen `@mentions` and directive messages (`ask`, `ack`, `handoff`, `blocker`, `result`) as an inbox injection on every LLM turn — call this tool only when you need **older** history, a specific **thread**, or to deliberately scan for `say`/`update` chatter you were not mentioned in. Returns messages in ascending `seq` order.',
      parameters: {
        type: 'object',
        properties: {
          since_seq: {
            type: 'number',
            description:
              'Return messages with `seq > since_seq`. Omit (or use 0) to fetch from the beginning of the session.',
          },
          thread_id: {
            type: 'string',
            description:
              'Optional: restrict to a single thread (messages sharing this `thread_id`, typically the id of the first message in the thread).',
          },
          limit: {
            type: 'number',
            description:
              'Max messages to return (default 50, max 200).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'reply_to_team_message',
      description:
        'Reply to a specific team-chat message. Automatically threads the reply (inherits `thread_id` + `correlation_id` from the parent) and routes notifications to the parent\'s sender. Use `kind:"ack"` to acknowledge, `"blocker"` to flag you are stuck, `"result"` to deliver a terminal finding, or `"say"` for free-form conversation.',
      parameters: {
        type: 'object',
        properties: {
          reply_to: {
            type: 'string',
            description:
              'The `id` of the message you are replying to (e.g. from `poll_team_messages` or the inbox injection `<msg_id=...>` tag).',
          },
          body: {
            type: 'string',
            description: 'Reply text. Supports `@mentions` for additional routing.',
          },
          kind: {
            type: 'string',
            enum: ['say', 'ask', 'ack', 'update', 'handoff', 'blocker', 'result'],
            description:
              'Structured reply intent. Defaults to `ack` when replying to an `ask`, otherwise `say`.',
          },
        },
        required: ['reply_to', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'chat_with_hermes_tile',
      description:
        'Send a prompt to the **visible Hermes HTTP chat** (`hermes_agent` tile). The tile auto-sends over `POST /v1/responses` and posts a **sub-agent handoff** when the reply finishes (same resume path as `spawn_sub_agent`). Use when the user should **see** Hermes’ streaming chat on the canvas. For **headless** Hermes with the full Orca tool loop pinned to the Hermes gateway, use `spawn_sub_agent` with `runner:"hermes"` instead.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'User-visible instruction sent as the next Hermes chat message.',
          },
          display_name: {
            type: 'string',
            description: 'Tile title / roster label (default "Hermes").',
          },
          tile_id: {
            type: 'string',
            description:
              'Optional: reuse an existing `hermes_agent` tile. When omitted, a new tile is created.',
          },
          reuse: {
            type: 'boolean',
            description:
              'When `tile_id` is set, defaults to true (update that tile). Set false to always spawn a new Hermes tile.',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'wait_for_sub_agent',
      description:
        "Block until a sub-agent you spawned finishes, then receive its **handoff summary** as the tool result — a true synchronous await over the default fire-and-forget `spawn_sub_agent`. Use when you need the worker's output as direct input for your **next** step (e.g. Hermes worker spawns a Hermes helper to fetch KB context, then waits for the summary before writing the final answer). For independent parallel work (\"spawn 3 helpers and continue\"), **do not** call this — just let handoffs stream into your log. Returns `{ outcome: 'done' | 'error' | 'cancelled' | 'timeout', summary?: string, error?: string }`. If the sub-agent is already finished when you call, returns immediately.",
      parameters: {
        type: 'object',
        properties: {
          tile_id: {
            type: 'string',
            description:
              'The tile id of the sub-agent to wait for — exactly the `tile_id` returned by your earlier `spawn_sub_agent` call. Waiting on a tile you did not spawn (or one that never existed) is an error.',
          },
          timeout_ms: {
            type: 'number',
            description:
              'Optional upper bound in milliseconds (default 600000 = 10 min, max 1800000 = 30 min). When the timeout elapses the tool returns `outcome:"timeout"` — the sub-agent keeps running and may still post a handoff to your log later.',
          },
        },
        required: ['tile_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_codebase_graph',
      description:
        'Read `GRAPH_REPORT.md` from the workspace root when present (from the graphify tool or similar). Use for high-level “god nodes” and module relationships before deep file walks. If the file is missing, the response explains how to generate it.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Optional: what you are trying to find — echoed for context; report is file-based.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetch_dev_telemetry_snapshot',
      description:
        'Fetch dev telemetry health + recent orchestrator events (requires `npm run dev:telemetry:node` or a reachable telemetry API). Call periodically on long runs to monitor model/tool activity.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max recent events (default 30, max 80)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_merge_review_tickets',
      description:
        'List merge-review tickets queued after sub-agents finish (id, agent tile, status, notes preview). Users approve/reject in the Agents sidebar. Call to see what still needs human sign-off.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  /**
   * Hermes server-side tools — calls the local Hermes gateway at
   * `POST /v1/tools/{name}/invoke`. The dispatcher returns a structured error
   * when the gateway is unreachable (so the orchestrator can fall back
   * gracefully), but when it is running these give the orchestrator
   * first-class access to Hermes' knowledge base, web search, and skill
   * execution from any lead profile.
   */
  {
    type: 'function' as const,
    function: {
      name: 'hermes_kb_search',
      description:
        "Search Hermes' knowledge base over the local `hermes gateway`. Use when the user references Hermes-indexed docs, skills, or prior KB content and a direct KB lookup is cheaper than a web search. Returns the raw gateway payload (JSON) — let the orchestrator summarise.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language KB query.' },
          top_k: { type: 'number', description: 'Optional max results (default: server-chosen).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'hermes_web_search',
      description:
        "Hermes-hosted web search (routed through the local `hermes gateway`). Prefer the top-level `web_search` unless the user explicitly asked for Hermes' browsing provider or the orchestrator is in Hermes lead mode.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'number', description: 'Optional cap (1–10).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'hermes_skill',
      description:
        "Execute a Hermes skill by name via the gateway. Skills are server-side procedures configured under `~/.hermes/skills/…`. `input` is passed verbatim as the skill's JSON argument.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name, e.g. `summarize-repo`.' },
          input: {
            type: 'object',
            description: "Skill-specific JSON args (leave empty when the skill takes none).",
          },
        },
        required: ['name'],
      },
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // Agent Browser automation tools (Vercel agent-browser integration)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    type: 'function' as const,
    function: {
      name: 'browser_open',
      description:
        'Open a URL in the agent browser tile with visible cursor tracking. Creates tile if needed. Returns accessibility snapshot with refs for subsequent interactions. Pass the returned tile_id to other browser_* tools when more than one agent_browser tile exists. Use for web testing, form filling, scraping, or any browser automation task.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
          tile_id: {
            type: 'string',
            description: 'Optional existing agent_browser tile ID to reuse',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_snapshot',
      description:
        'Get accessibility tree with refs (@e1, @e2...) for the current page. Use refs in subsequent browser_click/browser_fill calls. The snapshot shows interactive elements the agent can target.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: {
            type: 'string',
            description:
              'agent_browser tile id (from browser_open). Required when multiple agent_browser tiles exist.',
          },
          interactive_only: {
            type: 'boolean',
            description: 'Only show interactive elements (buttons, inputs, links). Default true.',
          },
          compact: {
            type: 'boolean',
            description: 'Remove empty structural elements. Default true.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_click',
      description:
        'Click an element by ref (from snapshot) or CSS selector. The visible cursor animates to the target before clicking. Returns updated snapshot after click.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: {
            type: 'string',
            description:
              'agent_browser tile id (from browser_open). Required when multiple agent_browser tiles exist.',
          },
          selector: {
            type: 'string',
            description: 'Element ref like @e1 (from snapshot) or CSS selector',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_fill',
      description:
        'Clear and fill a text input by ref or selector. The visible cursor moves to the input field before typing.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: {
            type: 'string',
            description:
              'agent_browser tile id (from browser_open). Required when multiple agent_browser tiles exist.',
          },
          selector: {
            type: 'string',
            description: 'Element ref like @e1 (from snapshot) or CSS selector',
          },
          text: { type: 'string', description: 'Text to fill into the input' },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_press',
      description:
        'Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.) in the browser.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: {
            type: 'string',
            description:
              'agent_browser tile id (from browser_open). Required when multiple agent_browser tiles exist.',
          },
          key: {
            type: 'string',
            description: 'Key name: Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, etc.',
          },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_screenshot',
      description:
        'Take a screenshot of the current page, optionally annotated with numbered element labels for visual reference.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: {
            type: 'string',
            description:
              'agent_browser tile id (from browser_open). Required when multiple agent_browser tiles exist.',
          },
          annotate: {
            type: 'boolean',
            description: 'Overlay numbered labels on interactive elements. Default false.',
          },
          path: {
            type: 'string',
            description: 'Optional workspace-relative path to save screenshot',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_scroll',
      description: 'Scroll the page in a direction by a pixel amount.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: {
            type: 'string',
            description:
              'agent_browser tile id (from browser_open). Required when multiple agent_browser tiles exist.',
          },
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Scroll direction',
          },
          pixels: {
            type: 'number',
            description: 'Pixels to scroll (default 500)',
          },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_wait',
      description:
        'Wait for an element to appear or a condition to be met before continuing.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: {
            type: 'string',
            description:
              'agent_browser tile id (from browser_open). Required when multiple agent_browser tiles exist.',
          },
          selector: {
            type: 'string',
            description: 'Element ref or CSS selector to wait for',
          },
          timeout_ms: {
            type: 'number',
            description: 'Max wait time in milliseconds (default 5000)',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_get_text',
      description: 'Extract the text content from an element by ref or selector.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: {
            type: 'string',
            description:
              'agent_browser tile id (from browser_open). Required when multiple agent_browser tiles exist.',
          },
          selector: {
            type: 'string',
            description: 'Element ref like @e1 (from snapshot) or CSS selector',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_close',
      description: 'Close the agent browser session and tile.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: {
            type: 'string',
            description:
              'agent_browser tile to close. Required when multiple agent_browser tiles exist; optional when only one.',
          },
        },
        required: [],
      },
    },
  },
]

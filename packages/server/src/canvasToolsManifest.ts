/**
 * OpenAI-style tool manifest for GET /api/canvas/tools — keep in sync with
 * packages/client/src/lib/orchestrator/toolDefinitions.ts
 */
export const CANVAS_AGENT_TOOLS_MANIFEST = {
  name: 'agent-canvas',
  version: '0.1.0',
  description:
    'Hermes / OpenClaude–compatible canvas + workspace tools. Same contract as the built-in orchestrator.',
  tools: [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          'Read a UTF-8 text file from the workspace (relative path). Executed in the connected Orca Coder app. Optional start_line/end_line or offset/limit for read-range metadata.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            start_line: { type: 'number' },
            end_line: { type: 'number' },
            offset: { type: 'number' },
            limit: { type: 'number' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description:
          'Create or overwrite a file. If a diff tile is on the canvas, the first one auto-updates with before/after — create diff + browser + terminal when building websites.',
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
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a workspace file by relative path. Refreshes the explorer.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List files and folders. Use "." for workspace root.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'workspace_grep',
        description:
          'Ripgrep-style line search in the workspace. Respects .gitignore in the desktop app. Use `fixed_string: true` for literal text; `glob` to limit file types. For vault markdown use `search_workspace_memory` instead.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string' },
            fixed_string: { type: 'boolean' },
            case_insensitive: { type: 'boolean' },
            glob: { type: 'string' },
            max_matches: { type: 'number' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Search the public web (DuckDuckGo instant answers). Use for research before spec or stack choices.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            num_results: { type: 'number' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'open_workspace',
        description:
          'Switch the left sidebar explorer to a folder (absolute path). Do not use a browser tile for this.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'canvas_list_modules',
        description:
          'List every tile on the infinite canvas (ids, types, layout, meta). Response may include terminal_warnings from recent PTY output (e.g. Hermes gateway). Call before multi-tile changes.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_terminal_output',
        description:
          'Read recent PTY lines from a terminal tile (tile_id from canvas_list_modules). Read-only — cannot send input; prefer non-interactive terminal commands. Use for Hermes gateway logs — not available via read_file.',
        parameters: {
          type: 'object',
          properties: {
            tile_id: { type: 'string' },
            max_lines: { type: 'number' },
          },
          required: ['tile_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_last_terminal_command',
        description:
          'Read structured state for the last Orca-wrapped command on a terminal tile: exit code, duration, error signature, output tail. Prefer over blind retries after failures.',
        parameters: {
          type: 'object',
          properties: {
            tile_id: { type: 'string' },
          },
          required: ['tile_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'wait_for_terminal_command',
        description:
          'Block until the active terminal command completes or timeout_ms elapses. Returns completion record or active command snapshot — use before assuming a long-running shell finished.',
        parameters: {
          type: 'object',
          properties: {
            tile_id: { type: 'string' },
            timeout_ms: { type: 'number' },
          },
          required: ['tile_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_shell_command',
        description:
          'One-shot shell in the workspace via subprocess (no PTY). Desktop Orca only. Requires non-empty `command`. Prefer for npm ci, tests, git status; use terminal tiles for dev servers and watch mode.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            timeout_ms: { type: 'number' },
            cwd_relative: { type: 'string' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'canvas_create_tile',
        description:
          'Spawn a tile: terminal | editor | browser | diff | todo | agent | agent_team | changelog | orchestrator | benchmark | remotion | openrouter_usage | toolbox | inspect | research | reasoning | project_status | telemetry | hermes_bridge | hermes_agent | telegram_onboard | native_gateway (legacy). Websites: create diff + browser (meta.url) + terminal (meta.command) before writing files. **Terminal meta.command must be non-interactive by default** (npx --yes, npm --yes, CI=1, etc. — no prompts). hermes_bridge: external agent ↔ Orca HTTP bridge (see docs/CANVAS_AGENT_BRIDGE.md). hermes_agent: Hermes POST /v1/responses — first add terminal with command API_SERVER_ENABLED=true hermes gateway unless gateway already runs.',
        parameters: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: [
                'terminal',
                'editor',
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
                'inspect',
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
                'terminal: { command } — non-interactive shell only (npx --yes, npm --yes, CI=1); Hermes: API_SERVER_ENABLED=true hermes gateway; browser: { url }; editor: { file }; diff: optional { original, modified, path } (usually filled by write_file); hermes_agent: optional { conversation } for Hermes Responses API session name',
            },
          },
          required: ['type'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'canvas_update_tile',
        description:
          'Update or remove a tile by id (from canvas_list_modules). meta merges: terminal command runs (non-interactive only); browser url updates iframe.',
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
            meta: { type: 'object' },
          },
          required: ['tile_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'configure_hermes_api',
        description:
          'Persist Hermes API settings in Orca (same as Settings → Integrations): api_key (Hermes API_SERVER_KEY), optional api_base_url, model. At least one field required.',
        parameters: {
          type: 'object',
          properties: {
            api_key: { type: 'string' },
            api_base_url: { type: 'string' },
            model: { type: 'string' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_project_skill',
        description:
          'Write a task-specific SKILL.md under .cursor/skills and/or .claude/skills for repeatable workflows; enables future /skill-slug prompts.',
        parameters: {
          type: 'object',
          properties: {
            skill_slug: { type: 'string' },
            description: { type: 'string' },
            body_markdown: { type: 'string' },
            title: { type: 'string' },
            version: { type: 'string' },
            install_target: { type: 'string', enum: ['cursor', 'claude', 'both'] },
          },
          required: ['skill_slug', 'description', 'body_markdown'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'record_benchmark_session',
        description:
          'Ingest benchmark JSON; writes reports under .agent-canvas/benchmarks/ and opens benchmark / optional browser + remotion tiles.',
        parameters: {
          type: 'object',
          properties: {
            results_json: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            open_docs_browser_tile: { type: 'boolean' },
            open_remotion_tile: { type: 'boolean' },
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['results_json'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_project_wiki',
        description:
          'Keyword-search markdown under wiki/ and Orca/brain/ in the workspace vault. For raw chat transcripts use recall_session_history.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            max_results: { type: 'number' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spawn_sub_agent',
        description:
          'Delegate work to a **parallel sub-agent**. Any orchestrator or sub-agent may spawn more workers (subject to max concurrency): **5** concurrent for non‑Z.AI; **2–8** for Z.AI by plan tier in Settings. One call ⇒ one new agent tile. Split big goals into **3–5 narrow SIMPLE** workers when possible so **OpenRouter/free** can run them; reserve premium models for rare **complex** tracks. Name specialists clearly: **Mei**-style (coding/build/CI), **Sora**-style (research/compare), **Hana**-style (docs/content), **Hermes** (`runner:"hermes"`). With **Z.AI**, chat/completions share a **concurrency limit** app-wide. **Agent team** tile opens automatically. Sub-agents get the same **skills** catalog. On finish, handoffs merge into the orchestrator session. Avoid conflicting edits.',
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
                'Which runtime should host this sub-agent. **default** (omit) uses the standard provider/model heuristics (Mei/Sora/Hana workers). **hermes** forces the sub-agent to run on the local **Hermes gateway** (`http://127.0.0.1:8642/v1`).',
            },
          },
          required: ['task'],
        },
      },
    },
    {
      type: 'function',
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
                'Optional structured intent. `ask` = question awaiting reply, `ack` = acknowledgement, `update` = status/progress, `handoff` = ownership transfer, `blocker` = I am stuck, `result` = terminal finding. Directive kinds (`ask`, `ack`, `handoff`, `blocker`, `result`) are auto-delivered to every registered sub-agent\'s inbox on next turn even without an explicit `@mention`. Defaults to `say`.',
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
      type: 'function',
      function: {
        name: 'poll_team_messages',
        description:
          'Fetch group-chat history for the current session. By default sub-agents automatically receive unseen `@mentions` and directive messages (`ask`, `ack`, `handoff`, `blocker`, `result`) as an inbox injection on every LLM turn — call this tool only when you need **older** history, a specific **thread**, or to deliberately scan for `say`/`update` chatter you were not mentioned in. Returns messages in ascending `seq` order.',
        parameters: {
          type: 'object',
          properties: {
            since_seq: { type: 'number', description: 'Return messages with seq > since_seq (0 = from start).' },
            thread_id: { type: 'string', description: 'Optional: restrict to a single thread.' },
            limit: { type: 'number', description: 'Max messages (default 50, max 200).' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'reply_to_team_message',
        description:
          'Reply to a specific team-chat message. Auto-threads via parent\'s thread_id + correlation_id.',
        parameters: {
          type: 'object',
          properties: {
            reply_to: { type: 'string', description: 'The id of the message being replied to.' },
            body: { type: 'string', description: 'Reply text. Supports @mentions.' },
            kind: {
              type: 'string',
              enum: ['say', 'ask', 'ack', 'update', 'handoff', 'blocker', 'result'],
              description: 'Structured reply intent. Defaults to ack when replying to an ask.',
            },
          },
          required: ['reply_to', 'body'],
        },
      },
    },
    // ─────────────────────────────────────────────────────────────────────────────
    // Agent Browser automation tools (Vercel agent-browser integration)
    // ─────────────────────────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'browser_open',
        description:
          'Open a URL in the agent browser tile with visible cursor tracking. Creates tile if needed. Returns accessibility snapshot with refs for subsequent interactions.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to navigate to' },
            tile_id: { type: 'string', description: 'Optional existing agent_browser tile ID' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_snapshot',
        description:
          'Get accessibility tree with refs (@e1, @e2...) for the current page. Use refs in subsequent browser_click/browser_fill calls.',
        parameters: {
          type: 'object',
          properties: {
            tile_id: {
              type: 'string',
              description:
                'agent_browser tile id from browser_open. Required when multiple agent_browser tiles exist.',
            },
            interactive_only: { type: 'boolean', description: 'Only show interactive elements. Default true.' },
            compact: { type: 'boolean', description: 'Remove empty structural elements. Default true.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_click',
        description: 'Click an element by ref (from snapshot) or CSS selector. Returns updated snapshot.',
        parameters: {
          type: 'object',
          properties: {
            tile_id: {
              type: 'string',
              description:
                'agent_browser tile id from browser_open. Required when multiple agent_browser tiles exist.',
            },
            selector: { type: 'string', description: 'Element ref like @e1 or CSS selector' },
          },
          required: ['selector'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_fill',
        description: 'Clear and fill a text input by ref or selector.',
        parameters: {
          type: 'object',
          properties: {
            tile_id: {
              type: 'string',
              description:
                'agent_browser tile id from browser_open. Required when multiple agent_browser tiles exist.',
            },
            selector: { type: 'string', description: 'Element ref like @e1 or CSS selector' },
            text: { type: 'string', description: 'Text to fill into the input' },
          },
          required: ['selector', 'text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_press',
        description: 'Press a keyboard key (Enter, Tab, Escape, etc.).',
        parameters: {
          type: 'object',
          properties: {
            tile_id: {
              type: 'string',
              description:
                'agent_browser tile id from browser_open. Required when multiple agent_browser tiles exist.',
            },
            key: { type: 'string', description: 'Key name: Enter, Tab, Escape, Backspace, ArrowUp, etc.' },
          },
          required: ['key'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_screenshot',
        description: 'Take a screenshot, optionally annotated with numbered element labels.',
        parameters: {
          type: 'object',
          properties: {
            tile_id: {
              type: 'string',
              description:
                'agent_browser tile id from browser_open. Required when multiple agent_browser tiles exist.',
            },
            annotate: { type: 'boolean', description: 'Overlay numbered labels on interactive elements.' },
            path: { type: 'string', description: 'Optional workspace-relative save path.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll',
        description: 'Scroll the page in a direction.',
        parameters: {
          type: 'object',
          properties: {
            tile_id: {
              type: 'string',
              description:
                'agent_browser tile id from browser_open. Required when multiple agent_browser tiles exist.',
            },
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
            pixels: { type: 'number', description: 'Pixels to scroll (default 500)' },
          },
          required: ['direction'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_wait',
        description: 'Wait for an element to appear before continuing.',
        parameters: {
          type: 'object',
          properties: {
            tile_id: {
              type: 'string',
              description:
                'agent_browser tile id from browser_open. Required when multiple agent_browser tiles exist.',
            },
            selector: { type: 'string', description: 'Element ref or CSS selector to wait for' },
            timeout_ms: { type: 'number', description: 'Max wait time in milliseconds (default 5000)' },
          },
          required: ['selector'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_text',
        description: 'Extract the text content from an element.',
        parameters: {
          type: 'object',
          properties: {
            tile_id: {
              type: 'string',
              description:
                'agent_browser tile id from browser_open. Required when multiple agent_browser tiles exist.',
            },
            selector: { type: 'string', description: 'Element ref like @e1 or CSS selector' },
          },
          required: ['selector'],
        },
      },
    },
    {
      type: 'function',
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
  ],
}

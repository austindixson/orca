# Agent Browser Automation

Browser automation for AI agents using Vercel's agent-browser. Provides visible cursor
tracking so users can watch the agent navigate, click, and fill forms in real-time.

## When to Use

Invoke browser automation tools when:
- User asks to "test the site", "check the page", "fill out a form", "login to X"
- User asks to "scrape", "extract data from", or "read content from" a webpage
- Task requires interacting with a web UI (clicking buttons, submitting forms)
- User says "open in browser", "navigate to", "go to URL"
- E2E testing, QA verification, or user flow validation
- User asks to "screenshot the page" or "show me what it looks like"
- Debugging a deployed site or verifying a feature works
- Automating repetitive web tasks (filling forms, downloading files)

## When NOT to Use

Do not use browser tools when:
- Reading local files (use `read_file` instead)
- The URL is already open in a BrowserTile (passive iframe) - use agent_browser for automation
- Simple curl/fetch would suffice (prefer `web_search` for quick lookups)
- User just wants to preview localhost (use existing `browser` tile for passive preview)

## Core Workflow

1. **Navigate**: `browser_open` to go to URL (creates tile if needed, returns snapshot)
2. **Understand**: Parse the accessibility snapshot - refs like `@e1`, `@e2` identify elements
3. **Interact**: Use `browser_click`, `browser_fill`, `browser_press` with refs
4. **Verify**: Call `browser_snapshot` after actions to see updated page state
5. **Capture**: Use `browser_screenshot --annotate` for visual evidence with labeled elements

## Tool Reference

| Tool | Purpose | Example |
|------|---------|---------|
| `browser_open` | Navigate to URL, get initial snapshot | `browser_open({ url: "https://example.com" })` |
| `browser_snapshot` | Get accessibility tree with refs | `browser_snapshot({ interactive_only: true })` |
| `browser_click` | Click element by ref or selector | `browser_click({ selector: "@e3" })` |
| `browser_fill` | Clear and type into input | `browser_fill({ selector: "@e5", text: "hello" })` |
| `browser_press` | Press keyboard key | `browser_press({ key: "Enter" })` |
| `browser_screenshot` | Capture viewport | `browser_screenshot({ annotate: true })` |
| `browser_scroll` | Scroll page | `browser_scroll({ direction: "down", pixels: 500 })` |
| `browser_wait` | Wait for element/condition | `browser_wait({ selector: "@e1" })` |
| `browser_get_text` | Extract text from element | `browser_get_text({ selector: "@e2" })` |
| `browser_close` | Close session and tile | `browser_close()` |

## Ref-Based Workflow (Recommended)

Refs (`@e1`, `@e2`, etc.) from snapshots are the most reliable way to target elements:

```
1. browser_open({ url: "https://login.example.com" })
   -> Returns snapshot with refs:
      - textbox "Email" [ref=e1]
      - textbox "Password" [ref=e2]  
      - button "Sign In" [ref=e3]

2. browser_fill({ selector: "@e1", text: "user@example.com" })
3. browser_fill({ selector: "@e2", text: "secret123" })
4. browser_click({ selector: "@e3" })
5. browser_snapshot() -> Verify login succeeded
```

## Visible Cursor

The AgentBrowserTile shows a live viewport with an animated cursor. When you call
`browser_click` or `browser_hover`, the cursor visibly moves to the target element
before the action executes. This lets users watch the agent work in real-time.

## Error Handling

- If element not found: Re-snapshot and find new ref (page may have changed)
- If page blocked by dialog: Use `browser_press({ key: "Escape" })` or click dialog buttons
- If timeout: Increase wait time or check if element is in a frame
- If site blocks automation: Try `--headed` mode or auth state import

## Trigger Patterns

The skill should auto-activate on these patterns (case-insensitive):
- "test the site", "test the page", "test this URL"
- "open in browser", "navigate to", "go to"
- "click the button", "fill the form", "submit the form"
- "login to", "sign in to", "authenticate"
- "scrape", "extract from page", "get content from"
- "screenshot the page", "capture the screen"
- "QA this", "verify the feature", "check if it works"
- "automate", "browser automation"

## Multiple agent browser tiles

If more than one `agent_browser` tile exists on the canvas, pass `tile_id` on **every** `browser_*` call after `browser_open` (use the `tile_id` returned by `browser_open`). Otherwise the orchestrator returns an explicit “multiple tiles” error instead of guessing.

## Desktop backend

Orca’s desktop app registers a Tauri command that runs the `agent-browser` CLI from your workspace. If you see **run_agent_browser not found**, rebuild/update the **desktop** app (browser-only / Vite dev does not expose this IPC). If the CLI is missing from PATH, install it (below).

## Installation

Agent-browser requires the Orca desktop app (Tauri). The CLI must be installed:

```bash
npm install -g agent-browser
agent-browser install
```

The tile will prompt if agent-browser is not found.

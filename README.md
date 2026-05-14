# Orca Coder

A multi-agent infinite canvas IDE for running Claude Code, Codex, and Gemini in parallel.

## Features

- **Infinite Canvas** - Pan and zoom around a workspace filled with tiles
- **Multiple Tile Types**:
  - **Agent** - Run AI coding agents (Claude, Codex, Gemini) with real-time output
  - **Terminal** - Full PTY terminal with xterm.js and automatic error detection
  - **Editor** - Monaco-powered code editor with syntax highlighting
  - **Browser** - Embedded browser for previewing web apps
  - **Diff** - Side-by-side diff viewer with inline comments
  - **Todo** - Task list with agent handoff
  - **Inspect** ⭐ **NEW** - Automated debugging with console/network capture and auto-fix
- **Focus Mode** - Zoom into a single tile for distraction-free work
- **Toast Notifications** - Real-time feedback for agent status
- **Keyboard Shortcuts** - Fast tile creation and navigation
- **Canvas orchestrator** - Chat-driven tool loop with automated debugging capabilities
- **External agents (Hermes / OpenClaw / [Pi](https://github.com/badlogic/pi-mono) / OpenClaude)** - Same tool contract over HTTP as the built-in orchestrator; discovery hub [docs/AGENT_ORCHESTRATOR_SYNC.md](docs/AGENT_ORCHESTRATOR_SYNC.md), bridge reference [docs/CANVAS_AGENT_BRIDGE.md](docs/CANVAS_AGENT_BRIDGE.md), executable skill [`docs/skills/orca-external-orchestrator/SKILL.md`](docs/skills/orca-external-orchestrator/SKILL.md) (Paperclip-style BYOA)

### 🚀 Inspect Module - Automated Debugging

**Self-healing browser debugging with automatic console/network capture**

The Inspect Module provides the orchestrator with comprehensive debugging capabilities:

- **Automatic Capture**: All console logs and network requests intercepted automatically
- **Intelligent Detection**: Pattern recognition, spike detection, issue grouping
- **Auto-Fix**: Common issues fixed without user intervention
- **Visual Interface**: Real-time monitoring with filtering and export
- **Orchestrator Integration**: 9 specialized tools for automated debugging

**Key Capabilities:**
- Detect console errors, network failures, API issues
- Auto-fix syntax errors, undefined variables, auth failures
- Monitor performance (slow endpoints, large payloads)
- Export data (JSON, CSV, Markdown, clipboard)
- Zero configuration - works automatically in browser tiles

**See [INSPECT_MODULE.md](docs/INSPECT_MODULE.md) for complete documentation.**

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Zustand
- **Terminal**: xterm.js with node-pty backend
- **Editor**: Monaco Editor
- **Backend**: Node.js, Express, WebSocket (ws)

## Headless daemon (Telegram / CLI without UI)

Run the companion server + headless harness as a **user daemon** (`orcad`) and use the **`orca` CLI** — OpenClaw-style, always-on when your machine is logged in.

See **[docs/DAEMON.md](docs/DAEMON.md)** for install, config (`~/.orca/config.toml`), and commands.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
npm install
```

### Cursor: Context7 MCP

The repo ships [`.cursor/mcp.json`](.cursor/mcp.json) with [Context7](https://github.com/upstash/context7) for up-to-date library documentation in-agent. Optionally set `CONTEXT7_API_KEY` (free tier at [context7.com](https://context7.com/dashboard)) in your environment for higher limits.

### Development

Run both client and server:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:client  # Vite dev server at http://localhost:5173
npm run dev:server  # API server at http://localhost:3001
```

### Developer documentation

Contributors: **[`docs/DEVELOPER.md`](docs/DEVELOPER.md)** — monorepo map, orchestrator stack, Tauri vs web, harness eval, testing.

### Build

```bash
npm run build
```

## CI/CD Pipeline

This project uses GitHub Actions for continuous integration and deployment.

### CI Workflow

The CI pipeline (`.github/workflows/ci.yml`) runs on every push and pull request to main, develop, and feature branches:

**Jobs:**

1. **Lint & Type Check**
   - TypeScript type checking for all packages
   - Rust `cargo fmt` formatting check
   - Rust `cargo clippy` linting

2. **Test Node.js packages**
   - Runs tests for `packages/client` and `packages/server`
   - Collects coverage with c8
   - Uploads coverage to Codecov

3. **Test Rust packages**
   - Runs all Rust workspace tests
   - Collects coverage with cargo-tarpaulin
   - Uploads coverage to Codecov

4. **Build artifacts**
   - Builds client (Vite)
   - Builds server (TypeScript)
   - Builds harness-headless
   - Builds Rust server, daemon, and CLI
   - Uploads build artifacts for 30 days

5. **Coverage Report**
   - Generates coverage summary in GitHub Actions UI
   - Coverage tracked across client, server, and Rust components

6. **Status Check**
   - Aggregates all job statuses
   - Fails CI if any job fails

### Coverage Reporting

Coverage is reported via [Codecov](https://codecov.io/):

- **Client**: React/TypeScript frontend
- **Server**: Node.js/TypeScript backend
- **Rust**: Tauri daemon, CLI, and server components

Configuration is in `codecov.yml` at the repo root.

### Running Tests Locally

```bash
# Run all tests
npm run test --workspace=packages/client
npm run test --workspace=packages/server

# Run tests with coverage
NODE_ENV=test c8 npm run test --workspace=packages/client

# Run Rust tests
cargo test --workspace

# Run Rust tests with coverage
cargo install cargo-tarpaulin
cargo tarpaulin --workspace --out Xml
```

### Windows Build Workflow

Separate workflow (`.github/workflows/build-windows.yml`) builds Windows installers (NSIS + MSI) on version tags and manual dispatch.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘ + Enter` | Toggle focus mode |
| `⌘ + 1` | Add Agent tile |
| `⌘ + 2` | Add Terminal tile |
| `⌘ + 3` | Add Browser tile |
| `⌘ + 4` | Add Todo tile |
| `⌘ + 5` | Add Editor tile |
| `⌘ + 6` | Add Diff tile |
| `⌘ + 7` | Add Inspect tile |
| `⌘ + 0` | Reset canvas view |
| `⌘ + ?` | Show keyboard shortcuts |
| `Esc` | Exit focus mode |
| `Scroll` | Zoom in/out |
| `Drag` | Pan canvas |

## Project Structure

```
packages/
  client/                 # React frontend
    src/
      components/
        Canvas/           # Infinite canvas and tile system
        tiles/            # Individual tile components
          InspectTile.tsx # Automated debugging UI
        FocusMode/        # Focus mode overlay
        Toolbar/          # Canvas toolbar and shortcuts
        Toast/            # Notification system
      lib/
        inspect/          # Inspect module
          types.ts        # Data structures
          errorDetection.ts # Error detection algorithms
          networkInterceptor.ts # Network capture
      store/              # Zustand state stores
        inspectStore.ts   # Inspect state management
      orchestrator/       # Orchestrator integration
        inspectTools.ts   # Query tools
        autoFixWorkflows.ts # Auto-fix logic
  server/                 # Node.js backend
    src/
      pty/                # Terminal session management
      agents/             # AI agent process management
      ws/                 # WebSocket router
```

## License

MIT

# Environment Setup Guide

This document describes how to set up the development environment for Orca Coder.

## Tech Stack Overview

Orca Coder is a hybrid project using:
- **Frontend**: Node.js 18+, TypeScript, React 18, Vite
- **Backend**: Node.js, Express, WebSocket (ws)
- **Desktop**: Rust (via Tauri) - version 1.77.2+
- **Optional Python**: Tooling only (not required for core development)

## Prerequisites

### Required

1. **Node.js 18+**
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version` (should be 18.x or higher)
   - Verify npm: `npm --version` (should be 9.x or higher)

2. **Rust 1.77.2+**
   - Install via rustup: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
   - Verify installation: `cargo --version`
   - Verify rustc: `rustc --version`

3. **System Dependencies**
   - macOS: Xcode Command Line Tools (`xcode-select --install`)
   - Linux: `build-essential`, `pkg-config`, `libssl-dev`
   - Windows: Visual Studio C++ Build Tools

### Optional

- **Python 3.8+** (for optional tooling only)
  - Not required for core development
  - Only needed if you want to use Python-based tooling
  - See `requirements.txt` for Python dependencies

## Installation Steps

### 1. Clone Repository

```bash
git clone <repository-url>
cd orca
```

### 2. Install Node.js Dependencies

```bash
# Install all workspace dependencies
npm install

# This installs dependencies for:
# - packages/client (React frontend)
# - packages/server (Node.js backend)
# - packages/harness-headless (Headless CLI)
# - Root dev dependencies (TypeScript, Vite, Tauri CLI, etc.)
```

### 3. Build Rust Components

```bash
# Build all Rust workspace members
cargo build --workspace

# Build specific components:
cargo build -p agent-canvas-server  # Rust server
cargo build -p orca-daemon           # Daemon
cargo build -p orca-cli              # CLI
cargo build -p agent-canvas          # Tauri app
```

## Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

### Required Environment Variables

For development, most environment variables are optional with sensible defaults. See `.env.example` for the complete list.

### LLM Provider Keys

The app supports multiple LLM providers. Keys can be configured in multiple ways (priority order):

1. **Settings UI** (desktop app) - highest priority
2. **Tauri shell** (`~/.pi/agent/auth.json`, `~/.hermes/.env`, etc.) - desktop only
3. **Environment variables** - lowest priority

Example environment variables:
```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-api03-...

# Google / Gemini
GEMINI_API_KEY=...

# OpenRouter
OPENROUTER_API_KEY=sk-or-v1-...

# Z.AI (GLM)
ZAI_API_KEY=...
```

See `packages/client/src/lib/llmCredentials.ts` for the complete list of supported providers and environment variable names.

### OpenRouter Model Preflight

When you add or select an OpenRouter model in **Settings → Providers**, Orca automatically probes the model via OpenRouter's `/models/{slug}/endpoints` API and reports one of:

- **OK (tools)** — at least one live endpoint exposes the `tools` parameter; the orchestrator can call tools through this model.
- **No tools** — no live endpoint exposes `tools`. Orchestrator agents need tool-use, so selecting this as the default will fail; pick a different model.
- **Auth** — `OPENROUTER_API_KEY` is missing, invalid, or returned `403` for this model.
- **Insufficient credits** — OpenRouter returned `402`. Top up your account.
- **Rate limited** — OpenRouter returned `429`. Retry shortly.
- **Not found** — the slug doesn't exist on OpenRouter.

Results are cached per-model and persisted across restarts. The preflight status appears as a small badge next to each model in the orchestrator picker and catalog list, and as a prominent warning banner above the orchestrator model list when the currently selected model is in an error state. To force a re-probe, remove and re-add the model. Probes are implemented in `packages/client/src/lib/openrouterPreflight.ts`.

## Development Workflow

### Run All Services

```bash
npm run dev
```

This starts:
- **Client**: Vite dev server at `http://localhost:5173`
- **Server (Rust)**: `cargo run -p agent-canvas-server`
- **Telemetry Server**: Node.js server at `http://localhost:3002`

### Run Individual Services

```bash
# Frontend only
npm run dev:client

# Node.js backend (legacy)
npm run dev:server:node

# Rust backend
cargo run -p agent-canvas-server

# Tauri desktop app
npm run tauri:dev
```

### Build for Production

```bash
# Build all components
npm run build

# Build specific components
npm run build:client      # React app
npm run build:server       # Node.js backend
npm run build:server:node  # TypeScript compilation
npm run build:daemon       # Rust daemon + CLI
```

## Code Quality Tools

### Linting and Formatting

#### Node.js / TypeScript

```bash
# ESLint configuration is in .eslintrc.js
# Run ESLint
npm run lint

# Auto-fix ESLint issues
npm run lint:fix

# TypeScript type checking
npm run type-check

# Format code with Prettier
npm run format
```

#### Rust

```bash
# Format Rust code
cargo fmt

# Check code with Clippy
cargo clippy

# Run Clippy with all targets
cargo clippy --all-targets --all-features
```

### Pre-commit Hooks

The project uses pre-commit hooks to ensure code quality:

```bash
# Install pre-commit hooks (if configured)
npm run install:pre-commit

# Run pre-commit manually
npm run pre-commit
```

## Testing

### Run All Tests

```bash
# Node.js tests
npm run test --workspace=packages/client
npm run test --workspace=packages/server

# Rust tests
cargo test --workspace

# Run tests with coverage
NODE_ENV=test c8 npm run test --workspace=packages/client
cargo tarpaulin --workspace --out Xml
```

### Run Specific Test Suites

```bash
# Client orchestrator tests
npm run test:client-orchestrator

# Hermes integration tests
npm run test:hermes-tile

# Smoke tests for models
npm run test:models:smoke
```

## Troubleshooting

### Node.js Issues

**Problem: Node version too old**
```bash
# Use nvm to install Node 18+
nvm install 18
nvm use 18
```

**Problem: npm install fails**
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Rust Issues

**Problem: Rust not found**
```bash
# Install Rust via rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Reload shell
source $HOME/.cargo/env
```

**Problem: Build fails with linking errors**
```bash
# macOS: Install Xcode Command Line Tools
xcode-select --install

# Linux: Install build dependencies
sudo apt-get install build-essential pkg-config libssl-dev
```

### Tauri Issues

**Problem: Tauri build fails**
```bash
# Install Tauri CLI
npm install -g @tauri-apps/cli

# Verify Tauri setup
npm run tauri info
```

## IDE Setup

### VS Code

Recommended extensions:
- **ESLint** - JavaScript/TypeScript linting
- **Prettier** - Code formatting
- **rust-analyzer** - Rust language server
- **Tailwind CSS IntelliSense** - CSS framework support
- **Vitest** - Test runner

### Cursor / Claude Code

The project includes:
- `.cursor/mcp.json` - Context7 MCP for library documentation
- `.claude/skills/` - Reusable agent skills
- `.cursor/skills/` - Cursor-specific skills

## Additional Resources

- **Tauri Documentation**: https://tauri.app/
- **Vite Documentation**: https://vitejs.dev/
- **React Documentation**: https://react.dev/
- **Rust Book**: https://doc.rust-lang.org/book/

## Support

For issues or questions:
1. Check the [README.md](../README.md) for general information
2. Review [docs/](../docs/) for specific features
3. Check [AGENT_ORCHESTRATOR_SYNC.md](AGENT_ORCHESTRATOR_SYNC.md) for agent integration
4. Check [CANVAS_AGENT_BRIDGE.md](CANVAS_AGENT_BRIDGE.md) for external agent bridge

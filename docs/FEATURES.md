# Orca Coder Features

## Overview

Orca Coder is a multi-agent canvas IDE with automated debugging, intelligent error detection, and self-healing capabilities.

## Core Features

### 🎨 Canvas-Based IDE
- **Tile System**: Modular tiles for terminal, editor, browser, GitHub, diff review, and more
- **Smart Layouts**: Preset layouts, smart collapse, mission control scatter
- **Drag & Drop**: Intuitive tile positioning and resizing
- **Focus Modes**: Multi-tile focus for enhanced productivity

### 🤖 Orchestrator
- **Automated Workflows**: Execute complex tasks with AI agents
- **Tool Integration**: Query files, run commands, search web, manage todos
- **Sub-Agent Spawning**: Parallel task execution
- **Activity Monitoring**: Real-time orchestrator activity feed
- **Session Management**: Persistent orchestrator sessions
- **External orchestrators (Hermes / OpenClaw / Pi)**: HTTP bridge + skill [`docs/skills/orca-external-orchestrator/SKILL.md`](skills/orca-external-orchestrator/SKILL.md) — see [AGENT_ORCHESTRATOR_SYNC.md](AGENT_ORCHESTRATOR_SYNC.md)
- **Chat persistence**: Local `~/.orca/sessions/` JSONL + optional FTS; vault export `Orca/chat/*.md` when **Mirror full orchestrator transcript** is on (Settings → **Agent data** → **Vault & Obsidian**; master mirror is **on by default** in the desktop app). Troubleshooting: same section shows workspace path, **Mirror now (self-test)**, and recent mirror attempts.

### 🔍 Inspect Module ⭐ NEW
**Self-healing browser debugging with automatic console/network capture**

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

**See [INSPECT_MODULE.md](INSPECT_MODULE.md) for complete documentation.**

### 🖥️ Terminal
- **PTY Sessions**: Full terminal emulation with shell integration
- **Error Detection**: Automatic error pattern detection
- **Status Tracking**: Working, done, error, warning states
- **Reconnect**: Easy reconnect on disconnect
- **Multi-Session**: Multiple terminal tiles supported

### 📝 Editor
- **Code Editing**: Syntax highlighting and editing
- **File Management**: Create, read, update files
- **Multiple Files**: Edit multiple files simultaneously
- **Auto-Save**: Changes saved automatically

### 🌐 Browser
- **Web Browsing**: Built-in browser for testing
- **Console Capture**: Integrated with inspect module
- **Network Monitoring**: Automatic request/response tracking
- **Multiple Tabs**: Multiple browser tiles supported

### 📊 Diff Review
- **Code Review**: Multi-file diff review sessions
- **Side-by-Side**: Compare changes easily
- **AI Summary**: Get AI-powered change summaries
- **Accept/Reject**: Apply or reject changes

### ✅ Todo Management
- **Task Tracking**: Create and manage tasks
- **Priorities**: Set task priorities
- **Orchestrator Integration**: Auto-generated tasks from issues
- **Progress Tracking**: Track completion status

### 👥 Agent Teams
- **Multi-Agent**: Run multiple agents simultaneously
- **Agent Chat**: Agents can communicate with each other
- **Specialized Skills**: Agents have domain-specific skills
- **Session Management**: Persistent agent sessions

### 🔧 Toolbox
- **Tool Library**: Collection of development tools
- **Quick Access**: Frequently used tools at your fingertips
- **Customizable**: Add your own tools

### 📈 Benchmark
- **Performance Testing**: Run performance benchmarks
- **Metrics Tracking**: Track performance over time
- **Comparison**: Compare different implementations

### 🎬 Remotion
- **Video Creation**: Create videos with code
- **Remotion Studio**: Integrated Remotion editor
- **Preview**: Real-time video preview

### 📊 OpenRouter Usage
- **API Monitoring**: Track OpenRouter API usage
- **Cost Tracking**: Monitor API costs
- **Usage Statistics**: View usage statistics

## Technical Features

### 🏗️ Architecture
- **TypeScript**: Type-safe codebase
- **React**: Modern UI framework
- **Tauri**: Desktop application framework
- **Zustand**: State management
- **Vite**: Fast build tool

### 🔒 Security
- **Local Processing**: All processing happens locally
- **No Data Telemetry**: No data sent to external servers
- **User Privacy**: Privacy-first design

### ⚡ Performance
- **Fast Builds**: Vite for lightning-fast HMR
- **Optimized**: Performance-optimized code
- **Efficient**: Minimal resource usage

### 🎨 UI/UX
- **Modern Design**: Clean, modern interface
- **Dark Mode**: Dark theme by default
- **Responsive**: Adapts to different screen sizes
- **Keyboard Shortcuts**: Efficient keyboard navigation

## Development

### Getting Started
```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run Tauri dev
npm run tauri:dev

# Build for production
npm run build
```

### Project Structure
```
orca/
├── packages/
│   ├── client/          # Frontend (React + TypeScript)
│   └── server/          # Backend server (Node.js)
├── src-tauri/           # Tauri backend (Rust)
├── scripts/             # Build and utility scripts
└── docs/                # Documentation
```

### Key Technologies
- **Frontend**: React, TypeScript, Tailwind CSS, Zustand
- **Backend**: Node.js, TypeScript, Express
- **Desktop**: Tauri, Rust
- **Build**: Vite, esbuild
- **Testing**: Playwright, Jest

## Documentation

- [Inspect Module](INSPECT_MODULE.md) - Automated debugging documentation
- [orca.md](../orca.md) - Project instructions and context
- [Inspect README](../packages/client/src/lib/inspect/README.md) - Technical details

## Contributing

Contributions are welcome! Please read the project documentation before contributing.

## License

See project LICENSE for details.

---

**Built with ❤️ by the Orca Coder team**

---
name: orca-daemon
description: Install and operate the Orca user-level daemon (orcad), headless harness, and orca CLI without the desktop UI. Use for service-style runs, OpenClaw-style daemon workflows, bridge and headless debugging, and optional companion-server integrations (see skill body).
license: MIT
---

# Orca daemon skill

Canonical doc: [docs/DAEMON.md](../../DAEMON.md)

## Quick commands

```bash
orca install && orca start && orca status
orca chat "list files in the workspace root"
```

## Requirements

- Built `orcad`, `orca` binaries on `PATH`
- Built `packages/harness-headless/dist/harness-headless.mjs` (or set `ORCA_HARNESS_SCRIPT`)
- `[llm]` or `OPENROUTER_API_KEY` for headless model calls

## Troubleshooting

- `bridge-status` shows `headlessGatewayRegistered: false` → harness not running or wrong `harness.script`
- `401` on API → set `CANVAS_BRIDGE_TOKEN` / `orca install` token
- Telegram works only when companion server + harness are up (`orca status`)

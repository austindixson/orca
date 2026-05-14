# Dev telemetry baseline (local troubleshooting)

Orca can ship structured events to the **dev telemetry** server (`packages/server`, default port **3002**). Exports:

- Flat CSV: `GET /api/dev/telemetry/export.csv`
- Per-session ZIP: `GET /api/dev/telemetry/export/by-session.zip` — includes `telemetry-export-summary.json` plus one CSV per `session_id` and `no-session.csv` for rows with no session.

## Metrics (from export summary + CSV patterns)

| Signal | Meaning |
|--------|---------|
| `issueSignals.terminalConnectionTimedOut` | Rows whose `payload_json` mentions terminal connect timeout (client PTY/WebSocket path). |
| `issueSignals.stillWaiting` | Orchestrator LLM pending nudges (`Still waiting`). |
| `issueSignals.rateLimitedOrQuota` | Rate limit / quota / `Retry N/M` patterns in payloads. |
| `issueSignals.scriptError` | `Script error` in payloads (often opaque `window.error`). |
| `issueSignals.cancelledOrAborted` | User cancel / harness abort strings. |
| `totals.unassignedSessionRatio` | Share of events with no `session_id` — high values make per-session ZIPs harder to interpret. |

## Pass/fail thresholds (starting point)

Tune for your environment. These are **starting gates** for regression checks after remediation work:

| Metric | Warn | Fail |
|--------|------|------|
| `terminalConnectionTimedOut` (per multi-hour capture) | > 20 | > 55 |
| `unassignedSessionRatio` | > 0.35 | > 0.85 |
| `stillWaiting` lines per active Z.AI session hour | > 80 | > 200 |
| `rateLimitedOrQuota` per session | > 25 | > 80 |

## Reproducible check

From repo root:

```bash
node scripts/telemetry-baseline-check.mjs /path/to/telemetry-folder
```

The script scans all `*.csv` in a directory (or a single file), aggregates the same pattern counts as the server summary, and exits **1** if any **fail** threshold is exceeded. Use a time-bounded export (`since` / `until` query params) so comparisons stay comparable.

## Correlation fields (client)

When an orchestrator run is active, unified telemetry and ingest rows include:

- `telemetryCorrelationId` — stable for the run (nanoid).
- `telemetrySessionId` / `telemetryRunId` — mirror `sessionId` + harness stem (`orch-<n>`) on the wire when set.

Window `error` / `unhandledrejection` records embed these ids in `payloadJson` so they can be joined to orchestrator rows in SQLite or CSV tools.

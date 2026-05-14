# Hermes Any-App Hybrid Implementation Plan

> For Hermes: execute in vertical slices that satisfy spec acceptance criteria early.

## Goal
Ship an MVP matching spec: dual GUI modes, workflow packs, auth tiers, 20 seeded workflows, machine-readable configs, and Orca-parity multi-LLM connectivity.

## Slice 1 — Settings + provider schema integration
Deliverables:
- Provider settings UI + persistence wired to:
  - `HERMES-ANY-APP-PROVIDER-CONFIG.schema.json`
  - `HERMES-ANY-APP-PROVIDER-CONFIG.example.json`
- Validation on save (schema checks + required refs).
- Runtime policy picker for local vs Hermes Lead.

Definition of done:
- User can add/edit providers, models, fallback chains.
- Config save rejects invalid schema payloads.

## Slice 2 — Dual GUI shell
Deliverables:
- Persistent sidebar mode (~25% default width, resizable bounds 20–40%).
- Spotlight launcher mode (Control+Space default, configurable shortcut).
- Mode switch and persistence.

Definition of done:
- Both modes launch and route to same composer/execution pipeline.

## Slice 3 — Composer ingestion pipeline
Deliverables:
- Drag/drop files and photos -> absolute local path attachments.
- Clipboard image paste -> local file path attachment chip.
- Large-text instant truncation token + expandable preview.

Definition of done:
- Attachment metadata visible pre-send; paths validated.

## Slice 4 — Workflow pack runtime
Deliverables:
- Load `HERMES-ANY-APP-WORKFLOW-CATALOG.json` seed library.
- NL intent -> workflow resolution with slot filling.
- Risk gate enforcement (destructive confirm hard-stop).

Definition of done:
- At least 5 seeded flows execute through resolver end-to-end in test harness.

## Slice 5 — Auth lanes
Deliverables:
- OAuth lane (Google Drive first):
  - PKCE bootstrap + scope consent UI.
  - Encrypted token persistence + refresh lifecycle.
  - Pre-run OAuth health checks (`token_valid`, `scope_sufficient`, `api_reachable`).
- Browser-session lane (X first):
  - Interactive login capture flow.
  - Encrypted session bundle (`cookies`, storage snapshot, fingerprint hash, domain binding, TTL metadata).
  - Pre-run session health checks (`healthy|expiring|invalid`) with re-auth hard-stop.
- Hybrid lane router:
  - Command-step lane selection (`official_api` -> OAuth, `browser_ui` -> browser-session, `hybrid` -> per-step).
  - Bounded fallback policy and remediation messaging.
  - Trace annotations for selected lane + fallback decisions.

Definition of done:
- Drive upload flow and X post flow both pass with trace artifacts.
- Hybrid chain run records per-step lane routing and no-secret traces.
- Invalid OAuth/session state fails safely with explicit re-auth remediation.

## Slice 6 — Browser hub + registration wizard
Deliverables:
- Tauri embedded browser tab with default bookmark collections.
- Multi-app registration wizard from spec.
- One-click register from active tab.

Definition of done:
- User can onboard 3 apps in one wizard run and save packs.

## Slice 7 — Observability and drift
Deliverables:
- Per-run trace includes provider/model, command chain, risk tier, artifacts.
- Drift status for packs and command confidence.
- Re-discovery and contract diff workflow.

Definition of done:
- Drifted command is quarantined and recoverable through guided flow.

## Immediate next implementation tasks (Slice 5)
1) Add auth profile store contract for lane type (`oauth | browser_session | hybrid`) and encrypted artifact refs.
2) Implement Google Drive OAuth PKCE flow + token refresh lifecycle + pre-run health probe.
3) Implement X interactive session capture and encrypted session-bundle persistence.
4) Implement hybrid lane router (command-step lane selection + bounded fallback semantics).
5) Extend run trace payload to include lane selection/fallback events and verify secret redaction.

## Validation commands (once code exists)
- `npm run test`
- `npm run typecheck`
- `npm run build`
- integration smoke: provider settings save/load, spotlight open latency, attachment ingest, risk-gate confirmation.

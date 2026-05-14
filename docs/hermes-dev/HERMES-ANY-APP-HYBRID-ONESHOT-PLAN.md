# Hermes Any-App Hybrid — One-Shot Build Plan

## Goal
Build a new desktop project that combines:
1) Orca center menu bar UX,
2) orchestrator quick text input,
3) optional Hermes Lead mode,
4) EverythingIsAPI command-synthesis/runtime,
5) capability to add Hermes-driven automation to currently open applications.

## Product definition (MVP)
- New app shell with center menu bar as the primary control surface.
- Quick command input on the center bar (single-line command launcher + slash-like intents).
- Mode toggle: Local Orchestrator vs Hermes Lead.
- “Attach to app” flow:
  - browser-first target attachment (active tab / chosen app URL)
  - discovery pass
  - generated typed commands
  - command run with safety tier + approvals
- Live execution panel:
  - command selected
  - risk tier (read_only/mutating/destructive)
  - trace and artifact links (logs/screenshots/JSON)
- Safety defaults:
  - destructive commands require explicit confirm
  - domain allowlist enforced
  - no plaintext secret logging

## Proposed architecture
- UI shell: port/adapt center menu bar patterns from Orca.
- Runtime orchestrator adapter:
  - Local mode: Orca-native orchestrator behavior.
  - Hermes Lead mode: bridge-compatible execution path using external-agent contract.
- Automation layer: EverythingIsAPI engine for discovery -> contracts -> execution.
- Contract store:
  - per-target config
  - versioned commands
  - run artifacts and drift reports.

## Non-goals (v1)
- Full unrestricted native desktop automation for every OS control.
- CAPTCHA bypasses.
- Silent destructive actions.

## One-shot execution strategy
Use Orca One-Shot to generate a complete scaffold in one run with strict deliverables:
- research_context.json
- SPEC.md
- ARCHITECTURE.html
- FILE_MANIFEST.json
- DECOMPOSITION.json (v2)
- initial code + tests + README

## Copy/paste One-Shot prompt
Use this as the One-Shot idea prompt:

"""
Project name: Hermes Any-App Hybrid

Build a new desktop app that combines proven patterns from two local projects:
- Orca (UI shell + center menu bar + orchestrator UX)
- EverythingIsAPI (discover UI surfaces and generate typed AI-callable commands)

Primary user outcome:
Add Hermes capability to any currently open application through a safe command layer.

Must-have product requirements:
1) Center menu bar as the main navigation/control hub.
2) Quick orchestrator text input embedded in the center bar.
3) Hermes Lead mode is an explicit toggle option (with clear status indicator).
4) EverythingIsAPI workflow integrated end-to-end:
   - target selection/attachment
   - discovery
   - command contract synthesis
   - command execution with safety tiers and approvals
   - artifacts + traces for each run.
5) “Attach to open app” flow should be browser-first in MVP with explicit target/domain allowlist.
6) Safety model required:
   - classify commands as read_only | mutating | destructive
   - destructive requires explicit user confirmation
   - never log plaintext secrets
7) UX must expose execution trace and command/result history in-app.
8) Provide robust error surfacing for failed discovery, missing auth/session, selector drift, and blocked risky actions.

Technical preferences:
- Reuse Orca design language for the center bar and orchestration feel.
- Keep architecture modular: ui-shell, orchestrator-adapter, capability-engine, contract-store, observability.
- Keep MVP focused and shippable.

Deliverables required in generated project:
- SPEC with MVP scope, non-goals, risks, and milestone plan.
- Architecture artifact and file manifest with dependency ordering.
- Decomposition with dependency-aware tasks and estimated complexity.
- Initial runnable scaffold and tests for core flows:
  - mode toggle
  - command input dispatch
  - target attach
  - safety gate on destructive commands
  - trace/event logging.
- README with run/test instructions.

Acceptance criteria:
- User can type command in center quick input, choose Hermes Lead mode, run against attached browser target, and receive traceable result with safety handling.
"""

## Canonical target-user workflow (Twitter/X example)
Goal: user logs into X once, app generates reusable capability commands, and later invokes them via natural language.

### End-user flow
1) User opens X in browser and signs in normally (interactive auth).
2) User clicks Attach Target in the hybrid app and selects `https://x.com`.
3) Discovery pass scans bounded routes (home, compose, profile) and builds selector provenance.
4) Contract synthesis generates intent-centric commands (examples):
   - `x.compose.open`
   - `x.tweet.send`
   - `x.tweet.reply`
   - `x.timeline.read`
5) User approves command set and risk tiers:
   - read_only: timeline/profile reads
   - mutating: likes/replies/tweets
   - destructive: deletes/unfollows (explicit confirm required)
6) User saves this as an app workflow pack (e.g. `x-social-ops`).
7) Later, user types natural language in quick input:
   - “send tweet: shipping hybrid mode tonight 🚀”
   - runtime resolves to `x.tweet.send({ text })` and executes with trace + artifacts.

### Workflow packs (reusable across apps)
- Each attached app gets a named pack with:
  - target config + allowlist,
  - versioned command contracts,
  - saved natural-language intent mappings,
  - run history and drift health.
- Users can invoke later by name:
  - “Use x-social-ops and post this update...”
  - “Run stripe-billing pack and export overdue invoices.”

### Natural-language invocation model
- Input parser resolves utterance -> pack -> command -> typed inputs.
- If ambiguity exists, app asks a short disambiguation question.
- If command is risky, app gates with explicit approval before execution.

### Cross-app workflow example: local files -> Google Drive
Goal: user has a local folder open and can say “Move all of these to Google Drive.”

1) User connects Google Drive target once (interactive auth/OAuth).
2) App synthesizes Drive capability commands (examples):
   - `gdrive.folder.ensure`
   - `gdrive.file.upload`
   - `gdrive.batch.upload`
3) User saves workflow pack (e.g. `drive-ingest`).
4) Later user highlights/opens local folder and types:
   - “Move all of these to Google Drive.”
5) Runtime resolves intent:
   - source = active folder context
   - destination = default or specified Drive folder
   - action = upload (optionally delete-local only after explicit approval)
6) Execution runs with progress + per-file result trace (uploaded/skipped/failed).

Safety/risk classification for this flow:
- read_only: list local files, list Drive folders
- mutating: upload files/create folder
- destructive: delete local originals after upload (must require explicit confirm)

### Guardrails for these examples
- Never store plaintext credentials.
- Respect target allowlist and platform boundaries.
- Keep automation policy-compliant with platform terms and rate limits.
- Re-run discovery + contract diff when selectors drift.
- For file moves, prefer upload+verify first; destructive cleanup is always an explicit second step.

## Recommended milestone cuts (after one-shot generation)
1) Milestone A: Shell + center bar + quick input + mode toggle.
2) Milestone B: EverythingIsAPI ingestion (target config + discovery + contract list).
3) Milestone C: Execute commands with safety gates + approval UI.
4) Milestone D: Hermes Lead bridge wiring + trace UX parity.
5) Milestone E: Workflow-pack library + NL intent resolver + drift health status.

## Linked specs/docs
- `hermes-dev/HERMES-ANY-APP-HYBRID-SPEC-AUTH.md` (product + auth architecture)
- `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.md` (20 practical workflow definitions)
- `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json` (machine-readable workflow + UI/runtime defaults)
- `hermes-dev/HERMES-ANY-APP-GUI-UX-SPEC.md` (sidebar/spotlight UX + attachments/paste behavior)
- `hermes-dev/HERMES-ANY-APP-PROVIDER-CONFIG.schema.json` (LLM provider config schema)
- `hermes-dev/HERMES-ANY-APP-PROVIDER-CONFIG.example.json` (starter provider settings)
- `hermes-dev/HERMES-ANY-APP-IMPLEMENTATION-PLAN.md` (vertical-slice execution plan)

## Verification checklist
- [ ] Center menu bar and quick input are operational.
- [ ] Hermes Lead mode toggle switches runtime path clearly.
- [ ] Target attach and discovery produce usable contracts.
- [ ] Safety tiers enforced; destructive actions blocked pending approval.
- [ ] Trace/artifact pane records each execution.
- [ ] README includes setup, run, and test steps.

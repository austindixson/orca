# Hermes Any-App Hybrid — Product Spec + Authentication

## Goal
Create a web-first control layer where users can issue natural-language commands that execute reusable workflows across web apps, with safety gates, traceability, and optional Hermes Lead orchestration.

## Product statement
"Attach app once -> generate typed capabilities -> save workflow pack -> invoke later with natural language."

## Primary users
1) Solo operator/founder automating repetitive browser tasks.
2) Ops/RevOps person running recurring cross-tool workflows.
3) Creator/social manager scheduling and posting updates.
4) Analyst/support agent moving files/data between tools.

## Core use cases
1) X/Twitter posting
- User logs into X interactively.
- App discovers compose/send actions.
- User later says: "Post this tweet..."
- Runtime maps intent -> `x.tweet.send` -> executes with trace.

2) Local folder -> Google Drive
- User authorizes Drive once.
- User later says: "Move all of these to Google Drive."
- Runtime maps to `gdrive.batch.upload` (mutating) and optionally `local.delete_batch` (destructive, explicit confirm required).

3) CRM bulk updates
- "Tag all stale leads as follow-up-2026."
- Safety tier: mutating, preview first.

4) Report export
- "Export this week invoices CSV to Drive/Reports/Week-17."
- read_only data query + mutating file upload.

5) App-specific quick actions
- "In Notion app-pack, create meeting note from this template."
- workflow pack selected by name and route context.

## Practical workflow catalog (20)
The full 20-workflow catalog is maintained in:
- `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.md`

These examples are normative for MVP intent coverage and include:
- social posting/replies/scheduling,
- local-to-cloud file movement,
- CRM/support/ops automations,
- cross-app reporting and launch-day orchestration.

### Workflow IDs included in spec scope
1) x-post-update
2) x-reply-top-mentions
3) x-schedule-from-draft
4) drive-upload-active-folder
5) drive-upload-then-clean-local
6) billing-export-to-drive
7) drive-create-client-tree
8) notion-meeting-note-template
9) notion-transcript-to-tasks
10) crm-tag-stale-leads
11) crm-daily-pipeline-to-slack
12) zendesk-followups-to-linear
13) design-assets-upload-and-share
14) cms-publish-draft-from-folder
15) analytics-snapshot-to-drive
16) ad-cac-anomaly-alert
17) local-rename-normalize-upload
18) hiring-csv-to-linear
19) release-checklist-status-post
20) launch-day-multiapp-push

## Workflow-pack model
Each connected app (or integration) persists a workflow pack:
- pack_id, pack_name
- target_type: browser_ui | official_api | hybrid
- target metadata (domain/app id)
- auth profile reference
- command contracts (versioned)
- intent mappings (NL patterns -> command ids)
- safety policies and approval rules
- drift score + last validation timestamp

Machine-readable companion file:
- `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json`
- Includes: workflow IDs, command chains, slot requirements, risk tiers, and defaults.

## Deployment + workspace persistence model (web-first)
Default runtime is browser/web app. Desktop shell (Tauri) is optional for users who want tighter local integration.

Workspace storage tiers:
1) Default: local browser storage, encrypted at rest (IndexedDB/local data envelope) with user-controlled passphrase or device key.
2) Optional cloud workspace: encrypted sync backend for multi-device continuity.
3) Optional GitHub-backed workspace: repo-linked persistence for prompts/config/workflow packs/artifacts suitable for versioned text assets.

GitHub identity and repository access:
- Sign-in with GitHub OAuth is first-class for account bootstrap.
- Repository access must use least-privilege scopes and explicit repo selection.
- Workspace can bind to one or more repos for config/versioned artifact sync.
- Non-versionable/high-churn runtime state should remain local or in cloud state store, not committed blindly to Git.

## Embedded browser hub (Tauri tab)
Add a dedicated Tauri browser tab that acts as the default app-launch + registration surface.

Requirements:
- Full-featured embedded browser experience (tabs/history/navigation).
- Default bookmark screen with popular app collections:
  - Google Suite (Gmail, Drive, Docs, Sheets, Calendar)
  - Creator/Social (X, YouTube Studio, LinkedIn, Reddit)
  - Work/Collab (Slack, Notion, Linear, Zendesk)
- One-click "Register this app" affordance from current tab.

## App registration wizard
Provide a fast onboarding wizard so users can register multiple favorite apps in one pass.

Wizard steps:
1) Pick apps (presets + custom URL)
2) Choose auth method (OAuth/API, browser-session, hybrid)
3) Set allowlisted domains
4) Run discovery
5) Review generated command contracts
6) Configure safety policy (mutating preview/destructive confirm)
7) Save workflow pack

Wizard outputs per app:
- workflow pack record
- auth profile reference
- validated command contract set
- initial drift/health baseline

## Natural-language resolution flow
1) Parse utterance.
2) Resolve pack by explicit name or active context.
3) Resolve command candidate(s).
4) Fill typed inputs from utterance/context.
5) If ambiguous: ask short disambiguation.
6) Run safety policy:
   - read_only: run
   - mutating: run or preview per policy
   - destructive: always explicit confirmation
7) Execute and log artifacts.

## GUI interaction model
See detailed GUI spec:
- `hermes-dev/HERMES-ANY-APP-GUI-UX-SPEC.md`

This spec requires two user-selectable interaction surfaces:
1) Persistent desktop sidebar mode (expandable, ~25% width, responsive push/squish behavior)
2) Spotlight-style launcher mode (global shortcut default: Control+Space)

Input/attachment requirements (normative):
- Drag-and-drop files/photos into composer -> resolve to local absolute paths.
- Paste photos -> auto-save locally and insert path attachment chips.
- Large text paste -> instant truncation token with line/char counts.

## LLM provider connectivity (Orca-parity requirement)
Users must be able to connect and switch among multiple LLM providers/models, matching Orca-style flexibility.

Required capabilities:
- Multi-provider configuration in Settings (API key, base URL, model catalog per provider).
- Provider types:
  - first-party hosted APIs,
  - OpenAI-compatible endpoints,
  - local/self-hosted gateways.
- Per-run model selection + default model preference.
- Optional fallback model/provider policy for rate limits/errors.
- Clear model capability labels (tools/no-tools, context window, reasoning modes).
- Safe key handling: encrypted at rest, never logged in plaintext.

Runtime requirements:
- Preserve existing workflow-pack behavior regardless of selected model.
- Hermes Lead mode can use separate model/provider policy from local orchestrator mode.
- Session traces must record provider/model used for each run.

Provider config artifacts (normative):
- Schema: `hermes-dev/HERMES-ANY-APP-PROVIDER-CONFIG.schema.json`
- Example: `hermes-dev/HERMES-ANY-APP-PROVIDER-CONFIG.example.json`

Required provider-config sections:
- `providers[]` with `id`, `type`, `api.baseUrl`, `api.apiKeyRef`, `models[]`, `defaultModelId`
- `models[]` capability metadata (`supportsTools`, `contextWindowTokens`, `reasoningModes`)
- `fallbackChain[]` per provider and optional per-mode `fallbackOverride[]`
- `runtimePolicies.localOrchestrator` and `runtimePolicies.hermesLead` (separate defaults allowed)
- `keyStorage` + `tracePolicy` for secure storage and auditability

## Authentication architecture

### Design principles
- Prefer official auth paths whenever available.
- Never store plaintext credentials.
- Isolate auth by pack/app.
- Minimize privilege scopes.
- Treat browser-session auth as a controlled compatibility layer, not default first choice.

### Auth tiers
Tier A (preferred): Official OAuth/API
- Examples: Google Drive OAuth, Slack OAuth, Notion integrations.
- Store refresh/access tokens encrypted in OS keychain-backed vault.
- Advantages: stable, policy-aligned, low drift.

Tier B (browser-session bridge for web-only surfaces)
- For targets where user relies on web UI and no suitable API path.
- User authenticates interactively in a controlled browser context.
- Session artifacts (cookies/local storage/session storage) are captured only after explicit consent and encrypted at rest.
- Replay via hardened browser automation runtime.
- Strict domain binding + TTL + re-validation.

Tier C (hybrid)
- Use official APIs where possible, browser layer for missing UI-only actions.
- Single command surface hides backend split.

## Slice 5 execution spec — Auth lanes (normative)

### Lane A: OAuth lane (Google Drive first)
Purpose:
- First-class official API path for Drive workflows (`gdrive.*` commands).

Required behavior:
1) OAuth bootstrap
- Start PKCE OAuth flow from Connected Apps panel.
- Scope requests are explicit and minimized (`drive.file` preferred over full-drive when possible).
- Save `auth_profile_id` with provider=`google_drive`, lane=`oauth`, scope fingerprint, and token metadata refs.

2) Token storage and rotation
- Access/refresh tokens are encrypted at rest via keychain-backed secret storage.
- Runtime never writes raw tokens to logs, traces, or error messages.
- Refresh on expiry with bounded retries and clear failure state (`reauth_required`).

3) Command execution constraints
- Drive mutating commands require valid token health at run start.
- OAuth health checks run before command chain execution (`token_valid`, `scope_sufficient`, `api_reachable`).

### Lane B: Browser-session lane (X first)
Purpose:
- Controlled compatibility path for `x.*` flows when API lane is not primary.

Required behavior:
1) Interactive session capture only
- User logs into X directly in controlled browser context.
- Runtime captures session artifacts only after explicit consent.

2) Encrypted session bundle contract
- Persist encrypted bundle keyed by `auth_profile_id`:
  - cookies snapshot,
  - local/session storage snapshot,
  - runtime fingerprint hash,
  - domain binding (`x.com`, optional `twitter.com` alias),
  - issued_at, expires_at, ttl_policy.
- Bundle is non-portable across unrelated runtime fingerprints unless user explicitly rebinds.

3) Session health checks
- Before each run, execute lightweight checks:
  - domain binding valid,
  - bundle decryptable,
  - auth still active (e.g., compose/timeline probe),
  - ttl not expired.
- Health states: `healthy | expiring | invalid`.
- `invalid` must hard-stop execution and route user to re-auth flow.

### Lane C: Hybrid lane router
Purpose:
- Route workflow command chains across OAuth and browser-session lanes without changing user intent contract.

Routing policy:
1) Command-level lane preference
- `official_api` commands prefer OAuth lane.
- `browser_ui` commands prefer browser-session lane.
- `hybrid` commands resolve per step using capability availability.

2) Fallback order (bounded)
- OAuth command fail due to auth state -> attempt refresh -> recheck -> fail with remediation.
- Browser-session fail due to health invalid -> fail fast with re-auth action.
- Never silently downgrade destructive actions across lanes.

3) Run-time transparency
- Trace must record selected lane per command step and fallback decisions.
- Composer confirmation text shows active pack + lane summary before execution.

### Slice 5 definition-of-done verification
Must pass all:
1) Drive upload flow passes end-to-end via OAuth lane with trace artifacts.
2) X post flow passes end-to-end via browser-session lane with trace artifacts.
3) Hybrid router selects lane correctly for mixed command chains.
4) Invalid OAuth/session states are blocked with explicit remediation prompts.
5) No plaintext tokens/cookies/session ids appear in logs or trace payloads.

## Cookie/session approach (practical)
Based on your notes, plain cookie replay alone is often unreliable against modern anti-bot defenses. So spec should require:

1) Interactive bootstrap only
- User logs in directly in controlled browser runtime.
- No credential scraping or password storage.

2) Session bundle format
- Encrypted record containing cookies + storage snapshots + fingerprint metadata hash.
- Bound to domain + profile + runtime channel.

3) Runtime attestation checks
- Before run, verify session still valid via lightweight page check.
- If invalid: trigger re-auth flow, not silent retries forever.

4) Fingerprint-stable execution lane
- Keep consistent browser runtime/config per pack.
- Avoid cross-runtime session transplant by default.

5) Policy and compliance
- Respect site terms, user consent, and platform limits.
- Do not promise bypass of anti-bot systems.

## Security and privacy requirements
- Secret classes: tokens, cookies, session ids, API keys, personal data.
- Redaction in logs by default.
- At-rest encryption for all auth artifacts.
- Per-pack permission scopes.
- Explicit destructive approval gate.
- Full audit trace: who ran what, with which pack, result status, artifacts.

## Reliability requirements
- Drift detection: selector confidence drop triggers quarantine/review.
- Retry policy with bounded attempts and clear error reason.
- Fallback order: official API command -> browser command -> explicit failure with remediation tip.
- Session health state: healthy | expiring | invalid.

## UX requirements for auth
- "Connected apps" panel shows:
  - auth method (OAuth/session/hybrid)
  - last verified time
  - scope summary
  - health status
- Re-auth button per pack.
- Prompt-level transparency:
  - "Using drive-ingest pack (OAuth)"
  - "Using x-social-ops pack (browser session)"

## Example command contracts
- `x.tweet.send({ text, reply_to_id? })`
- `x.timeline.read({ mode, limit })`
- `gdrive.batch.upload({ local_paths[], destination_folder_id })`
- `local.delete_batch({ local_paths[] })` [destructive]

## Acceptance criteria (MVP)
1) User can onboard X and Google Drive packs end-to-end.
2) User can post to X from NL command through saved pack.
3) User can upload selected local folder files to Drive via NL command.
4) Destructive cleanup (delete local originals) requires explicit confirm every time.
5) Auth artifacts are encrypted; logs contain no plaintext secrets.
6) Run trace includes command, risk tier, result, and artifacts.

## Open technical questions
1) Session vault implementation details (keychain wrapper and rotation cadence).
2) Browser runtime standardization for session reliability.
3) Intent resolver confidence thresholds and disambiguation UX.
4) Granular policy model for per-command approvals.
5) Sync model for workflow packs across devices.

## Suggested implementation phases
Phase 1: Pack model + NL resolution + safety gates
Phase 2: OAuth connectors (Google Drive first)
Phase 3: Browser-session connector lane (X first)
Phase 4: Drift/quarantine + health dashboards
Phase 5: Cross-device sync and governance

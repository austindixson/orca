# Worklog

## 2026-04-22 08:54:22 PDT — Slice 5 UI polish: lane color mapping for auth route chips
Goal: improve scan speed in Harness traces accordion by color-mapping route/required-lane chips per auth lane type.

Completed:
- `packages/client/src/components/Settings/sections/AgentDataSection.tsx`
  - added `laneChipClass(lane)` helper with mapping:
    - `oauth` → cyan tone
    - `browser_session` / `browser-session` → fuchsia tone
    - `hybrid_router` / `hybrid-router` → amber tone
    - fallback → indigo tone
  - applied mapping to:
    - required lane chips
    - command route chips (`command → lane`)
  - preserved tooltip details (`reason`, `profile`) and auth profile badge rendering.

Validation:
- Build pass:
  - `npm run -s build --workspace=packages/client`
  - existing non-blocking Vite warnings only.

Next:
- Optional: add tiny lane legend row in the accordion for first-time users.

## 2026-04-22 08:49:12 PDT — Slice 5 UI polish: compact workflow route chips in Harness traces accordion
Goal: replace plain-text workflow route rows with compact chips in the same Harness traces accordion for faster scanning.

Completed:
- `packages/client/src/components/Settings/sections/AgentDataSection.tsx`
  - Added `harnessWorkflowTracePreview` UI state.
  - On `Show hints from trace`, persist returned `workflowTrace` for visual rendering.
  - On `Export experiment folder`, persist returned `workflowTrace` so the chips are available there too.
  - Added compact chip block under the harness actions:
    - required lanes rendered as small lane chips,
    - command route chips rendered as `command → lane` pills,
    - optional auth profile id badge on each route chip,
    - full reason/profile details preserved in tooltip (`title`) for hover inspect.
  - Errors clear the preview state to avoid stale lane chips.

Validation:
- Test pass:
  - `node --import tsx/esm --test src/lib/orchestrator/orchestratorHarnessOptimizer.test.ts`
- Build pass:
  - `npm run -s build --workspace=packages/client`
  - existing non-blocking Vite warnings only.

Next:
- Optional: add lane-color mapping by lane type (`oauth`, `browser_session`, `hybrid_router`) for even faster visual triage.

## 2026-04-22 08:02:45 PDT — Slice 5 trace UI follow-up: surface workflow auth-lane context in harness trace report
Goal: continue Slice 5 by exposing `workflow_trace_context` rows in a user-visible Trace UI path (Harness traces analyzer/report) so lane/provenance is visible without opening raw JSONL.

Completed:
- Added workflow trace extraction in harness optimizer:
  - `packages/client/src/lib/orchestrator/orchestratorHarnessOptimizer.ts`
  - new exported helper: `extractWorkflowTraceSummary(raw)`
  - parses latest custom row where `kind="custom"` and `label="workflow_trace_context"`
  - returns normalized summary:
    - `requiredLanes[]`
    - `routes[]` with `command`, `lane`, `laneReason`, `authProfileId`
- Extended optimizer APIs to carry workflow trace summary:
  - `analyzeHarnessTraceSession(...)` now returns `workflowTrace`
  - `exportHarnessExperimentArchive(...)` now includes `workflowTrace` in returned payload and `stats.json`
  - experiment `report.md` now includes a “Workflow auth-lane context” section with up to 8 route lines.
- Surfaced workflow trace summary in settings trace panel output:
  - `packages/client/src/components/Settings/sections/AgentDataSection.tsx`
  - “Show hints from trace” report now prints:
    - `workflow: required_lanes=...`
    - `route: <command> -> <lane> reason=... profile=...`
- Added regression coverage:
  - `packages/client/src/lib/orchestrator/orchestratorHarnessOptimizer.test.ts`
  - validates extractor picks latest workflow context row and captures lane reason/profile id.

Validation:
- Tests pass:
  - `node --import tsx/esm --test src/lib/orchestrator/orchestratorHarnessOptimizer.test.ts src/lib/orchestrator/runOrchestrator.workflowTraceContext.test.ts`
- Build pass:
  - `npm run -s build --workspace=packages/client`
  - non-blocking existing Vite warnings only.

Next:
- Optional polish: add a compact dedicated UI block/chips for workflow lane routes (instead of plain report text) in the Harness traces accordion.

## 2026-04-22 07:57:58 PDT — Reliability+semantics+trace parity execution wave (workspace/resume, 404/403 UX, live context strip)
Goal: execute the full reliability-first sequence in order: workspace-switch/resume hardening, error semantics surfacing, then one focused Hermes Lead trace parity slice with conformance/doc gates after each slice.

Completed:
- Slice 1 — workspace-switch/resume regression hardening
  - `packages/client/src/lib/orchestrator/interruptionResume.queued.integration.test.ts`
    - added regression: queued interruption runs pin to original workspace root despite rapid workspace change before dequeue.
  - `packages/client/src/store/orchestratorSessionStore.ts`
    - `QueuedRun` now carries `workspaceRoot`.
    - run path now normalizes/uses `queued.workspaceRoot` when present.
    - queued interruption/model-switch restart/sub-agent handoff queue items now persist workspace root.
    - run metadata writes now use the resolved per-run workspace root (no mid-run store drift).
    - delegation resume grounding now uses resolved per-run workspace root.
- Slice 2 — error semantics + concise surfacing
  - `packages/client/src/lib/tauri.ts`
    - introduced `WorkspaceHttpError` + `classifyWorkspaceHttpError(...)` with kinds:
      - `not_found` (404),
      - `forbidden` (403),
      - `internal` (other failure statuses).
    - browser fallback file APIs (`readDirectory`, `readFile`, `writeFile`, `deletePath`) now throw classified errors with concise actionable messages.
  - `packages/client/src/lib/orchestrator/executeTools.ts`
    - added workspace HTTP error payload extraction.
    - `read_file` / `list_directory` now return structured error extras (`error_kind`, `error_title`, `error_status`, `error_path`) and push concise header-level subtitle/status on the active orchestrator tile for path/permission/internal failures.
  - Added tests:
    - `packages/client/src/lib/tauri.workspaceHttpError.test.ts`.
- Slice 3 — focused Hermes Lead trace parity slice (performance-safe)
  - `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`
    - added `resolveContextUsedTokens(...)` and switched live context strip to stable max-of-signals selection (usage/stream estimate/session estimate) for consistent runtime context display.
  - `packages/client/src/components/orchestrator/OrchestratorTracePeekRows.tsx`
    - added `compactTracePeekLine(...)` for cleaner tool-trace readability in peek rows (whitespace normalization, bounded truncation, duration suffix preservation).
    - added full-line `title` tooltip on compacted rows.
  - Added tests:
    - `packages/client/src/components/orchestrator/__tests__/orchestratorContextStripTokens.test.ts`
    - expanded `packages/client/src/components/orchestrator/__tests__/OrchestratorTracePeekRows.test.ts`.

Validation:
- Targeted regression/tests pass:
  - `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/interruptionResume.queued.integration.test.ts`
  - `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/tauri.workspaceHttpError.test.ts src/lib/orchestrator/interruptionResume.queued.integration.test.ts src/components/orchestrator/__tests__/OrchestratorTracePeekRows.test.ts src/components/orchestrator/__tests__/orchestratorContextStripTokens.test.ts`
- Build pass:
  - `npm run -s build --workspace=packages/client`
- Conformance split (after each slice) remains green:
  - `wave1-workspace-resume-2026-04-22` → `passRate=1`, `p0HardFail=false`, `overallPass=true`
  - `wave2-error-semantics-2026-04-22` → `passRate=1`, `p0HardFail=false`, `overallPass=true`
  - `wave3-trace-parity-2026-04-22` → `passRate=1`, `p0HardFail=false`, `overallPass=true`
- Missing-path repro now returns semantic status (no false internal):
  - `curl ... /api/files?path=/Users/ghost/Desktop/DOES_NOT_EXIST` → `404`
  - `curl ... /api/file?path=/Users/ghost/Desktop/DOES_NOT_EXIST/file.txt` → `404`
- Active tauri log stream shows missing-path traffic as `status=404` (not `500`).

Next:
- Run quick manual UX pass in 2–3 real workflows to snapshot before/after trace readability + context strip behavior in screenshots/clips.
- If desired, split/commit these wave files separately from unrelated dirty-tree changes.

## 2026-04-22 07:53:21 PDT — Harness JSONL wiring for workflow/auth lane context
Goal: continue Slice 5 by emitting workflow/auth routing context directly into harness JSONL traces at run start.

Completed:
- Added run-level workflow trace custom event plumbing in orchestrator loop:
  - `packages/client/src/lib/orchestrator/runOrchestrator.ts`
  - new helper: `buildWorkflowTraceCustomEvent(traceContext, ts)`
  - `RunOrchestratorOptions` now accepts `workflowTraceContext?: Record<string, unknown> | null`
  - when `run_start` trace is written, orchestrator now appends a second custom JSONL row:
    - `kind: "custom"`
    - `label: "workflow_trace_context"`
    - `payload`: workflow/auth lane metadata (no secret plaintext)
- Added one-shot mapping helper and runtime handoff:
  - `packages/client/src/lib/orchestrator/oneShot/oneShotWorkflowResolver.ts`
    - new `buildWorkflowAuthTraceContext(intent)`
  - `packages/client/src/lib/orchestrator/oneShot/oneShotPipeline.ts`
    - every phase run now passes `workflowTraceContext` into `runOrchestratorAgent(...)`.
- Added regression tests:
  - `packages/client/src/lib/orchestrator/runOrchestrator.workflowTraceContext.test.ts`
  - expanded `packages/client/src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts` with trace-context assertions.
- Added sample JSONL artifact demonstrating emitted custom trace row shape:
  - `hermes-dev/artifacts/slice5-auth-lanes/workflow-trace-context.sample.jsonl`

Validation:
- Tests pass:
  - `node --import tsx/esm --test src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts src/lib/orchestrator/oneShot/authProfileStore.test.ts src/lib/orchestrator/runOrchestrator.workflowTraceContext.test.ts`
  - `node --import tsx/esm --test src/store/settingsStore.test.ts src/lib/orchestrator/oneShot/authProfileStore.test.ts src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts src/lib/orchestrator/runOrchestrator.workflowTraceContext.test.ts src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts`
- Build pass:
  - `npm run -s build --workspace=packages/client`
- Artifact check:
  - sample JSONL includes `workflow_trace_context` row with command-level `lane`, `laneReason`, and `authProfileId` fields.

Next:
- Optional UI follow-up: surface `workflow_trace_context` custom rows in Trace panel chips so users see lane reasons without opening raw files.

## 2026-04-22 07:34:41 PDT — Slice 5 trace evidence: lane reason + auth profile provenance
Goal: continue Slice 5 by making lane selection traceable per command and generating concrete Drive/X trace artifacts.

Completed:
- Extended one-shot workflow lane routing trace detail:
  - `packages/client/src/lib/orchestrator/oneShot/oneShotWorkflowResolver.ts`
  - `RoutedCommand` now includes:
    - `laneReason`
    - `authProfileId`
  - Added deterministic reason tagging:
    - `command_prefix:gdrive`
    - `command_prefix:x`
    - `target_type:official_api|browser_ui|hybrid`
    - `auth_profile:<id>;match:<pack|target_app|target_domain>`
- Context rendering now emits lane reason + profile provenance in routing seed lines.
- Added/updated resolver tests:
  - `packages/client/src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts`
  - asserts lane reason for X flow and auth profile provenance for profile-routed flow.
- Generated Slice 5 trace artifacts (catalog resolver evidence):
  - `hermes-dev/artifacts/slice5-auth-lanes/x-post-flow.trace.json`
  - `hermes-dev/artifacts/slice5-auth-lanes/drive-upload-flow.trace.json`
  - Both files include matched workflows, command chain, risk, required lanes, preflight checks, per-command lane reason + auth profile id.

Validation:
- Tests pass:
  - `node --import tsx/esm --test src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts src/lib/orchestrator/oneShot/authProfileStore.test.ts`
  - `node --import tsx/esm --test src/store/settingsStore.test.ts src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts src/lib/orchestrator/oneShot/authProfileStore.test.ts`
- Client build pass:
  - `npm run -s build --workspace=packages/client`
- Artifact sanity parse pass:
  - confirms X artifact includes `x-post-update` and lane `browser_session`
  - confirms Drive artifact includes `drive-upload-then-clean-local` and lane `oauth`

Next:
- Optional: wire these trace fields into harness JSONL run traces for direct UI display, not just workflow seed context/artifact snapshots.
- Optional: add redaction assertion tests to guarantee only secret refs (never plaintext session/token).

## 2026-04-22 07:20:03 PDT — Slice 5 auth lanes wired into settings + resolver runtime path
Goal: continue step-five implementation with visible progress by wiring auth profile persistence into settings and applying profile-based lane resolution in one-shot runtime.

Completed:
- Settings store now persists hybrid auth profiles (`hybridAuthProfiles`) with normalization/validation:
  - `packages/client/src/store/settingsStore.ts`
  - added `normalizeHybridAuthProfiles(...)`, `setHybridAuthProfiles(...)`, and `upsertHybridAuthProfile(...)`.
  - persist `partialize` + `merge` now include `hybridAuthProfiles`.
- Added settings normalization regression coverage:
  - `packages/client/src/store/settingsStore.test.ts`
  - verifies invalid hybrid auth profile records are rejected during normalization.
- One-shot resolver now supports profile-aware command lane routing:
  - `packages/client/src/lib/orchestrator/oneShot/oneShotWorkflowResolver.ts`
  - `resolveWorkflowIntent(..., { authProfiles })` added.
  - routing now prefers matched auth profile lane logic for workflow pack/app/domain matches.
- Added resolver test for profile-based lane override:
  - `packages/client/src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts`
  - verifies `hiring-ops` workflow command can route via browser-session when profile demands it.
- One-shot runtime now passes persisted auth profiles into resolver in both entry paths:
  - `packages/client/src/lib/orchestrator/oneShot/oneShotPipeline.ts`
- Added minimal settings UI surface for auth-lane records:
  - `packages/client/src/components/Settings/sections/ModelsSection.tsx`
  - new “Hybrid auth lanes” accordion with JSON editor and explicit validate/save action.

Validation:
- Targeted tests pass:
  - `node --import tsx/esm --test src/store/settingsStore.test.ts src/lib/orchestrator/oneShot/authProfileStore.test.ts src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts`
- Client build pass:
  - `npm run -s build --workspace=packages/client`

Next:
- Add trace artifact fields for selected auth profile ID + lane decision reason per command.
- Add Drive upload flow + X post flow execution harness traces as Slice 5 DoD artifacts.

## 2026-04-22 07:16:52 PDT — Orca harness workspace/root resilience coverage added
Goal: start workspace switching resilience hardening by adding deterministic run-root resolution tests before runtime behavior changes.

Completed:
- Exported run-root resolver for direct deterministic unit coverage:
  - `packages/client/src/lib/orchestrator/runOrchestrator.ts`
  - `resolveEffectiveWorkspaceRootForRun(...)` is now exported.
- Added new targeted test suite:
  - `packages/client/src/lib/orchestrator/runOrchestrator.workspaceRoot.test.ts`
  - coverage includes:
    - explicit run root precedence over store root,
    - fallback to store root when run root is `.` / empty / null,
    - null behavior when both run/store roots are unusable,
    - project-scoped workspace guard generation + non-project null behavior.
- Validation:
  - targeted orchestrator guards suite pass:
    - `runOrchestrator.workspaceRoot.test.ts`
    - `runOrchestrator.finalResponseGuard.test.ts`
  - conformance eval repeatability remains green:
    - `wave-harness-2026-04-22c` (`passRate=1`, `p0HardFail=false`, `overallPass=true`).
  - client build pass.

Next:
- Add session-store-level regression that simulates rapid workspace switch + queued/resume handoff to verify no stale-root leak into run metadata/trace.

## 2026-04-22 07:13:05 PDT — Orca harness wave started: conformance baseline + reliability verification pass
Goal: begin harness-first execution wave focused on conformance gate health and reliability evidence before new code changes.

Completed:
- Ran conformance harness eval baseline:
  - `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate wave-harness-2026-04-22a --split conformance`
  - result: `taskSource=primary`, `passRate=1`, `p0HardFail=false`, `overallPass=true`.
- Ran targeted reliability/conformance test bundle in `packages/client` covering:
  - `harnessEval/evaluateHarnessSuite.test.ts`
  - `harnessEval/scoreAggregation.test.ts`
  - `interruptionResume.test.ts`
  - `interruptionResume.queued.integration.test.ts`
  - `waitForSubAgent.test.ts`
  - `orchestratorPromptLayers.test.ts`
- Observed one invocation-level failure (`storage.setItem is not a function`) when test bootstrap imports were omitted.
- Re-ran same bundle with required harness test imports (`registerSvgStub` + `registerLocalStorage`): all tests pass (26/26).
- Re-ran conformance eval for repeatability:
  - `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate wave-harness-2026-04-22b --split conformance`
  - result unchanged: `passRate=1`, `p0HardFail=false`, `overallPass=true`.
- Verified client build:
  - `npm run -s build --workspace=packages/client` (pass; non-blocking Vite chunk/externalization warnings only).

Validation:
- Conformance artifacts:
  - `.agent-canvas/harness/candidates/wave-harness-2026-04-22a/scores.json`
  - `.agent-canvas/harness/candidates/wave-harness-2026-04-22b/scores.json`
- Reliability/conformance tests: pass (26/26) with harness test bootstrap imports.
- Client build: pass.

Next:
- Move to harness structural hardening wave in order:
  1) workspace/root switching resilience deterministic tests + fixes,
  2) canvas-bridge timeout provenance cleanup,
  3) remaining standalone graph-path retirement cleanup.

## 2026-04-22 05:44:02 PDT — Slice 5 implementation resumed: auth-lane routing in one-shot runtime + seed sync
Goal: continue implementation after Slice 5 interruption by wiring auth-lane metadata into runtime intent resolution and trace-facing context.

Completed:
- Regenerated One-Shot catalog seed from source-of-truth JSON:
  - updated `packages/client/src/lib/orchestrator/oneShot/catalog/workflowCatalogSeed.ts`
  - now includes top-level `auth_lanes` block from `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json`.
- Extended `packages/client/src/lib/orchestrator/oneShot/oneShotWorkflowResolver.ts`:
  - added auth-lane model (`oauth | browser_session | per_step`),
  - added command-level lane routing heuristics (`gdrive.*` -> OAuth, `x.*` -> browser-session, otherwise target-type driven with hybrid per-step fallback),
  - added `authLanePlan` output on resolver result:
    - required lanes,
    - OAuth pre-run checks,
    - browser-session pre-run checks,
    - bounded-fallback flag,
    - per-workflow command routing map.
  - updated context rendering to include per-command lane annotations and auth preflight summary.
- Added `packages/client/src/lib/orchestrator/oneShot/authProfileStore.ts`:
  - introduces Slice-5 auth profile contract (`oauth | browser_session | hybrid`) with lane-specific validation,
  - stores only encrypted secret references (`tokenRef`, `sessionBundleRef`, `runtimeFingerprintRef`) and domain bindings,
  - includes deterministic command-lane resolver + local persistence helpers for future settings/runtime wiring.
- Added tests `packages/client/src/lib/orchestrator/oneShot/authProfileStore.test.ts` for validation, normalization, lane routing, and storage roundtrip.
- Updated `packages/client/src/lib/orchestrator/oneShot/oneShotPipeline.ts`:
  - research-phase logs now emit resolved auth lanes + preflight check summary alongside workflow matches.
- Updated tests in `packages/client/src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts`:
  - asserts X flow resolves to browser-session lane,
  - asserts Drive upload+cleanup flow resolves `gdrive.*` to OAuth and local cleanup to per-step,
  - asserts context includes auth-lane summary block.

Validation:
- `node --import tsx/esm --test src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts` (pass)
- `node --import tsx/esm --test src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts src/store/settingsStore.test.ts src/lib/providerConfig.test.ts src/lib/pasteTruncation.test.ts src/lib/inputAttachments.test.ts` (pass, 38/38)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-22 05:37:22 PDT — Spec continuation: Slice 5 auth lanes detailed contract
Goal: continue the Hermes Any-App Hybrid spec from Slice 4 into Slice 5 with concrete OAuth/browser-session/hybrid-router requirements and machine-readable defaults.

Completed:
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-SPEC-AUTH.md`:
  - added `Slice 5 execution spec — Auth lanes (normative)` section,
  - defined Lane A OAuth (Google Drive first) with PKCE/bootstrap, token storage, refresh, and pre-run health checks,
  - defined Lane B browser-session (X first) with encrypted bundle contract and `healthy|expiring|invalid` states,
  - defined Lane C hybrid router policy, bounded fallback, and per-step trace transparency,
  - added Slice 5 verification gate list aligned to Drive upload + X post acceptance.
- Updated `hermes-dev/HERMES-ANY-APP-IMPLEMENTATION-PLAN.md`:
  - expanded Slice 5 deliverables and definition-of-done details,
  - replaced immediate next tasks with Slice 5 implementation tasks.
- Updated `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json`:
  - added top-level `auth_lanes` metadata block for OAuth/browser-session/hybrid routing defaults.
- Updated `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.md`:
  - documented that JSON companion now includes `auth_lanes` defaults.

Validation:
- Parsed `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json` successfully:
  - `catalog_id=hermes-any-app-workflows`
  - `workflow_count=20`
  - `auth_lanes=true`

## 2026-04-21 23:39:05 PDT — Slice 4 complete: one-shot workflow catalog runtime resolver + NL intent command mapping
Goal: wire machine-readable workflow catalog seeds into one-shot runtime so natural-language prompts map to concrete workflow command hints before spec/decomposition/codegen.

Completed:
- Added seeded catalog source for runtime resolver:
  - `packages/client/src/lib/orchestrator/oneShot/catalog/workflowCatalogSeed.ts`
  - generated from `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json`.
- Added resolver module:
  - `packages/client/src/lib/orchestrator/oneShot/oneShotWorkflowResolver.ts`
  - provides:
    - `resolveWorkflowIntent(query, { topK, minScore })`
    - `renderWorkflowIntentContext(intent)`
  - scoring combines title/pack/example/command/slot overlap with risk-sensitive bias for destructive language.
  - output includes ranked workflow matches, combined command hints, and approval-required flags.
- Integrated resolver into one-shot runtime pipeline:
  - updated `packages/client/src/lib/orchestrator/oneShot/oneShotPipeline.ts`
  - research and spec phases now inject catalog-derived workflow routing context into orchestrator user prompts.
  - research phase logs matched workflow ids/risk to the one-shot run log.
- Added tests:
  - `packages/client/src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts`
  - validates X posting routing, destructive Drive cleanup routing + approval flag, no-op unmatched prompt behavior, and context rendering.

Validation:
- `node --import tsx/esm --test src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts` (pass)
- `node --import tsx/esm --test src/lib/orchestrator/oneShot/oneShotWorkflowResolver.test.ts src/store/settingsStore.test.ts src/lib/providerConfig.test.ts src/lib/pasteTruncation.test.ts src/lib/inputAttachments.test.ts` (pass, 38/38)
- `npm run -s build --workspace=packages/client` (pass)
- `cargo check` in `src-tauri` (pass)

## 2026-04-21 22:53:40 PDT — Hermes memory philosophy + behavior-contract parity wave
Goal: implement explicit Hermes-style memory philosophy (deterministic trigger + recall/write reflex) and policy-encoded behavior contracts in Orca, then validate and document exact trigger semantics.

Completed:
- Added `packages/client/src/lib/orchestrator/orchestratorBehaviorPolicy.ts`:
  - fixed turn priority order constant (`safety > user_immediate_request > grounding > continuity > efficiency > verbosity`),
  - deterministic cross-session recall trigger detection,
  - deterministic durable-memory write trigger detection,
  - turn-level reflex guard builder,
  - behavior-contract + memory-philosophy prompt block builder.
- Added tests `packages/client/src/lib/orchestrator/orchestratorBehaviorPolicy.test.ts` covering:
  - fixed ordering,
  - recall trigger detection,
  - write trigger detection,
  - guard generation/no-trigger null behavior,
  - contract block content.
- Updated `packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts`:
  - dynamic preface now injects behavior-contract block for every run.
- Updated `packages/client/src/lib/orchestrator/runOrchestrator.ts`:
  - turn start now injects behavior reflex override system message when memory/continuity triggers are present.
- Updated lead-mode parity in `packages/client/src/lib/orchestrator/orchestratorToolFilter.ts` and prompt text:
  - lead allowlist now includes `memory` (with existing `session_search`),
  - lead tool contract line lists `memory` + `session_search`.
- Updated tool semantic guidance in `packages/client/src/lib/orchestrator/toolDefinitions.ts`:
  - `memory` description now encodes durable-only write policy,
  - `session_search` description now encodes proactive recall behavior.
- Updated docs:
  - added `hermes-dev/HERMES-MEMORY-PHILOSOPHY-PARITY-SPEC.md` with full trigger/priority/implementation spec,
  - updated `hermes-dev/NEXT-STEPS.md` with DONE entry for this parity wave.

Validation:
- `node --import tsx/esm --test src/lib/orchestrator/orchestratorBehaviorPolicy.test.ts src/lib/orchestrator/orchestratorPromptLayers.test.ts src/lib/orchestrator/orchestratorToolFilter.test.ts src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 22:40:27 PDT — Slice 2 complete: hybrid shell mode switch (desktop sidebar vs spotlight launcher)
Goal: implement persisted GUI shell mode selection so users can run Orca as either a persistent right-side orchestrator panel or spotlight/quick-input launcher mode.

Completed:
- Updated `packages/client/src/store/settingsStore.ts`:
  - added `HybridGuiShellMode` (`desktop_sidebar` | `spotlight_launcher`),
  - added normalization helper `normalizeHybridGuiShellMode(...)`,
  - added persisted state + setter:
    - `hybridGuiShellMode`,
    - `setHybridGuiShellMode(...)`,
  - wired mode into persist `partialize` and hydration `merge` normalization.
- Updated `packages/client/src/components/Settings/sections/AppearanceSection.tsx`:
  - added “Hybrid shell mode” settings block with explicit selectable options:
    - Desktop sidebar (persistent right chat panel),
    - Spotlight launcher (quick input only).
- Updated `packages/client/src/App.tsx`:
  - derived `showOrchestratorDock` from persisted shell mode + existing focus/plan constraints,
  - right orchestrator dock + drag handle + reveal tab now render only in desktop sidebar mode,
  - when switching to spotlight mode while orchestrator panel is active, app auto-returns panel to explorer to avoid hidden-active panel state,
  - toast container right offset now follows new dock visibility predicate.
- Updated `packages/client/src/store/settingsStore.test.ts`:
  - added coverage for `normalizeHybridGuiShellMode` fallback behavior.

Validation:
- `node --import tsx/esm --test src/store/settingsStore.test.ts src/lib/providerConfig.test.ts src/lib/pasteTruncation.test.ts src/lib/inputAttachments.test.ts` (pass, 34/34)
- `npm run -s build --workspace=packages/client` (pass)
- `cargo check` in `src-tauri` (pass)

## 2026-04-21 22:35:45 PDT — Hermes memory + recall tool compatibility wired into Orca orchestrator
Goal: implement Hermes-style memory/recall tool names and behaviors directly in Orca so orchestrator runs can use `memory` and `session_search` contracts.

Completed:
- Added new orchestrator tool definitions in `packages/client/src/lib/orchestrator/toolDefinitions.ts`:
  - `memory` (Hermes-shape args: `action`, `target`, `content`, `old_text`)
  - `session_search` (query/search + browse mode; alias wrapper for recall semantics)
- Added execution support in `packages/client/src/lib/orchestrator/executeTools.ts`:
  - `memory`:
    - desktop-only (`~/.orca`),
    - `target=memory` -> `~/.orca/MEMORY.md`,
    - `target=user` -> `~/.orca/USER.md`,
    - supports `add|replace|remove` mutation semantics.
  - `session_search`:
    - with query -> FTS recall via persisted session index,
    - without query -> browse-mode listing of resumable recent sessions (incomplete-session metadata) when available.
- Updated orchestrator guidance/system-prompt text in `packages/client/src/lib/orchestrator/runOrchestrator.ts`:
  - continuity guidance now points to `session_search` (alias `recall_session_history`),
  - full tool list now includes `memory` + `session_search`.
- Updated lead allowlist in `packages/client/src/lib/orchestrator/orchestratorToolFilter.ts` to include `session_search`.
- Updated tool concurrency mapping in `packages/client/src/lib/harness/toolConcurrency.ts`:
  - `session_search` => readonly
  - `memory` => write
- Added/updated tests:
  - updated `packages/client/src/lib/orchestrator/orchestratorToolFilter.test.ts` to assert `memory` and `session_search` are present.
  - added `packages/client/src/lib/orchestrator/executeTools.memory-session-search.test.ts` for alias runtime behavior.

Validation:
- `node --import tsx/esm --test src/lib/orchestrator/orchestratorToolFilter.test.ts` (pass)
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/executeTools.memory-session-search.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 22:33:40 PDT — Slice 1 complete: hybrid runtime policy validation wired into Settings save/load path
Goal: finish Slice 1 by wiring provider-config validation into persisted Settings hydration for `runtimePolicies.localOrchestrator` and `runtimePolicies.hermesLead`.

Completed:
- Updated `packages/client/src/store/settingsStore.ts`:
  - added hybrid runtime policy state fields:
    - `hybridProviderConfigJson`,
    - `hybridProviderConfigErrors`,
    - `hybridProviderConfig`,
    - `hybridRuntimePolicies`.
  - added save/load helpers:
    - `normalizeHybridRuntimePolicies(...)`,
    - `validateHybridRuntimePolicyRefs(...)`,
    - `resolveHybridProviderConfigState(...)`.
  - added defaults + setters:
    - `DEFAULT_HYBRID_RUNTIME_POLICIES`,
    - `setHybridProviderConfigJson(...)`,
    - `setHybridRuntimePolicy(...)`,
    - `clearHybridProviderConfigErrors(...)`.
  - integrated into persist flow:
    - `partialize` now saves `hybridProviderConfigJson` + `hybridRuntimePolicies`,
    - `merge` now validates/hydrates parsed config + effective runtime policies.
- Updated `packages/client/src/store/settingsStore.test.ts`:
  - added regression tests for hybrid runtime policy normalization,
  - added valid-config hydration test,
  - added runtime policy reference validation test.

Validation:
- `node --import tsx/esm --test src/store/settingsStore.test.ts src/lib/providerConfig.test.ts` (pass, 28/28)
- `npm run -s build --workspace=packages/client` (pass)
- `cargo check` in `src-tauri` (pass)

## 2026-04-21 22:19:05 PDT — Dev server 500 burst diagnostics + Rust server trace hardening
Goal: investigate tauri:dev watch-pattern ERROR burst (`tower_http::trace::on_failure` 500s) and improve observability for next repro.

Completed:
- Pulled live process log from `proc_d2ab9531d0f9` and correlated events.
- Confirmed separate concrete workspace error later in run:
  - `Path does not exist: /Users/ghost/Desktop/OrcaDesign/orca-design/claude-clone` (Tauri side, not generic 500).
- Added richer Rust server HTTP trace configuration in `agent-canvas-server/src/lib.rs`:
  - switched from bare `TraceLayer::new_for_http()` to explicit
    `on_response(DefaultOnResponse::new().level(Level::INFO))`
    and `on_failure(DefaultOnFailure::new().level(Level::ERROR))`.
- Kept existing orchestrator workspace contradiction hardening from prior step.

Validation:
- `cargo check -p agent-canvas-server` (pass)
- dev process remained running after diagnostics (`process poll`)

## 2026-04-21 22:15:43 PDT — Regular orchestrator telemetry hardening (open_workspace contradiction guard)
Goal: address regular-mode run where model claimed workspace path invalid immediately after successful open_workspace.

Completed:
- Investigated telemetry export: `/Users/ghost/Downloads/orca-telemetry-20260421-221237.csv`.
- Confirmed sequence:
  - `open_workspace` executed and returned `ok` (75ms),
  - subsequent assistant text still claimed path invalid.
- Hardened orchestrator system prompt in `packages/client/src/lib/orchestrator/runOrchestrator.ts`:
  - explicit rule: when `open_workspace` returns ok, treat path as active/accessible,
  - do not claim invalid path unless a later tool reports concrete error,
  - require immediate verification via `list_directory('.')` or delegated worker in lead-delegation mode.
- Hardened `open_workspace` tool result in `packages/client/src/lib/orchestrator/executeTools.ts`:
  - added `verifiedAccessible: true`,
  - added `nextStep` guidance for deterministic post-switch verification.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 22:06:01 PDT — Vision routing fix + Space Agent web infrastructure spec
Goal: fix broken image-attachment flows (provider lock) and define the Space-Agent-informed web infrastructure target.

Completed:
- Fixed vision model routing in `packages/client/src/store/orchestratorSessionStore.ts`:
  - removed hard Z.AI-only gate for image attachments,
  - switched to `pickPreferredVisionModel(...)` selection,
  - kept Z.AI preprocess/fallback logic only when selected provider is Z.AI,
  - generalized no-result error text to provider-agnostic wording.
- Fixed agent tile vision path in `packages/client/src/components/tiles/AgentTile.tsx`:
  - removed hard Z.AI-only gate,
  - switched to provider-agnostic vision model selection,
  - gated Z.AI preprocess to Z.AI-only branch,
  - generalized user-facing messaging.
- Added regression coverage in `packages/client/src/lib/modelRouting.test.ts` for:
  - non-Z.AI vision selection,
  - Z.AI preference when current provider is Z.AI,
  - ranked image-capable list behavior.
- Added new infrastructure spec:
  - `hermes-dev/SPACE-AGENT-WEB-INFRASTRUCTURE-SPEC.md`
  - defines web-first architecture, GitHub auth/repo access, workspace persistence tiers, vision subsystem contract, and Space Agent canvas invariants.
- Updated adaptation doc cross-link:
  - `hermes-dev/SPACE-AGENT-CANVAS-ADAPTATION.md` -> companion web infrastructure spec link.

Validation:
- `node --import tsx/esm --test src/lib/modelRouting.test.ts` (pass)
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/orchestratorMultiAgent.test.ts src/lib/orchestrator/interruptionResume.queued.integration.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 21:55:46 PDT — Web-first architecture direction captured (GitHub login + workspace tiers)
Goal: align hybrid spec with web-first runtime direction and explicit workspace persistence model discussed in session.

Completed:
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-SPEC-AUTH.md` goal from desktop-first to web-first.
- Added `Deployment + workspace persistence model (web-first)` section with:
  - default encrypted local browser storage,
  - optional encrypted cloud workspace,
  - optional GitHub-backed workspace for versioned assets.
- Added GitHub OAuth/repository-access constraints: least-privilege scopes, explicit repo selection, and guidance not to blindly commit high-churn runtime state.

Validation:
- Documentation consistency check passed (section inserted under workflow-pack model and before embedded-browser requirements).

## 2026-04-21 20:49:00 PDT — Added provider-config parser/validator module and tests
Goal: continue Slice 1 by turning provider schema docs into executable runtime validation logic.

Completed:
- Added `packages/client/src/lib/providerConfig.ts`:
  - `validateHybridProviderConfig(...)` structural validator,
  - `parseAndValidateHybridProviderConfig(...)` JSON parse + validation wrapper,
  - typed contracts for providers/models/runtime policies.
- Added `packages/client/src/lib/providerConfig.test.ts`:
  - validates `hermes-dev/HERMES-ANY-APP-PROVIDER-CONFIG.example.json` passes,
  - verifies invalid reasoning-mode failure path,
  - verifies parse-error handling.
- Extended spotlight/toolbar quick input to apply the same large-paste truncation policy used by the main orchestrator composer.

Validation:
- `node --import tsx/esm --test src/lib/providerConfig.test.ts src/lib/pasteTruncation.test.ts src/lib/inputAttachments.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)
- `cargo check` in `src-tauri` (pass)

## 2026-04-21 20:38:00 PDT — Implemented composer truncation + clipboard-image local-path attachments
Goal: start executing the hybrid spec in code by shipping core input/composer behaviors (large paste truncation + image paste pathing on desktop).

Completed:
- Added `packages/client/src/lib/pasteTruncation.ts` + `pasteTruncation.test.ts`:
  - instant large-text paste truncation with token format
    `[TRUNCATED: kept/total lines, kept/total chars]`.
- Updated `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`:
  - paste handler now:
    - routes clipboard images through attachment flow with `preferLocalImagePaths`,
    - truncates oversized plain-text paste inline and inserts tokenized body,
    - emits info toast with kept/total line counts.
- Extended attachment model in `packages/client/src/lib/inputAttachments.ts`:
  - `sourcePath?: string` for local-system attachment provenance,
  - path drops now preserve absolute source path metadata,
  - user-content formatter includes local path context for images/files.
- Added desktop temp-image persistence bridge:
  - `saveClipboardImageTemp(...)` wrapper in `packages/client/src/lib/tauri.ts`,
  - new Tauri command `save_clipboard_image_temp` in `src-tauri/src/lib.rs`,
  - command registered in Tauri invoke handler.

Validation:
- `node --import tsx/esm --test src/lib/pasteTruncation.test.ts src/lib/inputAttachments.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)
- `cargo check` in `src-tauri` (pass)


## 2026-04-21 21:22:00 PDT — Wishlist parity implementation wave (P0-B/C/D/E + P1-6/7/8)
Goal: ship the remaining prioritized wishlist behavior set, validate across tests/harness/build, and sync spec/parity docs.

Completed:
- Added root execution spec:
  - `ORCA_HARNESS_WISHLIST_IMPLEMENTATION_SPEC.md`
- P0-B queued interruption deterministic regression:
  - added `packages/client/src/lib/orchestrator/interruptionResume.queued.integration.test.ts`
  - validates checkpoint capture -> interruption-first answer -> queued resume directive -> checkpoint clear.
- P0-C policy gate hardening:
  - updated `packages/client/src/lib/orchestrator/runOrchestrator.ts`
    - plan-only request detection and mutation-tool blocking guard during tool-call batches.
  - updated `packages/client/src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts`
    - added plan-only request/tool-block predicate tests.
  - prompt/conformance contract coverage present in:
    - `orchestratorPromptLayers.ts`
    - `harnessEval/tasks.conformance.json`
    - `harnessEval/evaluateHarnessSuite.ts`
- P0-E dreaming/world-model decommission hardening:
  - updated `packages/client/src/lib/orchestrator/executeTools.ts`
  - removed browser-action dream preflight coupling and `dream_warning` response path from browser tools.
- P1-6/7 trace UX parity:
  - added `packages/client/src/lib/orchestrator/traceNodeBudget.ts`
  - added `packages/client/src/lib/orchestrator/traceNodeBudget.test.ts`
  - updated `packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.tsx`
  - updated `packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.test.tsx`
  - updated `packages/client/src/components/tiles/AgentTile.tsx`
- P1-8 design extraction workflow v1:
  - added `packages/client/src/lib/orchestrator/designExtraction/`:
    - `schema.ts`, `schema.test.ts`
    - `promptTemplates.ts`, `promptTemplates.test.ts`
    - `normalizer.ts`, `normalizer.test.ts`
    - `service.ts`, `service.test.ts`
- Harness/conformance/reporting sync:
  - updated `harnessEval/evaluateHarnessSuite.ts` + tests
  - updated `harnessEval/cli.ts`
  - updated `harnessCandidates.ts`

Validation:
- Targeted/feature matrix tests:
  - `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/harnessEval/scoreAggregation.test.ts src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts src/lib/orchestrator/interruptionResume.test.ts src/lib/orchestrator/interruptionResume.queued.integration.test.ts src/lib/orchestrator/traceNodeBudget.test.ts src/components/tiles/agent-tile/AgentTraceDrawer.test.tsx src/lib/orchestrator/designExtraction/schema.test.ts src/lib/orchestrator/designExtraction/promptTemplates.test.ts src/lib/orchestrator/designExtraction/normalizer.test.ts src/lib/orchestrator/designExtraction/service.test.ts src/lib/orchestrator/hermesTracePresentation.test.ts src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` (pass)
- Harness eval splits:
  - `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split search` (pass)
  - `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split proactive` (pass)
  - `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split conformance` (pass, `p0HardFail=false overallPass=true`)
  - `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split memory` (pass, warm passRate=1)
  - `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split test` (pass)
- Build:
  - `npm run -s build --workspace=packages/client` (pass)

Docs synced:
- updated `hermes-dev/FEATURE-WISHLIST.md` (items 2/3/5/6/7/8 marked DONE)
- updated `hermes-dev/FEATURE-WISHLIST-PARITY.md` (items 2/3/4/5/6/7/8 moved to PARITY_READY)
- updated `hermes-dev/NEXT-STEPS.md` with DONE markers for queued interruption regression, trace-node wave, design extraction, and dream-cleanup slice.

## 2026-04-21 20:12:00 PDT — Added execution plan to continue building against spec
Goal: continue from schema/spec work into an ordered implementation track with concrete vertical slices.

Completed:
- Added `hermes-dev/HERMES-ANY-APP-IMPLEMENTATION-PLAN.md` with 7 delivery slices:
  1) provider schema/settings integration,
  2) dual GUI shell,
  3) composer ingestion pipeline,
  4) workflow-pack runtime,
  5) auth lanes,
  6) browser hub + registration wizard,
  7) observability + drift.
- Added immediate next implementation tasks and validation command set.
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-ONESHOT-PLAN.md` linked docs to include the implementation plan.

Validation:
- Verified implementation-plan doc creation and linked-doc update under `hermes-dev/`.

## 2026-04-21 20:04:00 PDT — Added provider-config schema + example and linked it across spec/runtime docs
Goal: continue spec buildout with deterministic Orca-parity multi-LLM settings contract (schema + starter config).

Completed:
- Added `hermes-dev/HERMES-ANY-APP-PROVIDER-CONFIG.schema.json`:
  - provider fields (`apiKeyRef`, `baseUrl`, `models`, `capabilities`),
  - fallback-chain definitions,
  - separate runtime policies for `localOrchestrator` and `hermesLead`,
  - secure key storage and trace policy requirements.
- Added `hermes-dev/HERMES-ANY-APP-PROVIDER-CONFIG.example.json` starter config:
  - includes hosted + OpenAI-compatible provider examples,
  - includes per-mode defaults and fallback override.
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-SPEC-AUTH.md`:
  - linked schema/example artifacts,
  - documented required provider-config sections.
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-ONESHOT-PLAN.md` linked docs to include machine-readable files + provider schema/example.
- Updated `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json`:
  - added pointers to provider schema/example under `llm_connectivity`.

Validation:
- Parsed all updated JSON files successfully.
- Verified example includes all schema top-level required keys and both runtime policies.

## 2026-04-21 19:52:00 PDT — Added Orca-parity multi-LLM connectivity requirements
Goal: ensure hybrid product allows users to connect and switch all preferred models/providers just like Orca.

Completed:
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-SPEC-AUTH.md`:
  - added `LLM provider connectivity (Orca-parity requirement)` section,
  - specified provider types (hosted, OpenAI-compatible, local gateway),
  - per-run selection, default preferences, fallback policy, and trace recording.
- Updated `hermes-dev/HERMES-ANY-APP-GUI-UX-SPEC.md`:
  - added settings parity note for multi-provider model configuration/switching.
- Updated `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json`:
  - added `llm_connectivity` machine-readable block.

Validation:
- Parsed JSON companion successfully and verified `llm_connectivity.provider_types` present.

## 2026-04-21 19:44:00 PDT — Added GUI interaction spec (sidebar + spotlight) and attachment/paste behavior
Goal: capture user-directed GUI modes and composer ingestion behaviors in the hybrid docs/spec and machine-readable companion.

Completed:
- Added `hermes-dev/HERMES-ANY-APP-GUI-UX-SPEC.md` with:
  - two user-selectable modes: persistent desktop sidebar (~25% responsive push) and spotlight launcher (Control+Space),
  - drag/drop files/photos, paste-image-to-local-path attachment flow,
  - instant large-text paste truncation token format + preview behavior,
  - performance targets and acceptance criteria.
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-SPEC-AUTH.md`:
  - added `GUI interaction model` section with normative requirements and link to GUI spec.
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-ONESHOT-PLAN.md`:
  - linked the GUI spec in `Linked specs/docs`.
- Updated `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json`:
  - added `ui_shell` block for mode/shortcut/layout/attachment behavior.

Validation:
- Parsed JSON companion successfully after updates (`20 workflows`, `ui_shell.modes` present).

## 2026-04-21 19:31:00 PDT — Generated machine-readable workflow catalog + Tauri browser hub/wizard spec additions
Goal: create a JSON companion for the 20 workflows and extend spec with embedded browser + favorite-app registration wizard requirements.

Completed:
- Added `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json`:
  - schema metadata, risk tiers, safety defaults,
  - 20 workflow records with stable IDs, user examples, command chains, slot requirements,
  - `tauri_browser_hub` section with default bookmark collections,
  - `registration_wizard` section with required onboarding steps and outputs.
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-SPEC-AUTH.md`:
  - linked machine-readable companion file,
  - added dedicated `Embedded browser hub (Tauri tab)` requirements,
  - added `App registration wizard` workflow/outputs.
- Updated `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.md` to reference JSON companion.

Validation:
- Verified JSON companion file creation and spec/catalog cross-links under `hermes-dev/`.

## 2026-04-21 19:20:00 PDT — Added 20 practical workflows to docs and spec scope
Goal: include a concrete workflow library in docs and wire it into the hybrid spec as normative MVP intent coverage.

Completed:
- Added `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.md` with 20 practical workflows:
  - each includes user utterance, pack/target, command chain, and risk tier.
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-SPEC-AUTH.md`:
  - added `Practical workflow catalog (20)` section,
  - linked the catalog doc,
  - listed 20 workflow IDs in spec scope.
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-ONESHOT-PLAN.md` linked-docs section to include both spec and workflow catalog.

Validation:
- Verified new catalog file and spec/plan cross-links under `hermes-dev/`.

## 2026-04-21 19:11:00 PDT — Added full hybrid spec with auth architecture (OAuth + browser-session)
Goal: expand examples into a concrete product/auth specification, including cookie/session strategy informed by real-world anti-bot constraints.

Completed:
- Added `hermes-dev/HERMES-ANY-APP-HYBRID-SPEC-AUTH.md` with:
  - target users and expanded use-case catalog,
  - workflow-pack data model and NL resolution pipeline,
  - auth tiering: official OAuth, browser-session bridge, hybrid,
  - cookie/session constraints (interactive bootstrap, encrypted bundle, domain binding, TTL, health checks),
  - security/privacy and MVP acceptance criteria.
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-ONESHOT-PLAN.md` with a linked-spec section pointing to the new spec.

Validation:
- Verified new spec file and plan-link patch are present in `hermes-dev/`.

## 2026-04-21 19:03:39 PDT — Start Orca Harness upgrades: P0-A bucket scoring + hard-fail gate
Goal: begin implementation from the Orca Harness wishlist by shipping P0-A (deterministic invariant bucket scoring + P0 hard-fail aggregation).

Completed:
- Added new score aggregation module:
  - `packages/client/src/lib/orchestrator/harnessEval/scoreAggregation.ts`
  - deterministic bucket mapping + severity rollups + P0 hard-fail + overall pass flag.
- Added new test coverage:
  - `packages/client/src/lib/orchestrator/harnessEval/scoreAggregation.test.ts`
  - validates p0 hard-fail behavior, p1-nonblocking behavior, and bucket counts.
- Wired aggregation into harness eval path:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
  - aggregates now include: `p0HardFail`, `overallPass`, `severity`, `buckets`.
- Updated harness eval CLI output:
  - `packages/client/src/lib/orchestrator/harnessEval/cli.ts`
  - now prints `p0HardFail` and `overallPass`.
- Extended score type surface:
  - `packages/client/src/lib/orchestrator/harnessCandidates.ts`
  - `HarnessCandidateScoresV1.aggregates` now supports severity/bucket/gate fields.
- Extended conformance test assertions:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts`
  - verifies aggregate gate fields are present and expected.
- Updated wishlist tracking/docs:
  - `hermes-dev/FEATURE-WISHLIST-PARITY.md` item 1 moved to `PARITY_READY` with evidence notes.
  - `hermes-dev/FEATURE-WISHLIST.md` item 1 marked DONE.
  - `hermes-dev/NEXT-STEPS.md` item 16 marked DONE with shipped artifacts.

Validation:
- `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/harnessEval/scoreAggregation.test.ts src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts` (pass)
- `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split conformance` (pass)
  - output includes: `p0HardFail=false overallPass=true`
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 19:02:00 PDT — Added target-user workflows + Twitter/X reusable pack example
Goal: expand the hybrid One-Shot plan with concrete user workflows showing login-once, API generation, reusable app packs, and natural-language invocation.

Completed:
- Updated `hermes-dev/HERMES-ANY-APP-HYBRID-ONESHOT-PLAN.md` with:
  - canonical Twitter/X flow from attach/discovery to `x.tweet.send` execution,
  - workflow-pack model for saving per-app capabilities,
  - NL invocation resolution path (utterance -> pack -> command -> typed inputs),
  - guardrails for approvals, allowlists, secrets, terms/rate-limit compliance,
  - milestone E refinement: workflow-pack library + NL resolver + drift health.

Validation:
- Verified markdown patch applies cleanly and section appears before milestone list.

## 2026-04-21 18:55:00 PDT — Added One-Shot plan for Hermes Any-App Hybrid
Goal: convert user concept (Orca center bar + quick orchestrator input + Hermes Lead option + EverythingIsAPI capability layer) into an executable One-Shot planning artifact.

Completed:
- Added `hermes-dev/HERMES-ANY-APP-HYBRID-ONESHOT-PLAN.md` with:
  - MVP scope, non-goals, and modular architecture,
  - copy/paste One-Shot idea prompt tailored to Orca phases/deliverables,
  - milestone cuts (A–E) and verification checklist.
- Prompt explicitly encodes safety tiers, destructive-action approvals, domain allowlist, trace visibility, and browser-first target attachment for MVP.

Validation:
- Verified markdown file creation under `hermes-dev/` with complete One-Shot prompt and acceptance criteria.

## 2026-04-21 18:53:29 PDT — Expand Orca Harness future wishlist planning depth
Goal: continue building the Orca Harness future wishlist with stronger forward planning structure (waves, readiness criteria, and timeline outlook).

Completed:
- Updated `hermes-dev/FEATURE-WISHLIST.md`:
  - refreshed timestamp,
  - added `Future waves (harness roadmap view)` section with F1/F2/F3/F4 sequencing.
- Updated `hermes-dev/FEATURE-WISHLIST-PARITY.md`:
  - refreshed timestamp,
  - added Definition of Ready (DoR) criteria,
  - added Definition of Done (DoD) criteria for `PARITY_READY`,
  - added 30/60/90 parity outlook milestones.
- Updated `hermes-dev/NEXT-STEPS.md`:
  - added item 20 to keep future-wave planning and DoR/DoD parity governance active.

Validation:
- Verified markdown patches applied across wishlist, parity board, next-steps, and worklog docs.


## 2026-04-21 18:27:45 PDT — Full wishlist parity board added (entire Orca wishlist)
Goal: satisfy request for full parity coverage across the entire Orca feature wishlist with one explicit status/evidence board.

Completed:
- Added `hermes-dev/FEATURE-WISHLIST-PARITY.md`:
  - covers every open wishlist item end-to-end (P0, P1, memory track, P2, secondary backlog),
  - defines parity states (`NOT_STARTED`, `IN_PROGRESS`, `PARITY_READY`),
  - defines parity evidence requirements (runtime + tests/evaluators + docs/worklog),
  - includes P0/P1 gate rules and validation baseline commands.
- Updated `hermes-dev/FEATURE-WISHLIST.md`:
  - refreshed timestamp,
  - added explicit pointer that full parity tracking lives in `FEATURE-WISHLIST-PARITY.md`.
- Updated `hermes-dev/README.md` file index to include parity board doc.
- Updated `hermes-dev/NEXT-STEPS.md` with a dedicated `Full wishlist parity program` item.

Validation:
- Verified markdown file creation and patch application across wishlist, next-steps, readme, and worklog docs.

## 2026-04-21 18:23:40 PDT — Re-scope wishlist to Orca harness only (drop world-model expansion)
Goal: align roadmap with user direction to stop world-model feature updates for Orca and keep wishlist focused on harness reliability/conformance/UX.

Completed:
- Updated `hermes-dev/FEATURE-WISHLIST.md`:
  - added explicit scope lock (`Orca harness + orchestrator only`, no world-model/dreaming expansion),
  - added P0 item for dreaming/world-model decommission completion in Orca harness,
  - updated numbering and sprint ordering to prioritize decommission + reliability gates,
  - added Sprint Card `P0-E` for decommission hardening proof criteria.
- Updated `hermes-dev/NEXT-STEPS.md`:
  - replaced cross-repo sync item with Orca harness scope-lock item and decommission focus.

Validation:
- Verified markdown patch application and section consistency in `FEATURE-WISHLIST.md`, `NEXT-STEPS.md`, and `WORKLOG.md`.

## 2026-04-21 18:21:17 PDT — Keep building wishlist into executable sprint cards + command packs
Goal: convert wishlist priorities into immediately runnable planning artifacts for both Orca and macworldmodel.

Completed:
- Extended `hermes-dev/FEATURE-WISHLIST.md` with a concrete sprint card pack:
  - P0-A bucket scoring + hard-fail card
  - P0-B queued interruption deterministic resume card
  - P0-C skills runtime policy gate card
  - P0-D reliability evidence sweep card
- Extended `/Users/ghost/Desktop/macworldmodel/Hermes Research/FEATURE-WISHLIST.md` with a command pack section sourced from reproducibility docs:
  - environment/bootstrap commands
  - training commands (cartpole/pendulum/multi-env)
  - eval commands (rollout/planning/probe)
  - seed summary aggregation command using `world_model/src/summarize_seed_runs.py`
- Updated timestamps in both wishlist files.

Validation:
- Verified markdown patch application in both repositories.

## 2026-04-21 18:17:25 PDT — Continue wishlist build-out across Orca + MacWorldModel
Goal: deepen the living wishlists from high-level priorities into execution/gating artifacts usable for sprint selection and release decisions.

Completed:
- Expanded `hermes-dev/FEATURE-WISHLIST.md` with:
  - dependency map between P0/P1 items,
  - release-gate checklist for conformance/scoring/interruption/telemetry/build,
  - explicit defer-until-later scope controls to protect reliability-first sequencing.
- Expanded `/Users/ghost/Desktop/macworldmodel/Hermes Research/FEATURE-WISHLIST.md` with:
  - ordered next experiment tranche,
  - research gate checklist for benchmark-grade claim readiness,
  - defer-until-later constraints to prevent speculative drift.
- Updated timestamps in both wishlist files.

Validation:
- Verified markdown patches applied in both repositories.

## 2026-04-21 18:13:04 PDT — Sync root wishlist spec into hermes-dev active board
Goal: sync the new root-level wishlist spec into the `hermes-dev` living backlog so roadmap and sprint tracking stay aligned.

Completed:
- Updated `hermes-dev/FEATURE-WISHLIST.md` as a synced, open-only execution board.
- Pointed `FEATURE-WISHLIST.md` source-of-truth to `/Users/ghost/Desktop/orca/ORCA_FEATURE_WISHLIST_SPEC.md`.
- Synced priority tracks and execution order:
  - P0 conformance/gating and interruption-resume determinism
  - P1 in-canvas trace UX + design extraction workflow
  - P1/P2 memory rebuild milestones
  - P2 policy/platform hardening and secondary radar backlog
- Included synced 7-task sprint summary and retained governance rules.

Validation:
- Verified file write for `hermes-dev/FEATURE-WISHLIST.md`.
- Confirmed root spec path reference and updated timestamp.

## 2026-04-21 17:28:03 PDT — Expand feature wishlist into a living backlog (+ cross-repo sync hook)
Goal: continue building the feature wishlist with a concrete, prioritized, implementation-ready backlog and wire it into ongoing Hermes dev docs.

Completed:
- Added `hermes-dev/FEATURE-WISHLIST.md` with a structured living backlog:
  - P0 reliability/conformance work (bucket scoring hard-fail gates, mutating-tool error-as-data expansion, interruption-resume E2E, workspace-boundary QA)
  - P1 Hermes Lead UX parity and telemetry robustness
  - P1 design extraction workflow milestones
  - P1/P2 memory rebuild milestones
  - P2/P3 platform-risk and architecture cleanup items
  - explicit backlog governance rules (weekly rerank + validation logging expectations)
- Updated `hermes-dev/README.md` file index to include `FEATURE-WISHLIST.md`.
- Updated `hermes-dev/NEXT-STEPS.md` with a cross-repo Hermes wishlist sync item linking Orca and macworldmodel research roots.

Validation:
- Verified file writes and markdown patch application in-place.

## 2026-04-21 17:22:32 PDT — Continue resilience rollout: non-shell mutation errors as data + sensitive-path branch invariant
Goal: extend error-first branching beyond shell commands so file mutations (write/delete) return deterministic remediation branches instead of opaque failures.

Completed:
- Extended `packages/client/src/lib/orchestrator/executeTools.ts` with non-shell mutation branch model:
  - added `PathMutationRecoveryBranch` + `buildPathMutationRecoveryBranch(...)` classifier.
  - classifications include: `path_out_of_scope`, `sensitive_path_blocked`, `permission_denied`, `target_missing`, `unknown`.
- Upgraded `jsonErr(...)` helper to support structured extras payload.
- Applied error-as-data payloads to file mutation failure paths:
  - `write_file` now returns structured remediation metadata when:
    - workspace path assertion fails,
    - sensitive-path safety gate blocks,
    - filesystem write throws.
  - `delete_file` now returns structured remediation metadata when:
    - workspace path assertion fails,
    - sensitive-path safety gate blocks,
    - filesystem delete throws.
  - payload fields include:
    - `error_as_data: true`
    - `remediation_required: true`
    - `recovery_branch` (deterministic next_checks/fallback_steps/verify_steps)
- Added conformance + unit coverage for non-shell branch behavior:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
    - new task kind `file_mutation_sensitive_path_branching`.
  - `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`
    - added `p0-file-mutation-sensitive-path-branching`.
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts`
    - conformance suite expanded to include new task.
  - `packages/client/src/lib/orchestrator/runShellCommand.test.ts`
    - added unit tests for `buildPathMutationRecoveryBranch(...)` classifications.
- Updated roadmap:
  - `hermes-dev/NEXT-STEPS.md` now marks destructive non-shell file-path/write guard evaluator DONE.

Validation:
- `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/runShellCommand.test.ts src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts src/lib/orchestrator/waitForSubAgent.test.ts` (pass)
- `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split conformance` (pass, passRate=1)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 17:15:10 PDT — Implement error-first recovery branching (treat shell failures as data)
Goal: implement resilience policy for Orca orchestrator harness where non-zero shell exits are routed into deterministic remediation branches instead of blind retries.

Completed:
- Added runtime shell failure classifier in `packages/client/src/lib/orchestrator/executeTools.ts`:
  - new exported helper `buildShellRecoveryBranch({ command, exitCode, stderr, timedOut })`.
  - classifies failures into stable categories:
    - `timeout`, `git_not_repo`, `git_no_remote`, `git_auth`, `command_not_found`, `permission_denied`, `network`, `unknown`.
  - each class returns structured `next_checks`, `fallback_steps`, and `verify_steps`.
- Extended `run_shell_command` payload with explicit error-as-data routing metadata when command fails:
  - `error_as_data: true`
  - `remediation_required: true`
  - `remediation_note`
  - `recovery_branch` (structured branch plan from classifier)
- Added prompt-level behavior contract in `packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts`:
  - new `Error-first recovery protocol (mandatory)` section in dynamic preface.
  - requires reading `exit_code`/`stderr`, validating root cause via probe, switching remediation branch, and verifying end state.
- Added conformance coverage:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
    - new task kind: `error_first_recovery_branching`.
  - `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`
    - added `p0-error-first-recovery-branching`.
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts`
    - extended conformance suite to include new task.
- Added unit tests in `packages/client/src/lib/orchestrator/runShellCommand.test.ts`:
  - verifies git-not-repo classification branches to preflight/fallback/verify pattern.
  - verifies command-not-found classification from exit code + stderr.
  - verifies successful exits return no recovery branch.
- Updated roadmap docs:
  - `hermes-dev/NEXT-STEPS.md` now marks error-first protocol and new P0 conformance evaluator done.

Validation:
- `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/runShellCommand.test.ts src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts src/lib/orchestrator/waitForSubAgent.test.ts` (pass)
- `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split conformance` (pass, passRate=1)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 16:58:09 PDT — Start non-Hermes harness conformance hardening (P0 evaluators)
Goal: begin improving Orca orchestrator harness behavior outside Hermes Lead mode by translating Hermes dev research invariants into deterministic conformance checks.

Completed:
- Extended `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts` with two new deterministic conformance evaluators:
  - `safety_gate_blocks_destructive_shell`: verifies destructive shell command detection (`rm -rf`) and block/warn safety-mode behavior.
  - `wait_for_sub_agent_cancellation_integrity`: verifies `wait_for_sub_agent` returns `outcome:"cancelled"` when parent abort signal is already cancelled.
- Updated conformance task manifest:
  - `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`
  - added `p0-safety-gate-destructive-shell` and `p0-cancellation-integrity-wait-sub-agent`.
- Updated suite coverage:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts`
  - expanded conformance test case to include both new evaluator kinds.
- Updated roadmap docs for continuation:
  - `hermes-dev/NEXT-STEPS.md` now marks these two P0 evaluator items done and points next to non-shell destructive write/path guard coverage.

Validation:
- `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts src/lib/orchestrator/waitForSubAgent.test.ts` (pass)
- `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split conformance` (pass, passRate=1)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 16:46:56 PDT — Expand error-catching section with Hermes Lead runtime architecture
Goal: document exactly how Hermes Lead error catching is layered in Orca so future debugging and reliability work references concrete code paths.

Completed:
- Updated `hermes-dev/ERROR-CATCHING-BEST-PRACTICES.md` with a new section:
  - `Hermes Lead Runtime Error-Catching (Orca implementation)`
- Added 5-layer architecture summary with concrete files:
  - Provider/API retry + parse + contract handling (`chatCompletion.ts`)
  - Responses replay filtering (`openaiResponsesAdapter.ts`)
  - Orchestrator run-loop guards/recovery/quarantine (`runOrchestrator.ts`)
  - Tool-level normalization to structured errors (`executeTools.ts`)
  - Session/UI classification, logs/toasts/telemetry (`orchestratorSessionStore.ts`)

## 2026-04-21 16:39:21 PDT — Add Hermes error-catching best-practice doc
Goal: capture the proven failure-recovery pattern (preflight -> classify -> fallback -> verify) in durable Hermes research docs.

Completed:
- Added `hermes-dev/ERROR-CATCHING-BEST-PRACTICES.md` with:
  - non-zero-exit handling loop,
  - deterministic fallback branching,
  - final-state verification requirements,
  - concrete git commit/push recovery example.
- Updated `hermes-dev/README.md` file index to include the new best-practices doc.

Validation:
- Verified file write and README index update.

## 2026-04-21 15:43:51 PDT — Hard runtime workspace/cwd enforcement (Cursor-style guardrails)
Goal: move workspace correctness from prompt persuasion to runtime policy so active directory stays authoritative across file + shell tools.

Completed:
- Hardened file-path resolution in `packages/client/src/lib/orchestrator/executeTools.ts`:
  - `resolvePathForOrchestratorTool(...)` no longer strips leading `/`.
  - absolute path inputs are preserved and then rejected by existing workspace validators (instead of being silently coerced into relative paths).
  - sub-agent worktree prefixing no longer wraps absolute paths.
- Added runtime workspace-root propagation from orchestrator loop:
  - `packages/client/src/lib/orchestrator/runOrchestrator.ts` now passes `workspaceRoot` into tool-batch context.
  - `OrchestratorToolContext` extended with optional `workspaceRoot` snapshot.
- Added shell scope enforcement for `run_shell_command`:
  - new `enforceRunShellWorkspaceScope(...)` blocks out-of-scope `cd` targets (absolute paths outside allowed roots, `~`, and parent traversal via `..`).
  - workspace root + isolated sub-agent worktree are treated as allowed roots.
  - default shell cwd now auto-scopes to sub-agent isolated worktree when present (unless explicit `cwd_relative` provided).
  - response payload now reports `cwd_relative_effective` when applied.

Validation:
- `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/executeToolsWorktreePath.test.ts src/lib/orchestrator/runShellCommand.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 15:28:37 PDT — Add turn-level workspace override for project-scoped prompts
Goal: make project-scoped asks (e.g. “analyze my project”) stay inside the active workspace immediately, even when memory/history references other repos.

Completed:
- Confirmed via telemetry (`/Users/ghost/Downloads/orca-telemetry-20260421-152250.csv`) that run started at active workspace (`/Users/ghost/Desktop/mactopbar`) but drifted into `/Users/ghost/Desktop/orca` tool calls.
- Strengthened both system prompt variants in `packages/client/src/lib/orchestrator/runOrchestrator.ts` with conflict-resolution language:
  - current workspace root always wins over historical memory/profile paths.
- Added turn-level override injection in `runOrchestrator.ts`:
  - new helpers: `shouldForceWorkspaceScopeForRequest(...)`, `buildWorkspaceScopeTurnGuard(...)`.
  - for project-scoped user requests, inject an extra high-priority `system` message into the working set with explicit boundary and `path="."` guidance tied to active workspace root.
- This creates immediate per-turn grounding (not only general prompt policy).

Validation:
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 14:33:30 PDT — Enforce workspace-root scope in orchestrator prompts
Goal: stop Hermes Lead from drifting to parent folders when user intent is project-scoped (e.g. “analyze my project”).

Completed:
- Updated both orchestrator system-prompt variants in `packages/client/src/lib/orchestrator/runOrchestrator.ts` to include a mandatory workspace-scope rule directly under `Workspace root:`.
- New prompt contract now explicitly requires:
  - for project-scoped requests, start with `path: "."` (or exact workspace root),
  - keep file/search tools inside active workspace root,
  - do not begin from parent/home/Desktop paths unless explicitly requested by the user.
- This applies to both lead-delegation and full-tool orchestrator prompts.

Validation:
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 14:25:00 PDT — Add explicit workspace trace row at run start
Goal: make active workspace visible in the Hermes Lead trace at run start so users can confirm session root instantly.

Completed:
- Added `formatWorkspaceTraceLine(workspaceRoot)` in `packages/client/src/lib/orchestrator/hermesTracePresentation.ts`:
  - outputs `┊ workspace <path>` when active root exists
  - outputs `┊ workspace (no workspace)` fallback when unavailable
- Added regression tests in `packages/client/src/lib/orchestrator/hermesTracePresentation.test.ts` for both active and fallback outputs.
- Wired run-start logging in `packages/client/src/store/orchestratorSessionStore.ts`:
  - after user/resume/heartbeat line, append `appendLog(formatWorkspaceTraceLine(activeWorkspaceRoot))`.
  - keeps workspace visibility inside the gray trace strip (`┊ ...` semantic trace line).

Validation:
- `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/hermesTracePresentation.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 13:27:47 PDT — Hermes Lead workspace-awareness fix (use active Orca directory in system prompt)
Goal: ensure Hermes Lead always sees the currently active Orca workspace directory (not a stale/async-probed path), so it plans and executes relative to the correct project root.

Completed:
- Updated `packages/client/src/lib/orchestrator/runOrchestrator.ts`:
  - added `workspaceRoot?: string | null` to run/prompt options.
  - system prompt workspace root resolution now prefers:
    1) per-run `workspaceRoot` from caller,
    2) `useWorkspaceStore().rootPath` (when not `.`),
    3) `tauri.getWorkspace()?.path` fallback,
    4) no-workspace message.
- Updated `packages/client/src/store/orchestratorSessionStore.ts`:
  - pass `workspaceRoot: ws.rootPath === '.' ? null : ws.rootPath` into `runOrchestratorLeadAware(...)`.
- Result: Hermes Lead prompt `Workspace root: ...` is now anchored to Orca’s active directory for the run.

Validation:
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 13:21:50 PDT — Fix orchestrator crash (`useClawSpinnerFrame`) and make context timer visibly dynamic
Goal: address live run failure reported in telemetry and make Hermes context tracker visibly dynamic in real time.

Completed:
- Analyzed `/Users/ghost/Downloads/orca-telemetry-20260421-131704.csv` and identified concrete failure signature:
  - repeated runtime `ReferenceError: Can't find variable: useClawSpinnerFrame` in `OrchestratorModuleLayout.tsx` from window/console/tile error channels.
  - cancellation at end still occurred (`[Orchestrator] Request cancelled` + `[Error] Request cancelled`), but primary UI instability was the missing symbol runtime error.
- Confirmed and cleaned run-status-strip removal aftermath in `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx` (no residual spinner symbol usage).
- Made context elapsed tracker visibly dynamic and sticky:
  - elapsed ticker now keys only off `runStartedAtMs` and no longer resets to `0` immediately when run stops,
  - status display changed from coarse minute rounding (`0m/1m`) to second-resolution label (`12.3s`).
- This keeps Hermes status strip responsive during runs and preserves final elapsed after cancellation/completion.

Validation:
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 13:12:47 PDT — Remove animated run-status strip, restore top-fade trace gradient, add per-call elapsed counters
Goal: match requested Hermes Lead UX by removing the animated “Ruminating … tool rounds can be slow” run-status row, restoring trace fade to 0% opacity at the top, and showing per-call elapsed counters on Hermes provider tool-completion lines.

Completed:
- Removed the dedicated orchestrator run-status strip from `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx` (the row with spinner + `Ruminating... · Ns · tool rounds can be slow`).
- Removed now-unused run-strip locals/imports in the same file (`useClawSpinnerFrame`, `verb`, `iteration`, busy-frame wiring).
- Updated trace peek mask direction in `OrchestratorModuleLayout.tsx` to fade from top transparent to lower opaque:
  - `linear-gradient(to bottom, transparent 0%, black 45%, black 100%)`
- Extended Hermes trace timing in `packages/client/src/lib/orchestrator/hermesTracePresentation.ts`:
  - track `call_id` start time for all function calls (not only semantic `skill/plan` rows),
  - emit elapsed suffix on generic completion rows, e.g. `← search_files 0.4s`.
- Added regression in `packages/client/src/lib/orchestrator/hermesTracePresentation.test.ts`:
  - verifies generic function-call done line includes elapsed counter.

Validation:
- `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/hermesTracePresentation.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 13:09:00 PDT — Finish Orca remix: replace remaining Nyx tile branding in static clone bundle
Goal: finish the getnyx static remix so visible tile and canvas labels render Orca branding instead of Nyx.

Completed:
- Updated tile/context labels in `getnyx.dev-clone/_assets/Orchestration.Cv6dLNnE.js`:
  - `zsh · ~/projects/nyx` → `zsh · ~/projects/orca`
  - `nyx canvas · sprint-14` → `orca canvas · sprint-14`
- Updated browser-demo tile strings in `getnyx.dev-clone/_assets/DiffAndInspect.B9iE8pTt.js`:
  - `staging.getnyx.dev` → `staging.orca.dev`
  - `NYX · v0.2.0` → `ORCA · v1.0.0`
- Updated pricing badge in `getnyx.dev-clone/_assets/Pricing.CnHH8fgu.js`:
  - `◈ NYX · WAITLIST` → `◈ ORCA · WAITLIST`
- Updated footer branding in `getnyx.dev-clone/_assets/Footer.yskN-57K.js`:
  - `◈ EN / RU · getnyx.dev` → `◈ EN / RU · orca.dev`
  - giant footer watermark `NYX` → `ORCA`

Validation:
- `search_files(path=/Users/ghost/Desktop/orca/getnyx.dev-clone/_assets, pattern=NYX|nyx|getnyx)` now only returns operational links:
  - `mailto:hi@getnyx.dev`
  - `https://api.getnyx.dev`
- Verified updated strings are present in bundle assets (`~/projects/orca`, `orca canvas · sprint-14`, `staging.orca.dev`, `ORCA · v1.0.0`, `◈ ORCA · WAITLIST`, `ORCA`).

## 2026-04-21 12:57:24 PDT — Keep Hermes skill/plan trace rows inside gray gradient trace strip + tighten 4px gap
Goal: ensure Hermes semantic trace rows (e.g. `┊ skill ...`, `┊ plan ...`) render in the gray gradient trace peek area (not in main chat bubbles), and tighten spacing to 4px between gray trace area and Trace collapse row.

Completed:
- Updated trace-line classification in `packages/client/src/lib/orchestrator/activityLineParsing.ts`:
  - treat lines prefixed with `┊` as orchestrator trace lines.
  - this routes Hermes semantic rows into the trace channel and out of main chat bubbles.
- Added regression coverage in `packages/client/src/lib/orchestrator/activityLineParsing.test.ts`:
  - `isOrchestratorTraceLine('┊ skill ...') === true`
  - `isOrchestratorTraceLine('┊ plan ...') === true`
- Updated trace fade direction in `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`:
  - mask changed to `linear-gradient(to bottom, black 0%, black 55%, transparent 100%)` (100%→0% opacity toward collapse row).
- Tightened vertical spacing between gray trace strip and Trace collapse row:
  - footer stack changed from `space-y-1.5` to `space-y-1` (4px).

Validation:
- `npm run -s test --workspace=packages/client -- src/lib/orchestrator/activityLineParsing.test.ts` (pass)
- `npm run -s test --workspace=packages/client -- src/components/orchestrator/__tests__/OrchestratorTracePeekRows.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 12:54:26 PDT — Remix getnyx-clone landing copy for Orca Infinite Canvas IDE
Goal: remix the cloned website to promote Orca as an infinite canvas IDE and ensure tile language is Orca-branded (no Nyx tile copy).

Completed:
- Updated `getnyx-clone/src/app/page.tsx` nav label from `canvas` to `infinite canvas`.
- Rewrote hero headline/copy to explicitly position Orca as an "Infinite Canvas IDE" for autonomous multi-agent shipping.
- Confirmed tile section remains Orca-branded (`Orca Agent/Shell/Browser/Plan/Review/Studio Tile`) with no Nyx tile strings.

Validation:
- `search_files(path=/Users/ghost/Desktop/orca/getnyx-clone/src/app/page.tsx, pattern=Nyx|nyx)` → 0 matches.
- `npm run lint` in `getnyx-clone/` (pass)
- `npm run build` in `getnyx-clone/` (pass; non-blocking Next workspace root warning due multiple lockfiles)

## 2026-04-21 12:49:59 PDT — Make Hermes Lead context tracker dynamic (live in-run estimate)
Goal: fix non-dynamic context strip behavior in Hermes Lead where the tracker stayed near `1/400K` and did not count up during long runs.

Completed:
- Confirmed UI symptom from screenshot: status strip showed static `1/400K`, `0%`, empty progress bar.
- Updated orchestrator run loop to emit a live context estimate from the in-flight working set:
  - `packages/client/src/lib/orchestrator/runOrchestrator.ts`
  - added `estimateContextTokensFromWorkingSet(messages)` helper (`~4 chars/token`).
  - added new callback option `onContextTokens?: (tokens: number) => void`.
  - emit estimate at run start, after compaction/guarding, after assistant/tool transcript appends, and before continuation branches.
- Wired the estimate into session orchestration:
  - `packages/client/src/store/orchestratorSessionStore.ts`
  - pass `onContextTokens` into `runOrchestratorLeadAware(...)`.
- Added store support for live estimated context tokens:
  - `packages/client/src/store/orchestratorActivityStore.ts`
  - new state: `runEstimatedContextTokens`.
  - new action: `setRunEstimatedContextTokens(tokens)`.
  - reset estimate at run start with `setRunning(true)`.
- Updated context strip display fallback order:
  - `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`
  - now uses `runUsageTotalTokens` when provider usage exists, otherwise `runEstimatedContextTokens`, otherwise static session estimate.

Validation:
- `npm run -s test --workspace=packages/client -- src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` (pass)
- `npm run -s test --workspace=packages/client -- src/lib/orchestrator/hermesTracePresentation.test.ts` (pass)
- `npm run -s build --workspace=packages/client` (pass)

## 2026-04-21 12:43:01 PDT — Rebrand cloned Nyx landing build to Orca (tile copy included)
Goal: make the static cloned site read as Orca and replace Nyx tile references with Orca wording.

Completed:
- Updated cloned static site bundle at `getnyx.dev-clone/` by replacing user-facing `Nyx` branding with `Orca` in landing/section copy.
- Replaced tile-related wording so Nyx tile references now render as Orca wording in shipped bundle assets.
- Verified no remaining `Nyx` tokens in `getnyx.dev-clone/` content search.

Validation:
- `search_files(path=/Users/ghost/Desktop/orca/getnyx.dev-clone, pattern=Nyx)` → 0 matches.
- `search_files(path=/Users/ghost/Desktop/orca/getnyx.dev-clone, pattern=Orca)` → branding present across landing assets.

## 2026-04-21 12:38:49 PDT — Hermes trace chips: remove emoji icons from skill/plan rows
Goal: make Hermes trace rows render as neutral gray trace text without emoji glyphs (matching requested style).

Completed:
- Updated `packages/client/src/lib/orchestrator/hermesTracePresentation.ts`:
  - `skill_view` rows now render as `┊ skill     <name>` (removed 📚).
  - `plan/todo` rows now render as `┊ plan      <N> task(s)` / `┊ plan      update` (removed 📋).
- Updated `packages/client/src/lib/orchestrator/hermesTracePresentation.test.ts` expectations accordingly.

Validation:
- `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/hermesTracePresentation.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 12:37:21 PDT — Built GitHub Rising Radar scanner (momentum + stickiness + idea generation)
Goal: implement a full MVP scanner that finds rising/popular GitHub projects, analyzes sticky traits, and generates actionable project ideas.

Completed:
- Added new workspace package `packages/github-radar` with end-to-end scanner pipeline.
- Implemented ingestion (`src/github.ts`):
  - GitHub Search API fetch for repos filtered by stars and recent push activity (`lookbackDays`).
- Implemented persistence (`src/storage.ts`):
  - durable `out/snapshots.json` history store for repo metrics snapshots.
  - rolling retention (last 45 snapshots per repo).
- Implemented analysis engine (`src/analysis.ts`):
  - momentum score from stars/day + forks/day deltas using snapshot comparisons.
  - sticky-signal scoring (onboarding speed, distribution loop, ecosystem surface, time-to-wow, maintainability).
  - confidence modeling based on snapshot interval.
- Implemented idea generation (`src/ideas.ts`):
  - 3 idea outputs per repo (niche clone, B2B layer, privacy/self-host version).
- Implemented report generation (`src/report.ts`):
  - timestamped JSON + Markdown reports in `packages/github-radar/out/`.
- Implemented CLI/runtime config (`src/cli.ts`, `src/config.ts`):
  - env + arg overrides (`--max-repos`, `--min-stars`, `--lookback-days`, `--output-dir`).
- Added tests:
  - `src/analysis.test.ts`
  - `src/ideas.test.ts`
- Added package docs:
  - `packages/github-radar/README.md`
- Wired root scripts in `/package.json`:
  - `radar:scan`, `radar:test`, `radar:build`.

Validation:
- `npm install` (workspace sync)
- `npm run radar:test` (pass)
- `npm run radar:build` (pass)
- `npm run radar:scan -- --max-repos 10 --min-stars 50000` (pass, report artifacts generated)

Follow-ups:
- Optional next wave: add GitHub event/traffic enrichers and social signals for stronger early-breakout detection.
- Optional next wave: add LLM post-processor (evidence-grounded summaries) and weekly digest automation.

## 2026-04-21 12:30:24 PDT — Remove manual terminal approval round-trip in Hermes runs
Goal: remove the visible "terminal security gate" user interruption (`reply "approved"`) by auto-continuing Hermes runs when the gateway returns an `approval_required` prompt pattern.

Completed:
- Updated `packages/client/src/lib/orchestrator/runOrchestrator.ts`:
  - added `shouldAutoApproveHermesTerminalSecurityGate(textOnly)` helper.
  - detection matches Hermes gate signatures (`approval_required` / "terminal security gate") plus explicit ask for `approved`.
  - in final-response branch, when provider is Hermes and gate pattern is detected, orchestrator now:
    - appends assistant gate message to working transcript,
    - injects synthetic user turn `approved`,
    - continues loop automatically (single-use guard per run).
  - added one-shot run guard `implicitHermesTerminalApprovalUsed` to prevent infinite approval loops.
- Added regression coverage in `packages/client/src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts`:
  - positive match for approval gate text.
  - negative match for normal assistant completion text.

Validation:
- `NODE_ENV=test node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` (pass)
- `npm run -s test --workspace=packages/client -- src/lib/orchestrator/openaiResponsesAdapter.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 12:16:33 PDT — Hermes Lead trace formatting parity for skill + plan lines
Goal: make Hermes Lead trace show terminal-like semantic rows for skills and plan tasks (name + task count + elapsed), e.g. `📚 skill ...` and `📋 plan ...`.

Completed:
- Updated `packages/client/src/lib/orchestrator/hermesTracePresentation.ts`:
  - added Hermes-special trace summaries for:
    - `skill_view` -> `┊ 📚 skill     <skill-name>`
    - `plan`/`todo` -> `┊ 📋 plan      <N> task(s)`
  - added per-call elapsed timing for these rows by tracking `function_call.call_id` start/done pairs.
  - done rows now render with elapsed suffix (e.g., `0.0s`) to match terminal-style quick-scan traces.
  - preserved existing compact behavior for non-special tools (`→ tool ...` / `← tool`).
- Updated tests `packages/client/src/lib/orchestrator/hermesTracePresentation.test.ts`:
  - added regression for skill-view name rendering + elapsed line.
  - added regression for plan task-count rendering + elapsed line.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/hermesTracePresentation.test.ts` (pass)
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/executeTools.agentBrowserPreflight.test.ts src/lib/orchestrator/openaiResponsesAdapter.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 12:07:42 PDT — Hermes Lead architecture pivot: allow Hermes-native browser tools in Hermes mode
Goal: implement user-directed Hermes Lead contract where Hermes keeps its default robust toolset and Orca primarily visualizes/coordinates canvas UX.

Completed:
- Updated `packages/client/src/lib/orchestrator/executeTools.ts`:
  - added `shouldBlockHermesNativeBrowserToolForCurrentLeadProfile()`.
  - changed Hermes-native browser guard to apply only when `leadProfile !== 'hermes'`.
  - retained default-lead safety steering (Orca browser tile equivalents) for non-Hermes profile.
  - updated policy message to explicitly direct switching to Hermes Lead mode for native-tool behavior.
- Updated `packages/client/src/lib/orchestrator/executeTools.agentBrowserPreflight.test.ts`:
  - expanded guard tests to assert profile-aware behavior:
    - default lead profile blocks Hermes-native browser tools with policy guidance.
    - Hermes lead profile does not apply policy block.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/executeTools.agentBrowserPreflight.test.ts` (pass)
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/openaiResponsesAdapter.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 11:57:42 PDT — Live Hermes browser verification run (post-fix telemetry)
Goal: run a fresh Hermes-driven browser task and verify telemetry for loop behavior after browser/tool replay fixes.

Run executed:
- Triggered a live Hermes task through Orca bridge by spawning a Hermes sub-agent:
  - `spawn_sub_agent` task: open `https://getnyx.dev` and summarize homepage via browser workflow.
- Exported filtered telemetry to:
  - `/Users/ghost/Downloads/orca-telemetry-20260421-livecheck.csv`
  - query window used: `since=2026-04-21T18:52:00Z`

Findings:
- Session observed: `orch-1-qmhCHcr1` (run `orch-1`)
- Browser tool behavior in this live run still used Hermes-native names:
  - multiple `browser_navigate`
  - zero `browser_open`
- Positives in this run window:
  - no `No user message found in input`
  - no `_stdout_open/_stdout_snapshot` race
  - no `Request cancelled`
- The run stream remained in-progress during export window (no `response.completed` yet), so completion-state assertions are pending.

Conclusion:
- Prior replay/no-user-message hardening appears improved in this sampled window (no recurrence seen).
- Hermes-native browser tool drift still exists in the Hermes runner path used by spawned Hermes agents; current orchestrator guard does not fully cover this path.

## 2026-04-21 11:49:32 PDT — Trace-gap tighten + telemetry replay-root-cause fix
Goal: tighten vertical spacing between trace activity strip and Trace collapse row, and diagnose why Hermes Lead still failed on `orca-telemetry-20260421-114410.csv`.

Telemetry findings (`/Users/ghost/Downloads/orca-telemetry-20260421-114410.csv`):
- The run still emitted a Hermes-native `browser_navigate` call and hit known transient browser transport race:
  - `[Errno 2] ... /tmp/agent-browser-h_.../_stdout_open`
- A `.dev` lookalike-TLD security gate interrupted terminal mirror command (`approval_required`).
- Critical loop issue remained after `response.completed`:
  - orchestrator replayed a sequential batch of already-finished tool calls from the completed response snapshot
  - then raised `[Orchestrator] No user message found in input`.

Root cause identified:
- `responsesApiJsonToChatCompletion(...)` treated every historical `function_call` in a completed `response.output` snapshot as fresh `tool_calls`, even when matching `function_call_output` already existed.
- This caused post-completion tool-call replay and subsequent invalid continuation behavior.

Completed:
- Updated `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx` to reduce visual gap:
  - chat-shell container tightened from `gap-2 py-2` to `gap-1.5 py-1.5`.
  - footer stack tightened from `space-y-2 p-2.5` to `space-y-1.5 px-2.5 pb-2 pt-1.5`.
- Updated `packages/client/src/lib/orchestrator/openaiResponsesAdapter.ts`:
  - added completed-call filtering: collect `function_call_output.call_id` set first.
  - skip emitting `tool_calls` for any `function_call` whose call id is already completed in same response snapshot.
- Added regression in `packages/client/src/lib/orchestrator/openaiResponsesAdapter.test.ts`:
  - verifies completed snapshot (`function_call` + `function_call_output` + message) maps to `finish_reason: stop` with no tool replay.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/openaiResponsesAdapter.test.ts src/lib/orchestrator/executeTools.agentBrowserPreflight.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 11:37:28 PDT — Guard Hermes-native browser tools in Orca orchestrator mode
Goal: Prevent Hermes Lead from drifting into non-Orca browser tool names (`browser_navigate`, `browser_console`, etc.) and force actionable steering back to agent_browser tile workflow.

Completed:
- Updated `packages/client/src/lib/orchestrator/executeTools.ts`:
  - added `isHermesNativeBrowserToolName(...)` guard for non-Orca browser tools.
  - added `hermesNativeBrowserToolPolicyMessage(...)` mapping blocked Hermes-native names to Orca equivalents:
    - `browser_navigate -> browser_open`
    - `browser_type -> browser_fill`
    - `browser_console -> browser_snapshot/browser_get_text`
    - `browser_get_images -> browser_screenshot`
    - `browser_back -> browser_click back or browser_open(previous_url)`
  - `executeOrchestratorTool(...)` now short-circuits these blocked names with a clear policy error and steering guidance, and records the block on orchestrator module telemetry.
- Updated tests `packages/client/src/lib/orchestrator/executeTools.agentBrowserPreflight.test.ts`:
  - added coverage for Hermes-native name detection.
  - added policy-message guidance assertions.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/executeTools.agentBrowserPreflight.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 11:13:41 PDT — Orchestrator trace bar consolidation + single-tone chat background
Goal: Reduce vertical clutter in orchestrator by removing glittery verb emphasis, keeping trace as the primary running signal, and consolidating recent trace chip into the Trace collapse bar.

Completed:
- Updated `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`:
  - removed `TextShimmer`-based glitter verb rendering in run-status row; verb now renders plain gray text.
  - moved the colorful recent tool chip (`→/← tool`) out of the run-status row and into the Trace `<summary>` bar.
  - made recent trace chip derivation independent of run state so the latest chip can stay visible on Trace bar.
  - normalized chat surface toward a single background tone by removing extra panel tint layers (`bg-canvas-bg/50`, `bg-black/15`) in the chat shell/footer container.

Validation:
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 11:03:43 PDT — Plan tools now inform Orca Plan page
Goal: Ensure Hermes plan-related tool activity and outputs feed the Plan workspace UI automatically.

Completed:
- Updated `packages/client/src/components/Canvas/PlanChatSplitView.tsx`:
  - Plan doc loader now also checks latest Hermes plan artifact under `.hermes/plans/*.md` (lexicographically newest markdown file).
  - Added auto-refresh when new tool-feed lines indicate plan-related activity (`plan` / `todo` tools and plan-path writes).
  - "In context" block now includes recent relevant tool lines (plan/todo/read/search/write) so plan operations are visible in the Plan page itself.
- Updated `packages/client/src/store/orchestratorSessionStore.ts`:
  - widened tool-start parsing to support both legacy `→ tool(args)` and new detailed `→ tool details...` trace formats.
  - preserves todo/tool timeline wiring after richer trace-line formatting changes.

Validation:
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 10:57:34 PDT — Continued Hermes Lead reliability + richer trace detail lines
Goal: Continue post-interruption Hermes Lead hardening and make trace rows include actionable tool details (paths/patterns/commands/durations), matching Hermes-style readability.

Completed:
- Browser resilience:
  - Updated `packages/client/src/lib/tauri.ts` with broader transient browser failure classification:
    - `_stdout_open/_stdout_snapshot` temp-file races
    - `Target page, context or browser has been closed` / page-context closed variants
  - Added `isAgentBrowserTransientErrorMessage(...)` and used it in `runAgentBrowser(...)`.
  - `runAgentBrowser(...)` now auto-retries once for transient session-bound failures before surfacing error.
- Trace detail upgrades:
  - Updated `packages/client/src/lib/orchestrator/orchestratorToolBatch.ts`:
    - new `formatToolTraceStartLine(...)` and `formatToolTraceEndLine(...)`.
    - start lines now include tool-specific details (e.g., `read_file path=... offset=...`, `search_files target=... pattern=... path=...`, shell `$ ...`).
    - end lines now include status + elapsed (`ok/error` + `ms/s`).
  - Updated `packages/client/src/lib/orchestrator/hermesTracePresentation.ts`:
    - function-call `data:` events now parse arguments and append compact details (path/command/pattern/todo count) to `→ tool` chips when available.
- Added/updated regression coverage:
  - `packages/client/src/lib/orchestrator/orchestratorToolBatch.traceFormatting.test.ts` (new)
  - `packages/client/src/lib/tauri.agentBrowserSession.test.ts` (transient/page-closed classifiers)
  - `packages/client/src/lib/orchestrator/hermesTracePresentation.test.ts` (function-call argument detail rendering)

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/orchestratorToolBatch.traceFormatting.test.ts src/lib/tauri.agentBrowserSession.test.ts src/lib/orchestrator/hermesTracePresentation.test.ts src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts src/lib/harness/compactionHierarchy.test.ts src/lib/orchestrator/chatCompletion.fallback.integration.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 10:50:43 PDT — Removed orchestrator mode toggle (Chat / 1-shot)
Goal: Remove the bottom-panel "Mode" toggle UI from orchestrator as requested.

Completed:
- Updated `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`:
  - removed the entire `Mode` selector row (Chat + 1-shot buttons and helper text).
  - removed now-unused `setOneShotMode` store selector.
- Kept existing one-shot runtime behavior for flows that are enabled elsewhere (no change to pipeline/state logic).

Validation:
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 10:45:32 PDT — Hermes Lead no-user-message failure hardening (post-tool continuation guard)
Goal: Fix recurring Hermes Lead runtime failure `No user message found in input` seen after tool-heavy runs in telemetry `orca-telemetry-20260421-102754.csv`.

Root cause:
- In long tool loops, the working message set can reach a continuation round with no `user` role present before the next provider call.
- Hermes Responses rejects that payload contract with HTTP 400 (`No user message found in input`).

Completed:
- Added defensive working-set guard in `packages/client/src/lib/orchestrator/runOrchestrator.ts`:
  - new `ensureWorkingSetHasUserMessage(messages)` helper.
  - injects a synthetic continuation user turn only when no user turn exists.
  - applied immediately after compaction and before each LLM round.
- Added regression coverage in `packages/client/src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts`:
  - verifies injection occurs when no user message exists.
  - verifies no injection when a user turn already exists.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts src/lib/harness/compactionHierarchy.test.ts src/lib/orchestrator/chatCompletion.fallback.integration.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 10:32:21 PDT — Trace-clutter suppression + telemetry review (`orca-telemetry-20260421-102754.csv`)
Goal: Reduce orchestrator trace noise (`response.created`, `response.output*`) and inspect failed Hermes Lead clone attempt telemetry.

Completed:
- Updated `packages/client/src/lib/orchestrator/hermesTracePresentation.ts`:
  - suppresses event-chip emission for `response.created` and all `response.output*` event lines.
  - keeps compact actionable chips for tool calls (`→ tool`, `← tool`) and non-noisy lifecycle events (e.g., `response.completed`).
- Updated `packages/client/src/lib/orchestrator/hermesTracePresentation.test.ts`:
  - added regression assertions for suppression of `response.created` and `response.output*` events.
  - added bracket-marker suppression check for `[Hermes trace] response.created`.

Telemetry findings (`/Users/ghost/Downloads/orca-telemetry-20260421-102754.csv`):
- Clone run encountered browser instability before fallback path:
  - `page.goto: Target page, context or browser has been closed`
  - `[Errno 2] ... /tmp/agent-browser-h_.../_stdout_open` (known transient transport race)
- Fallback terminal fetch was blocked by security approval gate:
  - `.dev` lookalike-TLD policy (`approval_required`) on `curl https://getnyx.dev/`.
- After assistant emitted approval request and run completed, orchestrator still logged:
  - `[Orchestrator] No user message found in input`
  - `[Error] No user message found in input`
  indicating recurrence in a post-response follow-up call path.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/hermesTracePresentation.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass)

## 2026-04-21 10:22:53 PDT — Harness efficiency pass: file tool visualization trim + graph mode de-entrypoint
Goal: Start Hermes-parity harness optimization by removing high-churn visualization paths and reducing duplicate view modes.

Completed:
- File-tool visualization trim:
  - `read_file` no longer auto-creates editor tiles on every read.
  - if an editor for the file is already open, read scan metadata updates that tile; otherwise read stays non-intrusive.
  - `write_file` no longer forces editor-tile write stream/flash visualization.
  - write visualization now centers on the Diff tile (agent focus points to diff).
- Standalone graph de-entrypoint:
  - removed `Graph` mode button from `CanvasToolbar`.
  - `setCanvasViewMode('graph')` is now normalized to `helix` (Lead view) for compatibility safety.
- Drafted optimization roadmap:
  - `hermes-dev/HERMES-PARITY-HARNESS-OPTIMIZATION-PLAN.md`
  - includes phased plan for in-canvas tool bubbles/nodes and resource guardrails.

Validation:
- pending targeted type/test/build validation after this slice (next command batch).

## 2026-04-21 10:10:25 PDT — Slash trigger boundary fix + Hermes strip usage wiring + compaction regression wave
Goal: Fix over-sensitive slash command trigger in composer, complete steps 1/2/3 from the reliability follow-up, and validate no regressions.

Completed:
- Slash trigger sensitivity fix (`packages/client/src/lib/skillCommands.ts`):
  - slash palette now activates only at line-start or after whitespace/bracket boundaries.
  - prevents URL/word false-positives like `https://getnyx.dev/` and `foo/`.
- Added slash parsing regressions (`packages/client/src/lib/skillCommands.parseSlashMenuQuery.test.ts`):
  - active at line start / after whitespace.
  - inactive inside URLs and end-of-word slash.
  - replacement helper ignores URL slash tokens.
- Step 2 complete — Hermes strip now consumes real provider token usage when available:
  - `runOrchestrator.ts` now emits per-round `usage` via new `onUsage` callback.
  - `orchestratorActivityStore.ts` now tracks aggregated run usage tokens.
  - `OrchestratorModuleLayout.tsx` status strip now prefers real `runUsageTotalTokens` and falls back to estimated context tokens when usage is absent.
- Step 3 complete — added orchestrator-style compaction regression:
  - `packages/client/src/lib/harness/compactionHierarchy.test.ts`
  - new repeated-compaction test simulates heavy tool loops and asserts a `user` message always survives before follow-up model calls.
- Step 1 telemetry action performed:
  - exported fresh CSV: `/Users/ghost/Downloads/orca-telemetry-20260421-100902.csv`
  - exported scoped follow-up: `/Users/ghost/Downloads/orca-telemetry-20260421-100902-since.csv` (`since=2026-04-21T17:09:00Z`)
  - scoped export currently contains header only (no new post-fix run events yet), so one heavy interactive browser/tool run is still needed for final production-style confirmation.

Validation:
- Targeted tests (pass):
  - `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/skillCommands.parseSlashMenuQuery.test.ts src/lib/harness/compactionHierarchy.test.ts src/lib/orchestrator/chatCompletion.fallback.integration.test.ts src/lib/tauri.agentBrowserSession.test.ts`
- Build (pass):
  - `npm run build --workspace=packages/client`

## 2026-04-21 10:03:20 PDT — getnyx.dev clone verification pass
Goal: Clone `https://getnyx.dev/` into a local runnable project and verify it renders the expected landing sections.

Completed:
- Confirmed a dedicated clone workspace exists at `getnyx-clone/` with a Next.js app implementation of the Nyx landing page.
- Verified clone structure/content in `src/app/page.tsx` (hero, tiles, focus, pricing, FAQ, waitlist, footer).
- Ran validation successfully:
  - `npm run lint`
  - `npm run build`
- Ran local dev server on port `4010` and validated rendered page snapshot via browser tooling.

Notes:
- Attempted direct website mirroring with `npx website-scraper`, but CLI security guard required explicit approval for `.dev` TLD usage. Continued using source-grounded local clone validation workflow.

## 2026-04-21 09:52:46 PDT — Telemetry 093729 fix + Hermes GUI TUI strip + hard dreaming-key cleanup
Goal: Resolve latest Hermes failure (`orca-telemetry-20260421-093729.csv`), add CLI-style Hermes status strip in GUI, and fully remove inert `harnessDreaming*` settings keys.

Root cause (from telemetry):
- Run completed tool batch + assistant message, then failed with `No user message found in input`.
- `runOrchestrator` compaction can remove the only remaining `user` message under heavy tool output, producing invalid payloads for providers requiring at least one user message.

Changes:
- Compaction safety fix (`packages/client/src/lib/harness/compactionHierarchy.ts`):
  - preserves at least one `user` message during snip phase.
  - if only one user exists at prefix, snip removes the next safe block instead of dropping that final user.
- Added regression tests (`packages/client/src/lib/harness/compactionHierarchy.test.ts`):
  - verifies at least one user survives heavy-tool trimming.
  - verifies oldest user can still be dropped when another user remains.
- Hermes-mode GUI status strip parity (`packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`):
  - added compact line showing: `⚕ model | used/cap | [████░░░░░░] % | Xm`
  - context usage approximated from serialized session messages (`~4 chars/token`), cap from model context length or Hermes fallback `400K`.
- Hard cleanup of dreaming settings keys (`packages/client/src/store/settingsStore.ts`):
  - removed `harnessDreaming*` fields from state schema, defaults, setters, persistence projection, and hydration normalization.
  - removed now-unused `normalizeHarnessDreaming*` helpers.

Validation:
- Targeted tests (pass):
  - `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/harness/compactionHierarchy.test.ts src/lib/orchestrator/chatCompletion.fallback.integration.test.ts src/lib/tauri.agentBrowserSession.test.ts`
- Build (pass):
  - `npm run build --workspace=packages/client`

## 2026-04-21 09:39:57 PDT — World-model (dreaming harness) decommission from Orca runtime
Goal: Remove/neutralize world-model integration paths that were adding complexity without clear product ROI.

Completed:
- Runtime coupling removed from browser tool execution path:
  - `packages/client/src/lib/orchestrator/executeTools.ts`
  - removed import dependency on `dreamingHarness`
  - replaced dream preflight gate with a no-op pass-through (`blocked: false`) so browser actions no longer call any external `/dream` adapter.
- Removed dream-integration artifacts from Orca repo:
  - deleted `packages/client/src/lib/orchestrator/dreamingHarness.ts`
  - deleted `packages/client/src/lib/orchestrator/dreamingHarness.test.ts`
  - deleted `scripts/dev-dream.sh`
  - deleted `docs/DREAM_ADAPTER_CONTRACT.md`
- Removed npm script alias from root package scripts:
  - `package.json`: removed `dev:dream`.

Validation:
- `npm run build --workspace=packages/client` (pass)
- Tauri dev remained running with HMR updates (`proc_4577578f0631`).

Notes:
- Settings-store dreaming keys are currently left in place for compatibility/migration safety; they are inert now because runtime no longer invokes dreaming preflight.

## 2026-04-21 09:32:54 PDT — Stop non-retryable HTTP 400 replay loop (Hermes "No user message found")
Goal: Address recurring failure from telemetry `orca-telemetry-20260421-092336.csv` where an HTTP 400 (`No user message found in input`) was retried and surfaced as terminal run failure.

Root cause:
- In chat retry loops, non-retryable statuses (retry budget 0) still retried once due `retryBudget >= 0` checks after `retryBudget = Math.min(retryBudget - 1, statusRetryBudget)`.
- For HTTP 400 this produced one unnecessary replay attempt and noisy `[HTTP 400 ... Retry 1/8]`, then terminal failure.

Changes:
- Updated `packages/client/src/lib/orchestrator/chatCompletion.ts` retry guards in three paths:
  - Responses API path (`/v1/responses`)
  - Hermes gateway Responses path
  - OpenAI-compatible chat/completions path
- New condition requires both:
  - `retryBudget > 0`
  - `statusRetryBudget > 0`
- Effect: 400/401/403/etc. no longer auto-retry; only explicitly retryable statuses (429/408/502/529/overload-ish 503) back off/retry.

Tests:
- Extended `packages/client/src/lib/orchestrator/chatCompletion.fallback.integration.test.ts` with:
  - `does not retry non-retryable HTTP 400 errors (Hermes Responses)`
  - Asserts single attempt and zero `onRetry` callbacks on 400.
- Validation command (pass):
  - `node --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/chatCompletion.fallback.integration.test.ts`
- Build validation (pass):
  - `npm run build --workspace=packages/client`

Runtime:
- Tauri dev remains running (`proc_4577578f0631`) with hot reload active.

## 2026-04-21 09:20:48 PDT — Orchestrator tile Hermes trace visibility fix (compact chips)
Goal: Make Hermes direct-mode provider traces visible inside the orchestrator tile as simplified trace chips instead of only in telemetry.

Completed:
- Root-cause confirmed: in `orchestratorSessionStore`, Hermes direct-mode provider notices were only appended to `reasoningTraceStore` (telemetry/trace drawer), not to orchestrator activity feed.
- Added `packages/client/src/lib/orchestrator/hermesTracePresentation.ts`:
  - `summarizeHermesProviderNoticeLine(line)` maps raw provider trace lines into compact activity entries:
    - `event: response.created` -> `◆ response.created`
    - function-call data payloads -> `→ <tool>` / `← <tool>`
    - noisy `response.output_text.delta` data payloads ignored to avoid spam
- Wired direct-mode callback in `packages/client/src/store/orchestratorSessionStore.ts`:
  - still appends raw line to `reasoningTraceStore`
  - now also appends compact summary to orchestrator activity via `appendLog(...)`
- Added focused tests in `packages/client/src/lib/orchestrator/hermesTracePresentation.test.ts` for event mapping, tool-call mapping, delta suppression, and bracket-style markers.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/hermesTracePresentation.test.ts src/lib/tauri.agentBrowserSession.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings only)
- Tauri dev remains running (`proc_4577578f0631`) with Vite hot reload active.

## 2026-04-21 09:12:37 PDT — Browser temp-file error classification hardening
Goal: Investigate telemetry-reported browser failures (`/tmp/agent-browser-h_.../_stdout_open|_stdout_snapshot`) and prevent misleading "install agent-browser" hints.

Completed:
- Investigated telemetry export `/Users/ghost/Downloads/orca-telemetry-20260421-090608.csv` and confirmed repeated transient browser errors:
  - `[Errno 2] No such file or directory: '/tmp/agent-browser-h_.../_stdout_open'`
  - `[Errno 2] No such file or directory: '/tmp/agent-browser-h_.../_stdout_snapshot'`
- Updated `packages/client/src/lib/tauri.ts`:
  - tightened `isAgentBrowserCliMissingErrorMessage(...)` so generic `No such file or directory` no longer auto-classifies as missing CLI
  - added `isAgentBrowserSessionTransportErrorMessage(...)` for temp-file race signatures
  - updated `withAgentBrowserCliInstallHint(...)` to return a transport-specific retry message instead of install guidance for these session races
- Updated tests in `packages/client/src/lib/tauri.agentBrowserSession.test.ts`:
  - missing-cli detection now asserts plain `No such file or directory` is **not** treated as missing CLI
  - added transport-race detection coverage for `_stdout_open`
  - added hint behavior coverage to ensure transport errors do not include install instructions

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/tauri.agentBrowserSession.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings only)

## 2026-04-21 09:02:33 PDT — AgentTraceDrawer regression + local Tauri dev launch
Goal: Add focused regression coverage for trace drawer collapse/expand parity and launch local desktop app for manual QA.

Completed:
- Added `packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.test.tsx` with two UI regressions:
  - collapsed drawer shows explicit `Expand (N)` control + collapsed preview snippet
  - expanded drawer shows `Collapse (N)` + full orchestrator trace region
- Ran targeted UI tests:
  - `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/components/tiles/agent-tile/AgentTraceDrawer.test.tsx src/components/tiles/__tests__/HermesAgentChatPanel.test.ts`
  - result: pass (5/5)
- Launched desktop app for manual testing:
  - `npm run tauri:dev`
  - confirmed active processes include `tauri dev`, `vite`, `agent-canvas-server`, and desktop binary `target/debug/agent-canvas`.

Notes:
- Background process session id for this run: `proc_4577578f0631`.

## 2026-04-21 08:58:22 PDT — Hermes trace UX parity implementation (chips + collapse + fenced output)
Goal: Implement Hermes-style trace chip visibility and code/diff rendering parity across Hermes chat and agent trace surfaces.

Completed:
- Added richer trace-chip extraction/formatting in `packages/client/src/lib/orchestrator/delegatedLogPresentation.ts`:
  - parses Hermes `tool.call/tool.result` events
  - captures tool icon + target snippet + duration metadata
  - exports `formatTraceChipLabel(...)` for shared UI display
- Extended trace chip tests in `packages/client/src/lib/orchestrator/delegatedLogPresentation.test.ts` for Hermes-style tool/path/duration lines.
- Updated `packages/client/src/components/tiles/HermesAgentChatPanel.tsx`:
  - trace chips now use shared extractor/formatter and persist after run completion
  - trace collapse state remains visible via raw trace section
  - assistant output now parses fenced blocks and renders:
    - diff blocks (`data-testid="hermes-chat-diff-block"`)
    - code blocks (`data-testid="hermes-chat-code-block"`)
- Updated `packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.tsx`:
  - chip rows now show icon/target/duration metadata
  - expand/collapse control aligned to explicit label format (`Expand/Collapse (count)`)
  - collapsed preview snippet added when not expanded
- Added Hermes chat UI regression in `packages/client/src/components/tiles/__tests__/HermesAgentChatPanel.test.ts` for fenced diff/code rendering.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/components/tiles/__tests__/HermesAgentChatPanel.test.ts` (pass)
- `npm exec -- vitest run src/lib/orchestrator/delegatedLogPresentation.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings only)

Follow-ups:
- Add a focused UI test for AgentTraceDrawer expanded/collapsed parity if we want stricter snapshot coverage.

## 2026-04-21 08:45:35 PDT — Hermes trace UX parity planning
Goal: Decide the next Orca continuation slice for Hermes-style trace visibility and diff/chat rendering parity.

Completed:
- Inspected current trace and output surfaces in:
  - `packages/client/src/components/tiles/HermesAgentChatPanel.tsx`
  - `packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.tsx`
  - `packages/client/src/components/tiles/agent-tile/AgentOutputStream.tsx`
  - `packages/client/src/store/reasoningTraceStore.ts`
- Confirmed current state:
  - Hermes chat already has a raw gateway trace collapse section.
  - Trace chips are visible while streaming in Hermes chat and in AgentTraceDrawer.
  - Hermes chat bubbles currently render assistant text as plain text, not parsed fenced code/diff blocks.
- Updated `hermes-dev/NEXT-STEPS.md` to prioritize a dedicated "Hermes trace UX parity wave" before broader feature waves.

Follow-ups:
- Implement shared trace-chip formatting for Hermes chat + agent trace drawer (tool/path/duration metadata).
- Render Hermes chat assistant output with fenced block parsing so diff/code appear as code blocks.
- Keep collapsible trace affordance visible and consistent across chat/tile surfaces.

## 2026-04-20 16:49:14 PDT — Bootstrap
Goal: Initialize Hermes dev documentation and establish persistent tracking.

Completed:
- Verified GitHub CLI authentication (`gh auth status`) for account `RuneweaverStudios`.
- Inspected repository git status and remote configuration.
- Created `hermes-dev/` tracking folder in project root.
- Added core tracking docs (`README.md`, `WORKLOG.md`, `NEXT-STEPS.md`, `DECISIONS.md`).

Validation:
- Confirmed `gh` is installed and authenticated with `repo` + `workflow` scopes.
- Confirmed repository tracks `origin` at `https://github.com/austindixson/nyx-clone.git`.

Follow-ups:
- Begin harness hardening plan and benchmark expansion docs.

## 2026-04-20 16:49:14 PDT — GitHub push completed
Goal: Push Hermes dev-tracking bootstrap to remote using gh-authenticated setup.

Completed:
- Committed `hermes-dev/` docs with message: `docs: bootstrap hermes-dev work tracking`.
- Pushed commit `865bf8b` to `origin/main`.

Validation:
- Push succeeded to `https://github.com/austindixson/nyx-clone.git`.
- Branch advanced: `340fb0a..865bf8b`.

Notes:
- Git warned committer identity is auto-derived (`ghost@ghosts-MacBook-Pro.local`).
- Recommended: set explicit global identity via `git config --global user.name` and `git config --global user.email`.

## 2026-04-20 16:52:34 PDT — Conformance/spec kickoff
Goal: Start harness hardening with explicit conformance and eval-v2 planning docs.

Completed:
- Auth checked and repo state verified before new work.
- Added `hermes-dev/LOOP-CONFORMANCE-SPEC.md` with invariants (I1-I10), severity levels, and exit criteria.
- Added `hermes-dev/HARNESS-EVAL-V2-PLAN.md` with behavioral test matrix and implementation map.

Validation:
- Spec and plan are scoped to live Orca loop files (`runOrchestrator`, `orchestratorToolBatch`, `executeTools`, `orchestratorSessionStore`, `orchestratorHeartbeat`).
- Plan includes P0 gating rule: any P0 invariant failure blocks acceptance.

Follow-ups:
- Implement conformance split (`tasks.conformance.json`) and P0 evaluators first.
- Patch empty-final-response success-path gap in orchestrator loop.

## 2026-04-20 17:00:05 PDT — Conformance split + P0 evaluator wave 1
Goal: Implement first conformance benchmark slice and close silent-empty final response gap.

Completed:
- Added new harness split file: `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`.
- Extended harness CLI to accept `--split conformance` and map to `tasks.conformance.json`.
- Added two P0 evaluators in `evaluateHarnessSuite.ts`:
  - `terminal_success_requires_non_empty_final`
  - `single_failure_requires_recovery_attempt`
- Patched orchestrator final response guard in `runOrchestrator.ts` to reject empty terminal assistant output after tool rounds.
- Added exported guard helper: `shouldRejectEmptyTerminalAssistantMessage(...)` for direct invariant testing.
- Added tests:
  - `runOrchestrator.finalResponseGuard.test.ts`
  - extended `evaluateHarnessSuite.test.ts` with conformance split smoke.

Validation:
- Targeted tests passed via `npm exec -- c8 node ... --test` for both updated test files (8/8 pass).
- Harness eval conformance run succeeded:
  - `npm run harness:eval --workspace=@agent-canvas/client -- --candidate audit-2026-04-20 --split conformance`
  - output: `passRate=1`.

Follow-ups:
- Add next P0 conformance evaluators (safety-gate destructive actions, cancellation integrity).
- Add invariant-bucket scoring + hard P0 fail gate in aggregate candidate scoring.

## 2026-04-20 17:07:59 PDT — Memory system teardown + rebuild plan
Goal: Dissect current Orca memory architecture and document a ground-up rebuild wishlist/blueprint.

Completed:
- Audited live memory stack and integration points:
  - `orcaMemory.ts`, `memoryDistiller.ts`, `userProfileDistiller.ts`
  - `sessionPersistence.ts`, `executeTools.ts`, `orchestratorSessionStore.ts`, `settingsStore.ts`
  - `docs/MEMORY_ARCHITECTURE.md`
- Authored `hermes-dev/MEMORY-SYSTEM-REBUILD.md` with:
  - current-state dissection
  - P0/P1/P2 issues
  - rebuild wishlist
  - target architecture and module map
  - conformance/eval additions
  - phased rollout + definition of done
- Updated `hermes-dev/README.md` to include the new memory rebuild doc.

Validation:
- Findings are grounded in current source files and current settings toggles.
- Plan keeps compatibility by proposing wrapper-based migration before legacy cleanup.

Follow-ups:
- Start Phase 0: define canonical typed memory schema + governance rules in code.
- Implement unified retrieval engine behind existing memory tools.

## 2026-04-20 17:12:38 PDT — Harness knobs priority doc added
Goal: Capture highest-impact agent loop parameters to maximize capability, efficiency, and speed.

Completed:
- Added `hermes-dev/HARNESS-KNOBS-PRIORITIES.md` with:
  - highest-impact tuning knobs (ordered)
  - vital loop parameters (core 12)
  - top-5 first tuning set
  - benchmark hooks for measurable improvement
- Updated `hermes-dev/README.md` file index with this new doc.
- Saved user preference/memory to prioritize these knobs in ongoing Orca guidance.

Validation:
- Knob list and parameter set aligned to active Orca orchestrator/harness architecture and current conformance direction.

Follow-ups:
- Convert these knob priorities into deterministic conformance/efficiency evaluators.

## 2026-04-20 17:16:53 PDT — Skills breakdown + Orca integration doc
Goal: Break down core skills and map each to concrete Orca harness policy/gate/evaluator implementation.

Completed:
- Added `hermes-dev/SKILLS-INTEGRATION-BREAKDOWN.md` covering:
  - `systematic-debugging`
  - `phase-completion-verification`
  - `verify-existing-implementation`
  - `writing-plans` / `plan`
- For each skill, documented:
  - intended behavior
  - required harness/policy mechanisms
  - conformance tasks to prove implementation
- Updated `hermes-dev/README.md` index and `hermes-dev/NEXT-STEPS.md` priorities to include skills integration workstream.

Validation:
- Skill breakdown tied directly to Orca files where enforcement should live (`runOrchestrator`, execution contract, executeTools, harness eval).

Follow-ups:
- Implement these skill gates as deterministic conformance checks before broad feature expansion.

## 2026-04-20 17:19:23 PDT — Interrupt/resume behavior documented
Goal: Capture and formalize the interruption handling pattern (answer-now + resume-offer) for Orca.

Completed:
- Added `hermes-dev/INTERRUPT-RESUME-PROTOCOL.md` describing:
  - interruption detection
  - checkpoint capture
  - immediate answer pivot
  - explicit resume offer
  - deterministic resume from checkpoint
- Added Orca implementation map to core files (`orchestratorSessionStore`, `runOrchestrator`, prompt layers, harness eval).
- Added suggested conformance tasks for interruption/resume behavior.
- Updated `hermes-dev/README.md` and `hermes-dev/NEXT-STEPS.md` to include this workstream.

Validation:
- Protocol aligns with user-observed behavior preference and current conformance-first roadmap.

Follow-ups:
- Implement interruption/resume conformance evaluators and wire checkpoint-aware resume logic.

## 2026-04-20 17:31:01 PDT — Shell/PTY in-flight validation + risk review
Goal: Validate current uncommitted shell/PTY execution changes and determine merge-readiness before resuming roadmap work.

Completed:
- Ran targeted client tests for changed/new routing/filter surfaces:
  - `src/lib/terminal/shellRouter.test.ts`
  - `src/lib/orchestrator/orchestratorToolFilter.test.ts`
- Ran client build/typecheck path via `npm run build --workspace=packages/client`.
- Ran Rust compile validation for desktop bridge changes via `cargo check --manifest-path src-tauri/Cargo.toml`.
- Performed independent reviewer pass on full uncommitted diff (security + logic focus).

Validation:
- Targeted tests passed (8/8).
- Client build succeeded (existing Vite warnings only; no new hard failures).
- Rust check succeeded.
- Independent review flagged pre-commit blockers in new shell execution path:
  1) backend output capture can grow unbounded (`wait_with_output` without hard byte cap),
  2) timeout kill path may leave child processes alive (shell PID killed, process tree not guaranteed),
  3) `command_argv` flattened with join semantics (argument-boundary/quoting mismatch risk),
  4) missing deterministic tests for `run_shell_command` executeTools path.

Follow-ups:
- Patch backend subprocess handling for bounded output buffering and process-group tree termination.
- Resolve `command_argv` semantics (preserve argv boundaries or remove/deprecate field).
- Add focused executeTools tests for run_shell_command safety/cwd/timeout/budget behavior.
- Re-run targeted tests + build/check and then prepare commit.

## 2026-04-20 17:36:09 PDT — Shell/PTY hardening patches landed
Goal: Close independent-review blockers in the new `run_shell_command` + `run_workspace_shell_command` path.

Completed:
- Hardened desktop subprocess capture in `src-tauri/src/lib.rs`:
  - replaced `wait_with_output()` with bounded stream readers (`WORKSPACE_SHELL_MAX_CAPTURE_BYTES`),
  - added truncation metadata (`stdout_truncated`, `stderr_truncated`),
  - strengthened timeout cleanup to best-effort process-tree termination (`pkill -P` on Unix, `taskkill /T` on Windows) plus parent kill.
- Tightened orchestrator-side command semantics in `executeTools.ts`:
  - `run_shell_command` now requires non-empty `command`,
  - `command_argv` no longer treated as executable source,
  - payload reports `command_argv_ignored` for compatibility visibility,
  - payload surfaces backend output truncation flags.
- Updated type/contracts/docs wiring:
  - `WorkspaceShellResult` in `packages/client/src/lib/tauri.ts`,
  - tool descriptions in `toolDefinitions.ts` and `canvasToolsManifest.ts`.
- Added deterministic test coverage for new validation behavior:
  - `packages/client/src/lib/orchestrator/runShellCommand.test.ts`.

Validation:
- Targeted tests passed:
  - `shellRouter.test.ts`, `orchestratorToolFilter.test.ts`, `runShellCommand.test.ts` (10/10 pass).
- `cargo check --manifest-path src-tauri/Cargo.toml` passed.
- `npm run build --workspace=packages/client` passed (existing Vite warnings only).

Follow-ups:
- Add one integration-level timeout cleanup test for subprocess-tree behavior.
- Decide long-term `command_argv` direction (remove/deprecate vs keep metadata-only) before final commit split.

## 2026-04-20 17:40:24 PDT — Post-review consistency fixes
Goal: Address secondary review findings around JSON stability and contract wording.

Completed:
- Ensured `run_shell_command` returns valid JSON even under output budgeting by truncating `stdout`/`stderr` fields inside payload instead of truncating the full JSON string.
- Updated client tool description to match implementation (`command` required; `command_argv` metadata-only).
- Tightened Unix timeout cleanup command path resolution (`/usr/bin/pkill` with fallback to `pkill`).

Validation:
- Re-ran targeted tests: `shellRouter.test.ts`, `orchestratorToolFilter.test.ts`, `runShellCommand.test.ts` (10/10 pass).
- Re-ran `cargo check --manifest-path src-tauri/Cargo.toml` (pass).
- Re-ran `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings unchanged).

Follow-ups:
- Integration test coverage still needed for timeout cleanup/process-tree behavior on desktop shell path.

## 2026-04-20 17:51:32 PDT — Prompt-flow wishlist item added
Goal: Capture user-approved Hermes prompt-flow pattern as a prioritized Orca wishlist/backlog item.

Completed:
- Updated `hermes-dev/NEXT-STEPS.md` to add a dedicated prompt-flow contract item near the top of priority order.
- Added explicit sub-bullets for staged execution flow, interruption-resume behavior, and conformance checks for flow quality.

Validation:
- Confirmed the new wishlist/backlog item appears as step 2 in `NEXT-STEPS.md` and renumbering is consistent.

Follow-ups:
- Fold this prompt-flow contract into concrete evaluator specs once current shell/PTY timeout integration test is finished.

## 2026-04-20 17:54:50 PDT — Timeout cleanup integration test + UI simplification plan
Goal: Continue active queue by completing the remaining shell timeout-cleanup integration test and drafting the concrete tile/orchestrator simplification patch plan.

Completed:
- Added Rust integration-style unit test in `src-tauri/src/lib.rs`:
  - `workspace_shell_tests::timeout_cleanup_kills_spawned_child_processes`
  - test spawns a shell with a child process and verifies process-tree cleanup terminates both parent and child.
- Ran targeted test:
  - `cargo test --manifest-path src-tauri/Cargo.toml timeout_cleanup_kills_spawned_child_processes -- --nocapture` (pass).
- Authored `hermes-dev/ORCHESTRATOR-TILE-SIMPLIFICATION-PLAN.md` with a component-by-component implementation map for concise output UX.
- Updated `hermes-dev/README.md` index to include the new simplification plan doc.

Validation:
- New timeout-cleanup test passed locally (1/1).
- Plan doc includes explicit file targets for orchestrator/tile/parser and a verification/commit split.

Follow-ups:
- Implement Task 1+2 from simplification plan in UI files and add targeted client tests.
- Run full validation slice before commit split (`cargo check`, client build/tests).

## 2026-04-20 17:57:52 PDT — Simplified orchestrator/tile output wiring + validation sweep
Goal: Execute p3/p4 by wiring concise tool/reasoning presentation and verifying the build/test surface.

Completed:
- Updated `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`:
  - added `compactToolLine(...)` for compact labels (`Running <tool>`, `<tool> done/failed`, phase/resumed tags),
  - carried `compactLabel` through `mainColumnItems` bubble model,
  - changed tool-row rendering to concise primary label with optional expandable `Details` raw line.
- Updated `packages/client/src/components/tiles/agent-tile/AgentOutputStream.tsx`:
  - compacted tool-result chip language to explicit `<tool> done/failed` with failure tinting.
- Validation run:
  - `cargo test --manifest-path src-tauri/Cargo.toml timeout_cleanup_kills_spawned_child_processes -- --nocapture` (pass),
  - `cargo check --manifest-path src-tauri/Cargo.toml` (pass),
  - `npm run build --workspace=packages/client` (pass; existing Vite warnings unchanged),
  - `npm test --workspace=packages/client -- runShellCommand.test.ts` (pass),
  - `npm test --workspace=packages/client -- src/components/tiles/agent-tile/agentOutputParse.test.ts src/components/orchestrator/__tests__/OrchestratorTracePeekRows.test.ts` (pass).

Validation:
- Timeout cleanup/process-tree integration test is green.
- Client compiles and test suite entrypoints used in this wave remain green.

Follow-ups:
- Split commits cleanly between shell/PTY hardening test and UI simplification wave.
- Optional next: add explicit unit tests for `compactToolLine(...)` mapping behavior.

## 2026-04-20 18:01:14 PDT — Compact line mapping extracted + tested
Goal: Continue by making compact tool-line mapping independently testable and covered.

Completed:
- Added new helper module: `packages/client/src/components/orchestrator/orchestratorLineCompaction.ts`.
- Refactored `OrchestratorModuleLayout.tsx` to import `compactToolLine(...)` from the helper module.
- Added targeted tests: `packages/client/src/components/orchestrator/orchestratorLineCompaction.test.ts`.
  - covers tool-start mapping
  - covers success/failure result mapping
  - covers phase/resumed tag mapping and plain-text passthrough

Validation:
- `npm test --workspace=packages/client -- src/components/orchestrator/orchestratorLineCompaction.test.ts` (pass).

Follow-ups:
- Commit this extraction/test as a focused UI-quality commit.

## 2026-04-20 18:06:03 PDT — Relaxed shell/tool truncation aggressiveness
Goal: Reduce overly aggressive run_shell_command result truncation while preserving JSON safety and bounded outputs.

Completed:
- Increased shell-family tool result budget in `packages/client/src/lib/harness/toolResultBudget.ts`:
  - `run_terminal_cmd`, `bash`, `run_shell_command` cap raised from `50_000` to `120_000`.
- Improved `run_shell_command` overflow handling in `packages/client/src/lib/orchestrator/executeTools.ts`:
  - replaced equal per-field truncation with proportional stdout/stderr budgeting based on actual output distribution,
  - keeps JSON-valid fallback behavior and truncation flags/notes.

Validation:
- `npm test --workspace=packages/client -- runShellCommand.test.ts` (pass).

Follow-ups:
- If still too aggressive in practice, bump shell-family cap again (e.g. 150k) and/or bias stderr preservation for failure diagnostics.

## 2026-04-20 18:10:20 PDT — command_argv direction finalized for run_shell_command
Goal: Continue shell wave by finalizing the `run_shell_command` API direction and aligning public schemas/docs.

Completed:
- Chosen direction: **deprecate/remove from public schema** for `run_shell_command`, while keeping compatibility parsing server-side for older callers.
- Updated client tool schema/docs in `packages/client/src/lib/orchestrator/toolDefinitions.ts`:
  - removed `command_argv` from `run_shell_command` parameters,
  - removed `command_argv` mention from tool description.
- Updated server manifest in `packages/server/src/canvasToolsManifest.ts`:
  - removed `command_argv` from `run_shell_command` parameter schema,
  - updated description text accordingly.
- Updated orchestrator tool-log summarization in `packages/client/src/lib/orchestrator/orchestratorModuleBindings.ts`:
  - `run_shell_command` summary now uses only `command`.
- Updated backlog wording in `hermes-dev/NEXT-STEPS.md` to reflect decision completion and compatibility-cleanup follow-through.

Validation:
- `npm test --workspace=packages/client -- src/lib/orchestrator/orchestratorToolFilter.test.ts src/lib/orchestrator/runShellCommand.test.ts` (pass).

Follow-ups:
- In a later breaking-cleanup pass, remove compatibility parsing + `command_argv_ignored` payload note from execution path.

## 2026-04-20 18:13:39 PDT — completed run_shell_command execution-path cleanup
Goal: Keep going on the same item by finishing the breaking-cleanup follow-through for `run_shell_command`.

Completed:
- Updated `packages/client/src/lib/orchestrator/executeTools.ts` (`run_shell_command` case):
  - removed compatibility parsing of `args.command_argv`,
  - removed `command_argv_ignored` / `command_argv_note` response payload fields,
  - simplified empty-input error to `Provide non-empty \`command\`.`.
- Updated `hermes-dev/NEXT-STEPS.md` wording to reflect that `run_shell_command` now has command-only execution semantics and separate terminal-tile argv support.

Validation:
- `npm test --workspace=packages/client -- src/lib/orchestrator/runShellCommand.test.ts src/lib/orchestrator/orchestratorToolFilter.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite chunk warnings).

Result:
- `run_shell_command` is now fully command-string authoritative end-to-end (schema + manifest + execution path), with no lingering runtime compatibility flags.

## 2026-04-20 18:19:59 PDT — prompt-flow contract + interruption/resume conformance wave
Goal: Continue from shell wave into the next highest-priority harness item: enforce Hermes-style flow contract guidance and add conformance checks.

Completed:
- Updated dynamic orchestrator prompt preface in `packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts`:
  - added `buildPromptFlowContractBlock()` with staged flow sequence:
    1) skills/context scan, 2) plan/todo declaration, 3) targeted discovery,
    4) patch/test/verify, 5) concise closeout.
  - added interruption-resume policy text:
    - answer interruption first,
    - add single-sentence resume handoff,
    - resume from checkpoint (not restart).
  - wired into `buildDynamicPromptPreface()` for both default + heartbeat contexts.
- Added targeted prompt-layer tests:
  - `packages/client/src/lib/orchestrator/orchestratorPromptLayers.test.ts`
  - validates staged flow markers + interruption-resume markers + heartbeat coexistence.
- Extended harness conformance evaluators in `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`:
  - new task kind: `prompt_flow_contract_present`
  - new task kind: `interruption_answer_then_resume_offer`
  - deterministic checks read dynamic prompt preface markers.
- Extended conformance task list:
  - `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json`
  - added two P1 checks above.
- Updated harness eval tests:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts`
  - conformance split now validates 4 tasks (previous 2 + new 2).
- Updated `hermes-dev/NEXT-STEPS.md` to mark prompt-flow prompt/conformance work done and keep runtime checkpoint-resume wiring as next action.

Validation:
- `npm test --workspace=packages/client -- src/lib/orchestrator/orchestratorPromptLayers.test.ts src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts` (pass).
- `npm run harness:eval --workspace=@agent-canvas/client -- --split conformance --candidate local-dev` (pass; `passRate=1`).

Next:
- Implement runtime interruption checkpoint state in orchestrator session store + deterministic resume handoff behavior in run loop (beyond prompt policy text).

## 2026-04-20 18:32:31 PDT — runtime interruption checkpoint + deterministic resume-handoff wiring
Goal: Continue interruption-resume rollout by enforcing checkpoint state and runtime handoff behavior in the live orchestrator session loop.

Completed:
- Added new runtime helper module:
  - `packages/client/src/lib/orchestrator/interruptionResume.ts`
  - includes deterministic helpers for:
    - checkpoint construction (`buildInterruptionCheckpoint`),
    - interruption/resume directive generation (`buildInterruptionResumeDirectivePrefix`),
    - interrupted-task summary extraction from session history (`summarizeInterruptedTaskFromSession`).
- Added targeted tests:
  - `packages/client/src/lib/orchestrator/interruptionResume.test.ts`
  - validates deterministic directive content/order, trimming behavior, and user-task summary extraction.
- Extended orchestrator session runtime in `packages/client/src/store/orchestratorSessionStore.ts`:
  - state now tracks `interruptionCheckpoint`.
  - queued runs now carry optional `interruptionCheckpointId`.
  - when user interrupts during `running=true`, store captures checkpoint (run generation + summarized prior task + interruption preview) and binds it to queued turn.
  - when queued turn executes, run loop prepends deterministic runtime directive instructing:
    - answer interruption first,
    - then add exactly one resume-offer sentence,
    - and resume from checkpoint on later continue.
  - checkpoint is cleared after the queued turn completes; `clearQueue()` now clears stale checkpoint state as well.
- Updated `hermes-dev/NEXT-STEPS.md` to mark runtime checkpoint/handoff step as DONE and set next follow-up to an end-to-end queued interruption regression.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/interruptionResume.test.ts` (pass).
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts src/lib/orchestrator/orchestratorPromptLayers.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite chunk warnings only).

Next:
- Add end-to-end regression around actual queued interruption lifecycle in session store/runtime to assert checkpoint capture + directive injection + checkpoint clear behavior.

## 2026-04-20 18:42:24 PDT — xAI (Grok) provider support added
Goal: Add first-party xAI/Grok provider support using xAI OpenAI-compatible API (`https://api.x.ai/v1`) based on xAI quickstart docs.

Completed:
- Added new provider type and defaults in `settingsStore.ts`:
  - new provider id: `xai`
  - `XAI_DEFAULT_BASE = https://api.x.ai/v1`
  - baseline models: `grok-4.20-reasoning`, `grok-4`
  - provider metadata (`PROVIDER_INFO`) and initial persisted config (`providers.xai`).
- Wired model availability pipeline:
  - when `xai` is active, `getAvailableModels()` now includes `XAI_MODELS`.
- Wired credentials/base resolution in `llmCredentials.ts`:
  - API key env support: `XAI_API_KEY`
  - base-url env support: `XAI_BASE_URL`
  - `resolveBaseUrl('xai', …)` defaults to `https://api.x.ai/v1`.
- Wired runtime chat execution:
  - `chatCompletion.ts` now supports provider `xai` via OpenAI-compatible `POST /chat/completions` with Bearer auth.
  - `orchestratorPlanningStream.ts` now supports `xai` for streamed planning requests.
- Wired Settings UI:
  - `ProviderSettingsPanel.tsx` now includes xAI in Cloud APIs and base-URL editor handling/placeholder hints.
- Updated provider avatar monograms (`providerLogo.tsx`) to include `xai`.
- Added/extended tests:
  - `chatCompletion.fallback.integration.test.ts` adds xAI endpoint/auth assertion.
  - `settingsStore.test.ts` adds xAI defaults/models assertions.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/store/settingsStore.test.ts src/lib/orchestrator/chatCompletion.fallback.integration.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite chunk warnings only).

Next:
- Optional: add a tiny settings-panel regression test for xAI visibility in grouped provider rendering.

## 2026-04-20 18:58:18 PDT — Hermes Lead mode wave 1 scaffold implemented
Goal: Start building the third interface mode where Hermes is visible as lead orchestrator with left focus pane + right lightweight graph.

Completed:
- Added new canvas view mode `helix` in `packages/client/src/store/canvasStore.ts`.
- Added new toolbar mode button `Lead` in `packages/client/src/components/Toolbar/CanvasToolbar.tsx`.
- Added low-resource Hermes lead graph model builder:
  - `packages/client/src/lib/hermesLeadGraph.ts`
  - node kinds: `hermes`, `agent`, `tile`, `folder`, `file`
  - edge kinds: `spawn`, `contains`, `focus`
  - consumes canvas tiles + workspace file tree + active focus tile
- Added unit tests:
  - `packages/client/src/lib/hermesLeadGraph.test.ts`
- Added new split-view canvas page:
  - `packages/client/src/components/Canvas/HermesLeadCanvasView.tsx`
  - left 50% focus card for selected node
  - Hermes lens summary strip (agents/files/active/links)
  - right 50% static SVG DNA-style graph for low runtime cost
  - tile nodes support `Open tile` jump back into rich Tiles mode and center on canvas
  - auto-select follows active orchestrator tile when auto-focus is enabled
- Integrated mode into `InfiniteCanvas` render path and input guards:
  - `canvasViewMode === 'helix'` now renders HermesLeadCanvasView
  - pan/select/context-menu suppression mirrors graph/plan behavior
- Hidden non-essential overlays in Lead mode:
  - right minimap panel hidden (`CanvasRightPanel.tsx`)
  - orchestrator HUD hidden (`CanvasToolbar.tsx`)
- Added planning/tracking docs:
  - `hermes-dev/HERMES-LEAD-MODE.md`
  - updated `hermes-dev/README.md` index
  - promoted Hermes Lead wave-2 follow-ups in `hermes-dev/NEXT-STEPS.md`

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/hermesLeadGraph.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings only).

Next:
- Add Hermes lens card (intent/tools/delegation/confidence/risk).
- Add semantic clustering + filters for files/agents/tools.
- Add node-to-focus and focus-to-node transition animation polish.

## 2026-04-20 19:06:21 PDT — Hermes Lead mode wave 2 (filters + tool nodes + motion polish)
Goal: Continue Hermes Lead mode with semantic filtering, tool-aware graph nodes, and smoother interaction transitions.

Completed:
- Extended lead graph model in `packages/client/src/lib/hermesLeadGraph.ts`:
  - added node kind `tool`
  - added edge kind `tool`
  - added graph input support for `toolNames` and `maxToolNodes`
  - projected recent tools into graph as `tool:<name>` nodes linked from `hermes:lead`
- Extended tests in `packages/client/src/lib/hermesLeadGraph.test.ts`:
  - added failing-first coverage for tool node/edge projection
  - validated pass after implementation
- Upgraded `packages/client/src/components/Canvas/HermesLeadCanvasView.tsx`:
  - ingests recent tool names from orchestrator activity feed + latest tool name
  - adds semantic filter toggles (`Agents`, `Files`, `Tools`, `Tiles`)
  - prunes graph nodes/edges based on active filters
  - extends lens strip with tool count
  - adds transition timing for card/line/circle updates (smoother node-focus switching)
- Updated lead-mode spec doc:
  - `hermes-dev/HERMES-LEAD-MODE.md` now reflects tool nodes/edges and wave-2 progress.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/hermesLeadGraph.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings only).

Next:
- Add richer Hermes lens fields (intent, delegation tree, confidence/risk signal).
- Introduce semantic cluster layouts (agent/file/tool families) instead of single helix only.
- Add true morph-style node↔focus transitions (position-aware animation).

## 2026-04-20 19:13:50 PDT — Hermes Lead mode wave 3 (semantic cluster layout rollout)
Goal: Replace the single helix-only node positioning with semantic cluster family layout for better legibility at scale.

Completed:
- Added new layout utility:
  - `packages/client/src/lib/hermesLeadLayout.ts`
  - `computeHermesLeadClusterLayout(...)` provides deterministic family-band placement:
    - Hermes root top-center
    - agents left band
    - tools right band
    - files/folders lower-left band
    - generic tiles lower-right band
- Added tests:
  - `packages/client/src/lib/hermesLeadLayout.test.ts`
  - verifies root anchoring, semantic band distribution, and deterministic stability.
- Wired lead canvas to use semantic cluster layout:
  - `packages/client/src/components/Canvas/HermesLeadCanvasView.tsx`
  - replaced prior sine/helix-only positioning with utility-based cluster placement.
- Updated lead spec doc:
  - `hermes-dev/HERMES-LEAD-MODE.md` now includes wave-3 progress and updated known-gaps wording.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/hermesLeadLayout.test.ts src/lib/hermesLeadGraph.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings only).

Next:
- Add live density-aware clustering and optional force-pack mode.
- Add true node↔focus morph animations using position-aware transforms.
- Add richer Hermes lens fields (intent/delegation/confidence-risk) from orchestrator runtime state.

## 2026-04-20 19:17:33 PDT — Added design extraction JSON-tool track to roadmap
Goal: Capture a new to-do stream for screenshot-to-JSON design extraction and controlled JSON-driven image edits.

Completed:
- Added roadmap priority in `hermes-dev/NEXT-STEPS.md` for a design extraction tool.
- Added new doc `hermes-dev/DESIGN-EXTRACTION-JSON-TOOL.md` with:
  - extracted prompts from the referenced workflow
  - context-specific prompt variants (elements, weather/season, camera, add object)
  - proposed schema for full style-guide JSON output
  - acceptance criteria, implementation slices, and open decisions
- Updated `hermes-dev/README.md` index to include the new design extraction doc.

Validation:
- Verified markdown files updated in repo and linked from `README.md`.

Follow-ups:
- Decide first implementation target (Gemini-first vs provider-agnostic adapters).
- Draft strict JSON schema + repair policy and wire into extraction pipeline.

## 2026-04-20 19:26:00 PDT — Design extraction implementation plan + Hermes Lead wave 4 shipped
Goal: Convert the new design-extraction roadmap item into an executable implementation plan, then immediately deliver Hermes Lead wave 4 (morph/lens/pack).

Completed:
- Added `hermes-dev/DESIGN-EXTRACTION-JSON-TOOL-IMPLEMENTATION-PLAN.md` with stepwise tasks:
  - schema + contracts
  - prompt templates
  - normalization/repair
  - extraction API wiring
  - UI flow
  - eval harness
- Implemented Hermes Lead wave 4 runtime features:
  - `packages/client/src/lib/hermesLeadMorph.ts`
    - position-aware node→focus projection helper
  - `packages/client/src/lib/hermesLeadLens.ts`
    - richer lens snapshot (intent, delegation depth/hotspots, confidence/risk)
  - `packages/client/src/lib/hermesLeadLayout.ts`
    - added `semantic | pack | auto` modes and pack-threshold switching
  - `packages/client/src/components/Canvas/HermesLeadCanvasView.tsx`
    - added morph pulse bridge animation
    - upgraded lens card with intent/delegation/confidence-risk
    - added layout mode controls and auto-pack behavior
- Added wave-4 tests:
  - `packages/client/src/lib/hermesLeadLens.test.ts`
  - `packages/client/src/lib/hermesLeadMorph.test.ts`
  - expanded `packages/client/src/lib/hermesLeadLayout.test.ts` with pack-mode assertions
- Updated docs:
  - `hermes-dev/HERMES-LEAD-MODE.md` (wave 4 progress + wave 5 plan)
  - `hermes-dev/NEXT-STEPS.md` (advanced to wave 5)
  - `hermes-dev/README.md` (indexed implementation-plan doc)

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/hermesLeadLayout.test.ts src/lib/hermesLeadGraph.test.ts src/lib/hermesLeadLens.test.ts src/lib/hermesLeadMorph.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite/chunk warnings only).

Follow-ups:
- Iterate wave 5 with full card-shell morph path (not just pulse bridge).
- Add optional low-cost relaxation pass on top of pack layout for dense overlaps.
- Begin Task 1 from design extraction implementation plan (schema + tests).

## 2026-04-20 19:35:54 PDT — Hermes Lead wave 5 delivered (card-shell morph + adaptive relax + branch styling)
Goal: Continue immediately into wave 5 by replacing pulse morph with full card-shell transitions, adding adaptive pack relaxation, and improving file-branch semantics.

Completed:
- Added wave-5 RED tests first:
  - extended `packages/client/src/lib/hermesLeadMorph.test.ts` with full card-shell morph geometry assertions
  - extended `packages/client/src/lib/hermesLeadLayout.test.ts` with adaptive relaxation spacing assertions
- Implemented wave-5 helpers/runtime:
  - `packages/client/src/lib/hermesLeadMorph.ts`
    - added `computeCardShellMorph(...)`
  - `packages/client/src/lib/hermesLeadLayout.ts`
    - added `relaxIterations` option
    - deterministic jittered pack seeding
    - bounded local repulsion relaxation pass
  - `packages/client/src/components/Canvas/HermesLeadCanvasView.tsx`
    - replaced pulse-dot morph with card-shell overlay transform (position/size/radius)
    - wired relaxed pack layout options
    - added richer `contains` edge styling semantics (dashed + file-branch color treatment)
- Updated wave docs:
  - `hermes-dev/HERMES-LEAD-MODE.md` now includes wave-5 implemented scope and wave-6 plan
  - `hermes-dev/NEXT-STEPS.md` advanced top priority to wave 6

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/hermesLeadLayout.test.ts src/lib/hermesLeadMorph.test.ts src/lib/hermesLeadLens.test.ts src/lib/hermesLeadGraph.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite/chunk warnings only).

Follow-ups:
- Implement wave 6 shared-element handoff into tile-open transition.
- Add optional inter-family relaxation pass for very large mixed graphs.
- Start design extraction implementation plan Task 1 (schema/types + failing tests).

## 2026-04-20 19:45:05 PDT — Hermes Lead wave 6 delivered (shared-element tile-open handoff + inter-family relax + branch collapse)
Goal: Continue into wave 6 with transition handoff into tile-open, cross-family density handling, and file-branch collapse controls.

Completed:
- Added RED tests first:
  - `packages/client/src/lib/hermesLeadFileProjection.test.ts` for depth-based file-branch collapse + edge pruning
  - extended `packages/client/src/lib/hermesLeadLayout.test.ts` with inter-family relaxation behavior assertion
- Implemented wave-6 helpers/runtime:
  - Added `packages/client/src/lib/hermesLeadFileProjection.ts`
    - `projectGraphWithFileDepthLimit(...)`
  - Updated `packages/client/src/lib/hermesLeadLayout.ts`
    - `interFamilyRelaxIterations` option
    - deterministic cross-family relaxation pass (`relaxInterFamily`)
  - Updated `packages/client/src/components/Canvas/HermesLeadCanvasView.tsx`
    - integrated file-depth collapse projection controls (`files≤1/2/3/all`)
    - added shared-element style tile-open handoff overlay before Tiles mode switch
    - wired inter-family relax option for dense pack mode
- Updated docs:
  - `hermes-dev/HERMES-LEAD-MODE.md` now includes wave-6 implementation + wave-7 plan
  - `hermes-dev/NEXT-STEPS.md` advanced top priority to wave 7

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/hermesLeadLayout.test.ts src/lib/hermesLeadFileProjection.test.ts src/lib/hermesLeadMorph.test.ts src/lib/hermesLeadLens.test.ts src/lib/hermesLeadGraph.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite/chunk warnings only).

Follow-ups:
- Wave 7: target exact tile frame geometry for tile-open shared-element handoff.
- Add user-facing controls for inter-family relax strength/iterations.
- Add per-folder expand/collapse state memory in lead view.
- Start design extraction implementation plan Task 1 (schema/types + tests).

## 2026-04-20 19:58:51 PDT — Hermes Lead wave 7 delivered (exact tile-frame handoff + relax tuning controls + folder collapse memory)
Goal: Continue into wave 7 with precise tile-frame transition targeting, user-tunable cross-family spacing controls, and per-folder branch collapse memory.

Completed:
- Added RED tests first:
  - extended `packages/client/src/lib/hermesLeadMorph.test.ts` with exact tile-frame handoff geometry assertions
  - extended `packages/client/src/lib/hermesLeadLayout.test.ts` with inter-family relax strength tuning assertions
  - extended `packages/client/src/lib/hermesLeadFileProjection.test.ts` with per-folder collapse-memory assertions
- Implemented wave-7 helpers/runtime:
  - updated `packages/client/src/lib/hermesLeadMorph.ts`
    - added `computeTileFrameHandoff(...)` for tile world-rect + pan/zoom projection into exact viewport frame geometry
  - updated `packages/client/src/lib/hermesLeadLayout.ts`
    - added `interFamilyRelaxStrength` option
    - strengthened deterministic inter-family spacing behavior for low/med/high tuning
  - updated `packages/client/src/lib/hermesLeadFileProjection.ts`
    - added `collapsedFolderIds` support to prune descendants of collapsed folders while preserving non-file nodes
  - updated `packages/client/src/components/Canvas/HermesLeadCanvasView.tsx`
    - tile-open handoff now animates to true target tile frame geometry
    - added inter-family relax tuning controls (`r0/r2/r4/r6`, `low/med/high`)
    - added folder-level `Collapse branch` / `Expand branch` action with in-memory state retention across selections
- Updated docs:
  - `hermes-dev/HERMES-LEAD-MODE.md` now includes wave-7 implementation and wave-8 plan
  - `hermes-dev/NEXT-STEPS.md` advanced top priority to wave 8

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/hermesLeadLayout.test.ts src/lib/hermesLeadFileProjection.test.ts src/lib/hermesLeadMorph.test.ts src/lib/hermesLeadLens.test.ts src/lib/hermesLeadGraph.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite/browser-externalized/chunk warnings only).

Follow-ups:
- Wave 8: Hermes-authored tile-designer surface + conformance checks.
- Optional store-backed persistence for per-folder collapse memory.
- Start design extraction implementation plan Task 1 (schema/types + tests).

## 2026-04-20 20:06:53 PDT — Hermes Lead wave 8 delivered (tile-designer scaffold + conformance helper + store-backed collapse memory)
Goal: Continue into wave 8 by shipping the first Hermes-authored tile-designer surface, adding draft conformance checks, and moving folder-collapse memory to persisted store state.

Completed:
- Added RED tests first:
  - added `packages/client/src/lib/hermesLeadTileDesigner.test.ts` for deterministic draft scaffold generation + conformance violations
  - added `packages/client/src/lib/hermesLeadFolderCollapseMemory.test.ts` for visible-folder reconciliation of persisted collapse ids
- Implemented wave-8 helpers/runtime:
  - added `packages/client/src/lib/hermesLeadTileDesigner.ts`
    - `createHermesTileDesignerDraft(...)`
    - `validateHermesTileDesignerDraft(...)`
    - conformance checks: id/component key shape, title/summary bounds, tool-id format, permission guardrails
  - added `packages/client/src/lib/hermesLeadFolderCollapseMemory.ts`
    - `pruneCollapsedFolderIds(...)` for stale id cleanup against current visible folders
  - updated `packages/client/src/store/workspaceStore.ts`
    - added persisted `hermesLeadCollapsedFolderIds` state + setter/toggle actions
    - added persist/rehydrate wiring for collapsed folder ids
  - updated `packages/client/src/components/Canvas/HermesLeadCanvasView.tsx`
    - replaced local folder-collapse memory with workspace-store-backed state
    - added stale-id pruning via `pruneCollapsedFolderIds(...)`
    - added `Tile Designer (wave 8)` panel for brief-driven draft generation + validation output preview
- Updated docs:
  - `hermes-dev/HERMES-LEAD-MODE.md` now includes wave-8 implementation + wave-9 plan
  - `hermes-dev/NEXT-STEPS.md` advanced top priority to wave 9

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/hermesLeadTileDesigner.test.ts src/lib/hermesLeadFolderCollapseMemory.test.ts src/lib/hermesLeadLayout.test.ts src/lib/hermesLeadFileProjection.test.ts src/lib/hermesLeadMorph.test.ts src/lib/hermesLeadLens.test.ts src/lib/hermesLeadGraph.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite/browser-externalized/chunk warnings only).

Follow-ups:
- Wave 9: tile-designer registration pipeline + harness conformance evaluators.
- Design extraction implementation plan Task 1 (schema/types + tests).

## 2026-04-20 20:13:26 PDT — Orchestrator input now accepts pasted photos
Goal: Enable direct image paste in the orchestrator prompt input so users can paste screenshots/photos without drag/drop.

Completed:
- Added clipboard image extraction path in `packages/client/src/lib/inputAttachments.ts`:
  - new `extractClipboardFiles(...)` helper to read `clipboardData.items`/`files` and keep image-only payloads
  - fallback naming for nameless pasted images (common clipboard behavior), e.g. `pasted-image-...png/jpg`
  - `filesToInputAttachments(...)` now normalizes nameless files before attachment conversion
- Updated `packages/client/src/components/orchestrator/OrchestratorModuleLayout.tsx`:
  - composer `textarea` now handles `onPaste`
  - when pasted clipboard contains images, paste is intercepted and images are attached through existing attachment pipeline
  - normal text paste behavior remains unchanged when no images are present
- Added test coverage in new `packages/client/src/lib/inputAttachments.test.ts`:
  - image extraction from clipboard items
  - fallback filename generation for nameless clipboard images
  - attachment conversion for pasted images to data URL payloads

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/inputAttachments.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite/browser-externalized/chunk warnings only).

Follow-ups:
- If you also want this in the compact quick-input surfaces, wire the same `onPaste` handling into `QuickOrchestratorInput`/`OneShotQuickInput` with attachment preview affordances.

## 2026-04-20 20:26:30 PDT — Dreaming Harness v0 guardrails integrated (risk-gated, timeout-bounded)
Goal: Ship a low-latency, safety-first Dreaming Harness foundation that can preflight risky browser actions without noticeable default performance impact.

Completed:
- Added new dreaming helper module: `packages/client/src/lib/orchestrator/dreamingHarness.ts`
  - policy helpers:
    - `isRiskyBrowserAction(...)`
    - `shouldInvokeDreamingForBrowserAction(...)`
    - timeout/threshold normalization helpers
  - runtime preflight:
    - `runDreamingSimulation(...)` (score-only POST to configured endpoint)
    - bounded timeout + fail-open behavior when endpoint unavailable
    - block only when configured mode permits (`harnessSafetyMode === block`)
- Added test coverage: `packages/client/src/lib/orchestrator/dreamingHarness.test.ts`
  - risk classification
  - kill switch + risky-only gating
  - timeout/threshold normalization
  - block-vs-warn behavior under high surprise response
- Wired Dreaming preflight into agent-browser execution path in `packages/client/src/lib/orchestrator/executeTools.ts`
  - preflight before: `browser_open`, `browser_click`, `browser_fill`, `browser_press`
  - action is blocked only when dream decision blocks under block-mode
  - warning metadata is returned as `dream_warning` when available (non-blocking)
- Extended persisted settings in `packages/client/src/store/settingsStore.ts`
  - added:
    - `harnessDreamingEnabled` (default `false`)
    - `harnessDreamingEndpoint` (default `http://127.0.0.1:8844/dream`)
    - `harnessDreamingTimeoutMs` (default `350`)
    - `harnessDreamingOnlyRisky` (default `true`)
    - `harnessDreamingSurpriseThreshold` (default `0.65`)
  - added setters + persist partialize + rehydrate normalization

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/dreamingHarness.test.ts src/lib/orchestrator/orchestratorToolFilter.test.ts` (pass).
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite/browser-externalized/chunk warnings only).

Follow-ups:
- Add Settings UI controls (Agent & memory) for the new dreaming fields.
- Add harness conformance evaluator tasks for dream-gate behavior (risk-only invocation, timeout fallback, block-mode enforcement).
- Add optional local adapter server that bridges Orca action payloads to `/Users/ghost/Desktop/macworldmodel` inference for real scoring.

## 2026-04-20 20:30:36 PDT — macworldmodel local `/dream` adapter shipped and smoke-tested
Goal: Provide a working local endpoint in `/Users/ghost/Desktop/macworldmodel` that Orca can call immediately at `POST /dream` with the score-only contract.

Completed:
- Added adapter server module:
  - `/Users/ghost/Desktop/macworldmodel/world_model/src/dream_adapter.py`
  - Implements:
    - `score_orca_dream_request(payload)` scoring contract
    - conservative risk/surprise heuristics for `browser_open/click/fill/press/wait`
    - `ThreadingHTTPServer` endpoint on `POST /dream`
    - checkpoint presence reporting (`model_checkpoint_available` for `world_model/checkpoints/best.pt`)
- Added RED→GREEN unit tests:
  - `/Users/ghost/Desktop/macworldmodel/world_model/tests/test_dream_adapter.py`
  - covers low-risk allow behavior, destructive-click block behavior, and response contract fields
- Updated adapter usage docs:
  - `/Users/ghost/Desktop/macworldmodel/world_model/README.md`
  - added run/curl examples + response schema

Validation:
- `python3 -m unittest world_model/tests/test_dream_adapter.py` (pass).
- Smoke test:
  - start adapter on `127.0.0.1:8844`
  - `curl -X POST http://127.0.0.1:8844/dream ...` returns valid JSON with `allow/confidence/surprise_score/risk/reason`.

Follow-ups:
- Replace heuristic scorer internals with learned macworldmodel inference path once GUI NPZ checkpoint is available.
- Add optional authentication + request logging for the adapter endpoint.

## 2026-04-20 20:41:21 PDT — Dual-repo management baseline set (contract + startup + version handshake)
Goal: Make Orca + macworldmodel practical to run as two independent projects while keeping integration stable and fast.

Completed:
- Initialized source control in macworldmodel:
  - `git init` at `/Users/ghost/Desktop/macworldmodel`
  - added `.gitignore` for `.venv`, checkpoints/logs, and generated NPZ artifacts
- Added Orca-owned integration contract doc:
  - `docs/DREAM_ADAPTER_CONTRACT.md`
  - defines required `/dream` request/response fields and compatibility policy
- Added one-command local startup path from Orca:
  - `scripts/dev-dream.sh` (starts adapter + health check + runs `npm run dev`)
  - added npm script alias: `npm run dev:dream`
- Added adapter version handshake across both sides:
  - macworldmodel response now includes `adapter_version` (`1.0.0`)
  - Orca `runDreamingSimulation(...)` now warns on incompatible adapter major versions (fail-open, non-blocking)
  - extended tests in `packages/client/src/lib/orchestrator/dreamingHarness.test.ts`
  - extended adapter contract test in `world_model/tests/test_dream_adapter.py`

Validation:
- Orca tests: `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/dreamingHarness.test.ts src/lib/orchestrator/orchestratorToolFilter.test.ts` (pass).
- Orca build: `npm run build --workspace=packages/client` (pass; existing non-blocking warnings unchanged).
- macworldmodel tests: `python3 -m unittest world_model/tests/test_dream_adapter.py` (pass).
- Script syntax: `bash -n scripts/dev-dream.sh` (pass).
- Adapter smoke: `curl -X POST http://127.0.0.1:8844/dream ...` returns `adapter_version` + score fields.

Follow-ups:
- Add lightweight UI controls for dreaming endpoint/status in Settings (optional).
- Add learned-model inference mode behind the same `/dream` contract once GUI checkpoint quality is ready.

## 2026-04-20 20:52:25 PDT — Dream adapter checkpoint handoff automation (no manual sync loop)
Goal: Let a separate training agent update checkpoints in macworldmodel while Orca automatically sees latest checkpoint metadata via `/dream` without code/config sync cycles.

Completed:
- Added runtime checkpoint resolver to adapter:
  - `/Users/ghost/Desktop/macworldmodel/world_model/src/dream_adapter.py`
  - new `resolve_checkpoint_path(...)` behavior:
    1) explicit `--checkpoint` path if provided
    2) otherwise `active.pt` in checkpoints dir (if present)
    3) otherwise newest `*.pt` by mtime in checkpoints dir
- Added runtime metadata in `/dream` response:
  - `active_checkpoint_path` (optional)
  - `active_checkpoint_mtime` (optional)
  - keeps existing `model_checkpoint_available` and fail-open behavior
- Added optional adapter CLI flag:
  - `--checkpoints-dir` for custom checkpoint discovery root
- Bumped adapter version:
  - `adapter_version` now `1.1.0`
- Added RED→GREEN tests:
  - `world_model/tests/test_dream_adapter.py`
  - covers `active.pt` preference, newest-checkpoint fallback, and hot-switch metadata behavior between requests
- Updated adapter docs:
  - `/Users/ghost/Desktop/macworldmodel/world_model/README.md`
  - documented no Orca-side sync requirement and checkpoint resolution order

Validation:
- `python3 -m unittest world_model/tests/test_dream_adapter.py` (pass, 6 tests).
- smoke run:
  - start adapter + `curl POST /dream`
  - response includes `adapter_version=1.1.0`, `model_checkpoint_available=true`, `active_checkpoint_path`, `active_checkpoint_mtime`.

Follow-ups:
- Wire learned checkpoint inference into scoring path (current scoring remains heuristic with checkpoint-aware handoff plumbing).
- Optional: add `active.pt` symlink promotion helper script for deterministic checkpoint selection during long training runs.

## 2026-04-20 20:57:36 PDT — Dream adapter learned scoring path wired (hybrid fail-open)
Goal: Activate checkpoint-backed scoring without changing Orca contract or introducing brittle dependencies.

Completed:
- Upgraded adapter to hybrid scoring mode:
  - `/Users/ghost/Desktop/macworldmodel/world_model/src/dream_adapter.py`
  - `adapter_version` bumped to `1.2.0`
  - when PyTorch + compatible checkpoint are available, adapter now loads `dynamics.action_proj` (+ env/type embeddings when present) and computes a lightweight learned surprise component
  - final surprise blends heuristic + learned component (fail-open; if learned load fails it stays heuristic)
- Added runtime cache/reload behavior:
  - checkpoint runtime cache keyed by path + mtime under thread-safe lock
  - automatic refresh when checkpoint file changes
- Extended response metadata (optional fields):
  - `learned_surprise_score`
  - existing `source` now indicates mode (`macworldmodel-hybrid-v1` or `macworldmodel-heuristic-v0`)
- Strengthened tests in:
  - `world_model/tests/test_dream_adapter.py`
  - added source-mode tests for heuristic default and hybrid activation path
  - total tests now 8
- Updated docs:
  - `/Users/ghost/Desktop/macworldmodel/world_model/README.md` (v1.2 notes + hybrid behavior)
  - `/Users/ghost/Desktop/orca/docs/DREAM_ADAPTER_CONTRACT.md` (optional metadata fields)
- Improved Orca dev startup script:
  - `/Users/ghost/Desktop/orca/scripts/dev-dream.sh`
  - now prefers `$MACWORLDMODEL_ROOT/.venv/bin/python` when present so hybrid path can run automatically

Validation:
- `python3 -m unittest world_model/tests/test_dream_adapter.py` (pass, 8 tests).
- smoke (system python): `source=macworldmodel-heuristic-v0`, adapter v1.2.0, checkpoint metadata present.
- smoke (`.venv` python with torch): `source=macworldmodel-hybrid-v1`, includes `learned_surprise_score`, adapter v1.2.0.
- `bash -n /Users/ghost/Desktop/orca/scripts/dev-dream.sh` (pass).

Follow-ups:
- Replace lightweight learned calibration with full latent forward scoring once Orca can optionally pass richer observation payloads (e.g., image tensors/features) under the same `/dream` contract.

## 2026-04-20 21:01:45 PDT — Added checkpoint promotion helper for deterministic active.pt handoff
Goal: Make training-agent -> Dream adapter handoff explicit and deterministic without touching Orca config.

Completed:
- Added promotion utility:
  - `/Users/ghost/Desktop/macworldmodel/world_model/src/promote_checkpoint.py`
  - supports:
    - `--source <path>` to promote a chosen checkpoint
    - `--latest` to promote newest `*.pt` in checkpoints dir
    - `--checkpoints-dir` override
- Implemented atomic `active.pt` update:
  - writes temp link/file then `os.replace(...)` swap
  - prefers symlink mode; falls back to copy mode if symlink creation is unavailable
- Added RED→GREEN tests:
  - `/Users/ghost/Desktop/macworldmodel/world_model/tests/test_promote_checkpoint.py`
  - covers newest checkpoint resolution, active promotion materialization, and missing source failure path
- Updated docs:
  - `/Users/ghost/Desktop/macworldmodel/world_model/README.md`
  - added command examples for promotion helper and `active.pt` behavior

Validation:
- `python3 -m unittest world_model/tests/test_promote_checkpoint.py` (pass, 3 tests).
- smoke:
  - `python3 world_model/src/promote_checkpoint.py --latest --checkpoints-dir <tmpdir>`
  - result: `active.pt` updated to selected checkpoint (symlink mode on local macOS run).

Follow-ups:
- Optional: add a small post-train hook in training scripts to auto-run promotion when a new best checkpoint is written.

## 2026-04-20 21:10:02 PDT — Dream request payload enriched (state/context-aware preflight)
Goal: Upgrade Orca -> macworldmodel `/dream` payload from action-only to richer context without breaking contract compatibility.

Completed:
- Orca request enrichment in:
  - `/Users/ghost/Desktop/orca/packages/client/src/lib/orchestrator/dreamingHarness.ts`
  - added optional fields in `runDreamingSimulation` request body:
    - `previous_screenshot_snapshot`
    - `current_url`
    - `recent_actions` (last 8)
    - `observation_features` (`snapshot_char_len`, `previous_snapshot_char_len`, `recent_action_count`)
- Orca browser tool context wiring in:
  - `/Users/ghost/Desktop/orca/packages/client/src/lib/orchestrator/executeTools.ts`
  - preflight now forwards current snapshot + previous snapshot + current URL + recent action traces
  - added tile-meta tracking for dream context:
    - `dreamPreviousSnapshot`
    - `dreamRecentActions`
- Adapter context scoring update in:
  - `/Users/ghost/Desktop/macworldmodel/world_model/src/dream_adapter.py`
  - `score_orca_dream_request(...)` now consumes richer fields and raises surprise for risky URL/snapshot/history context
  - adapter bumped to `adapter_version: 1.3.0`
- Tests added/extended:
  - Orca: `packages/client/src/lib/orchestrator/dreamingHarness.test.ts` now asserts richer payload fields are sent
  - macworldmodel: `world_model/tests/test_dream_adapter.py` now validates richer payload can increase surprise score
- Docs updated:
  - `/Users/ghost/Desktop/orca/docs/DREAM_ADAPTER_CONTRACT.md` request schema now documents richer optional fields
  - `/Users/ghost/Desktop/macworldmodel/world_model/README.md` documents accepted richer request fields

Validation:
- Orca tests: `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/dreamingHarness.test.ts src/lib/orchestrator/orchestratorToolFilter.test.ts` (pass).
- macworldmodel tests: `python3 -m unittest world_model/tests/test_dream_adapter.py world_model/tests/test_promote_checkpoint.py` (pass, 12 tests).
- adapter smoke on alternate port `8851`: richer payload accepted and returns valid response with adapter `1.3.0` and hybrid source metadata.

Follow-ups:
- Optional: add image-thumbnail/embedding transport under optional fields for stronger latent-state alignment without forcing decode on every call.

## 2026-04-20 21:37:09 PDT — Agent Browser dependency preflight + error surfacing hardening
Goal: Fix Agent Browser UX gap where Orca attempts navigation before dependency readiness checks, and improve header/title-level error visibility.

Completed:
- Added explicit dependency preflight in `packages/client/src/lib/tauri.ts`:
  - `ensureAgentBrowserCliInstalled()` (`agent-browser --version` via Tauri command path)
  - shared missing-dependency detection helper `isAgentBrowserCliMissingErrorMessage(...)`
  - shared message normalizer `withAgentBrowserCliInstallHint(...)`
- Improved CLI error messaging behavior in `runAgentBrowser(...)` so missing CLI errors always include install guidance even when stderr is non-empty.
- Wired preflight checks before browser open attempts in both UI and tools:
  - `packages/client/src/components/tiles/AgentBrowserTile.tsx` (`handleNavigate`)
  - `packages/client/src/lib/agentBrowser/navigateAgentBrowserTile.ts`
  - `packages/client/src/lib/orchestrator/executeTools.ts` (`browser_open`)
- Improved error state surfacing so failures are visible at tile chrome/title level:
  - on failure, `navigateAgentBrowserTile` now sets `tileStatus: 'error'` and `meta.subtitle` with a shortened error summary
  - on success/close, clears subtitle and restores idle tile status
  - in-tile status row now treats `lastSessionError` as effective `error` state instead of staying on `disconnected`
- Added tests in `packages/client/src/lib/tauri.agentBrowserSession.test.ts` for:
  - missing-CLI message detection variants
  - install-hint appending behavior (including no duplicate hint)

Validation:
- Targeted tests passed:
  - `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/tauri.agentBrowserSession.test.ts`
- Client build passed:
  - `npm run build --workspace=packages/client`
  - existing non-blocking Vite warnings unchanged (externalized node modules, chunk-size warnings).

Follow-ups:
- Optionally add the same preflight gate to non-`browser_open` agent-browser tools (click/fill/press/scroll/etc.) for uniform early failures when the CLI disappears mid-session.
- Fix `scripts/bridge-smoke.sh` unbound AUTH array bug to avoid false-negative bridge diagnostics when no token is set.

## 2026-04-20 21:46:31 PDT — Agent-browser preflight expanded to action tools
Goal: Apply dependency readiness checks uniformly across interactive agent-browser tools, not only browser_open.

Completed:
- Added helper in `packages/client/src/lib/orchestrator/executeTools.ts`:
  - `requiresAgentBrowserCliPreflight(name)` (exports explicit allowlist of interactive browser tools)
- Added centralized preflight gate in `executeOrchestratorTool(...)` before switch dispatch:
  - for allowlisted tools, enforce desktop runtime (`tauri.isTauri()`)
  - run `tauri.ensureAgentBrowserCliInstalled()` and return actionable error JSON on failure
- Covered tools via allowlist:
  - `browser_snapshot`, `browser_click`, `browser_fill`, `browser_press`,
    `browser_screenshot`, `browser_scroll`, `browser_wait`, `browser_get_text`
- Added new test file:
  - `packages/client/src/lib/orchestrator/executeTools.agentBrowserPreflight.test.ts`
  - verifies allowlist behavior (true for interactive tools, false for `browser_open`/`browser_close` and unrelated tools)

Validation:
- RED (expected fail before implementation):
  - `executeTools.agentBrowserPreflight.test.ts` failed with missing export for `requiresAgentBrowserCliPreflight`.
- GREEN:
  - `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/executeTools.agentBrowserPreflight.test.ts` (pass)
  - `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/tauri.agentBrowserSession.test.ts` (pass)
  - `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings unchanged)

Follow-ups:
- If you want maximum strictness, we can include `browser_close` in preflight too, but current behavior intentionally keeps close permissive so users can still clear stale browser tiles even when CLI is missing.
- Still pending: patch `scripts/bridge-smoke.sh` AUTH handling so smoke checks work cleanly in open localhost mode.

## 2026-04-20 21:49:06 PDT — bridge-smoke auth handling fixed for open localhost mode
Goal: Eliminate false-negative bridge smoke failures when `CANVAS_BRIDGE_TOKEN` is unset.

Completed:
- Reworked `scripts/bridge-smoke.sh` auth handling to avoid nounset/unbound-array failures:
  - removed brittle `AUTH[@]` expansion pattern
  - added `TOKEN` variable + `curl_bridge()` helper that conditionally injects Authorization header
  - kept POST execute call token-aware using explicit if/else branch
- Preserved existing smoke behavior and output formatting.

Validation:
- RED before fix:
  - `npm run bridge:smoke` failed with `scripts/bridge-smoke.sh: line 15: AUTH[@]: unbound variable`
- GREEN after fix:
  - `npm run bridge:smoke` now runs through health/status/tools probes successfully in open mode
  - execute call returns expected `503` when no UI client is connected, but script exits cleanly and prints `== done ==`.

Follow-ups:
- Optional: treat execute 503 as explicit informational status (`No Orca UI connected`) rather than raw curl error text for cleaner operator UX.

## 2026-04-20 22:11:20 PDT — OpenAI Codex wire model normalization fix
Goal: Fix Orca OpenAI Codex requests so ChatGPT-account Codex runs stop failing on unsupported `codex-*` model ids.

Completed:
- Root-caused mismatch in `chatCompletion.ts` model normalization:
  - Orca catalog uses ids like `codex-gpt-5.4`
  - ChatGPT Codex backend accepts bare model names (`gpt-5.4`, `gpt-5.4-mini`, `gpt-5.2`)
- Updated `resolveCodexResponsesWireModelId(...)` in `packages/client/src/lib/orchestrator/chatCompletion.ts` to normalize:
  - `codex-gpt-5.4` -> `gpt-5.4`
  - `codex-gpt-5.4-mini` -> `gpt-5.4-mini`
  - `codex-gpt-5.2` -> `gpt-5.2`
- Removed now-unused `OPENAI_CODEX_DEFAULT_MODEL_ID` import from `chatCompletion.ts`.
- Updated regression tests in `packages/client/src/lib/orchestrator/codexWireModel.test.ts` to enforce the corrected mapping.

Validation:
- RED:
  - `npm run test --workspace=packages/client -- src/lib/orchestrator/codexWireModel.test.ts` failed before implementation on new expectations.
- GREEN:
  - same test command passes after patch.
  - `npm run build --workspace=packages/client` passes (existing non-blocking Vite warnings unchanged).

Follow-ups:
- Optional hardening: add an OpenAI Codex `/codex/responses` preflight probe in Settings to dynamically verify account-supported model names and auto-filter picker options.

## 2026-04-20 22:16:10 PDT — Agent Browser title-level error surfacing
Goal: Make Agent Browser failures visible directly in tile title/header chrome (not only inline body error strip).

Completed:
- Added shared Agent Browser chrome helpers:
  - `packages/client/src/lib/agentBrowser/chrome.ts`
  - `AGENT_BROWSER_BASE_TITLE`
  - `AGENT_BROWSER_ERROR_TITLE`
  - `buildAgentBrowserErrorSubtitle(...)`
- Updated navigation/error wiring in `packages/client/src/lib/agentBrowser/navigateAgentBrowserTile.ts`:
  - success path now restores tile title to `Agent Browser`
  - failure path now sets title to `Agent Browser · Error` and subtitle from helper
- Updated UI flow in `packages/client/src/components/tiles/AgentBrowserTile.tsx`:
  - non-desktop preflight failure now marks tile chrome as error (title + status + subtitle)
  - `handleNavigate` catch now marks tile chrome as error (title + status + subtitle)
  - `handleClose` restores title to base
- Added tests:
  - `packages/client/src/lib/agentBrowser/chrome.test.ts` (new)

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/agentBrowser/chrome.test.ts` (pass)
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/tauri.agentBrowserSession.test.ts` (pass)
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/executeTools.agentBrowserPreflight.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings unchanged)

Follow-ups:
- Optional: add a tiny title tooltip suffix with first-line error snippet when tile is in error state for even faster scan in dense canvases.

## 2026-04-21 04:04:29 PDT — Hermes lead mode no-delegation guard
Goal: Diagnose Hermes lead mode “didn't really work” report and prevent plan-only early exits without delegated execution.

Completed:
- Analyzed telemetry export `/Users/ghost/Downloads/orca-telemetry-20260421-035701.csv` and confirmed run pattern:
  - lead mode loop completed after a single assistant plan-style message with no tool batch emitted.
- Root-caused loop gap in `runOrchestrator.ts`:
  - `leadDelegationOnly` did not enforce at-least-one tool/delegation before terminal reply in non-intro rounds.
- Patched orchestrator loop behavior:
  - added exported guard helper `shouldNudgeLeadDelegationBeforeTerminalReply(...)`
  - added one-time retry path that injects explicit lead directive and continues loop instead of returning immediately on plan-only text.
- Added regression coverage in `packages/client/src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` for lead nudge behavior and edge cases.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` (pass)
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/orchestratorToolFilter.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings unchanged)

Follow-ups:
- Verify in a live Hermes lead-mode run that the nudge yields an actual `spawn_sub_agent` (or other coordination tool batch) on the next round.
- If needed, tighten policy further to require at least one `spawn_sub_agent` specifically (not just any tool batch) for lead-only runs.

## 2026-04-21 04:13:08 PDT — Hermes lead mode defaults to direct Hermes conversation
Goal: Align Hermes lead mode UX so users are effectively talking directly to Hermes by default (without forced delegation-only routing).

Completed:
- Updated lead routing logic in `packages/client/src/lib/orchestrator/runOrchestrator.ts`:
  - Added `resolveLeadDelegationForRun(...)` helper.
  - `runOrchestratorLeadAware(...)` now defaults to **non-delegation** when `leadProfile === 'hermes'` unless an explicit `leadDelegationOnly` override is provided.
- Preserved existing behavior for default profile and explicit overrides.
- Added regression tests in `packages/client/src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts`:
  - Hermes profile defaults to direct mode.
  - Default profile still follows delegation setting.
  - Explicit override still wins.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` (pass)
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/orchestratorToolFilter.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings unchanged)

Follow-ups:
- Run a quick live Hermes lead-mode conversational smoke test to confirm tone/UX now feels direct while still allowing explicit delegation when requested.

## 2026-04-21 05:09:33 PDT — Commit, push, rebuild, reinstall (Hermes lead UX patch)
Goal: Ship the Hermes lead direct-conversation default fix and refresh the installed macOS app.

Completed:
- Committed local changes:
  - `fix: default Hermes lead mode to direct conversation`
  - commit: `db807cb`
- Pushed `main` to `origin`:
  - `4945f1a..db807cb  main -> main`
- Rebuilt desktop app:
  - `npm run tauri:build`
  - produced:
    - `/Users/ghost/Desktop/orca/target/release/bundle/macos/Orca Coder.app`
    - `/Users/ghost/Desktop/orca/target/release/bundle/dmg/Orca Coder_0.1.0_aarch64.dmg`
- Reinstalled app bundle to `/Applications`:
  - stopped running app process (best-effort)
  - copied bundle with `ditto` to `/Applications/Orca Coder.app`

Validation:
- Build completed successfully (release + bundle steps finished).
- Install path verified present: `/Applications/Orca Coder.app`.

Follow-ups:
- Optional: launch `/Applications/Orca Coder.app` and run one Hermes lead conversation smoke test to verify user-facing behavior end-to-end.

## 2026-04-21 05:21:08 PDT — Hermes lead mode: disable Orca decomposition/research scaffolding
Goal: Make Hermes lead mode behave like direct Hermes chat (no automatic Orca divide-and-conquer/hierarchy pre-planning in the session store pipeline).

Completed:
- Root-caused why Hermes lead still decomposed despite lead routing fix:
  - `orchestratorSessionStore.ts` was still running Orca-side triage/research/hierarchy/decomposition before the loop call.
- Updated `packages/client/src/store/orchestratorSessionStore.ts` to compute effective lead delegation via `resolveLeadDelegationForRun(...)` and apply Hermes-direct behavior when `leadProfile === 'hermes'` and delegation is off.
- In Hermes direct mode, now:
  - skips research auto-toggle (`[Research] Mode on ...` path)
  - skips articulation pre-phase toggles
  - forces simple prompt path (`[Hermes lead] Using simple path ...`)
  - disables hierarchy/decomposition planning scaffolding
  - avoids injecting delegation-resume hierarchy grounding
  - passes `leadDelegationOnly` explicitly into `runOrchestratorLeadAware(...)` so runtime and store routing stay consistent.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` (pass)
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/delegationResumeGrounding.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite warnings unchanged)

Follow-ups:
- Rebuild/reinstall app and run a live Hermes lead prompt; telemetry should no longer show `[Prompt] Complex` + `[Decomposition]` for standard Hermes lead turns.

## 2026-04-21 05:46:00 PDT — getnyx.dev-style homepage clone for orcacoder.com
Goal: Rework OrcaLabs homepage to mirror getnyx.dev landing-page structure and tone while branding as OrcaCoder.

Completed:
- Updated `OrcaLabs/OrcaLabs/app/page.tsx` to render only the landing experience (removed duplicate in-page nav include).
- Replaced `OrcaLabs/OrcaLabs/components/landing.tsx` with a new getnyx-inspired layout:
  - dark high-contrast hero + sticky nav treatment
  - section anchors (`#canvas`, `#tiles`, `#focus`, `#pricing`, `#faq`, `#waitlist-section`)
  - orchestration/canvas messaging rewritten for OrcaCoder branding
  - six tile cards + focus mode block + pricing cards + FAQ + waitlist CTA
- Preserved existing app routes (`/signup`, `/download`, `/pricing`) as CTA targets.

Validation:
- Targeted lint for changed files passed:
  - `npx next lint --file app/page.tsx --file components/landing.tsx`
- Full repo lint remains red due pre-existing unrelated issues across many legacy files.

Follow-ups:
- If desired, I can also refactor global `NavHeader` in `app/layout.tsx` to match the new landing style exactly (currently homepage has new section-nav in-content while global header remains app-wide).

## 2026-04-21 08:20:03 PDT — Hermes lead trace mode aligned to Hermes terminal-style stream
Goal: Make Hermes lead feel like direct Hermes terminal output in Orca UI by removing Orca scaffolding chatter and surfacing raw Hermes SSE trace lines.

Completed:
- Updated `packages/client/src/lib/orchestrator/chatCompletion.ts`:
  - added `ChatCompletionOptions.hermesTraceStyle` (`event_types` | `terminal_raw`)
  - Hermes gateway path now supports raw SSE pass-through in `terminal_raw` mode:
    - emits literal `event: ...` lines
    - emits literal `data: ...` JSON lines
  - retained structured parsing for tool-call extraction and final assistant content.
  - continuation-user injection notice is suppressed in `terminal_raw` mode to keep output terminal-like.
- Updated `packages/client/src/lib/orchestrator/runOrchestrator.ts`:
  - added `suppressStillWaitingNudges` option to silence Orca `[30s]/[60s] Still waiting` spam when raw Hermes stream is visible.
  - added `hermesTerminalTraceStyle` option and passed `hermesTraceStyle` through to chat completion.
- Updated `packages/client/src/store/orchestratorSessionStore.ts` for Hermes direct mode:
  - suppressed Orca meta chatter lines (`[Hermes lead] ...`, `[Prompt] ...`, `[Using model: ...]` in direct mode)
  - disabled reasoning-trace harness callback in Hermes direct mode so Orca run/iteration trace banners are not shown
  - enabled `suppressStillWaitingNudges` + `hermesTerminalTraceStyle` for Hermes direct runs.

Validation:
- `npm run test --workspace=packages/client -- src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` (pass)
- `npm run test --workspace=packages/client -- src/lib/orchestrator/delegationResumeGrounding.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass; existing non-blocking Vite chunk warnings unchanged)

Follow-ups:
- Run a live `npm run tauri:dev` Hermes lead prompt and verify activity panel now shows raw Hermes `event:`/`data:` stream without Orca scaffolding lines.
- If needed, add a Settings toggle to switch between `terminal_raw` and compact `event_types` trace styles.

## 2026-04-21 08:27:35 PDT — Executed ship cycle for Hermes terminal-style lead trace
Goal: Execute requested next steps: validate runtime health in dev, ship changes, rebuild/install/open app.

Completed:
- Committed Hermes lead terminal-trace changes:
  - commit: `ca800f5`
  - message: `fix: make Hermes lead trace mirror terminal SSE output`
- Pushed to `origin/main` successfully (`c9264b9..ca800f5`).
- Built macOS app bundle via `npm run tauri:build` (success).
- Installed app to `/Applications/Orca Coder.app` via `ditto`.
- Launched installed app with workspace path `/Users/ghost/Desktop/orca`.
- Restarted clean dev runtime for validation:
  - started `npm run tauri:dev` (session `proc_cd3d96679245`)
  - verified listeners:
    - `127.0.0.1:3001` (agent-canvas server)
    - `*:3002` (telemetry tsx process)
  - verified health endpoints:
    - `/api/health` => `{"status":"ok"...}`
    - `/api/dev/telemetry/health` => `{"ok":true...}`

Validation:
- Runtime stack is healthy and ready for user-facing Hermes lead prompt verification.
- Prior compile/test/build checks for this patch set are green.

Follow-ups:
- Run live Hermes lead prompts in this dev session and confirm activity output now matches terminal-style raw Hermes SSE (`event:` / `data:`) without Orca scaffolding chatter.
- Remaining separate track: d3 filesystem permission/read-only issue.

## 2026-04-21 08:39:52 PDT — Hermes lead output cleanup (hide raw SSE from activity feed)
Goal: Reduce Hermes lead chat clutter by keeping raw Hermes SSE trace out of main orchestrator activity output.

Completed:
- Updated `packages/client/src/lib/orchestrator/runOrchestrator.ts`:
  - added optional `onProviderNotice` callback in `RunOrchestratorOptions`
  - provider notices now route to `onProviderNotice ?? onLog`
- Updated `packages/client/src/store/orchestratorSessionStore.ts` Hermes-direct invocation:
  - `onProviderNotice` now appends to `useReasoningTraceStore` (`kind: trace`) instead of `appendLog`
  - keeps main activity lane focused on user/assistant/tool actions rather than raw `event:`/`data:` spam

Validation:
- `npm run test --workspace=packages/client -- src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts` (pass)
- `npm run build --workspace=packages/client` (pass)

Release:
- commit: `bbc8b5f`
- message: `fix: keep Hermes SSE trace out of lead activity output`
- pushed to `origin/main`

## 2026-04-21 12:39:09 PDT — getnyx-clone landing page rebrand to Orca tiles
Goal: Redesign the local cloned marketing site to promote Orca and replace Nyx-branded tile messaging with Orca-branded tile messaging.

Completed:
- Reworked `getnyx-clone/src/app/page.tsx` copy and IA to promote Orca:
  - nav item `tiles` -> `orca tiles`
  - brand labels and CTA text switched from Nyx to Orca
  - hero messaging updated to Orca orchestration positioning
  - tile section reframed as Orca tile system
- Replaced tile catalog with six Orca-specific tiles:
  - Orca Agent Tile
  - Orca Shell Tile
  - Orca Browser Tile
  - Orca Plan Tile
  - Orca Review Tile
  - Orca Studio Tile
- Updated pricing/support copy and FAQ language to remove Nyx references.
- Updated waitlist and footer copy to Orca branding.

Validation:
- `npm run lint` in `getnyx-clone/` (pass)
- `npm run build` in `getnyx-clone/` (pass; non-blocking Next workspace root warning due multiple lockfiles)
- Content scan confirms no remaining `Nyx|nyx` strings under `getnyx-clone/src/app`.

## 2026-04-21 20:48:34 PDT — Wishlist wave: P1/P2 conformance evaluator expansion
Goal: Continue implementing the Orca Harness feature/behavior wishlist by advancing item #10 (remaining P1/P2 conformance wave) with deterministic evaluator coverage and passing conformance outputs.

Completed:
- Updated `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`:
  - added new conformance task kinds:
    - `iteration_cap_enforcement`
    - `parallel_tool_conflict_guard`
    - `exactly_once_resume_handoff_integrity`
    - `heartbeat_synthetic_tag_skip_hygiene`
    - `trace_phase_end_state_completeness`
  - wired deterministic checks against runtime constants + batching + handoff merge formatting + heartbeat prompt hygiene + trace line formatting
- Updated `packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json` with matching task IDs for the new evaluator kinds.
- Updated `packages/client/src/lib/orchestrator/harnessEval/scoreAggregation.ts` bucket mapping:
  - iteration cap -> `termination`
  - parallel conflict guard -> `safety`
  - exactly-once resume handoff -> `queue_handoff`
  - heartbeat hygiene -> `proactive_hygiene`
  - trace completeness -> `observability`
- Updated `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts` for the expanded conformance matrix.

Validation:
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts src/lib/orchestrator/harnessEval/scoreAggregation.test.ts` (pass)
- `npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split conformance` (pass)
  - `passRate=1`
  - `p0HardFail=false`
  - `overallPass=true`

Docs sync:
- `hermes-dev/FEATURE-WISHLIST.md`: item #10 moved to `IN_PROGRESS` with implementation/evidence notes.
- `hermes-dev/FEATURE-WISHLIST-PARITY.md`: item #10 moved from `NOT_STARTED` -> `IN_PROGRESS` with file-level evidence.

# Orca Web Infrastructure Spec (Space Agent-informed)

Status: Draft v0.1
Source baseline: https://github.com/agent0ai/space-agent @ edd2e3f

## 1) Objective
Build Orca as a web-first system with:
- GitHub login + explicit repository access,
- encrypted browser-local workspace by default,
- optional encrypted cloud sync,
- optional GitHub-backed persistence for versioned artifacts,
- Space Agent-style infinite-canvas interaction reliability,
- provider-agnostic vision support (not hard-locked to one provider).

Non-goal:
- Do not clone Space Agent architecture wholesale; adapt proven primitives into Orca’s Hermes Lead runtime.

## 2) Reference patterns from Space Agent to adopt
1. Camera-first canvas navigation contract.
2. Deterministic viewport-aware tile packing.
3. Center-normalized rearrange behavior.
4. Reduced-motion/static rendering path.
5. Strong ownership boundaries between layout engine, camera state, and UI shell.

## 3) Top-level architecture

Client (web app)
- React/Canvas UI shell (primary runtime)
- Workflow/pack execution orchestrator UI
- Workspace manager (local/cloud/github backends)
- Encrypted local vault (IndexedDB envelope)
- Optional service-worker cache for offline-first UX

Control plane API (minimal backend)
- GitHub OAuth exchange + token brokering
- Optional cloud workspace sync API
- Optional key-wrapping/KMS helper for encryption key rotation
- Audit/event ingestion endpoint (redacted)

Execution/runtime
- Existing Orca orchestrator + tools runtime
- Provider model routing layer
- Vision strategy layer:
  - generic multimodal path for any supportsImages model
  - provider-specific preprocess hook only when required (Z.AI path)

## 4) Authentication and identity

Primary identity
- Sign in with GitHub OAuth (first-class).
- Scope minimization required:
  - read access by default,
  - repo write scopes only with explicit consent.

Session model
- Browser session token + refresh strategy.
- Workspace permissions bound to selected repos and domains.
- Re-consent path when scope expands.

## 5) Workspace persistence tiers

Tier 0 (default): Local encrypted browser workspace
- Storage: IndexedDB/local envelope.
- Encryption: key derived from user credential context or device-bound key material.
- Stores:
  - workflow packs,
  - prompt templates,
  - orchestrator settings,
  - local run metadata and non-sensitive traces.

Tier 1 (optional): Cloud encrypted workspace
- Sync local envelope metadata and encrypted blobs.
- Conflict resolution: last-writer-wins + explicit merge UI for workflow packs.
- Multi-device continuity.

Tier 2 (optional): GitHub-backed workspace
- Intended for versioned assets:
  - workflow catalogs,
  - prompt libraries,
  - policy configs,
  - docs/spec snapshots.
- Exclude high-churn runtime artifacts by default.
- Explicit commit previews before mutating repos.

## 6) Vision subsystem contract (fix-forward)

Problem resolved
- Vision runs were previously blocked unless model provider was Z.AI.

Required behavior
- If attachments include images:
  1) pick preferred image-capable model from available catalog,
  2) do not fail solely because provider != Z.AI,
  3) run provider-specific preprocess only when provider requires it (current: Z.AI hook),
  4) keep tool-capable orchestrator guarantees.

Fallback behavior
- For Z.AI, keep rate-limit fallback chain between Z.AI vision models.
- For non-Z.AI, no forced Z.AI fallback injection.

## 7) Canvas infrastructure (Space Agent-informed)

Layout engine
- Deterministic first-fit placement with viewport-width threshold.
- Stable ordering during batch spawn.
- Center normalization after rearrange.

Camera engine
- Pan/zoom camera state is authoritative (no accidental page-scroll semantics).
- Recoverability invariant: occupied tile region remains reachable.
- Hard recenter only on explicit user action.

Motion/accessibility
- Reduced-motion mode disables non-essential canvas and trace animations.
- Static fallback for long-running sessions to reduce GPU churn.

## 8) Data model slices

WorkspacePack
- id, name, createdAt, updatedAt
- persistenceMode: local | cloud | github
- githubBinding?: { owner, repo, branch, pathPrefix }
- encryptedEnvelopeRef

RepoBinding
- provider: github
- installation/user token reference
- repo id/full_name
- scopes granted

VisionPolicy
- preferredModelOrder[]
- providerPreprocess: { zai: enabled, others: none }
- maxAttachmentBytes
- fallbackPolicy

CanvasLayoutPolicy
- viewportColumnThreshold
- packingHeadroom
- centerNormalization: boolean
- cameraBoundsMode: occupied-span
- reducedMotionDefault

## 9) Security requirements
- No plaintext tokens or keys in logs.
- Encrypt auth/session artifacts at rest.
- Audit trail for mutating/destructive actions.
- Explicit confirmation on destructive steps.
- Repo mutation requires preflight summary + user acknowledgment.

## 10) Delivery phases

Phase A: Vision reliability + model routing hardening
- Remove provider lock for image attachments.
- Add tests for vision model selection and fallback behavior.

Phase B: Web-first workspace core
- Implement local encrypted workspace manager.
- Add backend abstraction local/cloud/github.
- Ship GitHub OAuth login and repo picker.

Phase C: Space Agent canvas primitives
- Viewport-aware placement + deterministic arrange.
- Camera bounds and recoverability invariants.
- Reduced-motion/static mode.

Phase D: Conformance + telemetry
- Add harness tasks for layout determinism, camera recoverability, and vision attach routing invariants.
- Add redacted telemetry for failure-class detection.

## 11) Acceptance criteria
- Users can run image-attached requests with any image-capable configured provider.
- GitHub login works and repository access is explicit and scoped.
- Default workspace is encrypted local browser storage.
- Optional cloud and GitHub persistence modes are selectable per workspace.
- Canvas placement and rearrange are deterministic across repeated runs.
- Reduced-motion mode measurably lowers animation churn.

## 12) Immediate execution slices
1. Wire vision model selection into all run entrypoints (orchestrator session + agent tile).
2. Add regression tests for provider-agnostic vision selection.
3. Add WorkspaceBackend interface (local/cloud/github adapters).
4. Add GitHub OAuth + repo binding UI flow in settings/onboarding.
5. Add canvas conformance tests for placement/camera invariants.

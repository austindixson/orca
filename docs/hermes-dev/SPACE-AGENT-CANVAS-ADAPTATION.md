# Space Agent -> Orca Canvas Adaptation Plan

Goal:
- Lift proven infinite-canvas behavior patterns from `agent0ai/space-agent` into Orca Harness while preserving Orca’s Hermes Lead trace/runtime model.
- Companion web-infrastructure spec: `hermes-dev/SPACE-AGENT-WEB-INFRASTRUCTURE-SPEC.md`

Reference snapshot reviewed:
- repo: https://github.com/agent0ai/space-agent
- commit: `edd2e3f`
- key files inspected:
  - `app/L0/_all/mod/_core/spaces/layout.js`
  - `app/L0/_all/mod/_core/spaces/AGENTS.md`
  - `app/L0/_all/mod/_core/visual/canvas/space-canvas.css`

## High-value patterns to port

1) Viewport-aware first-fit packing
- Space Agent uses centered, deterministic first-fit packing with width threshold tied to viewport columns and a small headroom constant.
- Why it helps Orca:
  - fewer off-screen initial spawns
  - better density and less overlap churn after multi-tile fanout
- Orca targets:
  - `packages/client/src/lib/layout/placement.ts`
  - `packages/client/src/lib/layout/anchorLayout.ts`
  - tests in `packages/client/src/lib/layout/*.test.ts`

2) Camera-first navigation contract
- Space Agent’s docs enforce camera panning over logical grid (not page scroll), plus bounded movement that keeps occupied edges visible.
- Why it helps Orca:
  - cleaner mental model for large canvases
  - less accidental “lost tile” state
- Orca targets:
  - `packages/client/src/store/canvasStore.ts`
  - pan/zoom interaction surfaces in `packages/client/src/App.tsx` and layout helpers

3) Deterministic rearrange + center normalization
- Their packing pipeline recenters packed bounds so layout remains symmetric and predictable.
- Why it helps Orca:
  - stable re-layout after batch creation/delegation
  - easier user recovery after auto-arrange
- Orca targets:
  - `packages/client/src/lib/layout/placement.ts`
  - `packages/client/src/lib/layout/workspaceContext.ts`

4) Motion/accessibility guardrails
- Space Agent canvas/backdrop stack has explicit reduced-motion behavior and static fallbacks.
- Why it helps Orca:
  - reduces GPU churn during long orchestrator runs
  - better accessibility compliance and laptop thermals
- Orca targets:
  - `packages/client/src/index.css`
  - tile animation/trace motion styles

5) Clear ownership contract for canvas behavior
- Space Agent’s AGENTS docs encode precise ownership and invariants for canvas/camera/layout.
- Why it helps Orca:
  - prevents drift between store, layout utilities, and UI wiring
  - easier conformance evaluator authoring
- Orca targets:
  - `hermes-dev/FEATURE-WISHLIST.md`
  - `hermes-dev/NEXT-STEPS.md`
  - optional new canvas-contract section in docs

## Proposed Orca implementation wave (next)

P1-CANVAS-1
- Add viewport-aware first-fit placement path for new tile insertion and batch spawn.
- Add deterministic tests for:
  - width-threshold behavior
  - stable ordering
  - centered packing output

P1-CANVAS-2
- Add camera bound policy:
  - keep occupied span recoverable
  - avoid hard recenter unless explicitly requested
- Add tests for pan boundary behavior and recovery.

P1-CANVAS-3
- Add reduced-motion/static animation mode for canvas/trace motion-heavy surfaces.
- Add regression checks for style toggles under reduced motion.

P1-CANVAS-4
- Add harness conformance tasks for canvas invariants:
  - deterministic placement on repeated runs
  - no overlapping placements after arrange
  - camera recovers occupied region after rearrange

## Non-goals for this adaptation
- Do not import Space Agent’s architecture wholesale.
- Do not alter Orca’s Hermes Lead orchestration semantics.
- Do not couple backend work to canvas improvements unless explicitly required.

## Success criteria
- New tile spawn/rearrange behavior is deterministic and viewport-aware.
- Pan/zoom behavior is camera-centric and less lossy for large canvases.
- Motion costs are lower under long-running sessions.
- Conformance/harness tests encode the new invariants.

# Hermes Lead Mode

## Goal
Add a third canvas interface mode where Hermes is the visible lead orchestrator:
- left 50% = selected node focus panel (expanded tile/details)
- right 50% = lightweight node graph (agents + file tree)
- node selection morphs into focus context, then collapses back to graph state

## Product intent
- Make orchestration legible at a glance (who is doing what, where, and why).
- Keep visual runtime low-resource vs force simulation-heavy graph mode.
- Treat Hermes as the system brain node rather than just another tile.

## Core UX contract (v1)
1. Toolbar exposes a new `Lead` view mode.
2. Entering Lead mode renders split view:
   - left pane: selected node detail card + actions
   - right pane: static/lightweight node map with click-to-select
3. Auto-focus integration:
   - if orchestrator auto-focus is enabled, active orchestrator tile focus updates selected graph node.
4. Tile materialization behavior:
   - selecting a tile node enables `Open tile` to jump back to rich Tile mode centered on that tile.
   - selection can collapse back to Hermes root.

## Data model
`src/lib/hermesLeadGraph.ts`
- `buildHermesLeadGraphModel(...)`
- Node kinds: `hermes | agent | tile | folder | file | tool`
- Edge kinds: `spawn | contains | focus | tool`
- Input: canvas tiles + workspace file tree + optional focused tile id + recent tool names
- Output: normalized graph model suitable for low-cost SVG rendering

## Current implementation wave (completed)
### UI/runtime
- Added new canvas mode: `helix` (`tiles | graph | plan | helix`).
- Added toolbar switch: `Lead`.
- Added split view component: `src/components/Canvas/HermesLeadCanvasView.tsx`.
- Added low-cost SVG “DNA-like” node layout (no force simulation loop).
- Added left-pane focus card with:
  - node metadata
  - tile `Open tile` jump action
  - collapse back action
- Hooked orchestrator auto-focus into selected node behavior.

### Canvas integration
- `InfiniteCanvas` now routes `canvasViewMode === 'helix'` to `HermesLeadCanvasView`.
- Disabled raw pan/select/context-menu interactions while in `helix` mode (same class of guard as graph/plan).
- Hid right minimap panel in Lead mode.
- Hid orchestrator HUD overlay in Lead mode to reduce overlap/noise.

### Tests
- Added unit tests: `src/lib/hermesLeadGraph.test.ts`.
  - verifies Hermes root + tile spawn relationships
  - verifies file-tree ingestion + node cap behavior

## Wave 2 progress (implemented)
1. Hermes lens card upgrade (v2-lite)
   - Added quick telemetry strip in left pane:
     - agents
     - files
     - tools
     - active nodes
     - link count
2. Semantic visibility filters
   - Added filter toggles for `Agents`, `Files`, `Tools`, `Tiles`.
   - Graph now projects only visible node kinds and prunes unrelated edges.
3. Tool awareness in graph model
   - Recent orchestrator tools (from activity feed + latest tool) become `tool:*` nodes.
   - Hermes root links to tool nodes through `tool` edges.
4. Motion polish
   - Added transition timing to focus card, lines, and node circles for smoother select/collapse feel.

## Wave 3 progress (implemented)
1. Semantic cluster layout utility
   - Added `src/lib/hermesLeadLayout.ts` with deterministic family bands:
     - Hermes root (top-center)
     - agents (left band)
     - tools (right band)
     - files/folders (lower-left band)
     - generic tiles (lower-right band)
2. Cluster layout tests
   - Added `src/lib/hermesLeadLayout.test.ts` covering:
     - root anchoring
     - kind-band placement expectations
     - deterministic repeatability
3. Lead canvas wiring
   - `HermesLeadCanvasView` now uses semantic cluster layout utility instead of single helix-only positioning.

## Wave 4 progress (implemented)
1. True node↔focus morph animation (position-aware)
   - Added `src/lib/hermesLeadMorph.ts` with absolute viewport-space projection from selected graph node to focus-card center.
   - Added animated morph pulse overlay in `HermesLeadCanvasView`:
     - computes graph pane + focus card geometry
     - animates node-origin -> focus-target with distance-based duration
     - clears after transition completion
2. Rich Hermes lens (intent/delegation/confidence-risk)
   - Added `src/lib/hermesLeadLens.ts` to compute runtime lens snapshot from graph + orchestrator activity:
     - intent string (`Executing <tool>`, fallback verb/idle)
     - delegation depth from spawn-edge graph walk
     - delegation hotspots from active session tool-depth map
     - confidence/risk scalar estimates (0..1)
   - Upgraded lens card in `HermesLeadCanvasView` to show:
     - intent, depth, hotspots, iteration
     - confidence + risk progress bars
3. Optional density-aware pack mode
   - Extended `src/lib/hermesLeadLayout.ts`:
     - layout modes: `semantic | pack | auto`
     - auto mode switches to pack at node-count threshold
     - pack mode places semantic families into compact bounded boxes
   - Added layout mode controls (`auto`, `semantic`, `pack`) in `HermesLeadCanvasView`.

## Tests added for wave 4
- `src/lib/hermesLeadLayout.test.ts`
  - new coverage for pack-mode spread, bounds, and arrangement difference vs semantic mode
- `src/lib/hermesLeadLens.test.ts`
  - verifies intent/delegation/confidence-risk projection
  - verifies lower risk/higher confidence in idle shallow state
- `src/lib/hermesLeadMorph.test.ts`
  - verifies position-aware projection math from node to focus anchor

## Wave 5 progress (implemented)
1. Full card-shell morph transition path
   - Extended `src/lib/hermesLeadMorph.ts` with `computeCardShellMorph(...)`:
     - projects node bubble bounds to focus-card bounds
     - returns transform deltas/scales and duration
   - Updated `HermesLeadCanvasView` animation overlay from pulse-dot to card-shell morph:
     - width/height/radius/position transition from node shell -> focus card
     - interrupt-safe restart on node reselection
2. Adaptive pack relaxation for dense clusters
   - Extended `src/lib/hermesLeadLayout.ts`:
     - new option `relaxIterations`
     - deterministic jittered pack seeds
     - low-cost bounded local repulsion pass inside family boxes
   - Lead view now uses relaxed pack layout in auto/pack pathways.
3. Richer file-branch semantics in right graph
   - Updated `HermesLeadCanvasView` edge styling for `contains` edges:
     - dashed branch styling
     - distinct contains-to-file color treatment

## Tests added for wave 5
- `src/lib/hermesLeadMorph.test.ts`
  - added coverage for full card-shell morph geometry
- `src/lib/hermesLeadLayout.test.ts`
  - added adaptive relaxation assertion (`relaxIterations` improves local spacing)

## Wave 6 progress (implemented)
1. Shared-element tile-open handoff
   - Updated `HermesLeadCanvasView` tile open action to animate a shared card-shell handoff before switching to Tiles mode.
   - Added temporary overlay state to bridge focus-card geometry into canvas center target geometry.
2. Optional inter-family relaxation pass
   - Extended `src/lib/hermesLeadLayout.ts`:
     - added `interFamilyRelaxIterations`
     - added deterministic cross-family spacing pass (`relaxInterFamily`) after per-family pack relax
   - Lead view now applies inter-family relax in dense pack mode.
3. Branch-collapse controls for deep file/folder subgraphs
   - Added `src/lib/hermesLeadFileProjection.ts` with `projectGraphWithFileDepthLimit(...)`.
   - Wired depth controls in `HermesLeadCanvasView` (`files≤1`, `files≤2`, `files≤3`, `files:all`) to prune deep file branches while preserving non-file graph nodes.

## Tests added for wave 6
- `src/lib/hermesLeadFileProjection.test.ts`
  - verifies deep file-branch collapse behavior + edge pruning
- `src/lib/hermesLeadLayout.test.ts`
  - added inter-family relaxation assertion (`interFamilyRelaxIterations` improves cross-family spacing)

## Wave 7 progress (implemented)
1. Exact tile-frame handoff geometry for tile-open
   - Extended `src/lib/hermesLeadMorph.ts` with `computeTileFrameHandoff(...)`.
   - Updated `HermesLeadCanvasView` tile-open action to animate from focus-card frame to the target tile’s true viewport frame (derived from tile world rect + pan + zoom).
2. Inter-family relax tuning controls
   - Extended `src/lib/hermesLeadLayout.ts` with `interFamilyRelaxStrength` and strengthened deterministic inter-family spacing behavior.
   - Added lead controls to tune inter-family relax iterations (`r0/r2/r4/r6`) and strength (`low/med/high`).
3. Per-folder branch expand/collapse memory
   - Extended `src/lib/hermesLeadFileProjection.ts` with `collapsedFolderIds` support.
   - Added folder-level `Collapse branch` / `Expand branch` control in focus pane.
   - Lead view now persists folder-collapse state in-memory across selection changes and depth-control toggles.

## Tests added for wave 7
- `src/lib/hermesLeadMorph.test.ts`
  - added exact tile-frame handoff geometry assertion
- `src/lib/hermesLeadLayout.test.ts`
  - added inter-family relax strength tuning assertion
- `src/lib/hermesLeadFileProjection.test.ts`
  - added per-folder collapse-memory projection assertion

## Wave 8 progress (implemented)
1. Tile-designer scaffold surface in Lead view
   - Added a new left-pane `Tile Designer (wave 8)` panel in `HermesLeadCanvasView`.
   - Supports brief-driven draft generation (name, description, tool list) and JSON preview output.
2. Tile-designer conformance helper
   - Added `src/lib/hermesLeadTileDesigner.ts`:
     - `createHermesTileDesignerDraft(...)`
     - `validateHermesTileDesignerDraft(...)`
   - Enforces schema/guardrails (id format, component key shape, title/summary bounds, tool allowlist format, permission constraints).
3. Store-backed folder-collapse memory
   - Added persisted workspace store state:
     - `hermesLeadCollapsedFolderIds`
     - `setHermesLeadCollapsedFolderIds(...)`
     - `toggleHermesLeadCollapsedFolderId(...)`
   - Added `src/lib/hermesLeadFolderCollapseMemory.ts` with `pruneCollapsedFolderIds(...)` for stale-id reconciliation against visible folder nodes.
   - Lead view now uses store-backed collapse memory instead of local-only component state.

## Tests added for wave 8
- `src/lib/hermesLeadTileDesigner.test.ts`
  - verifies deterministic scaffold generation and conformance error reporting
- `src/lib/hermesLeadFolderCollapseMemory.test.ts`
  - verifies visible-folder reconciliation behavior for persisted collapse state

## Known gaps (next waves)
1. Tile-designer currently generates validated drafts only; no direct registration/compilation into runtime tile registry yet.
2. Conformance checks are local helper-level; no harness evaluator task for tile-designer artifacts yet.
3. Tile-designer flow is single-shot scaffold; no iterative patch/apply loop against existing drafts.

## Wave 9 plan
1. Add tile-designer registration pipeline (draft -> registry patch -> preview tile spawn).
2. Add harness/conformance evaluator coverage for tile-designer outputs and guardrails.
3. Add iterative edit/apply flow (load existing draft, patch, revalidate, re-register).

## Validation checklist
- [x] `Lead` button appears in toolbar and toggles mode.
- [x] Entering Lead mode shows split layout (left focus, right graph).
- [x] Clicking node updates left focus panel.
- [x] Tile node can open in Tiles mode centered and focused.
- [x] Active orchestrator tile focus updates selected node when auto-focus is on.
- [x] Unit tests for graph, layout, lens, morph, and file-projection helpers pass.
- [x] client build passes.

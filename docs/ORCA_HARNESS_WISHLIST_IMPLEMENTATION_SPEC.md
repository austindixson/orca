# Orca Harness Wishlist Implementation Spec (Full Feature + Behavior Program)

Last updated: 2026-04-21
Owner: Hermes-led execution
Scope lock: Orca harness/orchestrator reliability, conformance, trace UX, memory rebuild, design extraction, and in-canvas visualization. No world-model expansion.

## 0. Completion contract

This implementation is complete only when ALL are true:
1) Every wishlist item has runtime implementation coverage.
2) Every wishlist item has deterministic tests/evaluator coverage.
3) Conformance split reports p0HardFail=false and overallPass=true.
4) Build passes for packages/client.
5) hermes-dev status docs and worklog contain evidence for each completed card.

## 1. Backlog (open-only) with implementation targets

P0-A DONE
- Invariant bucket scoring + P0 hard-fail aggregation.
- Files already landed: harnessEval/scoreAggregation.ts(+test), evaluateHarnessSuite.ts, cli.ts.

P0-B Queued interruption/resume deterministic regression
- Runtime behaviors:
  - checkpoint capture on interruption while run active
  - queued turn applies interruption-first directive
  - explicit single-sentence resume offer
  - checkpoint cleared after queued turn execution
- Targets:
  - packages/client/src/store/orchestratorSessionStore.ts
  - packages/client/src/lib/orchestrator/interruptionResume.ts(+test)
  - new integration test around queued run path

P0-C Skills/runtime policy enforcement gates
- Runtime behaviors:
  - evidence-first before mutation/delegate/write
  - verify-existing and phase-completion prerequisites encoded in prompt/runtime contract
  - plan-only mode blocks mutation/delegation
- Targets:
  - packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts
  - packages/client/src/lib/orchestrator/runOrchestrator.ts
  - packages/client/src/lib/orchestrator/harnessEval/tasks.conformance.json
  - evaluateHarnessSuite.ts(+test)

P0-D Reliability QA sweep + telemetry evidence
- Behaviors:
  - no tool replay regressions
  - no missing-user-message regressions
  - explicit cancel source
  - row-level telemetry parsing invariants
- Targets:
  - activityLineParsing.ts(+test)
  - hermes-dev/WORKLOG.md evidence entry

P0-E Dream/world-model decommission completion
- Behaviors:
  - no active dream gating dependency on normal browser tool execution
  - no blocking path via dream preflight
  - compatibility no-op only
- Targets:
  - packages/client/src/lib/orchestrator/executeTools.ts (+tests)
  - settings/docs cleanup references

P1-A In-canvas tool-call bubbles + strict budgets
- Behaviors:
  - visual states queued/running/success/error
  - category token styles
  - max nodes, TTL collapse, FPS throttle
- Targets:
  - packages/client/src/lib/orchestrator/traceNodeBudget.ts(+test)
  - packages/client/src/components/tiles/agent-tile/AgentTraceDrawer.tsx(+test)

P1-B Narrow-width trace readability regression pack
- Behaviors:
  - no clipping/overlap in tile/sidebar at narrow widths
- Targets:
  - AgentTraceDrawer.test.tsx
  - hermesTracePresentation.test.ts

P1-C Node graph + focus tile mode (new interface mode)
- Behaviors:
  - right pane: lightweight node graph (file-tree + agents)
  - click node => morph/expand to full tile in left 50% pane
  - autofocus enlarge active node, shrink-back on done/switch
  - low-resource rendering policy
- Targets:
  - route/view mode store + tile UI shell
  - graph adapter that maps file tree/agents to nodes
  - transition controller + tests

P1-D Design extraction workflow v1
- Behaviors:
  - screenshot -> strict style-guide JSON schema
  - scoped extraction templates
  - normalize/repair malformed JSON
  - provider-agnostic extraction orchestrator API
- Targets:
  - packages/client/src/lib/orchestrator/designExtraction/schema.ts(+test)
  - promptTemplates.ts(+test)
  - normalizer.ts(+test)
  - service.ts(+test)
  - docs/runbook updates in hermes-dev

P1/P2 Memory rebuild foundation
- Behaviors:
  - canonical typed memory item model
  - deterministic write governance (confidence/dedupe/redaction/supersession)
  - retrieval API with scored ranking
- Targets:
  - packages/client/src/lib/orchestrator/orcaMemory.ts(+test)
  - memoryDistiller.ts(+test)
  - memory docs sync

P2 remaining hardening
- Harness knobs -> evaluator translation
- Remaining conformance wave (iteration cap, parallel conflicts, handoff integrity, heartbeat hygiene, trace completeness)
- Workspace switching resilience
- Canvas bridge timeout cleanup

Secondary
- GitHub Rising Radar hardening wave

## 2. Execution order (dependency-safe)

Wave 1 (P0 closure): P0-B -> P0-C -> P0-E -> P0-D
Wave 2 (P1 core UX): P1-A -> P1-B -> P1-C
Wave 3 (workflow systems): P1-D -> Memory foundation
Wave 4 (P2 hardening + secondary)

## 3. Validation matrix

Targeted tests:
- interruptionResume + queued path integration tests
- evaluateHarnessSuite.test.ts + score aggregation tests
- AgentTraceDrawer.test.tsx + traceNodeBudget.test.ts
- designExtraction test suite
- orcaMemory/memoryDistiller tests

Harness eval:
- npm run -s harness:eval --workspace=@agent-canvas/client -- --candidate local-dev --split conformance

Build:
- npm run -s build --workspace=packages/client

## 4. Documentation + parity governance

When an item is completed:
- Update hermes-dev/FEATURE-WISHLIST.md status text.
- Update hermes-dev/FEATURE-WISHLIST-PARITY.md status to PARITY_READY.
- Add WORKLOG.md entry with files changed + command outputs + evidence notes.

## 5. Done declaration

Program declared FINISHED only after:
- all P0/P1 cards above implemented and validated,
- memory foundation card implemented with tests,
- parity docs updated with evidence,
- conformance/build green in current workspace.

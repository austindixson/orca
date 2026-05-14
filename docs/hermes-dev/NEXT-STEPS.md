# Next Steps

0. GitHub Rising Radar (new build) hardening wave:
- add second-source signals (release cadence, contributor growth, issue-close ratio, optional social mentions)
- add weekly digest cron pipeline + leaderboard trend deltas from stored snapshots
- add optional LLM evidence-grounded narrative summaries per top repo and per-idea confidence

1. Space-Agent-informed infinite canvas efficiency wave (new priority):
- adopt viewport-aware first-fit packing + centered deterministic rearrange patterns from `agent0ai/space-agent`
- enforce camera-first pan bounds that keep occupied regions recoverable
- add reduced-motion/static canvas motion path to lower GPU churn during long runs
- encode these as deterministic conformance invariants
- implementation plan: `hermes-dev/SPACE-AGENT-CANVAS-ADAPTATION.md`
2. Hermes-parity harness optimization wave (new priority):
- DONE (2026-04-21): implemented in-canvas tool-call bubbles/nodes (tiles trace overlay) with state/category chips and budget controls (`traceNodeBudget`).
- classify tool visual tokens by category/color and state (queued/running/success/error)
- add visualization budget controls (max node count, TTL collapse, animation fps throttle)
2. Finalize standalone graph removal:
- remove remaining graph-only code paths and controls after compatibility grace period
- keep Lead/helix graph concepts as the single graph surface
3. Hermes reliability + plan-workspace confirmation pass:
- DONE: no-user continuation guard in run loop + regression test.
- DONE: transient agent-browser retry hardening for `_stdout_open/_stdout_snapshot` and page/context-closed failures.
- DONE: Plan workspace now ingests Hermes plan-tool activity and auto-refreshes when plan-related tool lines appear.
- DONE: Orchestrator run strip no longer uses green glitter verb; latest tool chip moved onto Trace collapse bar for vertical-space savings.
- DONE: Orchestrator chat shell/footer background tints flattened to a single-tone surface.
- DONE: Hermes-native browser guard is now lead-profile aware: blocked only in default lead profile, allowed in Hermes Lead profile (Hermes-native toolset preserved).
- DONE: Responses adapter now ignores already-completed tool calls in `response.completed` snapshots (no replay of historical `function_call` entries when matching `function_call_output` exists).
- DONE: Hermes terminal approval gate prompt (`reply "approved"`) now auto-continues once per run via injected continuation turn.
- DONE: Hermes trace semantic skill/plan chips now render without emoji (`┊ skill ...`, `┊ plan ...`) for neutral gray trace styling.
- DONE: Hermes semantic `┊ ...` trace rows are now classified as trace (not chat bubbles), kept inside the gray gradient trace area above Trace collapse.
- DONE: spacing between gray trace strip and Trace collapse row tightened to 4px (`space-y-1`).
- DONE: removed animated orchestrator run-status strip row (`Ruminating... · Ns · tool rounds can be slow`) per Hermes Lead UX request.
- DONE: trace peek fade now starts at 0% opacity at the top (`transparent 0% -> black 45% -> black 100%`).
- NEXT: quick visual QA in both sidebar + tile variants to confirm trace summary chip wrapping and spacing at narrow widths.
- NEXT: verify fresh run after `useClawSpinnerFrame` runtime-error cleanup shows no `Tile render error` in telemetry.
- DONE: Hermes Lead system prompt now uses active Orca workspace root passed per-run (`workspaceRoot`) with store-first fallback.
- DONE: run-start trace now explicitly logs active workspace in gray trace strip (`┊ workspace <path>` / `(no workspace)`).
- DONE: orchestrator system prompts now enforce workspace-root scope for project-level tasks (`path: "."` first; avoid parent/home/Desktop unless explicitly requested).
- DONE: project-scoped turns now inject an explicit high-priority workspace override message at run start (active root wins over memory/profile path hints).
- DONE: tool runtime now hardens workspace scope (no absolute-path coercion for file tools, `run_shell_command` blocks out-of-scope `cd` targets, defaults sub-agent shell cwd to isolated worktree when present).
- DONE: Hermes-compatible memory/recall tool aliases are now wired (`memory`, `session_search`), with `session_search` added to lead allowlist and prompt guidance.
- DONE (2026-04-21): implemented Hermes memory philosophy behavior contract parity: fixed turn-priority ordering, deterministic memory/recall trigger detection, dynamic behavior-contract prompt block, turn-level reflex guard injection, and lead-mode `memory` tool parity (`orchestratorBehaviorPolicy.ts`, `runOrchestrator.ts`, `orchestratorPromptLayers.ts`, `orchestratorToolFilter.ts`).
- NEXT: live-run QA: confirm out-of-scope shell `cd` gets blocked with clear error and in-scope `cd` remains allowed.
- NEXT: verify Hermes Lead chat explicitly reflects the current project root after switching folders (without requiring app restart).
- NEXT: verify Hermes status strip now shows second-resolution elapsed (e.g. `12.3s`) and remains non-zero after completion/cancel.
- NEXT: run one fresh Hermes Lead browser/tool turn and export telemetry with `since` to confirm:
  - Hermes-native toolset executes without Orca policy block in Hermes Lead mode
  - no post-`response.completed` replay batch of historical tool calls
  - no new terminal `No user message found in input`
  - no manual approval pause for terminal security gate prompts (`approval_required` auto-continues)
  - cancellation source is explicit (user stop) rather than hidden transport failure
  - telemetry analysis uses row-level event parsing (avoid false positives from embedded trace payload blobs).
4. Hermes-mode status strip polish:
- DONE: wire provider `usage` tokens into GUI status strip when available
- DONE: keep fallback estimate for providers that do not return usage
- DONE: Hermes Lead now streams live in-run context estimate from orchestrator working set (no more static `1/400K` during active runs)
- NEXT: quick live QA in Hermes Lead to confirm the counter increments across multi-tool rounds and aligns with terminal-style expectations
5. Compaction safety regression coverage:
- DONE: added orchestrator-style repeated-compaction regression asserting at least one `user` survives before follow-up calls
- NEXT: optionally add a full `runOrchestrator` harness-level mock integration test if we want an end-to-end assertion at loop boundary
6. Hermes trace UX parity wave:
- DONE: Hermes chat/agent surfaces expose collapsible trace sections and shared trace-chip formatting
- DONE: trace chips include icon/name + target snippet + duration metadata
- DONE: Hermes chat renders fenced diff/code blocks instead of plain text walls
- DONE: Hermes Lead provider trace now emits terminal-like semantic rows for skill and plan calls:
  - `┊ skill     <skill-name>  <elapsed>`
  - `┊ plan      <N> task(s)  <elapsed>`
- DONE: generic Hermes tool completion trace rows now include elapsed counters (e.g. `← search_files 0.4s`).
- NEXT: add focused AgentTraceDrawer UI regression for collapsed/expanded preview parity
7. Hermes Lead mode wave 9:
- add tile-designer registration pipeline (draft -> registry patch -> preview tile spawn)
- add harness-level conformance evaluator tasks for tile-designer schema/permission/runtime guardrails
- add iterative edit/apply flow for existing tile-designer drafts (revalidate + re-register)
8. Design extraction tool (screenshot → style-guide JSON map):
- DONE (2026-04-21): shipped `designExtraction/` module (strict schema validation, full/scoped prompts, normalize/repair, provider-agnostic service, tests).
- define schema sections: global style, layout grid, typography, color tokens, spacing scale, components, interaction states, camera/perspective cues
- support scoped extraction modes from video workflow:
- element replacement blocks
- weather/season blocks
- camera-angle/perspective blocks
- additive object blocks
- add modifier loop that takes edited JSON block and regenerates image with minimal scene drift
- add prompt templates + validation checklist in docs for repeatable outputs
9. Finalize shell/PTY execution wave before commit:
- add one integration test for timeout cleanup semantics (best-effort process-tree termination)
- remove `command_argv` from `run_shell_command` public schemas/docs and execution path (terminal tile meta support remains separate)
10. Expand Hermes-style prompt-flow + interruption-resume implementation:
- DONE: dynamic prompt preface includes staged flow contract (skills/context scan → plan/todo → targeted discovery → patch/test/verify → concise closeout)
- DONE: conformance evaluators added for flow-contract presence + interruption-answer-then-resume-offer policy markers
- DONE: runtime interruption checkpoint captured in session state and deterministic resume-handoff directive injected on queued turn execution
- DONE: added error-first recovery protocol to dynamic prompt preface (treat exit_code/stderr as routing signals; branch remediation before retry)
- DONE (2026-04-21): end-to-end queued interruption regression added (`interruptionResume.queued.integration.test.ts`) covering capture → queued execution → clear.
11. Memory rebuild Phase 0:
- define canonical typed memory schema
- define write-governance policy (confidence/dedupe/redaction/supersession)
12. Translate `HARNESS-KNOBS-PRIORITIES.md` into deterministic efficiency/conformance evaluators.
13. Implement `SKILLS-INTEGRATION-BREAKDOWN.md` gates into orchestrator policies + conformance tests.
14. Implement `INTERRUPT-RESUME-PROTOCOL.md` behavior + conformance tasks.
15. Implement next P0 conformance evaluators:
- DONE: safety gate enforcement on destructive shell actions (`safety_gate_blocks_destructive_shell`).
- DONE: cancellation integrity for `wait_for_sub_agent` parent-abort path (`wait_for_sub_agent_cancellation_integrity`).
- DONE: error-first recovery branching invariant (`error_first_recovery_branching`) covering prompt protocol + deterministic shell failure classification.
- DONE: destructive non-shell file-path/write guard evaluator (`file_mutation_sensitive_path_branching`) with deterministic remediation branching guidance.
16. Add invariant-bucket scoring + P0 hard-fail gate in `scores.json` aggregation.
- DONE (2026-04-21): added `harnessEval/scoreAggregation.ts` + tests; conformance aggregates now include `p0HardFail`, `overallPass`, severity rollups, and bucket rollups; CLI output prints p0/overall gate flags.
17. Add P1/P2 conformance evaluators and extend regression coverage.
- IN_PROGRESS (2026-04-21): added deterministic evaluators + tests for iteration cap enforcement, parallel conflict guard, exactly-once resume handoff integrity, heartbeat skip hygiene, and trace phase/end-state completeness; conformance split passing.
18. Orca harness scope lock (no world-model expansion):
- DONE (2026-04-21): removed remaining browser-action dream preflight coupling in `executeTools.ts` and kept compatibility path fail-open.
- finalize dreaming/world-model decommission cleanup in Orca runtime/settings/test paths
- keep compatibility fail-open/no-op only where needed during transition
- prioritize harness reliability, conformance gates, and trace UX over world-model feature work
19. Full wishlist parity program:
- maintain `hermes-dev/FEATURE-WISHLIST-PARITY.md` as the status board for all open wishlist items
- require parity evidence (runtime + tests/evaluators + docs/worklog) before marking any item complete
- promote P0 items to `PARITY_READY` first before advancing P1/P2 waves
20. Future-wave planning expansion:
- maintain explicit F1/F2/F3/F4 harness roadmap slices in `FEATURE-WISHLIST.md`
- maintain DoR/DoD + 30/60/90 outlook in parity board
- use these sections to drive sprint sequencing and block scope creep

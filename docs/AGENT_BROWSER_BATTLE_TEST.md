# Agent Browser Battle Test

Battle-test whether Orca agents can reliably test a previewed app in a real session using `agent_browser` and `browser_*` tools.

---

## Goal

Validate that an orchestrator session can:

1. Launch a local app preview on a free port.
2. Use Agent Browser (not passive preview behavior) to interact with the app.
3. Recover from at least one interaction failure.
4. Produce concrete evidence and a trustworthy pass/fail verdict.

---

## Prerequisites

- Run Orca desktop app (Tauri), not web-only mode.
- Ensure agent-browser is installed and available to Orca (the app shells out via the `run_agent_browser` Tauri command).
- If you have **more than one** `agent_browser` tile, pass `tile_id` from `browser_open` on subsequent `browser_*` tool calls.
- Use a test app with deterministic UI states (todo app, form app, settings page).
- Prefer a fresh workspace state for each run.

---

## What counts as success

A run is considered successful only if all are true:

- Agent uses Agent Browser workflow (`agent_browser` + `browser_open`/`browser_snapshot`/`browser_click`/`browser_fill`).
- Agent completes all required UI tasks.
- Agent captures evidence:
  - at least one snapshot excerpt per checkpoint,
  - at least one annotated screenshot,
  - final state proof via snapshot/text extraction.
- Agent handles at least one induced failure (selector drift, delayed load, etc.) without human intervention.

---

## Standard test scenario

Use one app and run these checkpoints in order:

1. **Port and preview setup**
   - Agent calls `find_available_port`.
   - Agent starts app/server on that same port.
   - Agent opens the app via Agent Browser.
2. **Smoke interaction**
   - Create a new item/record (for todo app: add one todo).
   - Confirm item appears.
3. **State mutation**
   - Edit/update the same item.
   - Confirm updated text/value appears.
4. **State deletion**
   - Delete the item.
   - Confirm item no longer appears.
5. **Failure recovery**
   - Introduce one failure condition (pick one from "Chaos checks" below).
   - Agent must recover and still complete verification.

---

## Chaos checks (pick at least one)

- **Selector drift**
  - UI changes after action, old ref is stale.
  - Expected recovery: agent re-runs `browser_snapshot`, picks new ref, retries.
- **Delayed UI**
  - Introduce artificial delay/spinner.
  - Expected recovery: agent uses `browser_wait`, then retries action.
- **Partial overlay/modal**
  - Element blocked by modal/popover.
  - Expected recovery: dismiss overlay and continue.

---

## Evidence requirements

For each checkpoint, capture:

- Short snapshot excerpt showing expected state.
- Action trace summary (which browser tools were used).
- Final checkpoint screenshot:
  - `browser_screenshot` with annotation enabled.
  - Include saved path in summary.

Final report must include:

- `PASS` or `FAIL`.
- Failed checkpoints (if any).
- Recovery notes (what failed, how agent recovered).
- Residual risk notes (if test is partial).

---

## Scoring rubric (100 points)

- **Setup reliability (20)**
  - 20: free port + preview wiring correct on first attempt
  - 10: recovered from setup issue
  - 0: setup failed
- **Interaction correctness (30)**
  - 10 each for create/update/delete verified by snapshot or extracted text
- **Recovery behavior (20)**
  - 20: autonomous recovery from induced failure
  - 10: partial recovery
  - 0: stuck/fails
- **Evidence quality (20)**
  - snapshots + screenshot + clear proof chain
- **Final verdict quality (10)**
  - clear pass/fail with concise rationale and known limitations

Recommended pass bar: **>= 85/100**.

---

## Copy-paste battle prompt

Use this in a real orchestrator session:

```text
Run a full Agent Browser battle test against my local preview app.

Requirements:
1) Use find_available_port and start the app on that port.
2) Use agent_browser + browser_open/browser_snapshot/browser_click/browser_fill/browser_press as needed.
3) Execute these checks: create item, edit item, delete item, verify each state change.
4) Intentionally handle one failure case (selector drift or delayed load) and recover automatically.
5) Provide evidence: checkpoint snapshots, one annotated screenshot path, and final PASS/FAIL score out of 100 using this rubric:
   - Setup reliability 20
   - Interaction correctness 30
   - Recovery behavior 20
   - Evidence quality 20
   - Final verdict quality 10

Do not stop at planning. Execute the full flow and report results.
```

---

## Regression cadence

Run this battle test:

- Before merging orchestrator/browser-tooling changes.
- After changes to tile orchestration, tool definitions, or preview routing.
- Weekly as a smoke regression in active development periods.

Track outcomes in a simple log:

- Date
- Commit SHA
- App under test
- Score
- Pass/fail
- Notes on new failure modes

---

## Common failure signatures

- Agent uses legacy preview behavior and never performs interactive browser actions.
- Hard-coded localhost port mismatch vs actual bound port.
- Stale refs without re-snapshot retry.
- "Looks good" claims without snapshot/text proof.
- Missing screenshot artifact path in final output.
- **Orchestrator / model API:** errors like `Invalid completion payload: missing choices[0]` or `keys=error; choices=undefined` mean the **chat completion** response was not OpenAI-shaped (often a provider error object, rate limit HTML, or a buggy provider/upstream response). That blocks the whole orchestrator turn before any `browser_*` tool runs — it is **not** an Agent Browser tile or `agent-browser` CLI failure. Fix by switching model/provider, checking API access, and retrying; Orca may retry the completion request once automatically.

Use these to quickly classify regressions and prioritize fixes.

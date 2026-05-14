/**
 * Programmatic copies of the QA prompts (`MULTI_AGENT_*`, `PRACTICAL_*`).
 *
 * **Do not paste this `.ts` file into the orchestrator** — the model would see `export const`,
 * backtick escaping, etc. Copy **only** the user message text, or use the plain file:
 * `orchestratorMultiAgentSmoke.prompts.txt` (open it and copy one section).
 *
 * Manual QA: paste into the orchestrator input to exercise **spawn_sub_agent** (parallel workers),
 * **Agent team** tile, and (when the model supports it) **multiple tool_calls in one turn**.
 *
 * Use a tools-capable model. Budget models may need two turns instead of one batched spawn.
 */
export const MULTI_AGENT_ORCHESTRATOR_SMOKE_PROMPT = `[Multi-agent smoke test — do not skip steps]

1. Call canvas_list_modules once so you know the canvas state.
2. In **one assistant turn**, call spawn_sub_agent **twice** with different display_name/role/task:
   - Worker A: role "Smoke A", task "List the workspace root with list_directory on '.' only; reply with one sentence."
   - Worker B: role "Smoke B", task "Call canvas_list_modules and reply with how many tiles exist (one sentence)."
3. After both handoffs appear in the log, reply briefly confirming both summaries were received. (The Agent team module opens automatically when you spawn — no separate step.)

If your provider rejects parallel tool calls in one turn, run step 2 as two sequential spawn_sub_agent calls instead.`

/**
 * Practical exercise: one parent task split into **research**, **implementation**, and **testing**,
 * each delegated to a **different** sub-agent via `spawn_sub_agent`. Uses a dedicated folder so agents
 * rarely step on each other; the main orchestrator merges handoffs and summarizes.
 *
 * Paste into the orchestrator. Prefer a capable model for coordination; budget models should run
 * spawns **one after another** (research → build → test) instead of three at once.
 */
export const PRACTICAL_MULTI_AGENT_WORKFLOW_PROMPT = `[Practical multi-agent workflow — research / build / test]

## Goal
Ship a tiny, real artifact in this workspace: a **pure utility module** plus **tests**, informed by a short **research** note. Each phase is handled by a **separate sub-agent** (different \`spawn_sub_agent\` call, different \`display_name\` / \`role\`).

## Workspace sandbox (avoid file conflicts)
Use only this directory tree (create if missing): \`.agent-canvas/practical-team/\`
- \`.agent-canvas/practical-team/RESEARCH.md\` — findings (research sub-agent **only** writes this file)
- \`.agent-canvas/practical-team/lib.ts\` — implementation (build sub-agent **only** writes this file)
- \`.agent-canvas/practical-team/lib.test.ts\` — tests (test sub-agent **only** writes this file)

## What to build (keep it small)
- Export a function \`export function summarizePathSegments(path: string): string[]\` that splits a POSIX-style path on \`/\`, trims empty segments, and returns non-empty parts (no deps).
- Tests: 2–3 cases (empty, simple, nested).

## Delegation — three sub-agents

**1) Research sub-agent** — \`display_name\`: "Team Research", \`role\`: "Research"
Task: Read \`package.json\` at the workspace root and \`list_directory\` on \`packages/client/src/lib\` (or the closest \`lib\` folder). Write **only** \`.agent-canvas/practical-team/RESEARCH.md\` with: project kind (e.g. Vite/React), one sentence on test runner if visible, and where similar pure utilities live. No other writes.

**2) Implementation sub-agent** — \`display_name\`: "Team Build", \`role\`: "Implementation"
Task: Read \`RESEARCH.md\`, then **only** create/overwrite \`.agent-canvas/practical-team/lib.ts\` with \`summarizePathSegments\` and a one-line file header comment. No tests in this file.

**3) Testing sub-agent** — \`display_name\`: "Team QA", \`role\`: "Testing"
Task: Read \`lib.ts\`, then **only** create/overwrite \`.agent-canvas/practical-team/lib.test.ts\` using whatever test style matches the repo (e.g. \`node:test\` + \`assert\` if this is a Node package). Keep tests minimal.

## Orchestrator (you) — coordination
1. \`canvas_list_modules\` once.
2. Spawn the three sub-agents (Agent team module opens automatically on spawn):
   - **If the provider allows parallel tool calls in one turn**: call \`spawn_sub_agent\` three times in **one** assistant message (Research, Build, QA tasks above). Build/QA must **not** run until Research finished **only if** your model cannot handle parallel writers — if unsure, spawn **sequentially**: Research first → wait for handoff → Build → wait → QA.
   - **If parallel is unsafe** (same model struggling): run **sequential** spawns in three turns in order: Research → Build → QA.
3. After all handoffs, read the three files if needed, give a **short** closing summary to the user (what was created and how to run tests).

Do not rename the sandbox paths above. Do not use sub-agents for unrelated canvas work until this workflow is done.`

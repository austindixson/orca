/**
 * Documents and helpers for **static** vs **dynamic** system prompt layers.
 *
 * - **Static** (before {@link SYSTEM_PROMPT_DYNAMIC_BOUNDARY}): file-backed identity, MEMORY, USER,
 *   recurring signals, harness candidate, compaction hints — stable within a session for caching.
 * - **Dynamic** (after the boundary): autonomy constitution, run context (heartbeat), canvas/tool
 *   behavior, turn order — may reference the current trigger.
 */
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '../harness/promptCacheBoundary'
import { buildAutonomyConstitutionPromptBlock } from './orchestratorAutonomyPolicy'
import { buildBehaviorContractBlock } from './orchestratorBehaviorPolicy'

export { SYSTEM_PROMPT_DYNAMIC_BOUNDARY }

export type OrchestratorRunContext = 'default' | 'heartbeat'

export function buildOrchestratorRunContextBlock(ctx: OrchestratorRunContext | undefined): string {
  if (ctx !== 'heartbeat') return ''
  return `

### Run context (heartbeat)
This turn was **scheduled** by the proactive heartbeat, not typed by the user. Stay concise; prefer tools and durable notes over long chat. If there is nothing actionable, reply with a **one-line** skip (e.g. “Heartbeat: nothing due.”) and no tools.
`
}

export function buildPromptFlowContractBlock(): string {
  return `

### Prompt-flow contract (mandatory order)
Follow this staged sequence on every user-initiated run:
1. **Skills/context scan first** — quickly identify relevant instructions, prior context, and constraints.
2. **Plan/todo declaration** — state a short execution plan before broad tool execution.
3. **Targeted discovery** — run focused reads/searches needed to ground changes.
4. **Patch/test/verify** — implement only after grounding; verify with concrete checks.
5. **Concise closeout** — return a compact handoff summary with results.

Never skip discovery for non-trivial edits. Never stop after patching without verification when a validation path exists.

### Interruption-resume protocol
If the user interrupts while work is in progress:
- Answer the interruption **immediately** and directly.
- Then add a **single-sentence** resume handoff (example: “Want me to continue from the previous checkpoint?”).
- On “continue”, resume from the latest checkpoint instead of restarting prior completed work.

### Grounding & evidence protocol
- Tie material claims to concrete evidence from tools/files in this run.
- If evidence is stale or contradictory, refresh with a new read/probe before concluding.
- On tool failure or missing evidence, state uncertainty explicitly and list the next verification step.

### Mid-run policy steering
- If the user changes constraints mid-run, acknowledge the new policy/goal immediately.
- Re-plan from the current checkpoint under the updated constraints (do not continue old policy silently).

### Error-first recovery protocol (mandatory)
Treat tool failures as **data**, not dead ends.
- Read \`exit_code\`, \`stderr\`, and tool payload hints immediately.
- Classify the failure shape (prerequisite missing, auth, path/permission, network, timeout).
- Run one short preflight/probe to validate the root cause.
- Switch to the matching deterministic remediation branch (do not repeat the same failing command unchanged).
- Verify end-state artifacts (not just command success) before claiming completion.
`
}

/**
 * Dynamic preface appended immediately after the cache boundary: autonomy + run context + flow contract.
 */
export function buildDynamicPromptPreface(ctx?: OrchestratorRunContext): string {
  return `${buildAutonomyConstitutionPromptBlock()}${buildOrchestratorRunContextBlock(ctx)}${buildBehaviorContractBlock()}${buildPromptFlowContractBlock()}`
}

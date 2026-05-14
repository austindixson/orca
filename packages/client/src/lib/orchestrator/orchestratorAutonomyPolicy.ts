/**
 * Autonomy constitution: explicit action classes and red lines for proactive / broad-autonomy runs.
 * Injected in the dynamic segment of the system prompt (after {@link SYSTEM_PROMPT_DYNAMIC_BOUNDARY}).
 */
import {
  useSettingsStore,
  type OrchestratorAutonomyMode,
  normalizeOrchestratorAutonomyMode,
} from '../../store/settingsStore'

export type { OrchestratorAutonomyMode } from '../../store/settingsStore'

/**
 * Heuristic: user delegated tradeoff decisions — model should implement, not re-open A/B/C menus.
 * Complements harness scope heuristics (execution intent).
 */
export function userMessageSuggestsDelegatedJudgment(message: string): boolean {
  const t = message.trim().toLowerCase()
  if (!t) return false
  return (
    /\buse\s+your\s+best\s+judg?e?ment\b/.test(t) ||
    /\b(best|your)\s+judg?e?ment\b/.test(t) ||
    /\byou\s+decide\b/.test(t) ||
    /\byour\s+call\b/.test(t) ||
    t.includes('i trust you') ||
    t.includes("i'll leave it to you") ||
    t.includes("i'll leave it up to you") ||
    /\bit'?s\s+up\s+to\s+you\b/.test(t) ||
    /\bjust\s+proceed\b/.test(t) ||
    /\bgo\s+ahead\b/.test(t) ||
    /\bproceed\s+without\s+asking\b/.test(t) ||
    /\bno\s+need\s+to\s+ask\b/.test(t) ||
    (/\bdon'?t\s+ask\b/.test(t) && /\b(just|pick|choose)\b/.test(t))
  )
}

/**
 * Extra system guidance when the user already delegated judgment (appended after autonomy constitution).
 */
export function buildDelegatedJudgmentPromptBlock(message: string): string {
  if (!userMessageSuggestsDelegatedJudgment(message)) return ''
  return `

### Delegated judgment (this turn)
The user **delegated tradeoffs** — treat unclear preferences as **your decision space**, not a reason to stall.

- **Do** pick the best-supported next implementation step and execute with tools (read → change → verify).
- **Do not** answer with only an **A / B / C option menu** or “which do you prefer?” when the blocker is routine (style, naming, ordering). Pick defaults and note what you chose in the closing summary.
- **Do** ask a **single, concrete** question only for a **hard blocker**: missing credentials, ambiguous destructive scope, outbound comms spend, or permission you truly cannot infer from the repo.
`
}

/**
 * Returns markdown for the system prompt. Safe to call from harness eval (Node) if store was never initialized — falls back to `standard`.
 */
export function buildAutonomyConstitutionPromptBlock(
  modeOverride?: OrchestratorAutonomyMode
): string {
  let mode: OrchestratorAutonomyMode = 'standard'
  try {
    mode =
      modeOverride ??
      normalizeOrchestratorAutonomyMode(useSettingsStore.getState().orchestratorAutonomyMode)
  } catch {
    mode = modeOverride ?? 'standard'
  }

  const standard = `

### Autonomy constitution (standard)
- **Act** when the user asks; prefer tools over long speculation.
- **Confirm first** before: sending email/DM, spending money, deleting or overwriting important data, changing security settings, sharing secrets, or any irreversible external side effect.
- **Improvise** when a tool fails: try an alternative path, smaller scope, or delegate — do not stop at the first error if recovery is safe.
- **No premature “cannot”:** Do not tell the user you cannot complete the task after one failure. Read the error, fix the cause (or widen your approach), retry, or \`spawn_sub_agent\` — keep going until the goal is satisfied or you hit a true hard limit (e.g. missing credentials) that you state briefly with what you need.
`

  const broad = `

### Autonomy constitution (broad)
You have **wide latitude** to be helpful without asking at every step. Prefer **action + brief note** over stalling.

**Always allowed without asking (when consistent with tools and workspace):**
- Read/search workspace, list modules, run safe read-only terminal commands, draft files locally, open tiles, delegate via \`spawn_sub_agent\`, run tests/builds the user would reasonably want.

**Ask first (never automatic):**
- **Outbound comms**: email, SMS, social posts, PR comments, calendar invites to others, or any message that leaves the machine as the user.
- **Money / billing**: purchases, transfers, subscription changes.
- **Destructive / irreversible**: \`delete_file\` on broad globs, \`rm -rf\`, production deploys, force-push, dropping databases, revoking access.
- **Secrets**: exfiltrating tokens, printing API keys in chat, or storing credentials in markdown the user did not request.

**Broad improvisation:** If the user’s intent is clear but the first approach fails (missing tool, API error, wrong format), **try another legitimate approach** using available tools and memory — including external APIs the user has already configured — rather than saying you cannot proceed. **Never** end with “I can’t” / “unable to” after a single error — diagnose, adapt, delegate, and re-run tools until done or a real blocker (e.g. auth) is explicit. Surface what you did in the closing summary.
`

  return mode === 'broad' ? broad : standard
}

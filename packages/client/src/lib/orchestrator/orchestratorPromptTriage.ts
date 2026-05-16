import { heuristicResearchIntent } from './researchIntent'

export type OrchestratorPromptTier = 'trivial' | 'simple' | 'complex'

const GREETINGS = /^(hi|hey|hello|yo|sup|heya|hola|howdy|good (morning|afternoon|evening)|greetings|what's up|whats up)[\s!.,]*$/i
const THANKS = /^(thanks|thank you|ty|thx|tyvm|thank|cheers|much obliged|appreciate it)[\s!.,]*$/i
const ACKS = /^(ok|okay|k|kk|got it|gotcha|understood|noted|sure|alright|fine|cool|sounds good|makes sense|will do|on it|roger|ack)[\s!.,]*$/i

/**
 * Fast heuristic (no extra LLM).
 * **trivial** → no tools, no planning, minimal system prompt, max 2 turns.
 * **simple** → one orchestrator pass, tighter iteration cap, lightweight system prompt.
 * **complex** → optional decomposition + guidance to parallelize `spawn_sub_agent` for repo/project work.
 */
export function classifyOrchestratorPrompt(prompt: string): OrchestratorPromptTier {
  const t = prompt.trim()
  if (!t) return 'trivial'

  if (t.length < 30 && (GREETINGS.test(t) || THANKS.test(t) || ACKS.test(t))) return 'trivial'

  if (t.length < 6) return 'simple'
  // Explicit operator command: open Hermes agent in Orca canvas first.
  if (
    /\bopen\s+(?:a\s+)?hermes\s+agent\b/i.test(t) ||
    /next\s+task:\s*orchestrator:\s*open\s+(?:a\s+)?hermes\s+agent\b/i.test(t)
  ) {
    return 'simple'
  }
  if (heuristicResearchIntent(t)) return 'complex'

  // Repo / project health, audits, readiness — natural fit for parallel sub-agents
  if (/\b(production|production-ready|prod[- ]?ready)\b/i.test(t)) return 'complex'
  if (/\b(is|are)\s+(my|this|the)\s+.+\s+(ready|ok|safe|good enough)\b/i.test(t)) return 'complex'
  if (/\b(project|repo|codebase|workspace|monorepo)\b/i.test(t) && /\b(analy|review|audit|assess|evaluat|inspect|scan|structure)\b/i.test(t)) {
    return 'complex'
  }
  if (/\b(audit|analyze|analyse|review)\b.*\b(project|repo|codebase|workspace|app)\b/i.test(t)) return 'complex'

  if (t.length > 1400) return 'complex'
  if (/\b(refactor|implement|migrate|architecture|feature|multi[- ]?file|entire codebase)\b/i.test(t)) return 'complex'
  if ((t.match(/\n/g) ?? []).length > 4) return 'complex'

  // Short single-intent
  if (t.length < 220 && (t.match(/\n/g) ?? []).length <= 1 && !/\b(and then|also|steps|first|second)\b/i.test(t)) {
    return 'simple'
  }

  return 'complex'
}

/** Path / code-ish anchors — prompt is usually specific enough to skip a clarifying articulation pass. */
const ARTICULATION_CODE_ANCHOR =
  /\b(packages\/|src\/|\.tsx?\b|\.rs\b|\.json\b|`[^`]{4,}`|https?:\/\/[^\s]+)/i

/**
 * Whether to run the optional articulation LLM pass before planning (when Settings →
 * Prompt articulation is `before_planning`). Independent of {@link classifyOrchestratorPrompt}
 * (simple vs complex execution tier).
 *
 * Targets **short** or **vague** user text; skips **long specs**, **code-anchored** requests, and
 * common **audit / readiness** intents that are already goal-clear.
 */
export function shouldArticulateOrchestratorPrompt(prompt: string): boolean {
  const t = prompt.trim()
  if (!t) return false

  // Intent is already explicit (brief readiness / scope questions).
  if (/\b(production[- ]?ready|entire codebase|whole repo|security\s+audit|codebase\s+review)\b/i.test(t)) {
    return false
  }

  // Anchored to repo paths or inline paths — usually enough context to plan.
  if (ARTICULATION_CODE_ANCHOR.test(t) && t.length > 40) return false

  // Long structured prompts — user already wrote a spec.
  if (t.length > 450) return false
  if (t.length > 220 && (t.match(/\n/g) ?? []).length >= 3) return false

  // Very short fragment (greetings, typos, one-liners).
  if (t.length < 36) return true

  // Short line without path/code anchors — typical shorthand.
  if (t.length <= 110 && !ARTICULATION_CODE_ANCHOR.test(t)) return true

  // Medium: vague or underspecified phrasing.
  const vague =
    /\b(fix\s+(this|it)|doesn'?t work|not working|\bbroken\b|^help\b|what should i|make it work|what'?s wrong)\b/i.test(
      t
    ) ||
    /\b(this|that|it)\b.*\b(error|wrong|broken|bug)\b/i.test(t) ||
    /\b(error|wrong|broken|bug)\b.*\b(this|that|it)\b/i.test(t)

  if (vague && t.length < 240) return true

  return false
}

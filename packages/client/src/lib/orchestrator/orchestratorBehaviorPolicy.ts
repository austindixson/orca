const RECALL_TRIGGER_RE =
  /\b(last time|previous(?:ly)?|remember when|as (?:mentioned|discussed) before|we (?:did|worked on|fixed|talked about)|continue (?:from|where)|resume (?:from|where)|pick up (?:from|where)|what were we working on)\b/i

const REMEMBER_EXPLICIT_RE =
  /\b(remember this|remember that|don't forget this|dont forget this|save this preference|note this preference)\b/i

const PREFERENCE_SIGNAL_RE =
  /\b(i prefer|my preference is|for me,|for my workflow|please always|please never|don't do that again|do not do that again)\b/i

const CORRECTION_SIGNAL_RE =
  /\b(you were wrong|that's wrong|that is wrong|correction:|stop doing that)\b/i

export const ORCHESTRATOR_BEHAVIOR_PRIORITY_ORDER = [
  'safety',
  'user_immediate_request',
  'grounding',
  'continuity',
  'efficiency',
  'verbosity',
] as const

export type OrchestratorBehaviorSignal = {
  shouldRecallSessionContext: boolean
  shouldPersistDurableMemory: boolean
}

export function detectOrchestratorBehaviorSignals(userMessage: string): OrchestratorBehaviorSignal {
  const text = userMessage.trim()
  if (!text) {
    return { shouldRecallSessionContext: false, shouldPersistDurableMemory: false }
  }
  const shouldRecallSessionContext = RECALL_TRIGGER_RE.test(text)
  const shouldPersistDurableMemory =
    REMEMBER_EXPLICIT_RE.test(text) || PREFERENCE_SIGNAL_RE.test(text) || CORRECTION_SIGNAL_RE.test(text)
  return { shouldRecallSessionContext, shouldPersistDurableMemory }
}

export function buildBehaviorReflexTurnGuard(userMessage: string): string | null {
  const sig = detectOrchestratorBehaviorSignals(userMessage)
  if (!sig.shouldRecallSessionContext && !sig.shouldPersistDurableMemory) return null

  const lines: string[] = ['[Behavior reflex override — memory/continuity]']
  if (sig.shouldRecallSessionContext) {
    lines.push(
      '- User referenced prior work/context. Before asking user to repeat details, call `session_search` (or `recall_session_history`) and ground the response in retrieved evidence.'
    )
  }
  if (sig.shouldPersistDurableMemory) {
    lines.push(
      '- User signaled a durable preference/correction. After completing the immediate request, persist concise durable memory via `memory` (`target=user` for user prefs; `target=memory` for environment/workflow facts).'
    )
  }
  lines.push(
    '- If evidence is missing or tools fail, state uncertainty explicitly and provide the next safe retrieval step (do not fabricate confidence).'
  )
  return lines.join('\n')
}

export function buildBehaviorContractBlock(): string {
  const priority = ORCHESTRATOR_BEHAVIOR_PRIORITY_ORDER.join(' > ')
  return `

### Behavior contract (policy-encoded reflexes)
Behavior is a **contract**, not personality text.
- Enforce invariants under interruption, error, ambiguity, and completion. Example invariant: never continue tool calls after a terminal final answer.
- Priority order per turn (highest to lowest): **${priority}**.
- Interruptibility default: answer interruptions immediately, then provide a one-line resume offer.
- Honest uncertainty: when context/evidence is missing, declare limits and run the next safe retrieval step.
- Recovery is first-class: classify failure type, use bounded/backoff retry only when class supports retry, otherwise branch to deterministic remediation.
- Human factors: concise progress, actionable failure messages, explicit next-safe options.

### Memory philosophy contract
Use memory to reduce repeated user steering, not to log transient execution state.
- **Recall reflex:** if user references prior sessions/context, call **\`session_search\`** before asking them to restate details.
- **Write reflex:** persist memory via **\`memory\`** for stable preferences/corrections/environment facts likely to matter later.
- Prefer compact, durable entries; avoid saving temporary progress logs or one-off outputs.
`
}

import { chatCompletionWithTools, orchestratorChatOptionsFromStore } from './chatCompletion'
import { streamChatCompletionText } from './orchestratorPlanningStream'
import { MAX_PLANNING_USER_CHARS, truncateString } from './orchestratorContextBudget'
import type { Provider } from '../../store/settingsStore'
import type { ChatMessage } from './types'

export interface OrchestratorArticulationResult {
  /** Single authoritative paragraph for planning and the lead model (typos fixed when confident, scope explicit). */
  goal: string
  /** 0–3 short notes on assumptions or ambiguities (optional). */
  clarifications: string[]
}

const ARTICULATION_SYSTEM = `You **articulate** the user's request for a multi-agent coding orchestrator. People type in shorthand, vague phrases, and typos. Your job is to infer intent and produce ONE clear specification — **not** to decompose into tasks or name tools.

Respond with ONLY valid JSON (no markdown code fences) in this exact shape:
{"goal":"...","clarifications":[]}

Rules:
- "goal": **One or two paragraphs** (plain text). State what they want done, **inferred constraints** (language, stack, repo area if implied), and **explicit assumptions** when the original message is ambiguous. Fix obvious typos only when meaning is clear; if a word is ambiguous, prefer stating both interpretations in clarifications.
- "clarifications": **0 to 3** short strings — things that would change the plan if confirmed, or residual ambiguity. Use [] if none.
- **Do not** output a task list, JSON plan, or tool names — only articulation.
- Match the user's language when they wrote in a non-English language.
- If the message is already precise, "goal" can closely mirror it while cleaning wording.`

/** Exported for unit tests — strips optional fences and parses JSON. */
export function parseArticulationJson(raw: string): OrchestratorArticulationResult {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z0-9]*\s*/i, '').replace(/\s*```\s*$/i, '')
  }
  const o = JSON.parse(t) as { goal?: unknown; clarifications?: unknown }
  const goal = typeof o.goal === 'string' ? o.goal.trim() : ''
  const clarRaw = Array.isArray(o.clarifications) ? o.clarifications : []
  const clarifications = clarRaw
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, 3)
  if (!goal) throw new Error('Articulation JSON missing non-empty "goal"')
  return { goal, clarifications }
}

/**
 * One LLM call (no tools) to expand vague/short user input into a clear goal before hierarchy/decomposition.
 */
export async function runOrchestratorArticulationPhase(options: {
  provider: Provider
  model: string
  apiKey: string | undefined
  baseUrl: string | undefined
  userPrompt: string
  signal?: AbortSignal
  onStream?: (accumulatedText: string) => void
}): Promise<OrchestratorArticulationResult> {
  const userPrompt = truncateString(options.userPrompt, MAX_PLANNING_USER_CHARS)
  const messages: ChatMessage[] = [
    { role: 'system', content: ARTICULATION_SYSTEM },
    { role: 'user', content: userPrompt },
  ]

  let text: string
  if (options.onStream) {
    try {
      text = await streamChatCompletionText(
        options.provider,
        options.model,
        options.apiKey,
        options.baseUrl,
        messages,
        options.signal,
        options.onStream
      )
    } catch (e) {
      console.warn('[Articulation] Streaming failed; falling back to non-streaming', e)
      const res = await chatCompletionWithTools(
        options.provider,
        options.model,
        options.apiKey,
        options.baseUrl,
        messages,
        [],
        options.signal,
        undefined,
        orchestratorChatOptionsFromStore(options.provider)
      )
      const t0 = res.choices?.[0]?.message?.content
      if (typeof t0 !== 'string' || !t0.trim()) {
        throw new Error('Articulation returned empty content')
      }
      text = t0
    }
  } else {
    const res = await chatCompletionWithTools(
      options.provider,
      options.model,
      options.apiKey,
      options.baseUrl,
      messages,
      [],
      options.signal,
      undefined,
      orchestratorChatOptionsFromStore(options.provider)
    )
    const t0 = res.choices?.[0]?.message?.content
    if (typeof t0 !== 'string' || !t0.trim()) {
      throw new Error('Articulation returned empty content')
    }
    text = t0
  }

  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Articulation returned empty content')
  }
  return parseArticulationJson(text)
}

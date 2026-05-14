import { chatCompletionWithTools, orchestratorChatOptionsFromStore } from './chatCompletion'
import { MAX_ROUTER_USER_CHARS, truncateString } from './orchestratorContextBudget'
import type { Provider } from '../../store/settingsStore'
import type { ChatMessage } from './types'

export type OrchestratorRouteKind = 'direct' | 'plan'

export type OrchestratorIntentKind = 'research' | 'general'

export interface OrchestratorRouteResult {
  route: OrchestratorRouteKind
  rationale?: string
  /** When "research", the main loop uses browser-first + structured research prompts (Sora-style). */
  intent?: OrchestratorIntentKind
}

const ROUTER_SYSTEM = `You triage user requests for an IDE orchestrator. Respond with ONLY valid JSON (no markdown fences):
{"route":"direct"|"plan","rationale":"one short phrase","intent":"research"|"general"}

Use "direct" when ONE focused assistant turn is enough:
- Short questions, clarifications, explanations
- A single small edit, one file read, one shell command, or quick canvas tweak
- Casual chat or “what does X mean?”

Use "plan" when work should be decomposed first:
- Multiple files, multi-step features, refactors, or unclear scope
- Building or wiring several canvas tiles / tools in sequence
- Anything that clearly needs a checklist or several tool rounds

Set "intent":"research" when the user wants investigation from sources — web/docs comparison, competitive analysis, market/tech survey, "look into", "compare A vs B", summarize with citations, evaluate options, literature-style answers. Prefer "plan" for research that needs multiple steps or tiles.

Set "intent":"general" for coding/build tasks, refactors, or when research does not apply.

When unsure, prefer "plan". Omit "intent" only if truly ambiguous (the app may infer research from keywords).`

function parseRouteJson(raw: string): OrchestratorRouteResult {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z0-9]*\s*/i, '').replace(/\s*```\s*$/i, '')
  }
  const o = JSON.parse(t) as { route?: unknown; rationale?: unknown; intent?: unknown }
  const r = o.route
  if (r !== 'direct' && r !== 'plan') {
    throw new Error('Router JSON must set "route" to "direct" or "plan"')
  }
  let intent: OrchestratorIntentKind | undefined
  if (o.intent === 'research' || o.intent === 'general') {
    intent = o.intent
  }
  return {
    route: r,
    rationale: typeof o.rationale === 'string' ? o.rationale.trim() : undefined,
    intent,
  }
}

/**
 * Single cheap completion (no tools) to choose direct answer vs full planning + subtasks.
 */
export async function runOrchestratorRoutePhase(options: {
  provider: Provider
  model: string
  apiKey: string | undefined
  baseUrl: string | undefined
  userPrompt: string
  signal?: AbortSignal
}): Promise<OrchestratorRouteResult> {
  const userPrompt = truncateString(options.userPrompt, MAX_ROUTER_USER_CHARS)
  const messages: ChatMessage[] = [
    { role: 'system', content: ROUTER_SYSTEM },
    { role: 'user', content: userPrompt },
  ]
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
  const text = res.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Router returned empty content')
  }
  return parseRouteJson(text)
}

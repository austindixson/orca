import { chatCompletionWithTools, orchestratorChatOptionsFromStore } from './chatCompletion'
import { MAX_PLANNING_USER_CHARS, truncateString } from './orchestratorContextBudget'
import type { Provider } from '../../store/settingsStore'
import type { ChatMessage } from './types'

export interface OrchestratorPlanResult {
  understanding: string
  tasks: string[]
}

const PLAN_SYSTEM = `You are a planning assistant (divide-and-conquer). Respond with ONLY valid JSON (no markdown code fences) in this exact shape:
{"understanding":"...","tasks":["...","..."]}

Rules:
- "understanding": one short paragraph restating the user's goal in your own words so they can confirm you understood.
- "tasks": 3–10 atomic, ordered subtasks. Each must be actionable and verifiable.
- Use the same language as the user when possible.`

function parsePlanJson(raw: string): OrchestratorPlanResult {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z0-9]*\s*/i, '').replace(/\s*```\s*$/i, '')
  }
  const o = JSON.parse(t) as { understanding?: unknown; tasks?: unknown }
  const understanding =
    typeof o.understanding === 'string' ? o.understanding.trim() : ''
  const tasksRaw = Array.isArray(o.tasks) ? o.tasks : []
  const tasks = tasksRaw
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, 10)
  if (!understanding) {
    throw new Error('Planner JSON missing non-empty "understanding"')
  }
  if (tasks.length === 0) {
    throw new Error('Planner JSON missing "tasks"')
  }
  return { understanding, tasks }
}

/**
 * One-shot LLM call (no tools) to summarize the request and decompose into todo tasks.
 */
export async function runOrchestratorPlanningPhase(options: {
  provider: Provider
  model: string
  apiKey: string | undefined
  baseUrl: string | undefined
  userPrompt: string
  signal?: AbortSignal
}): Promise<OrchestratorPlanResult> {
  const userPrompt = truncateString(options.userPrompt, MAX_PLANNING_USER_CHARS)
  const messages: ChatMessage[] = [
    { role: 'system', content: PLAN_SYSTEM },
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
    throw new Error('Planner returned empty content')
  }
  return parsePlanJson(text)
}

import { chatCompletionWithTools, orchestratorChatOptionsFromStore } from './chatCompletion'
import { streamChatCompletionText } from './orchestratorPlanningStream'
import { MAX_PLANNING_USER_CHARS, truncateString } from './orchestratorContextBudget'

/** Room for upstream SKILL.md in the decomposition system prompt (rest is JSON contract). */
const MAX_DIVIDE_AND_CONQUER_GUIDANCE_CHARS = 10_000
import type { Provider } from '../../store/settingsStore'
import type { ChatMessage } from './types'

export type SubtaskDifficulty = 'easy' | 'medium' | 'hard'

export interface DecompositionSubtask {
  title: string
  difficulty: SubtaskDifficulty
  /** Concrete instructions for one spawn_sub_agent call (one area; avoid overlapping writes). */
  instruction: string
}

export interface OrchestratorDecompositionResult {
  understanding: string
  subtasks: DecompositionSubtask[]
}

const DECOMP_SYSTEM = `You are a planning assistant for a **multi-agent IDE orchestrator**. Respond with ONLY valid JSON (no markdown fences) in this exact shape:
{"understanding":"...","subtasks":[{"title":"...","difficulty":"easy|medium|hard","instruction":"..."}]}

**Parallel workers**
- Each JSON row is one **independent** sub-agent spawned in parallel.
- A **single** medium or complex user goal should become **3–5 narrow SIMPLE workers**, not one bloated worker. Prefer **many small free-tier jobs** over one heavy job per agent.

Rules:
- "understanding": one short paragraph restating the user's goal.
- "subtasks": **3–5** items preferred (minimum 2, maximum 6). Each row = **one independent, bounded** track (different paths or concerns).
- **difficulty** (maps to spawn \`task_complexity\` in the app: easy+medium → **simple** / free routing; hard → **complex** / premium model):
  - **easy** (default for workers): read-only or small checks — list dir, read specific files, one command, one grep, one area. **Most rows should be easy.**
  - **medium**: use sparingly — a few reads + small edits in **one** folder only; still routes as **simple** if scope stays tight.
  - **hard**: **at most one** row per plan, only when unavoidable (e.g. full security architecture review). Everything else stays easy/medium.
- **Specialist flavor** (name in **title** so the orchestrator can copy to \`display_name\` / \`role\`):
  - **Coding / build / CI / refactor** → hint **Mei**-style (e.g. title starts with "Mei —" or "Build —").
  - **Research / compare / investigate / docs discovery** → hint **Sora**-style.
  - **Docs / copy / polish** → hint **Hana**-style.
- For **project / repo / production-readiness / audits**: split into **3–5** parallel tracks (deps & scripts, tests & CI, config/env, security spot-check, docs, etc.). Each **instruction** must be **small enough for a short OpenRouter/free run** — no row should say "analyze entire codebase" alone.
- Instructions must be **disjoint** so workers do not fight over the same paths.
- Use the same language as the user when possible.`

const DIVIDE_AND_CONQUER_PREAMBLE = `## Divide and Conquer (/divideandconquer)

Apply this methodology when choosing subtasks: atomic units, explicit dependency thinking, parallel “waves,” weights/tool-call estimates when helpful, and aggressive parallelism **without** false serialisation.

**Output contract (overrides the skill’s markdown/JSON examples):** You must still reply with **ONLY** the single JSON object defined below — no markdown fences, no separate execution plan document. Use the skill to **think** (subtask boundaries, independence, ordering hints) and encode the result **only** in \`understanding\` + \`subtasks\`.

`

function buildDecompSystem(divideAndConquerGuidance?: string): string {
  const g = divideAndConquerGuidance?.trim()
  if (!g) return DECOMP_SYSTEM
  const block = `${DIVIDE_AND_CONQUER_PREAMBLE}${truncateString(g, MAX_DIVIDE_AND_CONQUER_GUIDANCE_CHARS)}\n\n---\n\n`
  return `${block}${DECOMP_SYSTEM}`
}

function parseDifficulty(x: unknown): SubtaskDifficulty {
  const s = typeof x === 'string' ? x.trim().toLowerCase() : ''
  if (s === 'easy' || s === 'medium' || s === 'hard') return s
  return 'medium'
}

function parseDecompositionJson(raw: string): OrchestratorDecompositionResult {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z0-9]*\s*/i, '').replace(/\s*```\s*$/i, '')
  }
  const o = JSON.parse(t) as { understanding?: unknown; subtasks?: unknown }
  const understanding = typeof o.understanding === 'string' ? o.understanding.trim() : ''
  const rawList = Array.isArray(o.subtasks) ? o.subtasks : []
  const subtasks: DecompositionSubtask[] = []
  for (const row of rawList.slice(0, 6)) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    const instruction = typeof r.instruction === 'string' ? r.instruction.trim() : ''
    if (!title || !instruction) continue
    subtasks.push({
      title,
      difficulty: parseDifficulty(r.difficulty),
      instruction,
    })
  }
  if (!understanding) throw new Error('Decomposition JSON missing "understanding"')
  if (subtasks.length < 2) throw new Error('Decomposition JSON needs at least 2 subtasks')
  return { understanding, subtasks }
}

/**
 * One LLM call (no tools) to decompose a **complex** request into parallel sub-agent tracks with difficulty.
 */
export async function runOrchestratorDecompositionPhase(options: {
  provider: Provider
  model: string
  apiKey: string | undefined
  baseUrl: string | undefined
  userPrompt: string
  signal?: AbortSignal
  onStream?: (accumulatedText: string) => void
  /** Full or partial SKILL.md body from austindixson/divideandconquer (or workspace copy). */
  divideAndConquerGuidance?: string
}): Promise<OrchestratorDecompositionResult> {
  const userPrompt = truncateString(options.userPrompt, MAX_PLANNING_USER_CHARS)
  const systemContent = buildDecompSystem(options.divideAndConquerGuidance)
  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
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
      console.warn('[Decomposition] Streaming failed; falling back to non-streaming', e)
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
      const t = res.choices?.[0]?.message?.content
      if (typeof t !== 'string' || !t.trim()) {
        throw new Error('Decomposition returned empty content')
      }
      text = t
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
    const t = res.choices?.[0]?.message?.content
    if (typeof t !== 'string' || !t.trim()) {
      throw new Error('Decomposition returned empty content')
    }
    text = t
  }

  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Decomposition returned empty content')
  }
  return parseDecompositionJson(text)
}

export function formatDecompositionBlock(result: OrchestratorDecompositionResult): string {
  const lines = result.subtasks.map((s, i) => {
    const tc = s.difficulty === 'hard' ? 'complex' : 'simple'
    return `${i + 1}. [${s.difficulty}] task_complexity: **${tc}** — **${s.title}**\n   Task: ${s.instruction}`
  })
  return [
    '### Orchestrator decomposition (follow this)',
    '',
    `**Understanding:** ${result.understanding}`,
    '',
    '**Parallel tracks.** Each row below is one **independent sub-agent** (parallel). Prefer **3–5 simple workers** on free routing over one complex worker — break big goals into narrow tasks.',
    '',
    '**Spawn** — After `canvas_list_modules`, call `spawn_sub_agent` **once per row** with **`task_complexity` exactly as shown**, and use **display_name** / **role** that match the specialist hint in the title (Mei≈coding/build, Sora≈research, Hana≈content/docs).',
    '',
    ...lines,
    '',
    'When handoffs return, synthesize a concise answer for the user.',
    '',
    '---',
    '',
  ].join('\n')
}
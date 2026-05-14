import { chatCompletionWithTools, orchestratorChatOptionsFromStore } from './chatCompletion'
import { streamChatCompletionText } from './orchestratorPlanningStream'
import { MAX_PLANNING_USER_CHARS, truncateString } from './orchestratorContextBudget'
import type { Provider } from '../../store/settingsStore'
import type { ChatMessage } from './types'

export interface HierarchyTask {
  title: string
  subtasks: string[]
}

export interface HierarchyPhase {
  title: string
  objective: string
  tasks: HierarchyTask[]
}

export interface OrchestratorHierarchyResult {
  understanding: string
  phases: HierarchyPhase[]
}

const HIERARCHY_SYSTEM = `You are a program manager creating a hierarchical execution plan for a multi-agent IDE orchestrator.
Respond with ONLY valid JSON (no markdown fences) in this exact shape:
{"understanding":"...","phases":[{"title":"...","objective":"...","tasks":[{"title":"...","subtasks":["...","...","..."]}]}]}

Rules:
- Produce **3–5 phases**.
- Each phase must contain **3–5 tasks**.
- Each task must contain **3–5 executable subtasks** (short imperative strings).
- Keep each phase independent enough to execute in sequence while preserving handoff quality.
- Emphasize delegation: subtasks should be small enough to map to short worker runs.
- Keep text concise and concrete; avoid generic "analyze everything".
- Use the same language as the user where possible.`

function trimLine(x: unknown): string {
  return typeof x === 'string' ? x.trim() : ''
}

function parseHierarchyJson(raw: string): OrchestratorHierarchyResult {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z0-9]*\s*/i, '').replace(/\s*```\s*$/i, '')
  }
  const o = JSON.parse(t) as { understanding?: unknown; phases?: unknown }
  const understanding = trimLine(o.understanding)
  if (!understanding) throw new Error('Hierarchy JSON missing "understanding"')
  const phaseRows = Array.isArray(o.phases) ? o.phases : []
  const phases: HierarchyPhase[] = []
  for (const p of phaseRows.slice(0, 5)) {
    if (!p || typeof p !== 'object') continue
    const pr = p as Record<string, unknown>
    const title = trimLine(pr.title)
    const objective = trimLine(pr.objective)
    const taskRows = Array.isArray(pr.tasks) ? pr.tasks : []
    const tasks: HierarchyTask[] = []
    for (const tr of taskRows.slice(0, 5)) {
      if (!tr || typeof tr !== 'object') continue
      const to = tr as Record<string, unknown>
      const taskTitle = trimLine(to.title)
      const subtasksRaw = Array.isArray(to.subtasks) ? to.subtasks : []
      const subtasks = subtasksRaw.map(trimLine).filter(Boolean).slice(0, 5)
      if (!taskTitle || subtasks.length < 3) continue
      tasks.push({ title: taskTitle, subtasks })
    }
    if (!title || !objective || tasks.length < 3) continue
    phases.push({ title, objective, tasks })
  }
  if (phases.length < 3) throw new Error('Hierarchy JSON needs at least 3 phases')
  return { understanding, phases }
}

export function shouldUseHierarchicalPlanning(input: {
  promptTier: 'simple' | 'complex'
  prompt: string
  wantsImages: boolean
  skillActivated: boolean
}): boolean {
  if (input.promptTier !== 'complex') return false
  if (input.skillActivated) return false
  if (input.wantsImages) return true
  const t = input.prompt
  if (t.length >= 1200) return true
  if ((t.match(/\n/g) ?? []).length >= 10) return true
  if (/\b(implement|build|create|ship).*\b(all|everything|entire|whole)\b/i.test(t)) return true
  if (/\b(end[- ]to[- ]end|production[- ]ready|full stack|complete app)\b/i.test(t)) return true
  return false
}

export async function runOrchestratorHierarchyPhase(options: {
  provider: Provider
  model: string
  apiKey: string | undefined
  baseUrl: string | undefined
  userPrompt: string
  signal?: AbortSignal
  /** Live model output (usually JSON) while the phased plan is generated. */
  onStream?: (accumulatedText: string) => void
}): Promise<OrchestratorHierarchyResult> {
  const userPrompt = truncateString(options.userPrompt, MAX_PLANNING_USER_CHARS)
  const messages: ChatMessage[] = [
    { role: 'system', content: HIERARCHY_SYSTEM },
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
      console.warn('[Hierarchy] Streaming failed; falling back to non-streaming planning', e)
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
        throw new Error('Hierarchy planning returned empty content')
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
      throw new Error('Hierarchy planning returned empty content')
    }
    text = t
  }

  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Hierarchy planning returned empty content')
  }
  return parseHierarchyJson(text)
}

export function formatHierarchyBlock(result: OrchestratorHierarchyResult): string {
  const phaseLines = result.phases.map((p, phaseIdx) => {
    const taskLines = p.tasks
      .map((t, taskIdx) => {
        const subs = t.subtasks.map((s, i) => `      ${phaseIdx + 1}.${taskIdx + 1}.${i + 1} ${s}`)
        return [
          `  - Task ${phaseIdx + 1}.${taskIdx + 1}: **${t.title}**`,
          ...subs,
        ].join('\n')
      })
      .join('\n')
    return [
      `### Phase ${phaseIdx + 1}: ${p.title}`,
      `Objective: ${p.objective}`,
      taskLines,
    ].join('\n')
  })

  return [
    '## Large-task hierarchy (execute in phases)',
    '',
    `**Mission:** ${result.understanding}`,
    '',
    '**Execution contract**',
    '- Create/update a Todo tile and mirror this hierarchy in `.agent-canvas/plans/current-plan.md` via `write_file`.',
    '- Work **one phase at a time**. Mark completed task IDs before moving to the next phase.',
    '- Each numbered subtask should be delegated as a small worker run when possible.',
    '- After every phase, post a short checkpoint and re-evaluate before continuing.',
    '',
    ...phaseLines,
    '',
    'Proceed with Phase 1 now.',
    '',
  ].join('\n')
}

/**
 * Optional LLM step: 0–3 multiple-choice clarifying questions after the research phase.
 * Single-turn, no tools (same stack as planning / decomposition text calls).
 */

import * as tauri from '../../tauri'
import { useSettingsStore, PROVIDER_INFO, providerAllowsEmptyApiKey } from '../../../store/settingsStore'
import { resolveApiKey } from '../../llmCredentials'
import { providerSupportsOrchestratorTools } from '../types'
import { chatCompletionWithTools, orchestratorChatOptionsFromStore } from '../chatCompletion'
import { ONE_SHOT_CLARIFY_TIMEOUT_MS } from '../orchestratorConstants'
import { streamChatCompletionText } from '../orchestratorPlanningStream'
import type { ChatMessage } from '../types'
import type { ClarifyingAnswer, ClarifyingQuestion } from './oneShotTypes'
import { resolveOneShotFilePath } from './oneShotDecompositionPhase'

const CLARIFY_SYSTEM = `You analyze a project idea for a 1-shot code generator **after** an automated research phase. You receive the user's idea plus research output (JSON or text) from that phase.

Return **only** valid JSON (no markdown fences, no commentary) in this exact shape:
{"questions":[]}

If the idea and research are already specific enough (clear product, stack, platform, scope), return {"questions":[]}.

Otherwise return **1 to 3** questions that would meaningfully improve the build (scope, platform, persistence, auth, MVP vs full feature set, deployment target, etc.).

Each question must have:
- "id": short snake_case id (e.g. "q_platform")
- "question": one line ending with ?
- "options": array of **exactly 4** strings:
  - **Index 0 (first option)** MUST be the **recommended** choice grounded in the research. Start with the prefix "Recommended: " then a short label, then " — " then **exactly one sentence** explaining why it is recommended (cite concrete findings from the research context below; if research is empty, say so briefly and still pick a sensible default).
  - Indices 1–2: plausible alternative approaches (plain text, no "Recommended:" prefix).
  - **Index 3** must always be exactly: "Other: ___" for a custom answer.

Example:
{"questions":[{"id":"q1","question":"What should we prioritize first?","options":["Recommended: MVP core flows — Research favors shipping a thin vertical slice before polish.","Polished UI and animations first","API and data layer first","Other: ___"]}]}

Rules:
- At most 3 questions.
- English unless the user's idea is clearly in another language (then match that language).
- Do not repeat what the user already stated clearly.`

/** Read research_context.json from the temp 1-shot workspace (empty string if missing). */
export async function loadResearchContextForClarify(workspaceRoot: string, projectRootPrefix: string): Promise<string> {
  const path = resolveOneShotFilePath(workspaceRoot, projectRootPrefix, 'research_context.json')
  try {
    return (await tauri.readFile(path)).trim()
  } catch {
    return ''
  }
}

function stripCodeFences(raw: string): string {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z0-9]*\s*/i, '').replace(/\s*```\s*$/i, '')
  }
  return t.trim()
}

function normalizeOtherOption(s: string): string {
  const t = s.trim()
  if (/^other\s*:/i.test(t) || t === 'Other: ___') return 'Other: ___'
  return t
}

function parseQuestionsJson(raw: string): ClarifyingQuestion[] {
  const t = stripCodeFences(raw)
  const o = JSON.parse(t) as { questions?: unknown }
  const list = Array.isArray(o.questions) ? o.questions : []
  const out: ClarifyingQuestion[] = []
  for (const row of list.slice(0, 3)) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    const question = typeof r.question === 'string' ? r.question.trim() : ''
    const opts = r.options
    if (!id || !question || !Array.isArray(opts) || opts.length !== 4) continue
    const a = opts.map((x) => (typeof x === 'string' ? x.trim() : ''))
    if (a.some((s) => !s)) continue
    a[3] = normalizeOtherOption(a[3])
    out.push({
      id,
      question,
      options: [a[0], a[1], a[2], a[3]] as [string, string, string, string],
    })
  }
  return out
}

async function resolveExecutionModel() {
  const settings = useSettingsStore.getState()
  const models = settings.getAvailableModels()
  const selected =
    models.find((m) => m.id === settings.selectedModel) ??
    models.find((m) => providerSupportsOrchestratorTools(m.provider)) ??
    models[0]
  if (!selected || !providerSupportsOrchestratorTools(selected.provider) || selected.supportsTools === false) {
    throw new Error('Select a tools-capable model in Settings for 1-shot mode.')
  }
  const providerConfig = settings.providers[selected.provider]
  const apiKey = await resolveApiKey(selected.provider, providerConfig.apiKey)
  if (!apiKey && !providerAllowsEmptyApiKey(selected.provider)) {
    throw new Error(`Set ${PROVIDER_INFO[selected.provider].name} API key in Settings.`)
  }
  return { selected, providerConfig, apiKey }
}

/**
 * Calls the configured orchestrator model (no tools) to propose 0–3 clarifying questions after research.
 * On failure, returns [] so 1-shot can proceed without blocking.
 */
export async function generateClarifyingQuestions(
  ideaPrompt: string,
  researchContext: string,
  signal: AbortSignal | undefined
): Promise<ClarifyingQuestion[]> {
  const idea = ideaPrompt.trim()
  if (!idea) return []

  let exec: Awaited<ReturnType<typeof resolveExecutionModel>>
  try {
    exec = await resolveExecutionModel()
  } catch {
    return []
  }

  const researchBlock =
    researchContext.trim().length > 0
      ? researchContext.trim()
      : '(No research_context.json was produced or the file was empty — infer cautiously from the idea only.)'

  const { selected, providerConfig, apiKey } = exec
  const messages: ChatMessage[] = [
    { role: 'system', content: CLARIFY_SYSTEM },
    {
      role: 'user',
      content: `User's project idea (1-shot):\n\n"""${idea}"""\n\nResearch phase output (use this to justify the recommended option and one-sentence rationale):\n\n"""${researchBlock}"""`,
    },
  ]

  let text: string
  try {
    text = await streamChatCompletionText(
      selected.provider,
      selected.name,
      apiKey,
      providerConfig.baseUrl,
      messages,
      signal,
      () => {},
      ONE_SHOT_CLARIFY_TIMEOUT_MS
    )
  } catch (e) {
    console.warn('[1-shot clarify] streaming failed; fallback non-streaming', e)
    try {
      const res = await chatCompletionWithTools(
        selected.provider,
        selected.name,
        apiKey,
        providerConfig.baseUrl,
        messages,
        [],
        signal,
        ONE_SHOT_CLARIFY_TIMEOUT_MS,
        orchestratorChatOptionsFromStore(selected.provider)
      )
      const t = res.choices?.[0]?.message?.content
      if (typeof t !== 'string' || !t.trim()) return []
      text = t
    } catch {
      return []
    }
  }

  try {
    return parseQuestionsJson(text)
  } catch (e) {
    console.warn('[1-shot clarify] JSON parse failed', e)
    return []
  }
}

/** Merge original idea with MC answers for downstream pipeline phases. */
export function buildEnrichedPrompt(ideaPrompt: string, answers: ClarifyingAnswer[], questions: ClarifyingQuestion[]): string {
  const idea = ideaPrompt.trim()
  if (answers.length === 0) return idea

  const lines: string[] = [idea, '', '**Clarifications (user-selected):**']
  const byId = new Map(questions.map((q) => [q.id, q]))
  for (const a of answers) {
    const q = byId.get(a.questionId)
    if (!q) continue
    const idx = Math.max(0, Math.min(3, a.selectedOption - 1))
    const label = q.options[idx] ?? ''
    let value: string
    if (a.selectedOption === 4) {
      const custom = (a.customText ?? '').trim()
      value = custom || label || 'Other'
    } else {
      value = label
    }
    lines.push(`- ${q.question} → ${value}`)
  }
  return lines.join('\n')
}

import { resolveApiKey } from '../llmCredentials'
import { useSettingsStore } from '../../store/settingsStore'
import { chatCompletionWithTools, orchestratorChatOptionsFromStore } from './chatCompletion'
import { extractNarratorVoiceLead } from './orchestratorCanvasHudLines'
import type { ChatMessage } from './types'

const AI_CACHE_TTL_MS = 20_000
const aiNarrationCache = new Map<string, { value: string; at: number }>()

function hashText(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0)
}

function withTerminalPunctuation(text: string): string {
  const t = text.trim()
  if (!t) return t
  if (/[.!?]$/.test(t)) return t
  return `${t}.`
}

function parseSeedValue(baseLine: string, key: string): string {
  const m = baseLine.match(new RegExp(`${key}\\n([^\\n]+)`))
  return m?.[1]?.trim() ?? ''
}

/** Parse structured narrator seed: `Task\n…\n\nReason\n…` (optionally with `Primary\n…\n\n` prefix). */
export function parseTaskReasonSeed(seed: string): { task: string; reason: string } {
  let body = seed.trim()
  if (body.startsWith('Primary\n')) {
    const sep = body.indexOf('\n\n', 8)
    if (sep !== -1) body = body.slice(sep + 2)
  }
  const reasonSep = '\n\nReason\n'
  const taskIdx = body.indexOf('Task\n')
  const reasonIdx = body.indexOf(reasonSep)
  if (taskIdx === -1 || reasonIdx === -1) {
    return { task: parseSeedValue(body, 'Task'), reason: parseSeedValue(body, 'Reason') }
  }
  const task = body.slice(taskIdx + 5, reasonIdx).trim()
  const reason = body.slice(reasonIdx + reasonSep.length).trim()
  return { task, reason }
}

function isScaffoldOnlyBullet(text: string): boolean {
  const t = text.trim().toLowerCase()
  return !t || t === 'task' || t === 'reason' || t === '…' || t === '...' || t === '—' || t === '-'
}

function formatTwoBullets(what: string, why: string): string {
  const left = withTerminalPunctuation(what.trim()).slice(0, 180)
  const right = withTerminalPunctuation(why.trim()).slice(0, 180)
  return `- ${left}\n- ${right}`.slice(0, 380)
}

/** Immediate HUD fallback before AI returns: clean bullets, no raw `Task`/`Reason` labels. */
export function buildFallbackBulletsFromSeed(seed: string, primaryLine: string | null): string {
  const primaryNorm = (primaryLine ?? '').trim().toLowerCase()
  const { task, reason } = parseTaskReasonSeed(seed)
  const keep = (s: string): boolean => {
    const t = s.trim()
    if (!t || isScaffoldOnlyBullet(t)) return false
    if (primaryNorm && t.toLowerCase() === primaryNorm) return false
    return true
  }
  const t1 = keep(task) ? task.trim().slice(0, 180) : ''
  const t2 = keep(reason) ? reason.trim().slice(0, 180) : ''
  if (!t1 && !t2) return ''
  if (t1 && t2) return formatTwoBullets(t1, t2)
  const one = withTerminalPunctuation((t1 || t2).trim()).slice(0, 180)
  return `- ${one}`.slice(0, 380)
}

function sanitizeNarratorBullets(raw: string, baseLine: string, primaryLine: string | null): string {
  const primaryNorm = (primaryLine ?? '').trim().toLowerCase()
  const cleanedLines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^["'`]+/, '')
        .replace(/["'`]+$/, '')
        .replace(
          /\b(Now|Progress|Obstacle|Mitigation|Focus|Who|What|When|Where|Why|How|Actor|Task|Timing|Goal|Method|Reason)\s*:\s*/gi,
          ''
        )
        .replace(/\bi am\b/gi, "I'm")
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)

  const bulletPayloads = cleanedLines
    .map((line) => line.replace(/^[-*•]\s+/, '').trim())
    .filter((line) => line && !isScaffoldOnlyBullet(line))

  const filtered = bulletPayloads.filter((line) => {
    if (primaryNorm && line.trim().toLowerCase() === primaryNorm) return false
    return true
  })

  let what = filtered[0] ?? ''
  let why = filtered[1] ?? ''
  if (!what) what = parseSeedValue(baseLine, 'Task')
  if (!why) why = parseSeedValue(baseLine, 'Reason')
  if (primaryNorm) {
    if (what.trim().toLowerCase() === primaryNorm) what = ''
    if (why.trim().toLowerCase() === primaryNorm) why = ''
  }
  if (isScaffoldOnlyBullet(what)) what = ''
  if (isScaffoldOnlyBullet(why)) why = ''
  if (what && why && what.trim().toLowerCase() === why.trim().toLowerCase()) why = ''
  if (!what && !why) return ''
  if (what && why) return formatTwoBullets(what, why)
  const one = what || why
  return `- ${withTerminalPunctuation(one.trim()).slice(0, 180)}`.slice(0, 380)
}

const FOCUS_PREFIX = 'Focused on '
const FOCUS_TEMPLATE_A = [
  'Focused on {label}{where}.',
  'Zeroed in on {label}{where}.',
  'Locked on {label}{where}.',
  'Concentrating on {label}{where}.',
  'Reviewing {label}{where}.',
  'Prioritizing {label}{where}.',
  'Working through {label}{where}.',
  'Tracking {label}{where}.',
] as const
const FOCUS_TEMPLATE_B = [
  '',
  'right now',
  'in this pass',
  'for this step',
  'for this checkpoint',
] as const

const ACTION_TEMPLATE_A = [
  '{actionCap} {bit} in {place}.',
  '{actionCap} {bit} in {place} now.',
  'In {place}, {action} {bit}.',
  'Working through {bit} in {place}.',
  'Handling {bit} in {place}.',
  '{actionCap} {bit} in {place} for this step.',
] as const
const ACTION_TEMPLATE_B = [
  '',
  ' right now',
  ' for this step',
  ' in this pass',
  ' for this checkpoint',
] as const

function splitVoiceLead(baseLine: string): { lead: string; body: string } {
  const idx = baseLine.indexOf(' — ')
  if (idx <= 0) return { lead: '', body: baseLine.trim() }
  return {
    lead: `${baseLine.slice(0, idx).trim()} — `,
    body: baseLine.slice(idx + 3).trim(),
  }
}

export function generateTemplateNarrationVariant(baseLine: string, variantSeed: number): string {
  const { lead, body } = splitVoiceLead(baseLine)
  if (!body) return baseLine

  if (body.startsWith(FOCUS_PREFIX) && body.endsWith('.')) {
    const target = body.slice(FOCUS_PREFIX.length, -1).trim()
    const whereMatch = target.match(/\s+on\s+["“].+["”]$/)
    const where = whereMatch ? whereMatch[0] : ''
    const label = where ? target.slice(0, -where.length).trim() : target
    const a = FOCUS_TEMPLATE_A[variantSeed % FOCUS_TEMPLATE_A.length]
    const b = FOCUS_TEMPLATE_B[Math.floor(variantSeed / FOCUS_TEMPLATE_A.length) % FOCUS_TEMPLATE_B.length]
    const sentence = a.replace('{label}', label).replace('{where}', where)
    if (!b) return `${lead}${sentence}`.slice(0, 300)
    return `${lead}${sentence.replace(/\.$/, '')} ${b}.`.slice(0, 300)
  }

  const workingInMatch = body.match(/^Working in (.+) on (.+)\.$/)
  const actionMatch = body.match(/^([A-Z][a-z]+) (.+) in (the [^.]+)\.$/)
  const parsed = workingInMatch
    ? { action: 'working on', actionCap: 'Working on', bit: workingInMatch[2], place: workingInMatch[1] }
    : actionMatch
      ? {
          action: actionMatch[1].toLowerCase(),
          actionCap: actionMatch[1],
          bit: actionMatch[2],
          place: actionMatch[3],
        }
      : null

  if (!parsed) return baseLine

  const a = ACTION_TEMPLATE_A[variantSeed % ACTION_TEMPLATE_A.length]
  const b = ACTION_TEMPLATE_B[Math.floor(variantSeed / ACTION_TEMPLATE_A.length) % ACTION_TEMPLATE_B.length]
  const sentence = a
    .replace('{action}', parsed.action)
    .replace('{actionCap}', parsed.actionCap)
    .replace('{bit}', parsed.bit)
    .replace('{place}', parsed.place)
  const merged = b ? withTerminalPunctuation(sentence.replace(/\.$/, '') + b) : withTerminalPunctuation(sentence)
  return `${lead}${merged}`.slice(0, 300)
}

export function narratorTemplateSeed(baseLine: string, tick: number): number {
  return hashText(baseLine) + tick * 17
}

type GenerateAiNarratorLineArgs = {
  baseLine: string
  /** HUD primary line — used to dedupe bullets that echo the phase header. */
  primaryLine: string | null
  personalityMarkdown: string | null
  modelId: string | null
  signal?: AbortSignal
}

export async function generateAiNarratorLine({
  baseLine,
  primaryLine,
  personalityMarkdown,
  modelId,
  signal,
}: GenerateAiNarratorLineArgs): Promise<string> {
  const settings = useSettingsStore.getState()
  const effectiveModelId = (modelId ?? settings.selectedModel ?? '').trim()
  if (!effectiveModelId) throw new Error('Narrator AI has no model selected.')
  const available = settings.getAvailableModels()
  const modelCfg = available.find((m) => m.id === effectiveModelId)
  if (!modelCfg) throw new Error(`Narrator model "${effectiveModelId}" is not available.`)

  const providerCfg = settings.providers[modelCfg.provider]
  const cacheKey = `${modelCfg.id}::${baseLine}`
  const now = Date.now()
  const cached = aiNarrationCache.get(cacheKey)
  if (cached && now - cached.at < AI_CACHE_TTL_MS) return cached.value

  const apiKey = await resolveApiKey(modelCfg.provider, providerCfg.apiKey)
  const voiceLead = personalityMarkdown?.trim() ? extractNarratorVoiceLead(personalityMarkdown) : ''
  const system = [
    'You are Orca narrator text for a tiny HUD in a coding workspace.',
    'Write exactly TWO bullet points in natural personal-assistant voice.',
    'Bullet 1 = what is happening right now.',
    'Bullet 2 = why it matters now (progress intent, blocker handling, or mitigation).',
    'Do not invent blockers or fixes not present in input.',
    'Do not quote text, do not output scaffold labels.',
    'Do not repeat the status verb already shown elsewhere in the HUD.',
    'Do not repeat the Primary line (first field in the input) inside your bullets.',
    'Use plain language, present tense, no emojis, no markdown, no lists.',
    'Keep each bullet concise.',
    voiceLead ? `Narrator voice hint: ${voiceLead}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `Turn this structured live state into one natural assistant-style status sentence:\n${baseLine}`,
    },
  ]
  const response = await chatCompletionWithTools(
    modelCfg.provider,
    modelCfg.name,
    apiKey,
    providerCfg.baseUrl,
    messages,
    [],
    signal,
    14_000,
    orchestratorChatOptionsFromStore(modelCfg.provider)
  )
  const text = sanitizeNarratorBullets(response.choices[0]?.message?.content ?? '', baseLine, primaryLine)
  if (!text) throw new Error('Narrator AI returned an empty line.')
  aiNarrationCache.set(cacheKey, { value: text, at: now })
  return text
}

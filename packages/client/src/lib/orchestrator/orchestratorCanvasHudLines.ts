import type { OrchestratorPlanningDraft } from '../../store/orchestratorSessionStore'
import type { AgentTileFocus } from '../../store/orchestratorActivityStore'

const PHASE_LOG_RE = /^\[Phase\s+(\d+)\]\s*(.+)$/

/** Latest `[Phase N] …` line from the activity transcript (end = most recent). */
export function extractLatestPhaseLineFromActivity(activityFeed: string[]): string | null {
  for (let i = activityFeed.length - 1; i >= 0; i--) {
    const m = activityFeed[i].trim().match(PHASE_LOG_RE)
    if (m) {
      const rest = m[2].trim()
      return `Phase ${m[1]} · ${rest}`.slice(0, 220)
    }
  }
  return null
}

const PLAN_PHASE_MD_RE = /^###\s*Phase\s+(\d+):\s*(.+)$/i

/** First phase heading or first substantive line from formatted / streaming plan markdown. */
export function extractPlanHeadLine(draft: OrchestratorPlanningDraft | null): string | null {
  if (!draft) return null
  if (draft.phase === 'streaming') {
    const t = draft.title?.trim()
    return t ? `${t}…` : 'Planning…'
  }
  const body = draft.body?.trim()
  if (!body) return null
  for (const line of body.split('\n')) {
    const m = line.trim().match(PLAN_PHASE_MD_RE)
    if (m) {
      return `Phase ${m[1]} · ${m[2].trim()}`.slice(0, 220)
    }
  }
  const decomp = body.split('\n').find((l) => /Orchestrator decomposition/i.test(l.trim()))
  if (decomp) return decomp.replace(/^#+\s*/, '').trim().slice(0, 140)

  const understanding = body.match(/\*\*Understanding:\*\*\s*(.+)/)
  if (understanding?.[1]) {
    return understanding[1].trim().slice(0, 160)
  }

  const first = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('---'))
  return first ? first.slice(0, 180) : null
}

/**
 * First readable line from personality.md for narrator tone (strip markdown noise, cap length).
 * Exported for tests.
 */
export function extractNarratorVoiceLead(personalityMarkdown: string): string {
  let t = personalityMarkdown.replace(/\r\n/g, '\n').trim()
  if (t.startsWith('---')) {
    const end = t.indexOf('\n---', 3)
    if (end !== -1) t = t.slice(end + 4).trim()
  }
  const firstPara = t.split(/\n\n+/)[0] ?? t
  const line = firstPara.split('\n').find((l) => l.trim().length > 0) ?? ''
  const cleaned = line
    .replace(/^#+\s*/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/, '')
    .trim()
  if (!cleaned) return ''
  const cap = 100
  return cleaned.length > cap ? `${cleaned.slice(0, cap).trim()}…` : cleaned
}

function tileKindPhrase(type: AgentTileFocus['tileType']): string {
  switch (type) {
    case 'editor':
      return 'the editor'
    case 'browser':
      return 'the browser'
    case 'agent_browser':
      return 'the agent browser'
    case 'diff':
      return 'the diff view'
    case 'terminal':
      return 'the terminal'
    default:
      return 'the canvas'
  }
}

function actionPhrase(action: AgentTileFocus['action']): string {
  switch (action) {
    case 'reading':
      return 'reading'
    case 'writing':
      return 'writing'
    case 'navigating':
      return 'navigating'
    case 'executing':
      return 'running'
    default:
      return 'working in'
  }
}

function normalizeTileBit(bit: string, tileType: AgentTileFocus['tileType']): string {
  const trimmed = bit.trim()
  if (tileType === 'editor' && /^\d+$/.test(trimmed)) return `line ${trimmed}`
  if (tileType === 'editor') {
    const range = trimmed.match(/^(\d+)\s*[–-]\s*(\d+)$/)
    if (range) return `lines ${range[1]}–${range[2]}`
  }
  return trimmed
}

function capitalizeFirst(text: string): string {
  if (!text) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export type TileSwitchNarrationOptions = {
  /** Raw personality.md text (optional); first line becomes a short voice lead. */
  personalityMarkdown?: string | null
}

function compactFeedLine(line: string): string {
  return line
    .trim()
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/g, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\b(summary|reason|task)\s*:\s*/gi, '')
    .replace(/\s*[|]\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[•·]\s*/g, ' · ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
    .slice(0, 180)
}

function isNarratorRelevantLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^(you|assistant|user|system)\s*:/i.test(t)) return false
  if (/^[-*]?\s*you\s*[·:]/i.test(t)) return false
  if (/^[-*]?\s*you\s*[—-]/i.test(t)) return false
  if (/^\(resumed\)/i.test(t)) return false
  if (/^\s*(complete|completed)\b/i.test(t) && /\b(summary|verification)\b/i.test(t)) return false
  if (/\bsummary:\b/i.test(t) && t.length > 90) return false
  if (
    /\bplease continue where we left off\b/i.test(t) ||
    /\bprogress so far:\b/i.test(t) ||
    /\bthe next task is:\b/i.test(t) ||
    /\bpick up from (there|this line)\b/i.test(t)
  ) {
    return false
  }
  if (t.includes('"') && t.length > 120) return false
  return true
}

function latestFeedMatch(activityFeed: string[], re: RegExp): string | null {
  for (let i = activityFeed.length - 1; i >= 0; i--) {
    const line = compactFeedLine(activityFeed[i])
    if (!isNarratorRelevantLine(line)) continue
    if (re.test(line)) return line
  }
  return null
}

export type NarratorStatusSnapshot = {
  progress: string | null
  obstacle: string | null
  mitigation: string | null
}

/**
 * Derives progress + blocker/mitigation signals from recent orchestrator activity.
 * Used by the HUD narrator so users get practical state, not generic "focused on" text.
 */
export function deriveNarratorStatusSnapshot(
  activityFeed: string[],
  phaseOrPlanLine: string | null
): NarratorStatusSnapshot {
  const currentPhase = phaseOrPlanLine?.match(/^Phase\s+(\d+)\s+·/)
  const planningSummary = latestFeedMatch(
    activityFeed,
    /\b(plan|phase|step|progress|done|completed|implementing|testing)\b/i
  )
  const progress = currentPhase
    ? `${phaseOrPlanLine}`
    : planningSummary
      ? planningSummary
      : null

  const obstacle = latestFeedMatch(
    activityFeed,
    /\b(blocked|obstacle|error|failed|failure|timeout|conflict|cannot|can't|issue)\b/i
  )
  const mitigation = latestFeedMatch(
    activityFeed,
    /\b(fix|fixed|mitigat|workaround|retry|resolved|resolving|patch|implementing|solution)\b/i
  )

  return { progress, obstacle, mitigation }
}

/**
 * One-line narration for “what module the orchestrator is on” — natural sentences;
 * optional personality.md colors the opening clause.
 */
export function formatTileSwitchNarration(
  agentTileFocus: AgentTileFocus | null,
  autoFocusHighlight: { tileId: string; label: string } | null,
  tileTitleById: (id: string) => string | undefined,
  options?: TileSwitchNarrationOptions
): string | null {
  const rawPersonality = options?.personalityMarkdown?.trim()
  const voice = rawPersonality ? extractNarratorVoiceLead(rawPersonality) : ''
  const lead = voice ? `${voice} — ` : ''

  if (agentTileFocus) {
    const title = tileTitleById(agentTileFocus.tileId)
    const detail = agentTileFocus.detail?.trim()
    const bit = normalizeTileBit(detail || title || 'this spot', agentTileFocus.tileType)
    const place = tileKindPhrase(agentTileFocus.tileType)
    const act = actionPhrase(agentTileFocus.action)
    const sentence =
      act === 'working in'
        ? `Working in ${place} on ${bit}.`
        : `${capitalizeFirst(act)} ${bit} in ${place}.`
    return `${lead}${sentence}`.slice(0, 300)
  }
  if (autoFocusHighlight) {
    const title = tileTitleById(autoFocusHighlight.tileId)
    const where = title ? ` on “${title}”` : ''
    const sentence = `Focused on ${autoFocusHighlight.label}${where}.`
    return `${lead}${sentence}`.slice(0, 300)
  }
  return null
}

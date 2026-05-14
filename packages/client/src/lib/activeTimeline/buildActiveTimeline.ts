import type { TimelineJsonlRecord } from '../persistence/sessionPersistence'

export type TimelineOutcome = 'ok' | 'bad' | 'neutral'

export type ActiveTimelineEntry = {
  id: string
  at: number
  source: 'session' | 'milestone'
  kind: 'tool_start' | 'tool_end' | 'milestone' | 'other'
  title: string
  detail: string
  outcome: TimelineOutcome
}

export type MilestoneNote = {
  id: string
  at: number
  title: string
  body: string
  /** User or default tag for filtering / tone */
  outcome?: 'win' | 'loss' | 'neutral'
}

const badHint = /\b(error|err:|failed|failure|exception|denied|timeout|panic|ECONN|ENOTFOUND)\b/i
const goodHint = /\b(success|succeeded|done|complete|ok\b|200\b)\b/i

function outcomeFromLine(line: string, kind: string): TimelineOutcome {
  if (badHint.test(line)) return 'bad'
  if (kind === 'tool_end' && goodHint.test(line)) return 'ok'
  return 'neutral'
}

function parseArrowLine(line: string): { dir: 'in' | 'out'; tool: string; rest: string } | null {
  const t = line.trimStart()
  if (t.startsWith('→')) {
    const m = t.slice(1).trim().match(/^([A-Za-z0-9_:-]+)([\s\S]*)$/)
    if (!m) return null
    return { dir: 'out', tool: m[1], rest: (m[2] ?? '').trim().slice(0, 400) }
  }
  if (t.startsWith('←')) {
    const m = t.slice(1).trim().match(/^([A-Za-z0-9_:-]+)([\s\S]*)$/)
    if (!m) return null
    return { dir: 'in', tool: m[1], rest: (m[2] ?? '').trim().slice(0, 400) }
  }
  return null
}

function entryId(at: number, idx: number): string {
  return `t-${at}-${idx}`
}

/** Turn raw JSONL + optional workspace milestones into a single sorted list for the Active Timeline UI. */
export function buildActiveTimelineEntries(
  raw: TimelineJsonlRecord[],
  milestones: MilestoneNote[]
): ActiveTimelineEntry[] {
  const out: ActiveTimelineEntry[] = []

  raw.forEach((rec, idx) => {
    const at = typeof rec.at === 'number' ? rec.at : 0
    const kind = typeof rec.kind === 'string' ? rec.kind : 'other'
    const line = typeof rec.line === 'string' ? rec.line : ''
    const parsed = parseArrowLine(line)

    if (parsed) {
      const isStart = parsed.dir === 'out'
      const title = isStart ? `Started · ${parsed.tool}` : `Finished · ${parsed.tool}`
      const outcome = isStart ? 'neutral' : outcomeFromLine(line, 'tool_end')
      out.push({
        id: entryId(at, idx),
        at,
        source: 'session',
        kind: isStart ? 'tool_start' : 'tool_end',
        title,
        detail: parsed.rest || line.slice(0, 500),
        outcome,
      })
      return
    }

    out.push({
      id: entryId(at, idx),
      at,
      source: 'session',
      kind: 'other',
      title: kind !== 'other' ? kind : 'Event',
      detail: line.slice(0, 500) || JSON.stringify(rec).slice(0, 200),
      outcome: 'neutral',
    })
  })

  for (const m of milestones) {
    const tone =
      m.outcome === 'win' ? 'ok' : m.outcome === 'loss' ? 'bad' : 'neutral'
    out.push({
      id: `m-${m.id}`,
      at: m.at,
      source: 'milestone',
      kind: 'milestone',
      title: m.title.trim() || 'Milestone',
      detail: m.body.trim(),
      outcome: tone,
    })
  }

  out.sort((a, b) => a.at - b.at)
  return out
}

/** Entries visible at or before `scrubAt` (inclusive). */
export function entriesThrough(entries: ActiveTimelineEntry[], scrubAt: number): ActiveTimelineEntry[] {
  return entries.filter((e) => e.at <= scrubAt)
}

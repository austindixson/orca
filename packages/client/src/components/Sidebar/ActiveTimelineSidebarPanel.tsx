import { useCallback, useEffect, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { useSettingsStore } from '../../store/settingsStore'
import { getDefaultSessionId, loadTimelineFromDisk } from '../../lib/persistence/sessionPersistence'
import {
  buildActiveTimelineEntries,
  entriesThrough,
  type ActiveTimelineEntry,
} from '../../lib/activeTimeline/buildActiveTimeline'
import {
  loadActiveTimelineNotes,
  saveActiveTimelineNotes,
  ACTIVE_TIMELINE_NOTES_RELATIVE,
} from '../../lib/activeTimeline/activeTimelineNotes'
import type { MilestoneNote } from '../../lib/activeTimeline/buildActiveTimeline'

function formatClock(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(ms)
  }
}

function summarizeThrough(entries: ActiveTimelineEntry[], scrubAt: number): string {
  const past = entriesThrough(entries, scrubAt)
  const tools = past.filter((e) => e.kind === 'tool_start' || e.kind === 'tool_end').length
  const wins = past.filter((e) => e.outcome === 'ok').length
  const losses = past.filter((e) => e.outcome === 'bad').length
  const miles = past.filter((e) => e.kind === 'milestone').length
  const parts: string[] = []
  if (tools) parts.push(`${tools} tool events`)
  if (miles) parts.push(`${miles} milestone${miles === 1 ? '' : 's'}`)
  if (wins) parts.push(`${wins} win signal${wins === 1 ? '' : 's'}`)
  if (losses) parts.push(`${losses} issue${losses === 1 ? '' : 's'}`)
  return parts.length ? parts.join(' · ') : 'No activity yet before this point.'
}

export function ActiveTimelineSidebarPanel() {
  const persistenceOn = useSettingsStore((s) => s.orcaPersistenceEnabled)
  const [entries, setEntries] = useState<ActiveTimelineEntry[]>([])
  const [milestones, setMilestones] = useState<MilestoneNote[]>([])
  const [scrubAt, setScrubAt] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [mTitle, setMTitle] = useState('')
  const [mBody, setMBody] = useState('')
  const [mTone, setMTone] = useState<'neutral' | 'win' | 'loss'>('neutral')

  const reload = useCallback(async () => {
    setErr(null)
    try {
      const sid = getDefaultSessionId()
      const [raw, notes] = await Promise.all([loadTimelineFromDisk(sid), loadActiveTimelineNotes()])
      setMilestones(notes)
      setEntries(buildActiveTimelineEntries(raw, notes))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const id = window.setInterval(() => void reload(), 4000)
    return () => window.clearInterval(id)
  }, [reload])

  const { tMin, tMax } = useMemo(() => {
    if (entries.length === 0) {
      const n = Date.now()
      return { tMin: n, tMax: n + 1 }
    }
    const times = entries.map((e) => e.at)
    let minT = Math.min(...times)
    let maxT = Math.max(...times, Date.now())
    if (maxT <= minT) maxT = minT + 1
    return { tMin: minT, tMax: maxT }
  }, [entries])

  useEffect(() => {
    setScrubAt((s) => {
      if (entries.length === 0) return Date.now()
      if (s < tMin || s > tMax) return tMax
      return s
    })
  }, [tMin, tMax, entries.length])

  const summary = useMemo(() => summarizeThrough(entries, scrubAt), [entries, scrubAt])

  const addMilestone = async () => {
    const title = mTitle.trim()
    if (!title) return
    const next: MilestoneNote = {
      id: nanoid(),
      at: Date.now(),
      title,
      body: mBody.trim(),
      outcome: mTone === 'win' ? 'win' : mTone === 'loss' ? 'loss' : 'neutral',
    }
    const merged = [...milestones, next]
    setMilestones(merged)
    setMTitle('')
    setMBody('')
    try {
      await saveActiveTimelineNotes(merged)
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-tile-bg/60 text-gray-300 backdrop-blur-xl">
      <div className="shrink-0 border-b border-tile-border/80 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-teal-200/90">Active timeline</div>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          Scrub through this session&rsquo;s tool rhythm plus milestones stored in{' '}
          <code className="text-gray-400">{ACTIVE_TIMELINE_NOTES_RELATIVE}</code>. Requires session persistence for
          tool events.
        </p>
        {!persistenceOn && (
          <p className="mt-2 rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100/90">
            Turn on <span className="font-medium">Orca persistence</span> in Settings to record tool starts/stops to the
            session timeline.
          </p>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-b border-tile-border/60 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Scrub time</div>
        <input
          type="range"
          className="orca-range w-full accent-accent-teal"
          min={tMin}
          max={tMax}
          step={Math.max(1, Math.floor((tMax - tMin) / 400) || 1)}
          value={Math.min(tMax, Math.max(tMin, scrubAt))}
          disabled={entries.length === 0}
          onChange={(e) => setScrubAt(Number(e.target.value))}
        />
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>{formatClock(tMin)}</span>
          <span className="text-teal-200/90">{formatClock(scrubAt)}</span>
          <span>{formatClock(tMax)}</span>
        </div>
        <p className="text-[11px] leading-snug text-gray-400">{summary}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {loading && <p className="text-[11px] text-gray-500">Loading…</p>}
        {err && (
          <p className="text-[11px] text-rose-300/90">{err}</p>
        )}
        {!loading && entries.length === 0 && (
          <p className="text-[11px] text-gray-500">
            No timeline rows yet. Run the orchestrator with persistence on, or add a manual milestone below.
          </p>
        )}
        <ul className="space-y-2">
          {[...entries].reverse().map((e) => {
            const dim = e.at > scrubAt
            const border =
              e.outcome === 'bad'
                ? 'border-rose-500/35 bg-rose-500/5'
                : e.outcome === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : e.kind === 'milestone'
                    ? 'border-teal-500/35 bg-teal-500/5'
                    : 'border-tile-border/60 bg-black/20'
            return (
              <li
                key={e.id}
                className={`rounded-md border px-2.5 py-2 text-[11px] leading-snug transition-opacity ${border} ${
                  dim ? 'opacity-35' : 'opacity-100'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-gray-200">{e.title}</span>
                  <span className="shrink-0 text-[10px] text-gray-500">{formatClock(e.at)}</span>
                </div>
                {e.detail ? (
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] text-gray-400">{e.detail}</p>
                ) : null}
                <div className="mt-1 text-[9px] uppercase tracking-wide text-gray-600">
                  {e.kind === 'milestone' ? 'Milestone' : e.source === 'session' ? 'Session' : ''}
                  {e.outcome === 'bad' ? ' · issue' : e.outcome === 'ok' ? ' · win' : ''}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="shrink-0 border-t border-tile-border/80 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Add milestone</div>
        <input
          type="text"
          placeholder="Title"
          value={mTitle}
          onChange={(ev) => setMTitle(ev.target.value)}
          className="mt-1 w-full rounded border border-tile-border/60 bg-black/25 px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-accent-teal"
        />
        <textarea
          placeholder="What worked / what did not (optional)"
          value={mBody}
          onChange={(ev) => setMBody(ev.target.value)}
          rows={2}
          className="mt-1 w-full resize-none rounded border border-tile-border/60 bg-black/25 px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-accent-teal"
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-gray-500">
            Tone
            <select
              value={mTone}
              onChange={(ev) => setMTone(ev.target.value as 'neutral' | 'win' | 'loss')}
              className="rounded border border-tile-border/60 bg-black/30 px-1.5 py-0.5 text-[10px] text-gray-200"
            >
              <option value="neutral">Neutral</option>
              <option value="win">Worked</option>
              <option value="loss">Did not work</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void addMilestone()}
            disabled={!mTitle.trim()}
            className="rounded-md border border-teal-500/40 bg-teal-600/25 px-2.5 py-1 text-[11px] font-medium text-teal-100/95 hover:bg-teal-600/40 disabled:opacity-35"
          >
            Save milestone
          </button>
        </div>
      </div>
    </div>
  )
}

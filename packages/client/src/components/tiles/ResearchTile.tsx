import { useCallback, useEffect, useMemo, useState } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import {
  useResearchSessionStore,
  type ResearchEntry,
  type ResearchEntryKind,
  type ResearchTab,
} from '../../store/researchSessionStore'

function kindLabel(k: ResearchEntryKind): string {
  switch (k) {
    case 'web_search':
      return 'Web'
    case 'mcp_context7':
      return 'Context7'
    case 'mcp_generic':
      return 'MCP'
    case 'url_fetch':
      return 'URL'
    default:
      return k
  }
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

/** One-line takeaway for the card (web_search lifecycle + DDG abstract/snippets). */
function keyFindingLine(e: ResearchEntry): string {
  if (e.kind === 'web_search') {
    if (e.status === 'queued') return 'Queued — runs after earlier tools in this batch finish.'
    if (e.status === 'active') return 'Searching the web…'
  }
  const ab = e.abstract?.trim()
  if (ab) {
    const m = ab.match(/^[^\n]+/u)
    const line = (m ? m[0] : ab).trim()
    const firstSentence = line.split(/(?<=[.!?])\s+/u)[0]?.trim() ?? line
    const take = firstSentence.length > 0 ? firstSentence : line
    return take.length > 220 ? `${take.slice(0, 217)}…` : take
  }
  if (e.snippets?.length) {
    const s = e.snippets[0]!
    const parts = [s.title, s.body?.trim()].filter(Boolean)
    const line = parts.join(' — ')
    return line.length > 220 ? `${line.slice(0, 217)}…` : line
  }
  if (!e.ok && e.error) return e.error
  return 'No instant summary yet — expand after results arrive or open in browser.'
}

/** True when there is a non-placeholder summary (abstract, snippet, or error line). */
function hasKeyFindingSummary(e: ResearchEntry): boolean {
  if (e.abstract?.trim()) return true
  if (e.snippets && e.snippets.length > 0) return true
  if (!e.ok && e.error?.trim()) return true
  return false
}

function webSearchStatusPill(e: ResearchEntry): string | null {
  if (e.kind !== 'web_search') return null
  if (e.status === 'queued') return 'Queued'
  if (e.status === 'active') return 'Active'
  if (e.status === 'done') return e.ok ? 'Done' : 'Failed'
  /* Legacy rows (no lifecycle field) — treat as finished */
  return e.ok ? 'Done' : 'Failed'
}

function webSearchStatusClass(pill: string): string {
  switch (pill) {
    case 'Queued':
      return 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/35'
    case 'Active':
      return 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/35'
    case 'Done':
      return 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/35'
    case 'Failed':
      return 'bg-red-500/20 text-red-200 ring-1 ring-red-500/35'
    default:
      return 'bg-gray-500/15 text-gray-400'
  }
}

function isResearchPending(e: ResearchEntry): boolean {
  return e.kind === 'web_search' && (e.status === 'queued' || e.status === 'active')
}

function entryRunKey(e: ResearchEntry): string {
  if (e.subAgentTileId) return `sub:${e.subAgentTileId}`
  if (typeof e.runGeneration === 'number') return `run:${e.runGeneration}`
  return 'none'
}

function runHeaderLabel(key: string, _group: ResearchEntry[]): string {
  if (key === 'none') return 'Session'
  if (key.startsWith('sub:')) {
    const id = key.slice(4)
    return `Sub-agent · ${id.slice(0, 8)}…`
  }
  if (key.startsWith('run:')) {
    const n = key.slice(4)
    return `Run #${n} — Orchestrator`
  }
  return key
}

export function ResearchTile({ data: _data }: TileComponentProps) {
  const entries = useResearchSessionStore((s) => s.entries)
  const clear = useResearchSessionStore((s) => s.clear)
  const selectFiltered = useResearchSessionStore((s) => s.selectFiltered)
  const getActiveKinds = useResearchSessionStore((s) => s.getActiveKinds)

  const [tab, setTab] = useState<ResearchTab>('all')
  const [filterText, setFilterText] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [collapsedRuns, setCollapsedRuns] = useState<Set<string>>(new Set())

  const activeKinds = useMemo(() => getActiveKinds(), [entries, getActiveKinds])

  const tabs: { id: ResearchTab; label: string }[] = useMemo(() => {
    const base: { id: ResearchTab; label: string }[] = [{ id: 'all', label: 'All' }]
    for (const k of activeKinds) {
      base.push({ id: k, label: kindLabel(k) })
    }
    return base
  }, [activeKinds])

  useEffect(() => {
    if (tab !== 'all' && !activeKinds.includes(tab as ResearchEntryKind)) {
      setTab('all')
    }
  }, [activeKinds, tab])

  const filtered = useMemo(() => selectFiltered(tab, filterText), [selectFiltered, tab, filterText, entries])

  const grouped = useMemo(() => {
    const map = new Map<string, ResearchEntry[]>()
    for (const e of filtered) {
      const k = entryRunKey(e)
      const list = map.get(k) ?? []
      list.push(e)
      map.set(k, list)
    }
    for (const [, list] of map) {
      list.sort((a, b) => b.ts - a.ts)
    }
    const order = Array.from(map.keys())
    order.sort((a, b) => {
      const rank = (k: string) => {
        if (k === 'none') return 2
        if (k.startsWith('run:')) return 0
        if (k.startsWith('sub:')) return 1
        return 3
      }
      const dr = rank(a) - rank(b)
      if (dr !== 0) return dr
      const maxTs = (key: string) => Math.max(0, ...(map.get(key) ?? []).map((x) => x.ts))
      return maxTs(b) - maxTs(a)
    })
    return { map, order }
  }, [filtered])

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleRunCollapse = useCallback((key: string) => {
    setCollapsedRuns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const copyText = useCallback(async (_label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
  }, [])

  const exportMarkdown = useCallback(() => {
    const lines: string[] = ['# Research session', '']
    for (const key of grouped.order) {
      const group = grouped.map.get(key) ?? []
      lines.push(`## ${runHeaderLabel(key, group)}`, '')
      for (const e of group) {
        lines.push(`### ${kindLabel(e.kind)} — ${e.query}`, '')
        if (e.abstract) lines.push(e.abstract, '')
        if (e.snippets?.length) {
          for (const s of e.snippets) {
            lines.push(`#### ${s.title}`, '', s.body, '')
            if (s.url) lines.push(`Source: ${s.url}`, '')
          }
        }
        if (!e.ok && e.error) lines.push(`_Error: ${e.error}_`, '')
        lines.push('---', '')
      }
    }
    const md = lines.join('\n')
    void copyText('export', md)
    try {
      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `research-session-${Date.now()}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }, [grouped, copyText])

  const stats = useMemo(() => {
    const settled = entries.filter((e) => !isResearchPending(e))
    const pending = entries.length - settled.length
    const ok = settled.filter((e) => e.ok).length
    const fail = settled.length - ok
    return { ok, fail, pending, total: entries.length }
  }, [entries])

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-depth-raised/95 text-left text-gray-200">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-tile-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-300/90">Research</span>
          {stats.total > 0 && (
            <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-200">
              {stats.total}
            </span>
          )}
        </div>
        <button
          type="button"
          className="rounded-md border border-tile-border/80 px-2 py-1 text-[11px] text-gray-400 hover:bg-white/5 hover:text-gray-200"
          onClick={() => clear()}
        >
          Clear
        </button>
      </div>

      <div className="shrink-0 border-b border-tile-border/40 px-3 py-2">
        <input
          type="search"
          data-research-filter="true"
          placeholder="Filter queries, answers, snippets…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full rounded-md border border-tile-border/60 bg-canvas-bg/90 px-2 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:border-indigo-500/50 focus:outline-none"
        />
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-tile-border/40 px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium ${
              tab === t.id
                ? 'bg-indigo-500/25 text-indigo-100'
                : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-gray-500">
            No entries yet. Web searches and library doc queries from the orchestrator appear here.
          </p>
        ) : (
          grouped.order.map((runKey) => {
            const groupEntries = grouped.map.get(runKey) ?? []
            const collapsed = collapsedRuns.has(runKey)
            return (
              <div key={runKey} className="mb-3">
                <button
                  type="button"
                  className="mb-1 flex w-full items-center justify-between rounded-md bg-white/5 px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-gray-400 hover:bg-white/10"
                  onClick={() => toggleRunCollapse(runKey)}
                >
                  <span>{runHeaderLabel(runKey, groupEntries)}</span>
                  <span className="text-gray-600">{collapsed ? '▸' : '▾'}</span>
                </button>
                {!collapsed &&
                  groupEntries.map((e) => {
                    const expanded = expandedIds.has(e.id)
                    const statusPill = webSearchStatusPill(e)
                    const hasDetail =
                      isResearchPending(e) ||
                      Boolean(e.abstract?.trim()) ||
                      Boolean(e.snippets?.length) ||
                      Boolean(e.related?.length) ||
                      Boolean(e.error) ||
                      (e.kind === 'web_search' &&
                        e.status === 'done' &&
                        e.ok &&
                        !e.abstract?.trim() &&
                        !e.snippets?.length)
                    return (
                      <div
                        key={e.id}
                        className="mb-2 rounded-lg border border-tile-border/50 bg-canvas-bg/80 p-2.5 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-200">
                                {kindLabel(e.kind)}
                              </span>
                              {statusPill && (
                                <span
                                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${webSearchStatusClass(statusPill)}`}
                                >
                                  {statusPill}
                                </span>
                              )}
                              {e.provider && (
                                <span className="text-[10px] text-gray-500">{e.provider}</span>
                              )}
                              {e.source && (
                                <span className="truncate text-[10px] text-gray-500">{e.source}</span>
                              )}
                              <span className="text-[10px] text-gray-600">{formatTime(e.ts)}</span>
                            </div>
                            <div className="mt-1 break-words text-sm font-semibold text-gray-100">{e.query}</div>
                            {hasKeyFindingSummary(e) && (
                              <>
                                <div className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                  Key finding
                                </div>
                                <p className="mt-0.5 line-clamp-3 text-xs leading-relaxed text-gray-300">
                                  {keyFindingLine(e)}
                                </p>
                              </>
                            )}
                            {e.subAgentTileId && (
                              <div className="mt-0.5 text-[10px] text-cyan-400/90">
                                Sub-agent tile: {e.subAgentTileId.slice(0, 10)}…
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-white/10 hover:text-gray-300"
                              onClick={() => toggleExpand(e.id)}
                              disabled={!hasDetail}
                              data-tooltip={!hasDetail ? 'No extra detail yet' : expanded ? 'Show less' : 'Show full answer and sources'}
                            >
                              {expanded ? 'Less' : 'More'}
                            </button>
                          </div>
                        </div>
                        {expanded && (
                          <div className="mt-2 space-y-2 text-xs">
                            {isResearchPending(e) && (
                              <p className="text-gray-400">
                                {e.status === 'queued'
                                  ? 'This search is queued and will start after earlier tools in the same batch complete.'
                                  : 'DuckDuckGo instant answer is loading…'}
                              </p>
                            )}
                            {e.abstract && (
                              <p className="whitespace-pre-wrap text-gray-300">{e.abstract}</p>
                            )}
                            {!isResearchPending(e) &&
                              !e.abstract?.trim() &&
                              !e.snippets?.length &&
                              !e.error &&
                              e.ok && (
                                <p className="text-gray-500">
                                  No abstract returned — try &quot;Open in browser&quot; below to verify results.
                                </p>
                              )}
                            {e.snippets?.map((s, i) => (
                              <div key={i} className="rounded-md border border-tile-border/40 bg-black/20 p-2">
                                <div className="text-[10px] font-semibold text-gray-500">{s.title}</div>
                                <div className="mt-1 whitespace-pre-wrap text-gray-300">{s.body}</div>
                                {s.url && (
                                  <a
                                    href={s.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-1 inline-block text-[10px] text-indigo-400 hover:underline"
                                  >
                                    Open link
                                  </a>
                                )}
                              </div>
                            ))}
                            {e.related && e.related.length > 0 && (
                              <div className="text-[11px] text-gray-500">
                                <span className="font-medium text-gray-400">Related:</span>{' '}
                                {e.related.join(' · ')}
                              </div>
                            )}
                            {!e.ok && e.error && <p className="text-red-300/90">{e.error}</p>}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1 border-t border-tile-border/30 pt-2">
                          <button
                            type="button"
                            className="rounded-md border border-tile-border/50 px-2 py-1 text-[10px] text-gray-400 hover:bg-white/5"
                            onClick={() => {
                              const u = `https://duckduckgo.com/?q=${encodeURIComponent(e.query)}`
                              window.open(u, '_blank', 'noopener,noreferrer')
                            }}
                          >
                            Open in browser
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-tile-border/50 px-2 py-1 text-[10px] text-gray-400 hover:bg-white/5"
                            onClick={() => void copyText('query', e.query)}
                          >
                            Copy query
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-tile-border/50 px-2 py-1 text-[10px] text-gray-400 hover:bg-white/5"
                            onClick={() =>
                              void copyText(
                                'answer',
                                e.abstract ?? e.snippets?.map((s) => s.body).join('\n\n') ?? ''
                              )
                            }
                          >
                            Copy answer
                          </button>
                        </div>
                      </div>
                    )
                  })}
              </div>
            )
          })
        )}
      </div>

      <div className="shrink-0 border-t border-tile-border/50 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500">
          <span>
            {stats.total} total
            {stats.pending > 0 ? ` · ${stats.pending} in flight` : ''} · {stats.ok} ok · {stats.fail} failed
          </span>
          <button
            type="button"
            className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[11px] font-medium text-indigo-200 hover:bg-indigo-500/20"
            onClick={exportMarkdown}
          >
            Export Markdown
          </button>
        </div>
      </div>
    </div>
  )
}

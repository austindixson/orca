import { useEffect, useMemo, useRef, useState } from 'react'
import {
  hermesTelemetryLinePrefixForTile,
  useHermesTelemetryStore,
} from '../../store/hermesTelemetryStore'
import {
  type TelemetryRecord,
  useUnifiedTelemetryStore,
  clearUnifiedTelemetry,
} from '../../store/unifiedTelemetryStore'
import { exportUnifiedTelemetryCsv } from '../../lib/telemetry/exportUnifiedTelemetryCsv'
import { buildTelemetrySettingsJson } from '../../lib/telemetry/settingsTelemetrySnapshot'

type SidebarTab = 'all' | 'errors' | 'trace' | 'reasoning' | 'output' | 'hermes'

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'errors', label: 'Errors' },
  { id: 'trace', label: 'Trace' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'output', label: 'Output' },
  { id: 'hermes', label: 'Hermes' },
]

function formatTs(ms: number): string {
  try {
    const d = new Date(ms)
    return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
  } catch {
    return '—'
  }
}

function formatRecordForClipboard(r: TelemetryRecord): string {
  let s = `${formatTs(r.tsMs)} [${r.source}/${r.category}]`
  if (r.level) s += ` · ${r.level}`
  if (r.title) s += `\n${r.title}`
  s += `\n${r.text}`
  if (r.payloadJson) s += `\n${r.payloadJson}`
  return s
}

function matchesTab(rec: TelemetryRecord, tab: SidebarTab): boolean {
  switch (tab) {
    case 'all':
      return true
    case 'errors':
      return rec.category === 'error'
    case 'trace':
      return rec.category === 'trace'
    case 'reasoning':
      return rec.category === 'reasoning'
    case 'output':
      return rec.category === 'output' || rec.category === 'log'
    case 'hermes':
      return rec.source === 'hermes'
    default:
      return true
  }
}

/**
 * Unified telemetry + legacy Hermes raw SSE (left sidebar).
 */
export function HermesTelemetrySidebarPanel() {
  const lines = useHermesTelemetryStore((s) => s.lines)
  const focusTileId = useHermesTelemetryStore((s) => s.focusTileId)
  const setFocusTileId = useHermesTelemetryStore((s) => s.setFocusTileId)
  const clearHermes = useHermesTelemetryStore((s) => s.clear)
  const records = useUnifiedTelemetryStore((s) => s.records)

  const [tab, setTab] = useState<SidebarTab>('all')
  const [search, setSearch] = useState('')
  const [copyFlash, setCopyFlash] = useState(false)
  const [copiedRowKey, setCopiedRowKey] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const hermesScrollRef = useRef<HTMLDivElement>(null)

  const displayLines = useMemo(() => {
    if (!focusTileId) return lines
    const prefix = hermesTelemetryLinePrefixForTile(focusTileId)
    return lines.filter((l) => l.includes(prefix))
  }, [lines, focusTileId])

  const hermesText = displayLines.join('\n')

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = records.filter((r) => matchesTab(r, tab))
    if (!q) return list
    return list.filter((r) => {
      const blob = `${r.source} ${r.category} ${r.title ?? ''} ${r.text} ${r.payloadJson ?? ''}`.toLowerCase()
      return blob.includes(q)
    })
  }, [records, tab, search])

  useEffect(() => {
    if (scrollRef.current && tab !== 'hermes') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filteredRecords, tab])

  useEffect(() => {
    if (hermesScrollRef.current && tab === 'hermes') {
      hermesScrollRef.current.scrollTop = hermesScrollRef.current.scrollHeight
    }
  }, [displayLines, tab])

  const onCopy = async () => {
    if (tab === 'hermes') {
      if (!hermesText.trim()) return
      try {
        await navigator.clipboard.writeText(hermesText)
        setCopyFlash(true)
        window.setTimeout(() => setCopyFlash(false), 2000)
      } catch {
        /* ignore */
      }
      return
    }
    const text = filteredRecords
      .map((r) => `${formatTs(r.tsMs)} [${r.source}/${r.category}] ${r.title ? r.title + ' — ' : ''}${r.text}`)
      .join('\n')
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(text)
      setCopyFlash(true)
      window.setTimeout(() => setCopyFlash(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const onClear = () => {
    clearUnifiedTelemetry()
    clearHermes()
  }

  const onExportCsv = () => {
    exportUnifiedTelemetryCsv(filteredRecords, undefined, {
      settingsJson: buildTelemetrySettingsJson(),
    })
  }

  const copyOneRecord = async (r: TelemetryRecord) => {
    try {
      await navigator.clipboard.writeText(formatRecordForClipboard(r))
      setCopiedRowKey(`rec:${r.id}`)
      window.setTimeout(() => setCopiedRowKey(null), 2000)
    } catch {
      /* ignore */
    }
  }

  const copyHermesLine = async (line: string, lineKey: string) => {
    try {
      await navigator.clipboard.writeText(line)
      setCopiedRowKey(lineKey)
      window.setTimeout(() => setCopiedRowKey(null), 2000)
    } catch {
      /* ignore */
    }
  }

  const canCopy =
    tab === 'hermes' ? Boolean(hermesText.trim()) : filteredRecords.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-tile-bg/60 text-gray-300 backdrop-blur-xl">
      <div className="shrink-0 border-b border-tile-border/80 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-teal-200/90">Telemetry</div>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          Errors, traces, orchestrator output, terminals, and raw Hermes SSE — unified ring buffer.
        </p>

        <div className="mt-2 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                tab === t.id
                  ? 'rounded-md border border-teal-500/50 bg-teal-600/25 px-2 py-0.5 text-[10px] font-medium text-teal-100'
                  : 'rounded-md border border-transparent px-2 py-0.5 text-[10px] text-gray-500 hover:bg-white/5 hover:text-gray-300'
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="mt-2 w-full rounded border border-tile-border/60 bg-black/30 px-2 py-1 text-[11px] text-gray-200 placeholder:text-gray-600"
        />

        {focusTileId ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-teal-500/35 bg-teal-950/40 px-2 py-1.5 text-[10px] text-teal-100/90">
            <span>
              Hermes filter: tile <code className="font-mono text-teal-200/95">{focusTileId.slice(0, 8)}</code>
            </span>
            <button
              type="button"
              onClick={() => setFocusTileId(null)}
              className="rounded border border-teal-500/40 px-1.5 py-0.5 text-[10px] hover:bg-teal-900/50"
            >
              Show all tiles
            </button>
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => void onCopy()}
            disabled={!canCopy}
            className="rounded-md border border-teal-500/30 bg-teal-600/20 px-2.5 py-1 text-[11px] font-medium text-teal-100/95 hover:bg-teal-600/35 disabled:opacity-35"
          >
            {copyFlash ? 'Copied' : 'Copy all'}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={!records.length && !lines.length}
            className="rounded-md border border-tile-border/60 px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-35"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onExportCsv}
            disabled={!filteredRecords.length}
            className="rounded-md border border-amber-500/35 bg-amber-900/20 px-2 py-1 text-[11px] text-amber-100/90 hover:bg-amber-900/35 disabled:opacity-35"
          >
            Export CSV
          </button>
        </div>
      </div>

      {tab === 'hermes' ? (
        <div
          ref={hermesScrollRef}
          className="min-h-0 flex-1 overflow-auto bg-black/25 px-2 py-2 font-mono text-[10px] leading-snug text-gray-300/95"
        >
          {displayLines.length === 0 ? (
            <p className="text-[11px] text-gray-500">
              {focusTileId
                ? 'No Hermes telemetry lines for this tile yet.'
                : 'Send a message from a Hermes agent tile. Streamed events appear here.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {displayLines.map((line, i) => {
                const lineKey = `hermes:${i}`
                return (
                  <li
                    key={lineKey}
                    className="group flex items-start gap-1.5 rounded border border-tile-border/30 bg-black/30 px-1.5 py-1"
                  >
                    <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words">{line}</pre>
                    <button
                      type="button"
                      onClick={() => void copyHermesLine(line, lineKey)}
                      className="shrink-0 rounded border border-teal-500/35 bg-teal-900/30 px-1.5 py-0.5 text-[9px] font-medium text-teal-100/90 opacity-80 hover:opacity-100"
                      data-tooltip="Copy this line"
                    >
                      {copiedRowKey === lineKey ? 'Copied' : 'Copy'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-black/25 px-2 py-2">
          {filteredRecords.length === 0 ? (
            <p className="text-[11px] text-gray-500">No rows for this tab yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {filteredRecords.map((r) => (
                <li
                  key={r.id}
                  className="rounded border border-tile-border/40 bg-black/20 px-2 py-1.5 text-[10px] leading-snug"
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setExpandedId((x) => (x === r.id ? null : r.id))}
                    >
                      <span className="font-mono text-gray-500">{formatTs(r.tsMs)}</span>{' '}
                      <span className="text-teal-300/90">{r.source}</span>
                      <span className="text-gray-600"> / </span>
                      <span className="text-amber-200/80">{r.category}</span>
                      {r.level ? (
                        <>
                          <span className="text-gray-600"> · </span>
                          <span className="text-gray-400">{r.level}</span>
                        </>
                      ) : null}
                      {r.title ? (
                        <div className="mt-0.5 font-medium text-gray-200">{r.title}</div>
                      ) : null}
                      <div className="mt-0.5 whitespace-pre-wrap break-words text-gray-300/95">
                        {r.text.length > 400 && expandedId !== r.id ? `${r.text.slice(0, 400)}…` : r.text}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void copyOneRecord(r)
                      }}
                      className="shrink-0 rounded border border-teal-500/35 bg-teal-900/30 px-1.5 py-0.5 text-[9px] font-medium text-teal-100/90 hover:bg-teal-900/45"
                      data-tooltip="Copy this entry"
                    >
                      {copiedRowKey === `rec:${r.id}` ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  {expandedId === r.id && r.payloadJson ? (
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/40 p-1.5 text-[9px] text-gray-400">
                      {r.payloadJson}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

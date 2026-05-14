import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useCanvasStore } from '../../store/canvasStore'

type TraceTab = 'logs' | 'roster'

const TAB_STYLE = (active: boolean) =>
  clsx(
    'rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition',
    active ? 'bg-[#1a2330] text-[#e8a632]' : 'text-[#6a737c] hover:bg-[#14181f] hover:text-[#c8cdd3]'
  )

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'working':
      return 'bg-[#1a2a38] text-[#5eb3e8]'
    case 'done':
      return 'bg-[#1a3328] text-[#5ecf7a]'
    case 'error':
      return 'bg-[#3a1a1a] text-[#f0a0a0]'
    default:
      return 'bg-[#1a1f26] text-[#6a737c]'
  }
}

export function SubAgentTelemetryTrace({ className }: { className?: string }) {
  const [tab, setTab] = useState<TraceTab>('logs')
  const membersByTileId = useAgentTeamStore((s) => s.membersByTileId)
  const tiles = useCanvasStore((s) => s.tiles)

  const rows = useMemo(() => {
    const list = Object.values(membersByTileId)
    return list
      .map((m) => {
        const t = tiles.get(m.tileId)
        const headerTitle = t?.title && t.title !== 'Agent' ? t.title : m.displayName
        return { ...m, headerTitle }
      })
      .sort((a, b) => a.headerTitle.localeCompare(b.headerTitle))
  }, [membersByTileId, tiles])

  const workingCount = useMemo(() => rows.filter((m) => m.status === 'working').length, [rows])
  const totalLogs = useMemo(() => rows.reduce((n, m) => n + m.logTail.length, 0), [rows])

  const mergedLogs = useMemo(() => {
    if (rows.length === 0) return ''
    const parts: string[] = []
    for (const m of rows) {
      const model =
        m.executionModelLabel != null
          ? ` · ${m.executionModelLabel}${m.executionModelIsFree ? ' (free)' : ''}`
          : ''
      parts.push(`── ${m.headerTitle} · ${m.role} [${m.status}]${model} ──\n`)
      parts.push(m.logTail.length ? m.logTail.join('') : '(no lines yet)\n')
      parts.push('\n')
    }
    return parts.join('').trimEnd()
  }, [rows])

  const logsRef = useRef<HTMLPreElement>(null)
  const rosterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = tab === 'logs' ? logsRef.current : rosterRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mergedLogs, rows, tab])

  const copyTab = useCallback(async () => {
    let text = ''
    if (tab === 'logs') text = mergedLogs
    else {
      text = rows
        .map((m) => {
          const bits = [
            `${m.headerTitle} (${m.role})`,
            `status=${m.status}`,
            m.currentTask ? `task=${m.currentTask}` : null,
            m.executionModelLabel ? `model=${m.executionModelLabel}` : null,
            m.error ? `error=${m.error}` : null,
            m.lastSummary && m.status === 'done' ? `summary=${m.lastSummary.slice(0, 500)}` : null,
          ].filter(Boolean)
          return bits.join(' · ')
        })
        .join('\n')
    }
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
  }, [tab, mergedLogs, rows])

  const summaryLabel =
    rows.length === 0
      ? 'No delegated runs yet'
      : workingCount > 0
        ? `${workingCount} running · ${rows.length} total`
        : `${rows.length} in roster`

  return (
    <div
      className={clsx(
        'flex min-h-[min(260px,36vh)] max-h-[min(520px,52vh)] shrink-0 flex-col overflow-hidden border border-[#1a1f26] bg-[#0a0c0e]/90',
        className
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#1a1f26] px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#5c6570]">Sub-agents</span>
          <span
            className={clsx(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
              workingCount > 0 ? 'bg-[#1a2a38] text-[#5eb3e8]' : 'bg-[#1a1f26] text-[#6a737c]'
            )}
          >
            {workingCount > 0 ? `${workingCount} active` : 'none active'}
          </span>
          <span className="truncate text-[11px] text-[#5c6570]" data-tooltip={summaryLabel}>
            {summaryLabel}. Logs from <code className="text-[#9aa0a6]">spawn_sub_agent</code> / agent team store.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded border border-[#2a3238] bg-[#08090b] p-0.5">
            <button type="button" className={TAB_STYLE(tab === 'logs')} onClick={() => setTab('logs')}>
              Logs ({totalLogs})
            </button>
            <button type="button" className={TAB_STYLE(tab === 'roster')} onClick={() => setTab('roster')}>
              Roster ({rows.length})
            </button>
          </div>
          <button
            type="button"
            onClick={() => void copyTab()}
            className="rounded border border-[#2a3238] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#9aa0a6] hover:border-[#e8a632]/40 hover:text-[#e8a632]"
          >
            Copy
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'logs' && (
          <pre
            ref={logsRef}
            className="h-full overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-[#c8cdd3]"
          >
            {rows.length === 0 ? (
              <span className="text-[#5c6570]">
                No sub-agent logs yet. When the orchestrator calls{' '}
                <code className="text-[#9aa0a6]">spawn_sub_agent</code>, transcript lines and routing appear here
                (same source as agent tiles).
              </span>
            ) : (
              mergedLogs
            )}
          </pre>
        )}
        {tab === 'roster' && (
          <div ref={rosterRef} className="h-full overflow-auto p-3">
            {rows.length === 0 ? (
              <p className="text-[12px] text-[#5c6570]">No sub-agents registered.</p>
            ) : (
              <ul className="space-y-3">
                {rows.map((m) => (
                  <li
                    key={m.tileId}
                    className="rounded border border-[#1a1f26] border-l-4 border-l-[#3ecf8e]/80 bg-[#08090b]/90 pl-3 pr-2 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[11px] text-[#c8cdd3]">{m.headerTitle}</div>
                        <div className="truncate text-[10px] text-[#5c6570]">{m.role}</div>
                      </div>
                      <span
                        className={clsx(
                          'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                          statusBadgeClass(m.status)
                        )}
                      >
                        {m.status}
                      </span>
                    </div>
                    {m.executionModelLabel ? (
                      <div className="mt-1 text-[10px] text-[#5eb3e8]/90">
                        Model: {m.executionModelLabel}
                        {m.executionModelIsFree ? ' · free tier' : ''}
                      </div>
                    ) : null}
                    <div className="mt-1 text-[11px] leading-snug text-[#9aa0a6]">{m.currentTask}</div>
                    {m.error ? (
                      <div className="mt-1 text-[10px] text-[#f0a0a0]">{m.error}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

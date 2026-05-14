import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  clearTelemetryEvents,
  downloadTelemetryCsvExport,
  downloadTelemetryZipBySession,
  fetchTelemetryEvents,
  fetchTelemetryHealth,
  fetchTelemetrySessions,
  type DevTelemetryEvent,
  type DevTelemetrySessionSummary,
  openTelemetryEventStream,
} from '../../lib/devTelemetryApi'
import { SubAgentTelemetryTrace } from './SubAgentTelemetryTrace'
import { getUnifiedTelemetryRecords } from '../../store/unifiedTelemetryStore'
import { exportUnifiedTelemetryCsv } from '../../lib/telemetry/exportUnifiedTelemetryCsv'
import { buildTelemetrySettingsJson } from '../../lib/telemetry/settingsTelemetrySnapshot'

export type DevTelemetryDashboardPreset = 'all' | 'errors' | 'trace_reasoning' | 'agent_output'

function matchesDashboardPreset(ev: DevTelemetryEvent, preset: DevTelemetryDashboardPreset): boolean {
  if (preset === 'all') return true
  if (preset === 'errors') {
    if (ev.level === 'error') return true
    if (/error/i.test(ev.kind)) return true
    const line = ev.payload?.line
    if (typeof line === 'string' && /error|failed|exception/i.test(line)) return true
    return false
  }
  if (preset === 'trace_reasoning') {
    if (ev.kind === 'orchestrator_trace') return true
    if (/trace|reasoning|thinking/i.test(ev.kind)) return true
    return false
  }
  if (preset === 'agent_output') {
    if (ev.kind === 'log') return true
    if (ev.source === 'orchestrator_ui') return true
    if (/^llm|^tool|assistant|message/i.test(ev.kind)) return true
    return false
  }
  return true
}

function kindBorderClass(kind: string): string {
  const k = kind.toLowerCase()
  if (k.includes('error')) return 'border-l-[#e85d5d]'
  if (k.startsWith('llm')) return 'border-l-[#5eb3e8]'
  if (k.includes('tool')) return 'border-l-[#3ecf8e]'
  return 'border-l-[#e8a632]'
}

function payloadPreview(ev: DevTelemetryEvent): string {
  if (ev.kind === 'orchestrator_trace' && ev.payload && typeof ev.payload === 'object') {
    const p = ev.payload as Record<string, unknown>
    const tLen = typeof p.trace === 'string' ? p.trace.length : 0
    const rLen = typeof p.reasoning === 'string' ? p.reasoning.length : 0
    const thLen = typeof p.thinking === 'string' ? p.thinking.length : 0
    return `trace ${tLen}ch · reasoning ${rLen}ch · thinking ${thLen}ch · entries ${String(p.entryCount ?? '—')}`
  }
  const line = ev.payload?.line
  if (typeof line === 'string') return line
  try {
    return JSON.stringify(ev.payload, null, 0).slice(0, 240)
  } catch {
    return '…'
  }
}

function formatTelemetryEventsAsCopyText(events: DevTelemetryEvent[]): string {
  const parts: string[] = []
  for (const ev of events) {
    parts.push(`════════ ${ev.ts} · ${ev.kind} · session ${ev.sessionId ?? '—'} ════════`)
    if (ev.source) parts.push(`source: ${ev.source}`)
    if (ev.provider) parts.push(`provider: ${ev.provider}`)
    if (ev.model) parts.push(`model: ${ev.model}`)
    parts.push(formatJson(ev.payload))
    parts.push('')
  }
  return parts.join('\n').trimEnd()
}

function downloadClientJsonl(events: DevTelemetryEvent[], baseFileName: string) {
  const safe = baseFileName.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 120) || 'telemetry-view'
  const body = events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '')
  const blob = new Blob([body], { type: 'application/x-ndjson;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.jsonl`
    a.rel = 'noopener'
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

export function DevTelemetryDashboard({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<DevTelemetryEvent[]>([])
  const [sessions, setSessions] = useState<DevTelemetrySessionSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [healthOk, setHealthOk] = useState<boolean | null>(null)
  const [healthStats, setHealthStats] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [live, setLive] = useState(true)
  const [filterKind, setFilterKind] = useState('')
  const [filterSession, setFilterSession] = useState('')
  const [filterProvider, setFilterProvider] = useState('')
  const [searchText, setSearchText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tokenDraft, setTokenDraft] = useState('')
  const [apiRootDraft, setApiRootDraft] = useState('')
  const [copyAllFlash, setCopyAllFlash] = useState(false)
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [dashboardPreset, setDashboardPreset] = useState<DevTelemetryDashboardPreset>('all')
  const seenIds = useRef(new Set<string>())

  useEffect(() => {
    try {
      setAuthToken(sessionStorage.getItem('devTelemetry.token'))
    } catch {
      setAuthToken(null)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const h = await fetchTelemetryHealth()
      setHealthOk(h.ok === true)
      setHealthStats((h.stats as Record<string, unknown>) ?? null)
      const [evRes, sessRes] = await Promise.all([
        fetchTelemetryEvents({
          limit: filterSession.trim() ? 10_000 : 800,
          kind: filterKind.trim() || undefined,
          sessionId: filterSession.trim() || undefined,
          provider: filterProvider.trim() || undefined,
          token: authToken,
        }),
        fetchTelemetrySessions(authToken),
      ])
      setEvents(evRes.events)
      setSessions(sessRes.sessions)
      seenIds.current = new Set(evRes.events.map((e) => e.id))
    } catch (e) {
      setHealthOk(false)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [filterKind, filterSession, filterProvider, authToken])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!live) return
    let es: EventSource | null = null
    try {
      es = openTelemetryEventStream({ token: authToken })
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as { type?: string; event?: DevTelemetryEvent; stats?: unknown }
          if (data.type === 'hello') {
            if (data.stats && typeof data.stats === 'object') {
              setHealthStats(data.stats as Record<string, unknown>)
            }
            return
          }
          if (data.type === 'event' && data.event) {
            const ev = data.event
            if (seenIds.current.has(ev.id)) return
            seenIds.current.add(ev.id)
            setEvents((prev) => [...prev.slice(-1500), ev])
          }
        } catch {
          /* ignore */
        }
      }
      es.onerror = () => {
        setHealthOk(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SSE failed')
    }
    return () => {
      es?.close()
    }
  }, [live, authToken])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    const base = !q
      ? events
      : events.filter((ev) => {
          const blob = `${ev.kind} ${ev.source ?? ''} ${ev.sessionId ?? ''} ${formatJson(ev.payload)}`.toLowerCase()
          return blob.includes(q)
        })
    return base.filter((ev) => matchesDashboardPreset(ev, dashboardPreset))
  }, [events, searchText, dashboardPreset])

  const selected = filtered.find((e) => e.id === selectedId) ?? null

  const handleClear = async () => {
    if (!window.confirm('Clear all telemetry events on the server?')) return
    try {
      await clearTelemetryEvents(authToken)
      seenIds.current.clear()
      setEvents([])
      setSelectedId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleExportCsv = async () => {
    setError(null)
    try {
      const sid = filterSession.trim()
      await downloadTelemetryCsvExport({
        token: authToken,
        sessionId: sid || undefined,
        filename: sid
          ? `telemetry-${sid.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80)}.csv`
          : 'telemetry-export.csv',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleExportAllUnifiedCsv = () => {
    setError(null)
    try {
      exportUnifiedTelemetryCsv(getUnifiedTelemetryRecords(), undefined, {
        settingsJson: buildTelemetrySettingsJson(),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleCopyAllVisible = async () => {
    const text = formatTelemetryEventsAsCopyText(filtered)
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(text)
      setCopyAllFlash(true)
      window.setTimeout(() => setCopyAllFlash(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleExportViewJsonl = () => {
    setError(null)
    try {
      const sid = filterSession.trim()
      const base =
        sid ||
        `view-${filterKind.trim() || 'all'}-${filterProvider.trim() || 'any'}-${filtered.length}-events`
      downloadClientJsonl(filtered, base)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleExportZip = async () => {
    setError(null)
    try {
      await downloadTelemetryZipBySession({ token: authToken })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const saveSettings = () => {
    try {
      if (tokenDraft.trim()) sessionStorage.setItem('devTelemetry.token', tokenDraft.trim())
      else sessionStorage.removeItem('devTelemetry.token')
      if (apiRootDraft.trim()) sessionStorage.setItem('devTelemetry.apiRoot', apiRootDraft.trim())
      else sessionStorage.removeItem('devTelemetry.apiRoot')
      setAuthToken(tokenDraft.trim() || null)
    } catch {
      /* */
    }
    setSettingsOpen(false)
    void load()
  }

  return (
    <div
      className="telemetry-dashboard fixed inset-0 z-[500] flex flex-col overflow-hidden pt-8 text-[13px]"
      style={{
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        background:
          'radial-gradient(1200px 800px at 10% -10%, rgba(232,166,50,0.08) 0%, transparent 55%), radial-gradient(900px 600px at 90% 0%, rgba(94,179,232,0.06) 0%, transparent 50%), #070809',
        color: '#c8cdd3',
      }}
    >
      {/* subtle grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      <header className="relative flex shrink-0 items-center justify-between gap-4 border-b border-[#1a1f26] bg-[#0c0e11]/90 px-10 py-5 backdrop-blur-md">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1
            className="truncate text-2xl font-black tracking-tight text-[#f0e6d8]"
            style={{ fontFamily: "'Syne', system-ui, sans-serif" }}
          >
            Signal Lab
          </h1>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#5c6570]">
            Dev telemetry · live orchestrator trace · server events · models
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div
            className={clsx(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider',
              healthOk
                ? 'border-[#2a4a38] bg-[#0f1812] text-[#5ecf7a]'
                : healthOk === false
                  ? 'border-[#4a2a2a] bg-[#180f0f] text-[#f0a0a0]'
                  : 'border-[#2a3238] bg-[#111418] text-[#6a737c]'
            )}
          >
            <span className={clsx('h-2 w-2 rounded-full', healthOk ? 'bg-[#3ecf8e] shadow-[0_0_0_0.6rem_rgba(62,207,142,0.12)]' : 'bg-[#555]')} />
            {healthOk ? 'server live' : healthOk === false ? 'offline' : '…'}
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-[#2a3238] bg-[#0f1114] px-3 py-1.5 text-[11px] text-[#9aa0a6]">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
              className="accent-[#e8a632]"
            />
            Live stream
          </label>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-full border border-[#2a3238] bg-[#12151a] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#c8cdd3] transition hover:border-[#e8a632]/50 hover:text-[#f0e6d8] disabled:opacity-50"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={() => void handleCopyAllVisible()}
            disabled={filtered.length === 0}
            data-tooltip="Copy every event in the current table (after kind/session/provider/search filters), full JSON payloads"
            className="rounded-full border border-[#2a3238] bg-[#12151a] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#c8cdd3] transition hover:border-[#e8a632]/50 hover:text-[#f0e6d8] disabled:opacity-40"
          >
            {copyAllFlash ? 'Copied' : 'Copy all'}
          </button>

          <button
            type="button"
            onClick={handleExportAllUnifiedCsv}
            data-tooltip="Client ring buffer: every unified row (errors, traces, output, console) as one RFC 4180 CSV"
            className="rounded-full border border-[#e8a632]/45 bg-[#1a160f] px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-[#f0e6d8] shadow-[0_0_0_1px_rgba(232,166,50,0.12)] transition hover:border-[#e8a632]/70"
          >
            Export ALL as CSV
          </button>

          <button
            type="button"
            onClick={() => void handleExportCsv()}
            data-tooltip={
              filterSession.trim()
                ? 'Server SQLite export for this session (full history)'
                : 'Server SQLite export — all rows; use Session filter to scope'
            }
            className="rounded-full border border-[#2a3238] bg-[#12151a] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#c8cdd3] transition hover:border-[#3ecf8e]/50 hover:text-[#f0e6d8]"
          >
            Server CSV
          </button>

          <button
            type="button"
            onClick={() => handleExportViewJsonl()}
            disabled={filtered.length === 0}
            data-tooltip="Download exactly the events shown in the table (JSON Lines — includes orchestrator trace / reasoning / thinking payloads)"
            className="rounded-full border border-[#2a3238] bg-[#12151a] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#c8cdd3] transition hover:border-[#5ecf9a]/50 hover:text-[#f0e6d8] disabled:opacity-40"
          >
            Export view JSONL
          </button>

          <button
            type="button"
            onClick={() => void handleExportZip()}
            data-tooltip="ZIP: one CSV per session_id, plus no-session.csv if needed"
            className="rounded-full border border-[#2a3238] bg-[#12151a] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#c8cdd3] transition hover:border-[#5eb3e8]/50 hover:text-[#f0e6d8]"
          >
            Export ZIP
          </button>

          <button
            type="button"
            onClick={() => {
              setTokenDraft(sessionStorage.getItem('devTelemetry.token') ?? '')
              setApiRootDraft(sessionStorage.getItem('devTelemetry.apiRoot') ?? '')
              setSettingsOpen(true)
            }}
            className="rounded-full border border-[#2a3238] bg-[#12151a] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#c8cdd3] transition hover:border-[#5eb3e8]/50"
          >
            Connection
          </button>

          <button
            type="button"
            onClick={() => void handleClear()}
            className="rounded-full border border-[#3a2a26] bg-[#181210] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#d4a090] transition hover:border-[#e85d5d]/60"
          >
            Clear server
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#2a3238] bg-[#12151a] px-5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#e8a632] transition hover:bg-[#1a160f]"
          >
            Close
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div
          className="absolute inset-0 z-[510] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Telemetry connection"
        >
          <div
            className="w-full max-w-lg border border-[#2a3238] bg-[#0c0e11] p-8 shadow-[0_0_0_1px_rgba(232,166,50,0.08),0_24px_80px_rgba(0,0,0,0.65)]"
            style={{ fontFamily: "'IBM Plex Mono', monospace" }}
          >
            <h2 className="mb-2 text-lg font-bold text-[#f0e6d8]" style={{ fontFamily: "'Syne', sans-serif" }}>
              Connection
            </h2>
            <p className="mb-6 text-[12px] leading-relaxed text-[#7a8288]">
              Optional API root (telemetry defaults to{' '}
              <code className="text-[#e8a632]">http://127.0.0.1:3002</code> — run{' '}
              <code className="text-[#9aa0a6]">npm run dev:telemetry:node</code> or full{' '}
              <code className="text-[#9aa0a6]">npm run dev</code>). Vite dev proxies{' '}
              <code className="text-[#5eb3e8]">/api/dev/telemetry</code> to that port. Bearer token if{' '}
              <code className="text-[#9aa0a6]">DEV_TELEMETRY_TOKEN</code> is set on the server.
            </p>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[#5c6570]">API root</label>
            <input
              value={apiRootDraft}
              onChange={(e) => setApiRootDraft(e.target.value)}
              placeholder="(empty = default)"
              className="mb-4 w-full border border-[#2a3238] bg-[#08090b] px-3 py-2 text-[12px] text-[#c8cdd3] outline-none focus:border-[#e8a632]/50"
            />
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[#5c6570]">Bearer token</label>
            <input
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              type="password"
              autoComplete="off"
              placeholder="••••••••"
              className="mb-6 w-full border border-[#2a3238] bg-[#08090b] px-3 py-2 text-[12px] text-[#c8cdd3] outline-none focus:border-[#e8a632]/50"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded border border-[#2a3238] px-4 py-2 text-[11px] uppercase tracking-wider text-[#9aa0a6]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSettings}
                className="rounded border border-[#e8a632]/40 bg-[#1a160f] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[#e8a632]"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col gap-3 px-10 py-6">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#1a1f26] pb-3">
          {(
            [
              ['all', 'All'],
              ['errors', 'Errors'],
              ['trace_reasoning', 'Trace & reasoning'],
              ['agent_output', 'Agent output'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDashboardPreset(id)}
              className={clsx(
                'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition',
                dashboardPreset === id
                  ? 'border-[#e8a632]/55 bg-[#1a160f] text-[#f0e6d8]'
                  : 'border-[#2a3238] bg-[#0f1114] text-[#7a8288] hover:border-[#3a4248]'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c6570]">Kind</span>
            <input
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value)}
              placeholder="log, llm_meta, …"
              className="w-44 border border-[#2a3238] bg-[#08090b] px-2 py-1.5 text-[12px] outline-none focus:border-[#e8a632]/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c6570]">Session</span>
            <input
              value={filterSession}
              onChange={(e) => setFilterSession(e.target.value)}
              placeholder="session id"
              className="w-52 border border-[#2a3238] bg-[#08090b] px-2 py-1.5 text-[12px] outline-none focus:border-[#e8a632]/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c6570]">Provider</span>
            <input
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              placeholder="xai, openrouter, …"
              className="w-44 border border-[#2a3238] bg-[#08090b] px-2 py-1.5 text-[12px] outline-none focus:border-[#e8a632]/50"
            />
          </div>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c6570]">Search payload</span>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="grep across kinds, payloads…"
              className="w-full border border-[#2a3238] bg-[#08090b] px-2 py-1.5 text-[12px] outline-none focus:border-[#5eb3e8]/50"
            />
          </div>
        </div>

        {error && (
          <div className="border border-[#4a2a2a] bg-[#180f0f] px-4 py-2 text-[12px] text-[#f0a0a0]">{error}</div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <SubAgentTelemetryTrace />

          <div className="flex min-h-0 flex-1 gap-4" style={{ minHeight: '200px' }}>
          <aside className="w-56 shrink-0 overflow-auto border border-[#1a1f26] bg-[#0a0c0e]/80">
            <div className="sticky top-0 border-b border-[#1a1f26] bg-[#0c0e11] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#5c6570]">
              Sessions
            </div>
            <ul className="p-2">
              {sessions.length === 0 && (
                <li className="px-2 py-3 text-[11px] text-[#5c6570]">No sessions yet</li>
              )}
              {sessions.map((s) => (
                <li key={s.sessionId}>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterSession(s.sessionId)
                    }}
                    className={clsx(
                      'mb-1 w-full rounded border px-2 py-2 text-left text-[11px] leading-snug transition',
                      filterSession === s.sessionId
                        ? 'border-[#e8a632]/50 bg-[#1a160f] text-[#f0e6d8]'
                        : 'border-transparent bg-transparent text-[#9aa0a6] hover:border-[#2a3238] hover:bg-[#0f1114]'
                    )}
                  >
                    <div className="truncate font-mono text-[10px] text-[#e8a632]">{s.sessionId}</div>
                    <div className="text-[9px] text-[#5c6570]"> {s.eventCount} evt · {s.lastKind}</div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="flex min-w-0 min-h-0 flex-1 flex-col border border-[#1a1f26] bg-[#0a0c0e]/80">
            <div className="flex shrink-0 items-center justify-between border-b border-[#1a1f26] px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c6570]">
                Event stream ({filtered.length})
              </span>
              {healthStats && (
                <span className="max-w-[min(420px,45vw)] truncate text-[10px] text-[#5c6570]" data-tooltip={String(healthStats.sqlitePath ?? '')}>
                  sqlite {String(healthStats.totalEvents ?? '—')} / cap {String(healthStats.maxEvents ?? '—')}
                  {typeof healthStats.sqlitePath === 'string' && healthStats.sqlitePath ? (
                    <span className="block truncate font-mono text-[9px] text-[#4a5258]">
                      {healthStats.sqlitePath}
                    </span>
                  ) : null}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {filtered.map((ev, i) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => setSelectedId(ev.id)}
                  style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}
                  className={clsx(
                    'flex w-full border-b border-[#14181f] border-l-4 px-3 py-2.5 text-left transition hover:bg-[#0f1216]',
                    selectedId === ev.id ? 'bg-[#12151a]' : '',
                    kindBorderClass(ev.kind)
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#e8a632]">{ev.kind}</span>
                      {ev.source && (
                        <span className="text-[10px] text-[#5eb3e8]">{ev.source}</span>
                      )}
                      {ev.provider && (
                        <span className="text-[10px] text-[#3ecf8e]">{ev.provider}</span>
                      )}
                      {ev.model && (
                        <span className="text-[10px] text-[#c8cdd3]">{ev.model}</span>
                      )}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-[#9aa0a6]">{payloadPreview(ev)}</div>
                    <div className="mt-1 truncate text-[9px] text-[#5c6570]">{ev.ts}</div>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && !loading && (
                <div className="p-8 text-center text-[12px] text-[#5c6570]">
                  No events. From the repo root run <code className="text-[#e8a632]">npm run dev</code> (starts Rust
                  on 3001 + Node telemetry on 3002) or only{' '}
                  <code className="text-[#e8a632]">npm run dev:telemetry:node</code>. Use the orchestrator and
                  sub-agents — lines ingest here.
                </div>
              )}
            </div>
          </section>

          <aside className="w-[min(420px,40vw)] shrink-0 overflow-auto border border-[#1a1f26] bg-[#08090b]">
            <div className="sticky top-0 border-b border-[#1a1f26] bg-[#0c0e11] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#5c6570]">
              Payload
            </div>
            <pre className="p-3 text-[11px] leading-relaxed text-[#a8b0b8]">
              {selected ? formatJson(selected) : <span className="text-[#5c6570]">Select an event</span>}
            </pre>
          </aside>
          </div>
        </div>
      </div>
    </div>
  )
}

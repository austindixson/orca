import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { aggregateByModel, useOpenRouterUsageStore, type OpenRouterUsageEvent } from '../../store/openRouterUsageStore'
import { fetchOpenRouterCreditsFromSettings } from '../../lib/openrouterCredits'
import { computeApiSpendDeltas, type OpenRouterApiSpend } from '../../lib/openRouterApiSpend'

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`
  return `${Math.round(n)}`
}

function fmtUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.0001 && n > 0) return `$${n.toExponential(1)}`
  return `$${n.toFixed(n < 0.01 ? 4 : 3)}`
}

function Sparkline({
  gid,
  values,
  height = 40,
}: {
  gid: string
  values: number[]
  height?: number
}) {
  const w = 280
  const pad = 4
  if (values.length < 2) {
    return (
      <div className="text-[10px] text-gray-600" style={{ height }}>
        Not enough points yet
      </div>
    )
  }
  const max = Math.max(...values, 1)
  const min = 0
  const span = max - min || 1
  const step = (w - pad * 2) / (values.length - 1)
  const pts = values.map((v, i) => {
    const x = pad + i * step
    const y = pad + (1 - (v - min) / span) * (height - pad * 2)
    return `${x},${y}`
  })
  const gradId = `or-spark-${gid}`
  return (
    <svg width={w} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts.join(' ')}
      />
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function OpenRouterUsageTile({ data }: TileComponentProps) {
  const gid = data.id
  const events = useOpenRouterUsageStore((s) => s.events)
  const credits = useOpenRouterUsageStore((s) => s.credits)
  const setCredits = useOpenRouterUsageStore((s) => s.setCredits)
  const clearSession = useOpenRouterUsageStore((s) => s.clearSession)

  const [filterApi, setFilterApi] = useState<string | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [loadingCredits, setLoadingCredits] = useState(false)
  const [apiSpend, setApiSpend] = useState<OpenRouterApiSpend | null>(null)

  const filtered = useMemo(
    () => (filterApi ? events.filter((e) => e.modelApiName === filterApi) : events),
    [events, filterApi]
  )

  const totals = useMemo(() => {
    let prompt = 0
    let completion = 0
    let total = 0
    let cost = 0
    for (const e of filtered) {
      prompt += e.promptTokens
      completion += e.completionTokens
      total += e.totalTokens
      cost += e.costUsd ?? 0
    }
    return { prompt, completion, total, cost, n: filtered.length }
  }, [filtered])

  const byModel = useMemo(() => aggregateByModel(filtered), [filtered])

  const sparkTokens = useMemo(() => {
    const slice = events.slice(-32)
    return slice.map((e) => e.totalTokens)
  }, [events])

  const refreshCredits = useCallback(async () => {
    setLoadingCredits(true)
    try {
      const snap = await fetchOpenRouterCreditsFromSettings()
      setCredits(snap)
      if (snap?.usageUsd != null && Number.isFinite(snap.usageUsd)) {
        setApiSpend(computeApiSpendDeltas(snap.usageUsd))
      } else {
        setApiSpend(null)
      }
    } finally {
      setLoadingCredits(false)
    }
  }, [setCredits])

  useEffect(() => {
    void refreshCredits()
    const id = window.setInterval(() => void refreshCredits(), 90_000)
    return () => window.clearInterval(id)
  }, [refreshCredits])

  const barMax = useMemo(() => Math.max(...byModel.map((b) => b.total), 1), [byModel])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0f0f14] text-gray-200">
      <div className="shrink-0 border-b border-white/10 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-indigo-300/90">OpenRouter</p>
            <p className="text-xs text-gray-400">Spend totals from OpenRouter credits API; token rows from this app</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            <button
              type="button"
              onClick={() => void refreshCredits()}
              disabled={loadingCredits}
              className="rounded border border-indigo-500/35 bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
            >
              {loadingCredits ? '…' : 'Refresh credits'}
            </button>
            <button
              type="button"
              onClick={() => clearSession()}
              className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-gray-400 hover:bg-white/5"
            >
              Clear log
            </button>
          </div>
        </div>

        {credits?.error ? (
          <p className="mt-2 text-[11px] text-amber-200/80">{credits.error}</p>
        ) : credits && (credits.usageUsd != null || credits.limitUsd != null) ? (
          <div className="mt-2 space-y-1">
            {credits.label ? (
              <p className="text-[10px] text-gray-500">Key: {credits.label}</p>
            ) : null}
            <div className="flex h-2 overflow-hidden rounded-full bg-black/40">
              {credits.limitUsd != null && credits.limitUsd > 0 && credits.usageUsd != null ? (
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all"
                  style={{
                    width: `${Math.min(100, (credits.usageUsd / credits.limitUsd) * 100)}%`,
                  }}
                />
              ) : credits.usageUsd != null ? (
                <div
                  className="h-full bg-indigo-500/80"
                  style={{ width: `${Math.min(100, credits.usageUsd * 100)}%` }}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-3 text-[11px] text-gray-300">
              {credits.usageUsd != null && <span>Used {fmtUsd(credits.usageUsd)}</span>}
              {credits.limitUsd != null && <span>Limit {fmtUsd(credits.limitUsd)}</span>}
              {credits.remainingUsd != null && (
                <span className="text-emerald-300/90">Left {fmtUsd(credits.remainingUsd)}</span>
              )}
              {credits.isFreeTier ? (
                <span className="text-gray-500">Free tier</span>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[10px] text-gray-600">
            Credits load from OpenRouter when a key is set (Refresh).
          </p>
        )}
      </div>

      <div className="shrink-0 border-b border-white/10 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">Spent (USD) — account (API)</p>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <SpendStat
            label="Session"
            hint="Cumulative account usage minus baseline when this tab first fetched credits"
            value={apiSpend != null ? fmtUsd(apiSpend.session) : '—'}
          />
          <SpendStat
            label="Today"
            hint="Since local midnight — delta from cumulative usage at day boundary (see footnote)"
            value={apiSpend != null ? fmtUsd(apiSpend.today) : '—'}
          />
          <SpendStat
            label="7 days"
            hint="Rolling ~7d — delta from oldest snapshot in window (local samples + API)"
            value={apiSpend != null ? fmtUsd(apiSpend.week) : '—'}
          />
        </div>
        <p className="mt-2 text-[9px] leading-snug text-gray-600">
          Derived from OpenRouter <code className="text-gray-500">/credits</code> or <code className="text-gray-500">/auth/key</code>{' '}
          cumulative usage, not per-completion <code className="text-gray-500">usage.cost</code>. Refresh updates figures.
          {totals.cost > 0 ? (
            <span className="block pt-1 text-gray-500">
              Completion-estimated (log){' '}
              <span className="font-mono text-emerald-400/80">{fmtUsd(totals.cost)}</span>
              {filterApi ? ' · filtered' : ''}
            </span>
          ) : null}
        </p>
      </div>

      <div className="shrink-0 border-b border-white/10 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">Log totals</p>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
          <Stat label="Requests" value={`${totals.n}`} />
          <Stat label="Prompt tok" value={fmtNum(totals.prompt)} />
          <Stat label="Output tok" value={fmtNum(totals.completion)} />
          <Stat label="Total tok" value={fmtNum(totals.total)} accent />
        </div>
      </div>

      <div className="shrink-0 border-b border-white/10 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">Throughput (last calls)</p>
        <div className="mt-1 flex items-end gap-2">
          <Sparkline gid={gid} values={sparkTokens} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">By model</p>
          {filterApi ? (
            <button
              type="button"
              onClick={() => setFilterApi(null)}
              className="text-[10px] text-indigo-300 hover:underline"
            >
              Clear filter
            </button>
          ) : null}
        </div>
        {byModel.length === 0 ? (
          <p className="text-xs text-gray-600">Run the orchestrator with an OpenRouter model to populate.</p>
        ) : (
          <ul className="space-y-2">
            {byModel.map((row) => {
              const pct = (row.total / barMax) * 100
              const active = filterApi === row.api
              return (
                <li key={row.api}>
                  <button
                    type="button"
                    onClick={() => setFilterApi(active ? null : row.api)}
                    className={clsx(
                      'w-full rounded border px-2 py-1.5 text-left transition-colors',
                      active
                        ? 'border-indigo-400/50 bg-indigo-500/15'
                        : 'border-white/10 bg-black/20 hover:bg-white/5'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate font-medium text-gray-200">{row.label}</span>
                      <span className="shrink-0 font-mono text-gray-400">{fmtNum(row.total)} tok</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/50">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500/90 to-violet-400/80"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-gray-600">
                      {row.n} calls · in {fmtNum(row.prompt)} · out {fmtNum(row.completion)}
                      {row.costUsd > 0 ? ` · ${fmtUsd(row.costUsd)}` : ''}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-white/10 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">Recent</p>
        <div className="mt-1 max-h-32 overflow-y-auto font-mono text-[10px] leading-relaxed text-gray-400">
          {[...filtered].reverse().slice(0, 18).map((e, i) => (
            <RecentRow
              key={e.id}
              e={e}
              dim={hoverIdx !== null && hoverIdx !== i}
              onEnter={() => setHoverIdx(i)}
              onLeave={() => setHoverIdx(null)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-gray-600">{label}</p>
      <p className={clsx('font-mono text-sm', accent ? 'text-emerald-300/95' : 'text-gray-200')}>
        {value}
      </p>
    </div>
  )
}

function SpendStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded border border-white/5 bg-black/20 px-2 py-1.5 text-center" data-tooltip={hint}>
      <p className="text-[9px] uppercase tracking-wide text-gray-600">{label}</p>
      <p className="font-mono text-sm text-emerald-300/95">{value}</p>
    </div>
  )
}

function RecentRow({
  e,
  dim,
  onEnter,
  onLeave,
}: {
  e: OpenRouterUsageEvent
  dim: boolean
  onEnter: () => void
  onLeave: () => void
}) {
  const t = new Date(e.ts)
  const time = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div
      className={clsx('flex gap-2 border-b border-white/5 py-0.5', dim && 'opacity-40')}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span className="shrink-0 text-gray-600">{time}</span>
      <span className="min-w-0 flex-1 truncate text-indigo-200/80">{e.modelLabel}</span>
      <span className="shrink-0">{fmtNum(e.totalTokens)}</span>
      {e.costUsd != null && e.costUsd > 0 ? (
        <span className="shrink-0 text-emerald-400/80">{fmtUsd(e.costUsd)}</span>
      ) : (
        <span className="shrink-0 w-10" />
      )}
    </div>
  )
}

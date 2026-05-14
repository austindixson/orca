import { useCallback, useEffect, useState } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import {
  fetchTelemetryEvents,
  fetchTelemetryHealth,
  type DevTelemetryEvent,
} from '../../lib/devTelemetryApi'

export function TelemetryTile({ data }: TileComponentProps) {
  const [health, setHealth] = useState<{ ok: boolean; stats?: Record<string, unknown> } | null>(null)
  const [events, setEvents] = useState<DevTelemetryEvent[]>([])
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setErr(null)
    try {
      const [h, ev] = await Promise.all([
        fetchTelemetryHealth(),
        fetchTelemetryEvents({ limit: 25 }),
      ])
      setHealth(h)
      setEvents(ev.events ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setHealth(null)
      setEvents([])
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 12_000)
    return () => window.clearInterval(t)
  }, [refresh])

  return (
    <div className="flex h-full flex-col bg-canvas-bg text-gray-200">
      <div className="flex items-center justify-between border-b border-tile-border px-3 py-2">
        <span className="text-sm font-medium">{data.title || 'Telemetry'}</span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-xs text-accent-teal hover:underline"
        >
          Refresh
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs">
        {err && (
          <p className="mb-2 rounded border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-amber-100">
            Dev telemetry server not reachable ({err}). Run{' '}
            <code className="text-gray-300">npm run dev:telemetry:node</code> or open{' '}
            <code className="text-gray-300">#/telemetry</code> for the full dashboard.
          </p>
        )}
        {health && (
          <div className="mb-3 rounded border border-tile-border/80 bg-black/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Health</div>
            <div className="font-mono text-[11px] text-gray-300">
              ok: {String(health.ok)}
              {health.stats && (
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-gray-400">
                  {JSON.stringify(health.stats, null, 0)}
                </pre>
              )}
            </div>
          </div>
        )}
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Recent events</div>
        <ul className="mt-1 space-y-1">
          {events.length === 0 && !err ? (
            <li className="text-gray-500">No events yet.</li>
          ) : (
            events.map((ev) => (
              <li
                key={ev.id}
                className="rounded border border-tile-border/60 bg-black/15 px-2 py-1 font-mono text-[10px] leading-snug"
              >
                <span className="text-gray-500">{ev.ts.slice(11, 19)}</span>{' '}
                <span className="text-accent-teal">{ev.kind}</span>
                {ev.model && <span className="text-gray-400"> · {ev.model}</span>}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}

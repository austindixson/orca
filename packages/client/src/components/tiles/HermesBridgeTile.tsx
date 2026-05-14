import { useCallback, useEffect, useState } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import {
  canvasBridgeEndpoints,
  fetchCanvasBridgeStatus,
  getCanvasBridgeHttpOrigin,
  type CanvasBridgeStatus,
} from '../../lib/canvasBridgeApi'

function copyText(label: string, text: string, onDone: (msg: string) => void) {
  void navigator.clipboard.writeText(text).then(
    () => onDone(`Copied ${label}`),
    () => onDone('Copy failed')
  )
}

export function HermesBridgeTile({ data }: TileComponentProps) {
  const [status, setStatus] = useState<CanvasBridgeStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const origin = getCanvasBridgeHttpOrigin()
  const ep = canvasBridgeEndpoints(origin || 'http://127.0.0.1:3001')

  const refresh = useCallback(async () => {
    setErr(null)
    try {
      const s = await fetchCanvasBridgeStatus()
      setStatus(s)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(t)
  }, [refresh])

  const connected = (status?.uiClients ?? 0) > 0
  const degraded = status && !connected

  const sampleExecute = `curl -sS -X POST ${ep.execute} \\
  -H 'Content-Type: application/json' \\
  -d '{"tool":"canvas_list_modules","arguments":{}}'`

  return (
    <div className="flex h-full flex-col bg-canvas-bg text-gray-200">
      <div className="flex items-center justify-between border-b border-tile-border px-3 py-2">
        <span className="text-sm font-medium">{data.title || 'Hermes · Orca bridge'}</span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-xs text-accent-teal hover:underline"
        >
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2 text-xs">
        {toast && (
          <div className="rounded border border-accent-teal/40 bg-accent-teal/10 px-2 py-1 text-[11px] text-accent-teal">
            {toast}
          </div>
        )}

        <div className="rounded border border-tile-border/80 bg-black/25 px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Connection</div>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                connected ? 'bg-emerald-400' : degraded ? 'bg-amber-400' : 'bg-gray-600'
              }`}
            />
            <span className="font-medium text-gray-100">
              {connected
                ? 'Orca UI connected (bridge ready)'
                : degraded
                  ? 'Degraded — start companion server & keep Orca open'
                  : 'Unknown'}
            </span>
          </div>
          {status && (
            <p className="mt-1 font-mono text-[11px] text-gray-400">
              uiClients: {status.uiClients}
              {status.tokenRequired ? ' · token required (CANVAS_BRIDGE_TOKEN)' : ' · open localhost'}
            </p>
          )}
          {err && (
            <p className="mt-2 text-[11px] text-amber-200/90">
              {err}. Run the stack so port 3001 serves the bridge (e.g.{' '}
              <code className="text-gray-300">npm run dev</code> with{' '}
              <code className="text-gray-300">packages/server</code>).
            </p>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">How Option B works</div>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
            <strong className="text-gray-300">Hermes</strong> (or another agent) stays the LLM / tool loop. Register
            Orca canvas tools from <code className="text-gray-300">GET /api/canvas/tools</code>, then forward each call
            to <code className="text-gray-300">POST /api/canvas/execute</code>. The companion server fans out over{' '}
            <code className="text-gray-300">WebSocket</code> to this UI — same path as the built-in orchestrator.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Copy</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className="rounded border border-tile-border/70 bg-black/20 px-2 py-1 text-[10px] text-gray-300 hover:border-accent-teal/45"
              onClick={() =>
                copyText('tools URL', ep.tools, (m) => {
                  setToast(m)
                  window.setTimeout(() => setToast(null), 2500)
                })
              }
            >
              Tools manifest URL
            </button>
            <button
              type="button"
              className="rounded border border-tile-border/70 bg-black/20 px-2 py-1 text-[10px] text-gray-300 hover:border-accent-teal/45"
              onClick={() =>
                copyText('execute URL', ep.execute, (m) => {
                  setToast(m)
                  window.setTimeout(() => setToast(null), 2500)
                })
              }
            >
              Execute URL
            </button>
            <button
              type="button"
              className="rounded border border-tile-border/70 bg-black/20 px-2 py-1 text-[10px] text-gray-300 hover:border-accent-teal/45"
              onClick={() =>
                copyText('WebSocket', ep.ws, (m) => {
                  setToast(m)
                  window.setTimeout(() => setToast(null), 2500)
                })
              }
            >
              WebSocket URL
            </button>
            <button
              type="button"
              className="rounded border border-tile-border/70 bg-black/20 px-2 py-1 text-[10px] text-gray-300 hover:border-accent-teal/45"
              onClick={() =>
                copyText('curl', sampleExecute, (m) => {
                  setToast(m)
                  window.setTimeout(() => setToast(null), 2500)
                })
              }
            >
              Sample curl
            </button>
          </div>
        </div>

        <div className="rounded border border-tile-border/60 bg-black/15 px-2 py-2 font-mono text-[10px] leading-snug text-gray-500">
          <div className="text-[9px] uppercase text-gray-600">Docs</div>
          <code className="block break-all text-gray-400">
            docs/CANVAS_AGENT_BRIDGE.md (runbook + bridge smoke)
          </code>
          <code className="mt-1 block break-all text-gray-500">
            docs/AGENT_ORCHESTRATOR_SYNC.md
          </code>
          <code className="mt-1 block text-gray-500">npm run bridge:smoke</code>
        </div>
      </div>
    </div>
  )
}

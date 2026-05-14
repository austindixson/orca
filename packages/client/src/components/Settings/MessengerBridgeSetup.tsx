import { useCallback, useEffect, useState } from 'react'
import {
  canvasBridgeEndpoints,
  fetchCanvasBridgeStatus,
  getCanvasBridgeHttpOrigin,
  type CanvasBridgeStatus,
} from '../../lib/canvasBridgeApi'
import { useCanvasStore } from '../../store/canvasStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useToastStore } from '../../store/toastStore'

const ORCA_BRIDGE_DOC = 'docs/CANVAS_AGENT_BRIDGE.md'

function copyText(text: string, onDone: (ok: boolean) => void) {
  void navigator.clipboard.writeText(text).then(
    () => onDone(true),
    () => onDone(false)
  )
}

export function MessengerBridgeSetup() {
  const addTile = useCanvasStore((s) => s.addTile)
  const addToast = useToastStore((s) => s.addToast)
  const showHermesAgentTile = useSettingsStore((s) => s.showHermesAgentTile)
  const openSettingsToSection = useSettingsStore((s) => s.openSettingsToSection)

  const [status, setStatus] = useState<CanvasBridgeStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const origin = getCanvasBridgeHttpOrigin() || 'http://127.0.0.1:3001'
  const ep = canvasBridgeEndpoints(origin)

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
    const id = window.setInterval(() => void refresh(), 4000)
    return () => window.clearInterval(id)
  }, [refresh])

  const connected = (status?.uiClients ?? 0) > 0
  const tokenRequired = status?.tokenRequired === true

  const sampleCurlBase = `curl -sS -X POST ${ep.execute} \\
  -H 'Content-Type: application/json' \\
  -d '{"tool":"canvas_list_modules","arguments":{}}'`

  const sampleCurlWithToken = `curl -sS -X POST ${ep.execute} \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer YOUR_CANVAS_BRIDGE_TOKEN' \\
  -d '{"tool":"canvas_list_modules","arguments":{}}'`

  const referenceAdapterJson = `{
  "orca_canvas_tools_url": "${ep.tools}",
  "orca_canvas_execute_url": "${ep.execute}",
  "orca_canvas_websocket_url": "${ep.ws}",
  "note": "Hermes stays the planner; merge these tools in Hermes and POST each invocation to execute_url. See ${ORCA_BRIDGE_DOC}"
}`

  const onCopy = (label: string, text: string) => {
    copyText(text, (ok) => {
      setToast(ok ? `Copied ${label}` : 'Copy failed')
      window.setTimeout(() => setToast(null), 2200)
    })
  }

  const onAddBridgeTile = () => {
    addTile('hermes_bridge', undefined, { title: 'Hermes · Orca bridge' })
    addToast({
      type: 'info',
      title: 'Hermes bridge tile',
      message: 'Added to canvas — URLs, status, and curl samples.',
    })
  }

  const onAddHermesAgentTile = () => {
    addTile('hermes_agent', undefined, { title: 'Hermes' })
    addToast({
      type: 'info',
      title: 'Hermes agent tile',
      message:
        'HTTP chat to the Hermes API server (POST /v1/responses). Run `API_SERVER_ENABLED=true hermes gateway` in a terminal tile first; set base URL and Bearer under Integrations.',
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-200">Canvas bridge</h3>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          URLs for external agents that call Orca tools over HTTP (for example Hermes). See{' '}
          <code className="rounded bg-black/35 px-1 text-xs text-gray-500">{ORCA_BRIDGE_DOC}</code>.
        </p>
      </div>

      {toast && (
        <div className="rounded border border-accent-teal/35 bg-accent-teal/10 px-2 py-1 text-[11px] text-accent-teal">
          {toast}
        </div>
      )}

      <div className="rounded-xl border border-tile-border bg-black/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">Orca bridge status</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-[11px] text-accent-teal hover:underline"
          >
            Refresh
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              connected ? 'bg-emerald-400' : status ? 'bg-amber-400' : 'bg-gray-600'
            }`}
          />
          <span className="text-sm text-gray-200">
            {connected
              ? 'UI connected — Hermes can execute canvas tools'
              : status
                ? 'Server up but no UI WebSocket — keep Orca open'
                : err
                  ? 'Cannot reach bridge (start dev server on :3001)'
                  : 'Checking…'}
          </span>
        </div>
        {status && (
          <p className="mt-1 font-mono text-[11px] text-gray-500">
            uiClients: {status.uiClients}
            {tokenRequired ? ' · set CANVAS_BRIDGE_TOKEN on the server and send Authorization: Bearer' : ' · token optional on localhost'}
          </p>
        )}
        {err && <p className="mt-1 text-[11px] text-amber-200/90">{err}</p>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['Tools manifest', ep.tools],
            ['Execute', ep.execute],
            ['Bridge status', ep.bridgeStatus],
            ['WebSocket', ep.ws],
            ['Health', ep.health],
          ] as const
        ).map(([label, url]) => (
          <button
            key={label}
            type="button"
            onClick={() => onCopy(label, url)}
            className="rounded border border-tile-border/70 bg-black/25 px-2 py-1 text-[11px] text-gray-300 hover:border-accent-teal/45"
          >
            Copy {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onCopy('sample curl', tokenRequired ? sampleCurlWithToken : sampleCurlBase)}
          className="rounded border border-tile-border/70 bg-black/25 px-2 py-1 text-[11px] text-gray-300 hover:border-accent-teal/45"
        >
          Copy sample curl
        </button>
        <button
          type="button"
          onClick={() => onCopy('adapter JSON', referenceAdapterJson)}
          className="rounded border border-tile-border/70 bg-black/25 px-2 py-1 text-[11px] text-gray-300 hover:border-accent-teal/45"
        >
          Copy reference JSON
        </button>
      </div>

      <pre className="max-h-32 overflow-auto rounded-lg border border-tile-border/60 bg-black/35 p-2 font-mono text-[10px] leading-relaxed text-gray-400">
        {tokenRequired ? sampleCurlWithToken : sampleCurlBase}
      </pre>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onAddBridgeTile}
          className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/20"
        >
          Add Hermes · Orca bridge tile to canvas
        </button>
        {showHermesAgentTile ? (
          <button
            type="button"
            onClick={onAddHermesAgentTile}
            className="w-full rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-2 text-sm font-medium text-teal-100 hover:bg-teal-500/20"
          >
            Add Hermes agent tile to canvas
          </button>
        ) : (
          <p className="rounded-lg border border-tile-border/60 bg-black/20 px-3 py-2 text-[11px] text-gray-500">
            Hermes agent tile is hidden — enable it under{' '}
            <button
              type="button"
              className="text-accent-teal/90 underline underline-offset-2 hover:text-accent-teal"
              onClick={() => openSettingsToSection('agent', { expandHermes: true })}
            >
              Settings → Agent → Hermes
            </button>
            .
          </p>
        )}
      </div>
      <p className="text-[11px] text-gray-600">
        Bridge tile: URLs and curl. Agent tile: use Hermes API settings above.
      </p>
    </div>
  )
}

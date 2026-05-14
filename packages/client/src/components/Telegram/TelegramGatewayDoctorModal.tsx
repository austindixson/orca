import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  fetchCanvasBridgeStatus,
  fetchOrcaGatewayStatus,
  fetchOrcaHealth,
} from '../../lib/canvasBridgeApi'
import { hasSavedTelegramCredentials } from '../../lib/telegramGatewayActions'

type Props = {
  open: boolean
  onClose: () => void
}

/**
 * Read-only snapshot of Telegram gateway + canvas bridge health (toolbar “Gateway Doctor”).
 */
export function TelegramGatewayDoctorModal({ open, onClose }: Props) {
  const labelId = useId()
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<string[]>([])
  const [nextSteps, setNextSteps] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setLines([])
    setNextSteps([])

    const run = async () => {
      const out: string[] = []
      const hints: string[] = []
      const creds = hasSavedTelegramCredentials()
      out.push(`Saved credentials in Orca (or prior start): ${creds ? 'yes' : 'no'}`)
      if (!creds) {
        hints.push('Add a bot token in Settings → Integrations, or set ORCA_TELEGRAM_BOT_TOKEN on the companion process.')
      }

      let healthOk = false
      try {
        const health = await fetchOrcaHealth()
        if (cancelled) return
        healthOk = true
        out.push(`Companion /health: ${health.status ?? 'ok'}`)
      } catch {
        if (cancelled) return
        out.push('Companion /health: unreachable')
        hints.push('Start the companion server (e.g. packages/server on port 3001) or launch an Orca build that includes it.')
      }

      let g: Awaited<ReturnType<typeof fetchOrcaGatewayStatus>> | null = null
      try {
        g = await fetchOrcaGatewayStatus()
        if (cancelled) return
        out.push(`Telegram gateway process: ${g.telegram.running ? 'running' : 'stopped'}`)
        out.push(`Canvas UI WebSocket clients: ${g.uiClients} (need ≥1 with this window open)`)
        if (!g.telegram.running) {
          hints.push('Start the gateway: Gateway sidebar or Telegram toolbar button (when credentials are saved).')
        } else if (g.uiClients < 1) {
          hints.push('Keep this Orca window open — the bridge needs at least one UI client to deliver Telegram messages.')
        }
      } catch {
        if (cancelled) return
        out.push('GET /api/gateway/status: failed')
        if (healthOk) {
          hints.push('Gateway status failed — check companion logs; ensure /api/gateway routes are enabled.')
        }
      }

      try {
        const b = await fetchCanvasBridgeStatus()
        if (cancelled) return
        out.push(`Bridge · uiClients: ${b.uiClients}`)
        out.push(`Canvas bridge token required: ${b.tokenRequired ? 'yes (match VITE_CANVAS_BRIDGE_TOKEN in the app)' : 'no'}`)
        if (b.tokenRequired) {
          hints.push('If API calls return 401, set CANVAS_BRIDGE_TOKEN on the server and the same value in VITE_CANVAS_BRIDGE_TOKEN for the client.')
        }
      } catch {
        if (cancelled) return
        out.push('GET /api/canvas/bridge-status: failed')
        hints.push('Confirm the WebSocket bridge is up and this app points at http://127.0.0.1:3001 in production builds.')
      }

      if (g?.telegram.running === true && (g.uiClients ?? 0) >= 1 && creds) {
        hints.push('If DMs still fail: verify bot token, optional allowlist user IDs, and that you messaged the correct bot.')
      }

      const uniqueHints = [...new Set(hints)]
      setLines(out)
      setNextSteps(uniqueHints)
      setLoading(false)
    }

    void run().catch((e) => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const overlay = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="my-auto w-full max-w-md max-h-[min(90dvh,32rem)] overflow-y-auto rounded-xl border border-tile-border bg-tile-bg/98 p-4 shadow-tile"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={labelId} className="text-base font-semibold text-gray-100">
          Gateway Doctor
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          Read-only snapshot. Nothing is changed.
        </p>
        {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
        {error && (
          <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-2 text-sm text-rose-100">
            {error}
          </p>
        )}
        {!loading && !error && (
          <>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-tile-border/80 bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-gray-300">
              {lines.join('\n')}
            </pre>
            {nextSteps.length > 0 && (
              <div className="mt-3 rounded-lg border border-accent-teal/25 bg-accent-teal/5 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-accent-teal/90">Next steps</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-gray-300">
                  {nextSteps.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-tile-border/80 bg-black/20 px-3 py-1.5 text-sm text-gray-300 hover:bg-tile-hover"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}

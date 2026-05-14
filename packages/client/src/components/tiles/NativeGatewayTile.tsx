import { useCallback, useEffect, useState } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import {
  fetchCanvasBridgeStatus,
  fetchOrcaGatewayStatus,
  fetchOrcaHealth,
  stopOrcaNativeTelegramGateway,
  type OrcaGatewayStatus,
  type CanvasBridgeStatus,
} from '../../lib/canvasBridgeApi'
import { runOrcaDoctorClient, type OrcaDoctorLine } from '../../lib/orcaDoctorClient'
import {
  readNativeTelegramLastStart,
  restartOrcaNativeTelegramGateway,
  saveNativeTelegramLastStart,
} from '../../lib/nativeTelegramGatewaySession'
import { friendlyTelegramGatewayError, startTelegramGatewayFromSavedSettings } from '../../lib/telegramGatewayActions'
import { useSettingsStore } from '../../store/settingsStore'
import { useToastStore } from '../../store/toastStore'

const POLL_MS = 4000

export function NativeGatewayTile({ data }: TileComponentProps) {
  const addToast = useToastStore((s) => s.addToast)

  const [health, setHealth] = useState<{ status?: string } | null>(null)
  const [bridge, setBridge] = useState<CanvasBridgeStatus | null>(null)
  const [gateway, setGateway] = useState<OrcaGatewayStatus | null>(null)
  const [doctorLines, setDoctorLines] = useState<OrcaDoctorLine[] | null>(null)
  const [doctorBusy, setDoctorBusy] = useState(false)
  const [gatewayBusy, setGatewayBusy] = useState(false)

  const tgToken = useSettingsStore((s) => s.orcaTelegramBotToken)
  const setTgToken = useSettingsStore((s) => s.setOrcaTelegramBotToken)
  const tgAllowed = useSettingsStore((s) => s.orcaTelegramAllowedUserIds)
  const setTgAllowed = useSettingsStore((s) => s.setOrcaTelegramAllowedUserIds)

  const refresh = useCallback(async () => {
    try {
      const [h, b, g] = await Promise.all([
        fetchOrcaHealth().catch(() => null),
        fetchCanvasBridgeStatus().catch(() => null),
        fetchOrcaGatewayStatus().catch(() => null),
      ])
      setHealth(h)
      setBridge(b)
      setGateway(g)
    } catch {
      setHealth(null)
      setBridge(null)
      setGateway(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const onDoctor = async () => {
    setDoctorBusy(true)
    setDoctorLines(null)
    try {
      const lines = await runOrcaDoctorClient()
      setDoctorLines(lines)
      const bad = lines.some((l) => !l.ok)
      addToast({
        type: bad ? 'warning' : 'info',
        title: 'Orca doctor',
        message: bad ? 'Some checks failed — see tile.' : 'Checks complete.',
      })
    } catch (e) {
      addToast({
        type: 'error',
        title: 'Doctor',
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setDoctorBusy(false)
    }
  }

  const copyDoctor = () => {
    if (!doctorLines?.length) return
    const text = doctorLines.map((l) => l.text).join('\n')
    void navigator.clipboard.writeText(text).then(
      () => addToast({ type: 'info', title: 'Copied', message: 'Doctor output' }),
      () => addToast({ type: 'error', title: 'Copy failed', message: '' })
    )
  }

  const onStart = () => {
    setGatewayBusy(true)
    void startTelegramGatewayFromSavedSettings()
      .then((r) => {
        if (r.skipped) {
          addToast({
            type: 'warning',
            title: 'Telegram gateway',
            message:
              r.message ??
              'No bot token — set ORCA_TELEGRAM_BOT_TOKEN on the companion server, or paste the token in Orca, then Start again.',
            duration: 12_000,
          })
          void refresh()
          return
        }
        addToast({
          type: 'success',
          title: 'Telegram gateway',
          message: 'Gateway started. Keep this window open (uiClients ≥ 1), then message your bot.',
          duration: 10_000,
        })
        void refresh()
      })
      .catch((e) =>
        addToast({
          type: 'error',
          title: 'Telegram gateway',
          message: friendlyTelegramGatewayError(e),
          duration: 14_000,
        })
      )
      .finally(() => setGatewayBusy(false))
  }

  const onStop = () => {
    setGatewayBusy(true)
    void stopOrcaNativeTelegramGateway()
      .then(() => {
        addToast({ type: 'info', title: 'Gateway', message: 'Stopped.' })
        void refresh()
      })
      .catch((e) =>
        addToast({
          type: 'error',
          title: 'Telegram gateway',
          message: friendlyTelegramGatewayError(e),
          duration: 12_000,
        })
      )
      .finally(() => setGatewayBusy(false))
  }

  const onRestart = () => {
    setGatewayBusy(true)
    void restartOrcaNativeTelegramGateway()
      .then(() => {
        const cfg = readNativeTelegramLastStart()
        if (cfg) saveNativeTelegramLastStart(cfg)
        addToast({ type: 'info', title: 'Gateway', message: 'Restarted.' })
        void refresh()
      })
      .catch((e) =>
        addToast({
          type: 'error',
          title: 'Telegram gateway',
          message: friendlyTelegramGatewayError(e),
          duration: 12_000,
        })
      )
      .finally(() => setGatewayBusy(false))
  }

  const uiOk = (bridge?.uiClients ?? 0) > 0
  const tgRunning = gateway?.telegram.running === true

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0f14] text-[12px] text-slate-200">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Companion</p>
          <p className="text-sm font-semibold text-slate-100">{data.title?.trim() || 'Native gateway'}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-teal-300/95 hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
        <section className="rounded-lg border border-white/[0.07] bg-black/30 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Health</p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            {health ? `api/health → ${health.status ?? 'ok'}` : '…'}
          </p>
        </section>

        <section className="rounded-lg border border-white/[0.07] bg-black/30 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Bridge</p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${uiOk ? 'bg-emerald-400' : 'bg-amber-400'}`}
            />
            <span className="text-[11px] text-slate-300">
              uiClients: {bridge?.uiClients ?? '—'}
              {bridge ? ` · tokenRequired: ${String(bridge.tokenRequired)}` : ''}
            </span>
          </div>
          {!uiOk && bridge && (
            <p className="mt-2 text-[11px] leading-snug text-amber-200/90">
              Keep this Orca window open so the WebSocket bridge sees at least one UI client.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/80">Telegram</p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            {gateway
              ? `native: ${tgRunning ? 'running' : 'stopped'} · uiClients: ${gateway.uiClients}`
              : '…'}
          </p>
          <input
            type="password"
            autoComplete="off"
            placeholder="Bot token (optional — prefer ORCA_TELEGRAM_BOT_TOKEN on server)"
            value={tgToken}
            onChange={(e) => setTgToken(e.target.value)}
            className="mt-2 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[11px] placeholder:text-slate-600"
          />
          <input
            type="text"
            placeholder="Allowed user IDs (optional)"
            value={tgAllowed}
            onChange={(e) => setTgAllowed(e.target.value)}
            className="mt-1.5 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[11px] placeholder:text-slate-600"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={gatewayBusy}
              onClick={onStart}
              className="rounded-md bg-emerald-600/90 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Start
            </button>
            <button
              type="button"
              disabled={gatewayBusy}
              onClick={onStop}
              className="rounded-md border border-white/15 bg-black/30 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-50"
            >
              Stop
            </button>
            <button
              type="button"
              disabled={gatewayBusy}
              onClick={onRestart}
              className="rounded-md border border-teal-500/35 bg-teal-500/10 px-2.5 py-1.5 text-[11px] text-teal-200 hover:bg-teal-500/20 disabled:opacity-50"
            >
              Restart
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-sky-500/20 bg-sky-500/[0.05] p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">Doctor</p>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={doctorBusy}
                onClick={() => void onDoctor()}
                className="rounded border border-sky-500/30 px-2 py-0.5 text-[10px] text-sky-200 hover:bg-sky-500/10 disabled:opacity-50"
              >
                {doctorBusy ? '…' : 'Run'}
              </button>
              <button
                type="button"
                onClick={copyDoctor}
                disabled={!doctorLines?.length}
                className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-slate-400 hover:bg-white/5 disabled:opacity-40"
              >
                Copy
              </button>
            </div>
          </div>
          {doctorLines && (
            <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
              {doctorLines.map((l, i) => (
                <span key={i} className={l.ok ? 'text-slate-400' : 'text-amber-300/95'}>
                  {l.text}
                  {'\n'}
                </span>
              ))}
            </pre>
          )}
        </section>
      </div>
    </div>
  )
}

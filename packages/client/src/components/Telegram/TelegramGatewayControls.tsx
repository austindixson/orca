import { useCallback, useEffect, useState } from 'react'
import {
  fetchOrcaGatewayStatus,
  stopOrcaNativeTelegramGateway,
  type OrcaGatewayStatus,
} from '../../lib/canvasBridgeApi'
import { restartOrcaNativeTelegramGateway } from '../../lib/nativeTelegramGatewaySession'
import {
  friendlyTelegramGatewayError,
  startTelegramGatewayFromSavedSettings,
} from '../../lib/telegramGatewayActions'
import { useSettingsStore } from '../../store/settingsStore'
import { useToastStore } from '../../store/toastStore'

const POLL_MS = 4000

type Props = {
  /** Smaller typography for sidebar */
  compact?: boolean
}

/**
 * Shared Telegram native gateway: token, allowlist, start/stop/restart, live status.
 */
export function TelegramGatewayControls({ compact }: Props) {
  const addToast = useToastStore((s) => s.addToast)
  const [gatewayStatus, setGatewayStatus] = useState<OrcaGatewayStatus | null>(null)
  /** After first poll: false = server unreachable; true = OK. */
  const [companionReachable, setCompanionReachable] = useState<boolean | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const tgToken = useSettingsStore((s) => s.orcaTelegramBotToken)
  const setTgToken = useSettingsStore((s) => s.setOrcaTelegramBotToken)
  const tgAllowed = useSettingsStore((s) => s.orcaTelegramAllowedUserIds)
  const setTgAllowed = useSettingsStore((s) => s.setOrcaTelegramAllowedUserIds)
  const [gatewayBusy, setGatewayBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setGatewayStatus(await fetchOrcaGatewayStatus())
      setCompanionReachable(true)
    } catch {
      setGatewayStatus(null)
      setCompanionReachable(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const onStart = () => {
    setGatewayBusy(true)
    setActionError(null)
    void startTelegramGatewayFromSavedSettings()
      .then((r) => {
        if (r.skipped) {
          const msg =
            r.message ??
            'No bot token — set ORCA_TELEGRAM_BOT_TOKEN on the companion server process, or paste the token in Orca, then Start again.'
          setActionError(msg)
          addToast({
            type: 'warning',
            title: 'Telegram gateway',
            message: msg,
            duration: 12_000,
          })
          void refresh()
          return
        }
        const line =
          'Gateway started. Keep this window open so uiClients ≥ 1, then message your bot in Telegram.'
        addToast({ type: 'success', title: 'Telegram gateway', message: line, duration: 10_000 })
        setActionError(null)
        void refresh()
      })
      .catch((e) => {
        const msg = friendlyTelegramGatewayError(e)
        setActionError(msg)
        addToast({
          type: 'error',
          title: 'Telegram gateway',
          message: msg,
          duration: 14_000,
        })
      })
      .finally(() => setGatewayBusy(false))
  }

  const onStop = () => {
    setGatewayBusy(true)
    setActionError(null)
    void stopOrcaNativeTelegramGateway()
      .then(() => {
        addToast({ type: 'info', title: 'Telegram gateway', message: 'Stopped.' })
        void refresh()
      })
      .catch((e) => {
        const msg = friendlyTelegramGatewayError(e)
        setActionError(msg)
        addToast({
          type: 'error',
          title: 'Telegram gateway',
          message: msg,
          duration: 12_000,
        })
      })
      .finally(() => setGatewayBusy(false))
  }

  const onRestart = () => {
    setGatewayBusy(true)
    setActionError(null)
    void restartOrcaNativeTelegramGateway()
      .then(() => {
        addToast({ type: 'info', title: 'Telegram gateway', message: 'Restarted.' })
        void refresh()
      })
      .catch((e) => {
        const msg = friendlyTelegramGatewayError(e)
        setActionError(msg)
        addToast({
          type: 'error',
          title: 'Restart',
          message: msg,
          duration: 12_000,
        })
      })
      .finally(() => setGatewayBusy(false))
  }

  const inputCls = compact
    ? 'w-full rounded border border-tile-border bg-black/30 px-2 py-1.5 font-mono text-[10px] text-gray-200 placeholder:text-gray-600'
    : 'w-full rounded border border-tile-border bg-black/30 px-2 py-1.5 font-mono text-[11px] text-gray-200 placeholder:text-gray-600'

  const btnPrimary = compact
    ? 'rounded-lg bg-emerald-600/85 px-2.5 py-1.5 text-[10px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50'
    : 'rounded-lg bg-emerald-600/85 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50'

  const btnGhost = compact
    ? 'rounded-lg border border-tile-border bg-black/25 px-2.5 py-1.5 text-[10px] text-gray-300 hover:bg-white/5 disabled:opacity-50'
    : 'rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-50'

  const warnBox =
    compact ? 'rounded-lg border px-2 py-2 text-[10px] leading-snug' : 'rounded-lg border px-2 py-2 text-[11px] leading-snug'

  return (
    <div className="space-y-2">
      {companionReachable === false && (
        <div
          className={`${warnBox} border-amber-500/50 bg-amber-500/10 text-amber-100/95`}
          role="status"
        >
          <strong className="text-amber-50">Companion server not reachable (port 3001).</strong> The Telegram bridge
          runs there. Start it from the repo (e.g. <code className="font-mono text-amber-200/90">packages/server</code>)
          or use an Orca build that launches it; then Start will work.
        </div>
      )}
      {gatewayBusy && (
        <p className={`text-gray-400 ${compact ? 'text-[10px]' : 'text-xs'}`} aria-live="polite">
          Contacting gateway…
        </p>
      )}
      {actionError && (
        <div
          className={`${warnBox} border-red-500/45 bg-red-500/10 text-red-100/95`}
          role="alert"
        >
          {actionError}
        </div>
      )}
      <input
        type="password"
        autoComplete="off"
        placeholder="Bot token (optional — prefer ORCA_TELEGRAM_BOT_TOKEN on server)"
        value={tgToken}
        onChange={(e) => setTgToken(e.target.value)}
        className={inputCls}
      />
      <input
        type="text"
        placeholder="Allowed Telegram user ids (optional, comma-separated)"
        value={tgAllowed}
        onChange={(e) => setTgAllowed(e.target.value)}
        className={inputCls}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={gatewayBusy} onClick={onStart} className={btnPrimary}>
          Start
        </button>
        <button type="button" disabled={gatewayBusy} onClick={onStop} className={btnGhost}>
          Stop
        </button>
        <button type="button" disabled={gatewayBusy} onClick={onRestart} className={btnGhost} data-tooltip="Stop then start with last saved config">
          Restart
        </button>
      </div>
      {gatewayStatus && (
        <>
          <p className={`font-mono text-gray-500 ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
            native telegram: {gatewayStatus.telegram.running ? 'running' : 'stopped'} · uiClients:{' '}
            {gatewayStatus.uiClients}
          </p>
          {gatewayStatus.telegram.running && gatewayStatus.uiClients < 1 && (
            <div
              className={`rounded-lg border border-amber-500/45 bg-amber-500/10 px-2 py-2 text-amber-100/95 ${compact ? 'text-[10px] leading-snug' : 'text-[11px] leading-snug'}`}
              role="status"
            >
              <strong className="text-amber-50">No Orca window on the bridge.</strong> Keep this app open so{' '}
              <code className="text-amber-200/90">uiClients ≥ 1</code> before messaging the bot.
            </div>
          )}
        </>
      )}
    </div>
  )
}

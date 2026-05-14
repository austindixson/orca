import { clearOrcaTelegramSavedGatewaySettings } from '../../lib/nativeTelegramGatewaySession'
import { useSettingsStore } from '../../store/settingsStore'
import { useToastStore } from '../../store/toastStore'

export function NativeTelegramSavedTokenPanel() {
  const addToast = useToastStore((s) => s.addToast)
  const tgToken = useSettingsStore((s) => s.orcaTelegramBotToken)
  const setTgToken = useSettingsStore((s) => s.setOrcaTelegramBotToken)
  const tgAllowed = useSettingsStore((s) => s.orcaTelegramAllowedUserIds)
  const setTgAllowed = useSettingsStore((s) => s.setOrcaTelegramAllowedUserIds)
  const gatewayStartKnown = useSettingsStore((s) => s.orcaTelegramGatewayStartKnown)

  const hasSaved =
    Boolean(tgToken?.trim()) || Boolean(tgAllowed?.trim()) || gatewayStartKnown

  const onClear = () => {
    clearOrcaTelegramSavedGatewaySettings()
    addToast({
      type: 'info',
      title: 'Telegram',
      message: 'Saved bot token, allowlist, and gateway session cache cleared.',
    })
  }

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
      <h3 className="text-sm font-medium text-emerald-100/95">Telegram (native gateway)</h3>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        Saved for the <strong className="text-gray-400">Start</strong> button on the Telegram gateway tile. Stopping
        the gateway does not clear these; use the button below to remove saved values.
      </p>
      <div className="mt-2 space-y-2">
        <input
          type="password"
          autoComplete="off"
          placeholder="Bot token (optional — prefer ORCA_TELEGRAM_BOT_TOKEN on server)"
          value={tgToken}
          onChange={(e) => setTgToken(e.target.value)}
          className="w-full rounded border border-tile-border bg-black/30 px-2 py-1.5 font-mono text-[11px] text-gray-200 placeholder:text-gray-600"
        />
        <input
          type="text"
          placeholder="Allowed user IDs (optional)"
          value={tgAllowed}
          onChange={(e) => setTgAllowed(e.target.value)}
          className="w-full rounded border border-tile-border bg-black/30 px-2 py-1.5 font-mono text-[11px] text-gray-200 placeholder:text-gray-600"
        />
        <button
          type="button"
          onClick={onClear}
          disabled={!hasSaved}
          className="w-full rounded-lg border border-amber-500/45 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100/95 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear saved Telegram token &amp; allowlist
        </button>
      </div>
    </div>
  )
}

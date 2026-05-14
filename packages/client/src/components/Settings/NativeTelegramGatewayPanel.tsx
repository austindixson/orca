import { TelegramGatewayControls } from '../Telegram/TelegramGatewayControls'

export function NativeTelegramGatewayPanel() {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
      <h4 className="text-xs font-semibold text-emerald-100/95">Orca native Telegram (no Hermes)</h4>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
        The companion server can long-poll Telegram and forward each message to this Orca window over the same WebSocket
        as the canvas bridge. Your <strong className="text-gray-400">orchestrator</strong> runs here (same as the bottom
        bar); replies go back to Telegram. Keep Orca open with the bridge connected (
        <code className="text-gray-500">uiClients ≥ 1</code>).         Prefer <code className="rounded bg-black/35 px-1 text-[10px]">ORCA_TELEGRAM_BOT_TOKEN</code> on the
        companion server (bot token is not required in Orca). Start/Stop always work; the bot runs only when a
        token is available (env or optional field below). The server can also auto-start the bot when that env
        is set at boot.
      </p>
      <div className="mt-2">
        <TelegramGatewayControls />
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import QRCode from 'react-qr-code'
import { fetchTelegramBotInfo } from '../../lib/canvasBridgeApi'
import { useSettingsStore } from '../../store/settingsStore'

const BOTFATHER_URL = 'https://t.me/BotFather'

function useTelegramOnboardQrTarget(tgToken: string) {
  const [qrTarget, setQrTarget] = useState<{
    url: string
    caption: string
  }>({
    url: BOTFATHER_URL,
    caption: 'Opens @BotFather — create a bot, then paste the token below.',
  })

  useEffect(() => {
    let cancelled = false
    const token = tgToken.trim()
    if (!token) {
      setQrTarget({
        url: BOTFATHER_URL,
        caption: 'Opens @BotFather — create a bot, then paste the token below.',
      })
      return
    }
    void fetchTelegramBotInfo({ token })
      .then((r) => {
        if (cancelled) return
        if (r.ok && r.openUrl) {
          setQrTarget({
            url: r.openUrl,
            caption: `Opens @${r.username ?? 'your_bot'} — Start gateway above, then DM the bot.`,
          })
        } else {
          setQrTarget({
            url: BOTFATHER_URL,
            caption:
              (r.error ? `Invalid token (${r.error.slice(0, 80)}). ` : '') +
              'Fix the token or create a bot in @BotFather, then paste below.',
          })
        }
      })
      .catch(() => {
        if (cancelled) return
        setQrTarget({
          url: BOTFATHER_URL,
          caption:
            'Start the companion on :3001 first — then we can verify your token and switch this link to your bot.',
        })
      })
    return () => {
      cancelled = true
    }
  }, [tgToken])

  return qrTarget
}

type QrBlockProps = {
  /** Sidebar uses a smaller QR */
  compact?: boolean
  className?: string
}

/**
 * QR + caption shared by the canvas onboard tile and the Gateway sidebar.
 * URL is always a normal https://t.me/… link — BotFather until a token validates, then your bot.
 */
export function TelegramOnboardQrBlock({ compact, className }: QrBlockProps) {
  const tgToken = useSettingsStore((s) => s.orcaTelegramBotToken)
  const qrTarget = useTelegramOnboardQrTarget(tgToken)
  const size = compact ? 112 : 132

  return (
    <div
      className={
        className ??
        clsx(
          'flex flex-col items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-3',
          compact ? 'py-2.5' : 'py-3'
        )
      }
    >
      <p
        className={`text-center font-semibold uppercase tracking-wider text-slate-500 ${
          compact ? 'text-[9px]' : 'text-[10px]'
        }`}
      >
        Scan or open in Telegram
      </p>
      <div className="rounded-lg bg-white p-2 shadow-inner">
        <QRCode value={qrTarget.url} size={size} />
      </div>
      <a
        href={qrTarget.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-1.5 font-medium text-sky-200/95 transition-colors hover:bg-sky-500/20 ${
          compact ? 'text-[11px]' : 'text-xs'
        }`}
      >
        Open in Telegram
      </a>
      <p
        className={`max-w-[20rem] text-center leading-snug text-slate-400 ${
          compact ? 'text-[10px]' : 'text-[11px]'
        }`}
      >
        {qrTarget.caption}
      </p>
      <p className="break-all font-mono text-slate-600 text-[9px]">{qrTarget.url}</p>
    </div>
  )
}

type StepsProps = {
  compact?: boolean
}

/** Numbered setup steps — full copy on tile, tighter copy in sidebar. */
export function TelegramOnboardNumberedSteps({ compact }: StepsProps) {
  const liNum =
    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#ff6b4a]/15 font-mono text-[10px] font-bold text-[#ffb4a2]'
  const text = compact ? 'text-[11px]' : 'text-[11.5px]'

  if (compact) {
    return (
      <ol className={`space-y-2 ${text} text-slate-300/95`}>
        <li className="flex gap-2">
          <span className={liNum}>1</span>
          <span>
            Companion on this machine (default <code className="font-mono text-[10px]">:3001</code>) must be running.
          </span>
        </li>
        <li className="flex gap-2">
          <span className={liNum}>2</span>
          <span>
            Paste token → <strong className="text-slate-200">Start</strong> (or set{' '}
            <code className="font-mono text-[10px]">ORCA_TELEGRAM_BOT_TOKEN</code> on the server).
          </span>
        </li>
        <li className="flex gap-2">
          <span className={liNum}>3</span>
          <span>
            Keep this Orca window open so the bridge sees this UI (<code className="rounded bg-black/40 px-0.5 font-mono text-[10px]">uiClients ≥ 1</code>).
          </span>
        </li>
        <li className="flex gap-2">
          <span className={liNum}>4</span>
          <span>Message your bot in Telegram — replies use the same session as the bottom orchestrator bar.</span>
        </li>
      </ol>
    )
  }

  return (
    <ol className={`space-y-2.5 ${text} text-slate-300/95`}>
      <li className="flex gap-2">
        <span className={liNum}>1</span>
        <span>
          Run the companion so it listens (e.g.{' '}
          <code className="rounded bg-black/40 px-1 font-mono text-[10px] text-sky-200/90">npm run dev</code> — default{' '}
          <code className="font-mono text-[10px]">:3001</code>).
        </span>
      </li>
      <li className="flex gap-2">
        <span className={liNum}>2</span>
        <span>
          Create a bot in <strong className="text-slate-200">@BotFather</strong>, copy the token, paste it here or in
          Settings → Integrations (or env <code className="font-mono text-[10px]">ORCA_TELEGRAM_BOT_TOKEN</code>).
        </span>
      </li>
      <li className="flex gap-2">
        <span className={liNum}>3</span>
        <span>
          <strong className="text-slate-200">Start gateway</strong>, keep this Orca window open — the bridge needs{' '}
          <code className="rounded bg-black/40 px-1 font-mono text-[10px]">uiClients ≥ 1</code>.
        </span>
      </li>
      <li className="flex gap-2">
        <span className={liNum}>4</span>
        <span>DM your bot in Telegram. Replies follow the bottom orchestrator session.</span>
      </li>
    </ol>
  )
}

export function TelegramOnboardTroubleshooting({ compact }: { compact?: boolean }) {
  const title = compact ? 'Still stuck?' : 'If nothing answers'
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2">
      <p className={`font-semibold uppercase tracking-wider text-slate-500 ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
        {title}
      </p>
      <ul
        className={`mt-1.5 list-disc space-y-1 pl-4 text-slate-500 ${compact ? 'text-[10px]' : 'text-[11px]'}`}
      >
        <li>
          Confirm the dev URL — use <code className="text-slate-400">http://localhost:5173</code> if IPv6-only bind breaks{' '}
          <code className="text-slate-400">127.0.0.1</code>.
        </li>
        <li>Optional allowlist: comma-separated Telegram user IDs in the gateway controls.</li>
        <li>
          Env auto-start: <code className="font-mono text-[10px] text-slate-400">ORCA_TELEGRAM_BOT_TOKEN</code> on the
          server.
        </li>
      </ul>
    </div>
  )
}

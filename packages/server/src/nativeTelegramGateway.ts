import { Bot } from 'grammy'
import { enqueueTelegramToOrca } from './gatewayBridge.js'

const TELEGRAM_MAX_MESSAGE = 4096
/** Telegram clears typing after ~5s; refresh so long orchestrator runs stay visible. */
const TELEGRAM_TYPING_INTERVAL_MS = 4000
/** Treat very old messages right after startup as likely backlog replays. */
const TELEGRAM_QUEUED_AGE_MS = 20_000
const TELEGRAM_QUEUE_DETECT_WINDOW_MS = 120_000

let activeBot: Bot | undefined
let stopFn: (() => Promise<void>) | undefined

function truncateTelegram(s: string): string {
  if (s.length <= TELEGRAM_MAX_MESSAGE) return s
  return `${s.slice(0, TELEGRAM_MAX_MESSAGE - 20)}\n…(truncated)`
}

/** Sends typing immediately and on an interval until `stop()` is called. */
function startTelegramTypingLoop(sendTyping: () => Promise<unknown>): () => void {
  const tick = () => {
    void sendTyping().catch(() => {})
  }
  tick()
  const id = setInterval(tick, TELEGRAM_TYPING_INTERVAL_MS)
  return () => clearInterval(id)
}

export function isNativeTelegramGatewayRunning(): boolean {
  return activeBot !== undefined
}

export async function stopNativeTelegramGateway(): Promise<void> {
  if (stopFn) {
    try {
      await stopFn()
    } catch {
      /* ignore */
    }
    stopFn = undefined
  }
  activeBot = undefined
}

/**
 * Start Telegram long polling. Inbound messages are forwarded to the Orca UI over WebSocket;
 * the orchestrator reply is sent back as the Telegram reply.
 */
export async function startNativeTelegramGateway(config: {
  token: string
  /** If non-empty, only these Telegram user ids may chat with the bot. */
  allowedUserIds?: number[]
}): Promise<void> {
  await stopNativeTelegramGateway()
  const startedAtMs = Date.now()
  const allowed =
    config.allowedUserIds && config.allowedUserIds.length > 0
      ? new Set(config.allowedUserIds)
      : null

  const bot = new Bot(config.token.trim())
  activeBot = bot

  bot.catch((err) => {
    console.error('[Gateway] grammY middleware error', err)
  })

  bot.on('message:text', async (ctx) => {
    const uid = ctx.from?.id
    if (allowed && uid !== undefined && !allowed.has(uid)) {
      await ctx.reply(
        'You are not allowed to use this Orca bot. Add your Telegram user id to the allowlist in Orca Settings (Integrations).'
      )
      return
    }
    const text = ctx.message.text?.trim() ?? ''
    if (!text) {
      await ctx.reply('Send a non-empty message.')
      return
    }
    const stopTyping = startTelegramTypingLoop(() =>
      ctx.api.sendChatAction(ctx.chat.id, 'typing')
    )
    try {
      const messageDateSec = ctx.message.date
      const messageDateMs = Number.isFinite(messageDateSec) ? messageDateSec * 1000 : Date.now()
      const ageMs = Math.max(0, Date.now() - messageDateMs)
      const withinStartupWindow = Date.now() - startedAtMs <= TELEGRAM_QUEUE_DETECT_WINDOW_MS
      const likelyQueued = withinStartupWindow && ageMs >= TELEGRAM_QUEUED_AGE_MS
      const reply = await enqueueTelegramToOrca({
        chatId: ctx.chat.id,
        text,
        username: ctx.from?.username,
        queued: {
          likely: likelyQueued,
          ageMs,
        },
      })
      stopTyping()
      await ctx.reply(truncateTelegram(reply))
    } catch (e) {
      stopTyping()
      const msg = e instanceof Error ? e.message : String(e)
      await ctx.reply(truncateTelegram(`Orca: ${msg}`))
    }
  })

  /** `bot.start()` only resolves when the bot stops — run polling in the background. */
  void bot.start().catch((err) => {
    console.error('[Gateway] Telegram bot.start failed', err)
  })

  stopFn = async () => {
    await bot.stop()
  }
}

/** If `ORCA_TELEGRAM_BOT_TOKEN` is set, start the gateway when the server boots. */
export async function maybeStartTelegramFromEnv(): Promise<void> {
  const token = process.env.ORCA_TELEGRAM_BOT_TOKEN?.trim()
  if (!token) return
  const raw = process.env.ORCA_TELEGRAM_ALLOWED_USER_IDS?.trim()
  const allowedUserIds = raw
    ? raw
        .split(/[\s,]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => !Number.isNaN(n))
    : undefined
  try {
    await startNativeTelegramGateway({ token, allowedUserIds })
    console.log('[Gateway] Native Telegram gateway started (ORCA_TELEGRAM_BOT_TOKEN)')
  } catch (e) {
    console.error('[Gateway] Failed to start Telegram gateway:', e)
  }
}

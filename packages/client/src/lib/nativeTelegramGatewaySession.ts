/**
 * Last successful native Telegram gateway start: session (same tab) plus persisted settings
 * so the token survives reload and Stop does not clear it.
 */
import {
  startOrcaNativeTelegramGateway,
  stopOrcaNativeTelegramGateway,
} from './canvasBridgeApi'
import { useSettingsStore } from '../store/settingsStore'

const STORAGE_KEY = 'orca.nativeTelegram.lastStart'

export type NativeTelegramLastStart = {
  token: string
  allowedUserIds?: number[]
}

export function parseTelegramAllowedUserIds(raw: string): number[] | undefined {
  const ids = raw
    .trim()
    .split(/[\s,]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n))
  return ids.length > 0 ? ids : undefined
}

export function saveNativeTelegramLastStart(cfg: NativeTelegramLastStart): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    /* ignore quota / private mode */
  }
  const {
    setOrcaTelegramBotToken,
    setOrcaTelegramAllowedUserIds,
    setOrcaTelegramGatewayStartKnown,
  } = useSettingsStore.getState()
  if (cfg.token.trim()) {
    setOrcaTelegramBotToken(cfg.token.trim())
  }
  if (cfg.allowedUserIds?.length) {
    setOrcaTelegramAllowedUserIds(cfg.allowedUserIds.join(', '))
  }
  setOrcaTelegramGatewayStartKnown(true)
}

export function readNativeTelegramLastStart(): NativeTelegramLastStart | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const v = JSON.parse(raw) as NativeTelegramLastStart
      if (typeof v?.token === 'string') {
        return {
          token: v.token.trim(),
          allowedUserIds: Array.isArray(v.allowedUserIds) ? v.allowedUserIds : undefined,
        }
      }
    }
  } catch {
    /* ignore */
  }
  const s = useSettingsStore.getState()
  const tok = (s.orcaTelegramBotToken ?? '').trim()
  const allowed = parseTelegramAllowedUserIds(s.orcaTelegramAllowedUserIds)
  if (tok) {
    return { token: tok, allowedUserIds: allowed }
  }
  if (s.orcaTelegramGatewayStartKnown) {
    return { token: '', allowedUserIds: allowed }
  }
  return null
}

/** Clears in-memory session cache only (e.g. optional “forget” flows); does not remove persisted token. */
export function clearNativeTelegramLastStart(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Clears persisted Telegram bot token, allowlist, restart flag, and session cache (explicit user action). */
export function clearOrcaTelegramSavedGatewaySettings(): void {
  const {
    setOrcaTelegramBotToken,
    setOrcaTelegramAllowedUserIds,
    setOrcaTelegramGatewayStartKnown,
  } = useSettingsStore.getState()
  setOrcaTelegramBotToken('')
  setOrcaTelegramAllowedUserIds('')
  setOrcaTelegramGatewayStartKnown(false)
  clearNativeTelegramLastStart()
}

export async function restartOrcaNativeTelegramGateway(): Promise<void> {
  const cfg = readNativeTelegramLastStart()
  if (!cfg) {
    throw new Error('No saved gateway config — start the gateway from Settings → Integrations first.')
  }
  await stopOrcaNativeTelegramGateway()
  const r = await startOrcaNativeTelegramGateway({
    token: cfg.token,
    allowedUserIds: cfg.allowedUserIds,
  })
  if (r.skipped || !r.telegram.running) {
    throw new Error(
      r.message ||
        'Telegram gateway did not start — set ORCA_TELEGRAM_BOT_TOKEN on the companion server (same token as your bot).'
    )
  }
}

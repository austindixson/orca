import {
  startOrcaNativeTelegramGateway,
  type StartOrcaTelegramGatewayResult,
} from './canvasBridgeApi'
import { parseTelegramAllowedUserIds, saveNativeTelegramLastStart } from './nativeTelegramGatewaySession'
import { useSettingsStore } from '../store/settingsStore'

/** Token in Settings and/or a prior successful start (e.g. token only in server env). */
export function hasSavedTelegramCredentials(): boolean {
  const s = useSettingsStore.getState()
  if (s.orcaTelegramBotToken.trim().length > 0) return true
  if (s.orcaTelegramGatewayStartKnown) return true
  return false
}

/**
 * Same body as the Integrations / Gateway sidebar Start — uses current Settings token, allowlist,
 * and persists last start on success.
 */
export async function startTelegramGatewayFromSavedSettings(): Promise<StartOrcaTelegramGatewayResult> {
  const s = useSettingsStore.getState()
  const token = s.orcaTelegramBotToken.trim()
  const allowedUserIds = parseTelegramAllowedUserIds(s.orcaTelegramAllowedUserIds)
  const r = await startOrcaNativeTelegramGateway({ token, allowedUserIds })
  if (!r.skipped) {
    saveNativeTelegramLastStart({ token, allowedUserIds })
  }
  return r
}

export function friendlyTelegramGatewayError(e: unknown): string {
  if (e instanceof TypeError && String(e.message).includes('fetch')) {
    return (
      'Could not reach the companion server (port 3001). Run the canvas bridge (e.g. npm run dev in packages/server) ' +
      'or use a build that starts it automatically; then retry Start.'
    )
  }
  if (e instanceof Error) return e.message
  return String(e)
}

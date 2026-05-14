import { sendToFirstOpenCanvasUiClient } from './canvasBridge.js'

const pending = new Map<
  string,
  { resolve: (v: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>()

const GATEWAY_UI_TIMEOUT_MS = 300_000

/**
 * Forward an inbound Telegram message to the first connected Orca UI; wait for `gateway:telegram:result`.
 */
export function enqueueTelegramToOrca(p: {
  chatId: number
  text: string
  username?: string
  queued?: {
    likely: boolean
    ageMs?: number
  }
}): Promise<string> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const sent = sendToFirstOpenCanvasUiClient({
      type: 'gateway:telegram',
      payload: {
        requestId,
        chatId: p.chatId,
        text: p.text,
        username: p.username,
        queued: p.queued,
      },
    })
    if (!sent) {
      reject(
        new Error(
          'No Orca UI on the bridge (uiClients: 0). Open Orca on this machine, keep it running (npm run dev or tauri dev), confirm GET /api/canvas/bridge-status shows uiClients >= 1, and do not set VITE_ENABLE_CANVAS_BRIDGE=false.'
        )
      )
      return
    }

    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(
        new Error(
          'Timed out waiting for Orca (keep the app open, canvas bridge enabled, and try again).'
        )
      )
    }, GATEWAY_UI_TIMEOUT_MS)

    pending.set(requestId, { resolve, reject, timer })
  })
}

export function completeGatewayTelegramReply(requestId: string, text: string): boolean {
  const p = pending.get(requestId)
  if (!p) return false
  clearTimeout(p.timer)
  pending.delete(requestId)
  p.resolve(text)
  return true
}

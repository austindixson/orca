import { WebSocket } from 'ws'

/** UI clients that can execute canvas tools (Hermes / OpenClaude bridge). */
const uiClients = new Set<WebSocket>()

const pending = new Map<
  string,
  { resolve: (v: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>()

export function registerCanvasUiClient(ws: WebSocket) {
  uiClients.add(ws)
  const onClose = () => {
    uiClients.delete(ws)
    ws.off('close', onClose)
  }
  ws.on('close', onClose)
}

export function getCanvasUiClientCount(): number {
  return uiClients.size
}

/** Send a JSON message to the first connected Orca UI (used by native gateway — avoid duplicate runs). */
export function sendToFirstOpenCanvasUiClient(message: { type: string; payload?: unknown }): boolean {
  const s = JSON.stringify(message)
  for (const w of uiClients) {
    if (w.readyState === WebSocket.OPEN) {
      w.send(s)
      return true
    }
  }
  return false
}

/**
 * Fan-out to all connected Orca Coder UIs; first response completes the HTTP request.
 * Mirrors Paperclip-style “bring your own agent” — external runners call HTTP, UI owns canvas state.
 */
export function invokeCanvasToolOnClients(tool: string, argsJson: string): Promise<string> {
  const active = [...uiClients].filter((w) => w.readyState === WebSocket.OPEN)
  if (active.length === 0) {
    return Promise.reject(
      new Error(
        'No Orca UI on the canvas bridge (uiClients: 0). Keep the Orca app window open, ensure :3001 WebSocket connects, and VITE_ENABLE_CANVAS_BRIDGE is not false. Check GET /api/canvas/bridge-status.'
      )
    )
  }

  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('Canvas tool timed out waiting for UI (90s)'))
    }, 90_000)

    pending.set(requestId, { resolve, reject, timer })

    const payload = JSON.stringify({
      type: 'canvas:invoke',
      payload: { requestId, tool, arguments: argsJson },
    })

    for (const w of active) {
      w.send(payload)
    }
  })
}

export function completeCanvasInvocation(requestId: string, result: string) {
  const p = pending.get(requestId)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(requestId)
  p.resolve(result)
}

export function failCanvasInvocation(requestId: string, message: string) {
  const p = pending.get(requestId)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(requestId)
  p.reject(new Error(message))
}

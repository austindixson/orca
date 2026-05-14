/**
 * WebSocket client for agent-browser streaming and CLI wrapper.
 * Connects to the agent-browser daemon's WebSocket stream for live viewport frames
 * and cursor position tracking.
 */

export interface FrameMetadata {
  deviceWidth: number
  deviceHeight: number
  pageScaleFactor: number
  offsetTop: number
  scrollOffsetX: number
  scrollOffsetY: number
}

export interface MouseInputEvent {
  eventType: 'mousePressed' | 'mouseReleased' | 'mouseMoved'
  x: number
  y: number
  button?: 'left' | 'right' | 'middle'
  clickCount?: number
}

export interface KeyboardInputEvent {
  eventType: 'keyDown' | 'keyUp' | 'char'
  key: string
  code?: string
  modifiers?: number
}

export interface CursorPosition {
  x: number
  y: number
  visible: boolean
  isClicking: boolean
}

type FrameCallback = (data: string, metadata: FrameMetadata) => void
type CursorCallback = (position: CursorPosition) => void
type ConnectionCallback = (connected: boolean) => void

export class AgentBrowserWsClient {
  private ws: WebSocket | null = null
  private frameCallbacks: FrameCallback[] = []
  private cursorCallbacks: CursorCallback[] = []
  private connectionCallbacks: ConnectionCallback[] = []
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = true
  private lastCursorPosition: CursorPosition = { x: 0, y: 0, visible: false, isClicking: false }

  constructor(private port: number) {}

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return

    try {
      this.ws = new WebSocket(`ws://localhost:${this.port}`)

      this.ws.onopen = () => {
        this.connectionCallbacks.forEach((cb) => cb(true))
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string
            data?: string
            metadata?: FrameMetadata
          }

          if (msg.type === 'frame' && msg.data && msg.metadata) {
            this.frameCallbacks.forEach((cb) => cb(msg.data!, msg.metadata!))
          }
        } catch {
          // Ignore malformed messages
        }
      }

      this.ws.onclose = () => {
        this.connectionCallbacks.forEach((cb) => cb(false))
        if (this.shouldReconnect) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = () => {
        // Error will trigger onclose
      }
    } catch {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldReconnect) {
        this.connect()
      }
    }, 1000)
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  updatePort(port: number): void {
    if (port === this.port) return
    this.port = port
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
    }
    this.connect()
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  sendMouseEvent(event: MouseInputEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const payload = {
      type: 'input_mouse',
      eventType: event.eventType,
      x: event.x,
      y: event.y,
      button: event.button ?? 'left',
      clickCount: event.clickCount ?? 1,
    }

    this.ws.send(JSON.stringify(payload))

    // Update cursor position for overlay
    const wasClicking = this.lastCursorPosition.isClicking
    this.lastCursorPosition = {
      x: event.x,
      y: event.y,
      visible: true,
      isClicking: event.eventType === 'mousePressed' ? true : event.eventType === 'mouseReleased' ? false : wasClicking,
    }
    this.cursorCallbacks.forEach((cb) => cb(this.lastCursorPosition))
  }

  sendKeyboardEvent(event: KeyboardInputEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const payload = {
      type: 'input_keyboard',
      eventType: event.eventType,
      key: event.key,
      code: event.code ?? event.key,
      modifiers: event.modifiers ?? 0,
    }

    this.ws.send(JSON.stringify(payload))
  }

  /** Emit a cursor position update (for tool execution animations) */
  emitCursorTarget(x: number, y: number, isClicking = false): void {
    this.lastCursorPosition = { x, y, visible: true, isClicking }
    this.cursorCallbacks.forEach((cb) => cb(this.lastCursorPosition))
  }

  /** Hide the cursor overlay */
  hideCursor(): void {
    this.lastCursorPosition = { ...this.lastCursorPosition, visible: false }
    this.cursorCallbacks.forEach((cb) => cb(this.lastCursorPosition))
  }

  onFrame(cb: FrameCallback): () => void {
    this.frameCallbacks.push(cb)
    return () => {
      this.frameCallbacks = this.frameCallbacks.filter((c) => c !== cb)
    }
  }

  onCursorMove(cb: CursorCallback): () => void {
    this.cursorCallbacks.push(cb)
    return () => {
      this.cursorCallbacks = this.cursorCallbacks.filter((c) => c !== cb)
    }
  }

  onConnection(cb: ConnectionCallback): () => void {
    this.connectionCallbacks.push(cb)
    return () => {
      this.connectionCallbacks = this.connectionCallbacks.filter((c) => c !== cb)
    }
  }
}

/** Parse snapshot text and extract refs for clickable elements */
export function parseSnapshotRefs(snapshot: string): Array<{ text: string; ref: string | null }> {
  const result: Array<{ text: string; ref: string | null }> = []
  const refPattern = /\[ref=([^\]]+)\]/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = refPattern.exec(snapshot)) !== null) {
    // Add text before the ref
    if (match.index > lastIndex) {
      result.push({ text: snapshot.slice(lastIndex, match.index), ref: null })
    }
    // Add the ref itself
    result.push({ text: `[@${match[1]}]`, ref: `@${match[1]}` })
    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < snapshot.length) {
    result.push({ text: snapshot.slice(lastIndex), ref: null })
  }

  return result
}

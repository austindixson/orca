import { useEffect, useRef, useCallback, useState } from 'react'

export interface WSMessage {
  type: string
  payload: unknown
}

interface UseWebSocketOptions {
  onMessage?: (message: WSMessage) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
  autoReconnect?: boolean
  reconnectInterval?: number
}

export function useWebSocket(url: string, options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onOpen,
    onClose,
    onError,
    autoReconnect = true,
    reconnectInterval = 3000,
  } = options

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(url)

    ws.onopen = () => {
      setIsConnected(true)
      onOpen?.()
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WSMessage
        onMessage?.(message)
      } catch {
        console.error('Failed to parse WebSocket message:', event.data)
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      onClose?.()
      wsRef.current = null

      if (autoReconnect) {
        reconnectTimeoutRef.current = window.setTimeout(connect, reconnectInterval)
      }
    }

    ws.onerror = (error) => {
      onError?.(error)
    }

    wsRef.current = ws
  }, [url, onMessage, onOpen, onClose, onError, autoReconnect, reconnectInterval])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    wsRef.current?.close()
    wsRef.current = null
    setIsConnected(false)
  }, [])

  const send = useCallback((message: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return { isConnected, send, disconnect, reconnect: connect }
}

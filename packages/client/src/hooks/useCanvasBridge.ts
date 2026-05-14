import { useEffect, useRef } from 'react'
import { nanoid } from 'nanoid'
import { executeOrchestratorTool } from '../lib/orchestrator/executeTools'
import { filterToolResultForContext } from '../lib/tauri'
import { handleGatewayTelegramMessage } from '../lib/nativeGatewayClient'
import { useOrchestratorSessionStore } from '../store/orchestratorSessionStore'
import { useAgentTeamStore } from '../store/agentTeamStore'
import { useCanvasStore } from '../store/canvasStore'
import { useGroupChatStore, type GroupChatMessageKind } from '../store/groupChatStore'
import { parseMentions } from '../lib/groupChat/parseMentions'
import { getDefaultSessionId } from '../lib/persistence/sessionPersistence'

function bridgeWsUrl(): string {
  const env = import.meta.env.VITE_CANVAS_BRIDGE_WS as string | undefined
  if (env) return env
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return 'ws://127.0.0.1:3001/ws'
  }
  if (typeof window === 'undefined') return 'ws://127.0.0.1:3001/ws'
  const host = window.location.hostname
  const port = 3001
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${host}:${port}/ws`
}

/**
 * Paperclip-style bridge: companion server fans out `canvas:invoke` so external agents
 * (Hermes, OpenClaude HTTP adapters, etc.) get the same tool execution as the built-in orchestrator.
 */
export function useCanvasBridge(enabled: boolean) {
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!enabled) return

    const url = bridgeWsUrl()
    let ws: WebSocket | null = null
    /** Strict Mode runs mount → unmount → mount in dev; closing a CONNECTING socket logs a noisy error. */
    let cancelled = false
    const connectId = globalThis.setTimeout(() => {
      if (cancelled) return
      try {
        ws = new WebSocket(url)
      } catch {
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled || !ws) return
        ws.send(JSON.stringify({ type: 'canvas:register', payload: { role: 'ui' } }))
      }

      ws.onmessage = async (ev) => {
        if (cancelled || !ws) return
        let msg: {
          type?: string
          payload?: {
            requestId?: string
            tool?: string
            arguments?: string
            chatId?: number
            text?: string
            username?: string
            queued?: {
              likely?: boolean
              ageMs?: number
            }
          }
        }
        try {
          msg = JSON.parse(ev.data as string)
        } catch {
          return
        }

        if (msg.type === 'gateway:telegram' && msg.payload?.requestId && msg.payload.text !== undefined) {
          const chatId = msg.payload.chatId
          const text = msg.payload.text
          if (typeof chatId !== 'number' || typeof text !== 'string') return
          void handleGatewayTelegramMessage(ws, {
            requestId: msg.payload.requestId,
            chatId,
            text,
            username: typeof msg.payload.username === 'string' ? msg.payload.username : undefined,
            queued: {
              likely: msg.payload.queued?.likely === true,
              ageMs:
                typeof msg.payload.queued?.ageMs === 'number'
                  ? msg.payload.queued.ageMs
                  : undefined,
            },
          })
          return
        }

        if (msg.type === 'orchestrator:reply' && msg.payload?.requestId) {
          const pl = msg.payload as {
            requestId: string
            parentTileId?: string
            childTileId?: string
            role?: string
            text?: string
          }
          const summary = typeof pl.text === 'string' ? pl.text : ''
          const role =
            typeof pl.role === 'string' && pl.role.trim() ? pl.role.trim() : 'external'
          const childTileId =
            typeof pl.childTileId === 'string' && pl.childTileId.trim()
              ? pl.childTileId.trim()
              : ''
          const handoffTileId = childTileId || `ext-${nanoid(10)}`
          useOrchestratorSessionStore.getState().recordSubAgentHandoff({
            displayName: 'orca',
            role,
            tileId: handoffTileId,
            outcome: 'done',
            summary,
          })
          if (childTileId) {
            const mem = useAgentTeamStore.getState().membersByTileId[childTileId]
            if (mem) {
              useAgentTeamStore.getState().patchMember(childTileId, {
                status: 'done',
                lastSummary: summary,
                currentTask: 'Done',
              })
            }
            useCanvasStore.getState().updateTile(childTileId, { tileStatus: 'idle' })
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'orchestrator:reply:result',
                payload: { requestId: pl.requestId, result: 'ok' },
              })
            )
          }
          return
        }

        if (msg.type === 'team:message:incoming' && msg.payload?.requestId) {
          const pl = msg.payload as {
            requestId: string
            agent?: string
            senderName?: string
            body?: string
            sessionId?: string
            team?: string
            to?: string
            channel?: string
            kind?: string
            replyTo?: string
            correlationId?: string
          }
          const ack = (result: {
            ok: boolean
            id?: string
            seq?: number
            thread_id?: string | null
            deduped?: boolean
            error?: string
          }) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'team:message:incoming:result',
                  payload: { requestId: pl.requestId, ...result },
                })
              )
            }
          }

          try {
            const body = typeof pl.body === 'string' ? pl.body.trim() : ''
            if (!body) {
              ack({ ok: false, error: 'body required' })
              return
            }
            const sessionId =
              typeof pl.sessionId === 'string' && pl.sessionId.trim()
                ? pl.sessionId.trim()
                : getDefaultSessionId()

            const ALLOWED: GroupChatMessageKind[] = [
              'say', 'ask', 'ack', 'update', 'handoff', 'blocker', 'result',
            ]
            const kindRaw =
              typeof pl.kind === 'string' ? pl.kind.trim().toLowerCase() : ''
            const kind: GroupChatMessageKind = (ALLOWED as string[]).includes(kindRaw)
              ? (kindRaw as GroupChatMessageKind)
              : 'say'

            const explicitTo = typeof pl.to === 'string' ? pl.to.trim() : ''
            let fullBody = body
            if (explicitTo && !body.includes(`@${explicitTo}`)) {
              fullBody = `@${explicitTo} ${body}`
            }

            const mentions = parseMentions(fullBody, {
              agentTeamStore: useAgentTeamStore.getState(),
            })

            const senderName =
              typeof pl.senderName === 'string' && pl.senderName.trim()
                ? pl.senderName.trim()
                : typeof pl.agent === 'string' && pl.agent.trim()
                  ? pl.agent.trim()
                  : 'External agent'
            const agentId =
              typeof pl.agent === 'string' && pl.agent.trim()
                ? pl.agent.trim()
                : 'external'

            const posted = useGroupChatStore.getState().postMessage({
              sessionId,
              senderName,
              body: fullBody,
              mentions,
              kind,
              replyTo:
                typeof pl.replyTo === 'string' && pl.replyTo.trim()
                  ? pl.replyTo.trim()
                  : undefined,
              correlationId:
                typeof pl.correlationId === 'string' && pl.correlationId.trim()
                  ? pl.correlationId.trim()
                  : undefined,
              provenance: {
                source: 'external_http',
                agent: agentId,
                trust: 'untrusted',
              },
            })

            ack({
              ok: true,
              id: posted.id,
              seq: posted.seq,
              thread_id: posted.threadId ?? null,
              deduped: posted.deduped === true,
            })
          } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
          }
          return
        }

        if (msg.type !== 'canvas:invoke' || !msg.payload?.requestId || !msg.payload?.tool) return

        const { requestId, tool, arguments: rawArgs } = msg.payload
        const argsStr =
          typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {})

        let result: string
        try {
          const raw = await executeOrchestratorTool(tool, argsStr, { orchestratorTileId: null })
          result = await filterToolResultForContext(raw)
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e)
          result = JSON.stringify({ ok: false, error: err })
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'canvas:result',
              payload: { requestId, result },
            })
          )
        }
      }

      ws.onerror = () => {
        /* companion server may be offline (e.g. Tauri without dev server) */
      }
    }, 0)

    return () => {
      cancelled = true
      globalThis.clearTimeout(connectId)
      if (ws) {
        ws.onmessage = null
        ws.onerror = null
        const socket = ws
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.close(1000, 'effect cleanup')
          } catch {
            /* ignore */
          }
        } else if (socket.readyState === WebSocket.CONNECTING) {
          /** Closing CONNECTING synchronously makes Chromium log “closed before established”. */
          socket.onopen = () => {
            try {
              socket.close(1000, 'effect cleanup')
            } catch {
              /* ignore */
            }
          }
        }
      }
      wsRef.current = null
    }
  }, [enabled])
}

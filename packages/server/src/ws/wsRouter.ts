import type { WebSocket } from 'ws'
import { ptyManager } from '../pty/PtyManager.js'
import { agentManager } from '../agents/AgentManager.js'
import { completeCanvasInvocation, registerCanvasUiClient } from '../canvasBridge.js'
import { completeGatewayTelegramReply } from '../gatewayBridge.js'
import {
  completeExternalTeamMessage,
  completeOrchestratorReply,
} from '../orchestratorReplyBridge.js'

interface WSMessage {
  type: string
  payload?: Record<string, unknown>
}

export function wsRouter(ws: WebSocket) {
  const ptySubscriptions = new Map<string, boolean>()
  const agentSubscriptions = new Map<string, boolean>()

  const send = (type: string, payload?: unknown) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type, payload }))
    }
  }

  const handlePtyData = (sessionId: string, data: string) => {
    if (ptySubscriptions.has(sessionId)) {
      send('pty:data', { sessionId, data })
    }
  }

  const handlePtyExit = (sessionId: string, exitCode: number, signal?: number) => {
    if (ptySubscriptions.has(sessionId)) {
      send('pty:exit', { sessionId, exitCode, signal: typeof signal === 'number' ? signal : null })
      ptySubscriptions.delete(sessionId)
    }
  }

  const handleAgentData = (agentId: string, data: string) => {
    if (agentSubscriptions.has(agentId)) {
      send('agent:data', { agentId, data })
    }
  }

  const handleAgentStatus = (agentId: string, status: string) => {
    if (agentSubscriptions.has(agentId)) {
      send('agent:status', { agentId, status })
    }
  }

  const handleAgentExit = (agentId: string, exitCode: number) => {
    if (agentSubscriptions.has(agentId)) {
      send('agent:exit', { agentId, exitCode })
    }
  }

  ptyManager.on('data', handlePtyData)
  ptyManager.on('exit', handlePtyExit)
  agentManager.on('agent:data', handleAgentData)
  agentManager.on('agent:status', handleAgentStatus)
  agentManager.on('agent:exit', handleAgentExit)

  ws.on('message', (raw) => {
    let msg: WSMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      send('error', { message: 'Invalid JSON' })
      return
    }

    const { type, payload } = msg

    switch (type) {
      case 'pty:spawn': {
        const { shell, cwd, cols, rows } = (payload || {}) as Record<string, unknown>
        try {
          const sessionId = ptyManager.spawn(
            shell as string | undefined,
            cwd as string | undefined,
            cols as number | undefined,
            rows as number | undefined
          )
          ptySubscriptions.set(sessionId, true)
          send('pty:spawned', { sessionId })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : typeof error === 'string' ? error : 'PTY spawn failed'
          send('error', { message: `PTY spawn failed: ${message}` })
        }
        break
      }

      case 'pty:write': {
        const { sessionId, data } = (payload || {}) as Record<string, unknown>
        if (typeof sessionId === 'string' && typeof data === 'string') {
          ptyManager.write(sessionId, data)
        }
        break
      }

      case 'pty:resize': {
        const { sessionId, cols, rows } = (payload || {}) as Record<string, unknown>
        if (typeof sessionId === 'string' && typeof cols === 'number' && typeof rows === 'number') {
          ptyManager.resize(sessionId, cols, rows)
        }
        break
      }

      case 'pty:kill': {
        const { sessionId } = (payload || {}) as Record<string, unknown>
        if (typeof sessionId === 'string') {
          ptyManager.kill(sessionId)
          ptySubscriptions.delete(sessionId)
        }
        break
      }

      case 'agent:create': {
        const { agentType, name, command, cwd } = (payload || {}) as Record<string, unknown>
        const agent = agentManager.createAgent(
          agentType as 'claude' | 'codex' | 'gemini' | 'custom',
          name as string | undefined,
          command as string | undefined,
          cwd as string | undefined
        )
        agentSubscriptions.set(agent.id, true)
        send('agent:created', agent.toJSON())
        break
      }

      case 'agent:start': {
        const { agentId } = (payload || {}) as Record<string, unknown>
        if (typeof agentId === 'string') {
          agentManager.startAgent(agentId)
          agentSubscriptions.set(agentId, true)
        }
        break
      }

      case 'agent:input': {
        const { agentId, data } = (payload || {}) as Record<string, unknown>
        if (typeof agentId === 'string' && typeof data === 'string') {
          agentManager.sendInput(agentId, data)
        }
        break
      }

      case 'agent:task': {
        const { agentId, task } = (payload || {}) as Record<string, unknown>
        if (typeof agentId === 'string' && typeof task === 'string') {
          agentManager.sendTask(agentId, task)
        }
        break
      }

      case 'agent:stop': {
        const { agentId } = (payload || {}) as Record<string, unknown>
        if (typeof agentId === 'string') {
          agentManager.stopAgent(agentId)
        }
        break
      }

      case 'agent:remove': {
        const { agentId } = (payload || {}) as Record<string, unknown>
        if (typeof agentId === 'string') {
          agentManager.removeAgent(agentId)
          agentSubscriptions.delete(agentId)
        }
        break
      }

      case 'agent:list': {
        send('agent:list', agentManager.getAgentList())
        break
      }

      case 'canvas:register': {
        const { role } = (payload || {}) as { role?: string }
        if (role === 'ui') {
          registerCanvasUiClient(ws)
        }
        send('canvas:registered', { ok: true, role: role ?? null })
        break
      }

      case 'canvas:result': {
        const { requestId, result } = (payload || {}) as { requestId?: string; result?: string }
        if (typeof requestId === 'string' && typeof result === 'string') {
          completeCanvasInvocation(requestId, result)
        }
        break
      }

      case 'gateway:telegram:result': {
        const { requestId, text } = (payload || {}) as { requestId?: string; text?: string }
        if (typeof requestId === 'string' && typeof text === 'string') {
          completeGatewayTelegramReply(requestId, text)
        }
        break
      }

      case 'orchestrator:reply:result': {
        const { requestId, result } = (payload || {}) as { requestId?: string; result?: string }
        if (typeof requestId === 'string' && typeof result === 'string') {
          completeOrchestratorReply(requestId, result)
        }
        break
      }

      case 'team:message:incoming:result': {
        const p = (payload || {}) as {
          requestId?: string
          ok?: boolean
          id?: string
          seq?: number
          thread_id?: string | null
          deduped?: boolean
          error?: string
        }
        if (typeof p.requestId === 'string') {
          completeExternalTeamMessage(p.requestId, {
            ok: p.ok === true,
            id: typeof p.id === 'string' ? p.id : undefined,
            seq: typeof p.seq === 'number' ? p.seq : undefined,
            thread_id: typeof p.thread_id === 'string' ? p.thread_id : null,
            deduped: p.deduped === true,
            error: typeof p.error === 'string' ? p.error : undefined,
          })
        }
        break
      }

      default:
        send('error', { message: `Unknown message type: ${type}` })
    }
  })

  ws.on('close', () => {
    console.log('[WS] Client disconnected')
    ptyManager.off('data', handlePtyData)
    ptyManager.off('exit', handlePtyExit)
    agentManager.off('agent:data', handleAgentData)
    agentManager.off('agent:status', handleAgentStatus)
    agentManager.off('agent:exit', handleAgentExit)
    
    for (const sessionId of ptySubscriptions.keys()) {
      ptyManager.kill(sessionId)
    }
  })

  send('connected', { message: 'WebSocket connected' })
}

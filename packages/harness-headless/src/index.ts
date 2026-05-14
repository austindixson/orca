/**
 * Headless Orca harness — WebSocket client (role=ui, agent=orca-headless) + gateway + canvas invoke.
 */

import WebSocket from 'ws'
import { loadConfig } from './config.js'
import {
  executeCanvasInvokeLocal,
  executeToolHttp,
  runGatewayTurn,
} from './orchestratorLite.js'

const cfg = loadConfig()

function wsUrl(): string {
  const port = process.env.PORT ?? process.env.ORCA_BRIDGE_PORT ?? '3001'
  return `ws://127.0.0.1:${port}/ws`
}

async function main() {
  const url = wsUrl()
  console.error(`[harness-headless] connecting ${url}`)

  const ws = new WebSocket(url)

  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        type: 'canvas:register',
        payload: { role: 'ui', agent: 'orca-headless' },
      })
    )
  })

  ws.on('message', async (data) => {
    const raw = data.toString()
    let v: { type?: string; payload?: Record<string, unknown> }
    try {
      v = JSON.parse(raw) as { type?: string; payload?: Record<string, unknown> }
    } catch {
      return
    }
    const typ = v.type ?? ''
    const payload = v.payload ?? {}

    if (typ === 'canvas:invoke') {
      const requestId = payload.requestId as string | undefined
      const tool = payload.tool as string | undefined
      const argsStr = (payload.arguments as string) ?? '{}'
      if (!requestId || !tool) return
      try {
        let args: unknown = {}
        try {
          args = JSON.parse(argsStr)
        } catch {
          args = {}
        }
        const result = await executeCanvasInvokeLocal(cfg, tool, args)
        ws.send(
          JSON.stringify({
            type: 'canvas:result',
            payload: { requestId, result },
          })
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        ws.send(
          JSON.stringify({
            type: 'canvas:result',
            payload: { requestId, result: JSON.stringify({ error: msg }) },
          })
        )
      }
      return
    }

    if (typ === 'gateway:telegram') {
      const requestId = payload.requestId as string | undefined
      const text = (payload.text as string) ?? ''
      if (!requestId) return
      try {
        const reply = await runGatewayTurn(cfg, text, async (tool, args) => {
          return executeToolHttp(cfg, tool, args)
        })
        ws.send(
          JSON.stringify({
            type: 'gateway:telegram:result',
            payload: { requestId, text: reply },
          })
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        ws.send(
          JSON.stringify({
            type: 'gateway:telegram:result',
            payload: { requestId, text: `Orca: ${msg}` },
          })
        )
      }
    }
  })

  ws.on('close', () => {
    console.error('[harness-headless] websocket closed')
    process.exit(1)
  })

  ws.on('error', (err) => {
    console.error('[harness-headless] websocket error', err)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

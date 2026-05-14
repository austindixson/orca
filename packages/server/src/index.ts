import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { createApp } from './app.js'
import { wsRouter } from './ws/wsRouter.js'
import { maybeStartTelegramFromEnv } from './nativeTelegramGateway.js'

const PORT = process.env.PORT || 3001

const app = createApp()
const server = createServer(app)

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  console.log('[WS] Client connected')
  wsRouter(ws)
})

server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`)
  console.log(`[WS] WebSocket server ready on ws://localhost:${PORT}/ws`)
  console.log(
    `[Dev telemetry] http://localhost:${PORT}/api/dev/telemetry/health (ingest: POST /api/dev/telemetry/events)`
  )
  void maybeStartTelegramFromEnv()
})

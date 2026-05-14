import express from 'express'
import cors from 'cors'
import { promises as fs } from 'fs'
import { join, resolve, dirname } from 'path'
import { CANVAS_AGENT_TOOLS_MANIFEST } from './canvasToolsManifest.js'
import { getCanvasUiClientCount, invokeCanvasToolOnClients } from './canvasBridge.js'
import {
  enqueueExternalTeamMessage,
  enqueueOrchestratorReply,
  type TeamMessageKind,
} from './orchestratorReplyBridge.js'
import { createDevTelemetryRouter } from './devTelemetry/routes.js'
import { workspaceGrepDev } from './workspaceGrepDev.js'
import {
  isNativeTelegramGatewayRunning,
  startNativeTelegramGateway,
  stopNativeTelegramGateway,
} from './nativeTelegramGateway.js'

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd()

/** Set when `POST /api/canvas/execute` includes `X-Orca-External-Agent` (e.g. hermes). */
let lastExternalOrchestrator: { id: string; tsMs: number } | null = null
const EXTERNAL_ORCH_TTL_MS = 120_000

function touchExternalOrchestrator(id: string) {
  const x = id.trim().toLowerCase()
  if (!x) return
  lastExternalOrchestrator = { id: x, tsMs: Date.now() }
}

function externalOrchestratorForStatus(): { id: string; lastSeenMs: number } | null {
  if (!lastExternalOrchestrator) return null
  if (Date.now() - lastExternalOrchestrator.tsMs > EXTERNAL_ORCH_TTL_MS) return null
  return { id: lastExternalOrchestrator.id, lastSeenMs: lastExternalOrchestrator.tsMs }
}

/**
 * Express app factory (used by `index.ts` and tests).
 * Dev telemetry: `POST/GET /api/dev/telemetry/*`, SSE `GET /api/dev/telemetry/stream`.
 * Env: `DEV_TELEMETRY_TOKEN` (optional auth), `DEV_TELEMETRY_MAX_EVENTS`, `DEV_TELEMETRY_SQLITE` (db path; default `.agent-canvas/dev-telemetry.sqlite` under cwd).
 */
export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '4mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  app.get('/api/canvas/tools', (_req, res) => {
    res.json(CANVAS_AGENT_TOOLS_MANIFEST)
  })

  app.get('/api/canvas/bridge-status', (_req, res) => {
    res.json({
      uiClients: getCanvasUiClientCount(),
      tokenRequired: Boolean(process.env.CANVAS_BRIDGE_TOKEN),
      externalOrchestrator: externalOrchestratorForStatus(),
    })
  })

  /** Native Orca Telegram gateway (no Hermes): POST start/stop; requires companion server + Orca UI for replies. */
  app.get('/api/gateway/status', (_req, res) => {
    res.json({
      telegram: { running: isNativeTelegramGatewayRunning() },
      uiClients: getCanvasUiClientCount(),
    })
  })

  app.post('/api/gateway/telegram/start', async (req, res) => {
    const token = process.env.CANVAS_BRIDGE_TOKEN
    if (token) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${token}`) {
        return res.status(401).json({ error: 'Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>' })
      }
    }
    const body = req.body as { token?: string; allowedUserIds?: number[] }
    const fromBody = typeof body.token === 'string' ? body.token.trim() : ''
    const fromEnv = (process.env.ORCA_TELEGRAM_BOT_TOKEN ?? '').trim()
    const effective = fromBody || fromEnv
    if (!effective) {
      // Start/stop are not blocked on a token: bot token is optional (env or POST body only).
      return res.json({
        ok: true,
        skipped: true,
        telegram: { running: false },
        message:
          'No Telegram bot token — set ORCA_TELEGRAM_BOT_TOKEN on the companion server process, then Start again (optional override: paste token in Orca).',
      })
    }
    try {
      await startNativeTelegramGateway({
        token: effective,
        allowedUserIds: Array.isArray(body.allowedUserIds) ? body.allowedUserIds : undefined,
      })
      res.json({ ok: true, telegram: { running: true } })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      res.status(500).json({ ok: false, error: message })
    }
  })

  app.post('/api/gateway/telegram/stop', async (req, res) => {
    const token = process.env.CANVAS_BRIDGE_TOKEN
    if (token) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${token}`) {
        return res.status(401).json({ error: 'Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>' })
      }
    }
    try {
      await stopNativeTelegramGateway()
      res.json({ ok: true, telegram: { running: false } })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      res.status(500).json({ ok: false, error: message })
    }
  })

  /**
   * Resolve bot username via Telegram getMe (POST body token or ORCA_TELEGRAM_BOT_TOKEN).
   * Returns openUrl for https://t.me/<username> — safe to encode as a QR (no token in URL).
   */
  app.post('/api/gateway/telegram/bot-info', async (req, res) => {
    const bridge = process.env.CANVAS_BRIDGE_TOKEN
    if (bridge) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${bridge}`) {
        return res.status(401).json({ error: 'Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>' })
      }
    }
    const body = req.body as { token?: string }
    const fromBody = typeof body.token === 'string' ? body.token.trim() : ''
    const fromEnv = (process.env.ORCA_TELEGRAM_BOT_TOKEN ?? '').trim()
    const effective = fromBody || fromEnv
    if (!effective) {
      return res.json({ ok: false, error: 'No bot token — paste in Orca or set ORCA_TELEGRAM_BOT_TOKEN on the server.' })
    }
    try {
      const url = `https://api.telegram.org/bot${effective}/getMe`
      const r = await fetch(url)
      const j = (await r.json()) as {
        ok?: boolean
        result?: { username?: string }
        description?: string
      }
      if (!j.ok || !j.result?.username) {
        return res.json({
          ok: false,
          error: j.description || 'getMe failed — check the bot token.',
        })
      }
      const username = j.result.username.trim()
      return res.json({
        ok: true,
        username,
        openUrl: `https://t.me/${username}`,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return res.json({ ok: false, error: message })
    }
  })

  app.post('/api/canvas/execute', async (req, res) => {
    const token = process.env.CANVAS_BRIDGE_TOKEN
    if (token) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${token}`) {
        return res.status(401).json({ error: 'Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>' })
      }
    }

    const rawExt = req.headers['x-orca-external-agent']
    const extHdr = Array.isArray(rawExt) ? rawExt[0] : rawExt
    if (typeof extHdr === 'string') {
      touchExternalOrchestrator(extHdr)
    }

    const { tool, arguments: args } = req.body as { tool?: string; arguments?: unknown }
    if (!tool || typeof tool !== 'string') {
      return res.status(400).json({ error: 'JSON body must include tool (string)' })
    }
    const argsJson = typeof args === 'string' ? args : JSON.stringify(args ?? {})
    try {
      const result = await invokeCanvasToolOnClients(tool, argsJson)
      res.json({ ok: true, result })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      res.status(503).json({ ok: false, error: message })
    }
  })

  /** CLI / external agents: POST a completion summary back to the lead orchestrator (WebSocket → recordSubAgentHandoff). */
  app.post('/api/orchestrator/reply', async (req, res) => {
    const token = process.env.CANVAS_BRIDGE_TOKEN
    if (token) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${token}`) {
        return res.status(401).json({ error: 'Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>' })
      }
    }
    const body = req.body as {
      parent_tile_id?: string
      text?: string
      role?: string
      child_tile_id?: string
      session_id?: string
    }
    const parentTileId =
      typeof body.parent_tile_id === 'string' ? body.parent_tile_id.trim() : ''
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!parentTileId) {
      return res.status(400).json({ ok: false, error: 'parent_tile_id required (or ORCA_PARENT_TILE_ID)' })
    }
    if (!text) {
      return res.status(400).json({ ok: false, error: 'text required' })
    }
    try {
      const reply = await enqueueOrchestratorReply({
        parentTileId,
        text,
        role: typeof body.role === 'string' ? body.role : undefined,
        childTileId: typeof body.child_tile_id === 'string' ? body.child_tile_id : undefined,
        sessionId: typeof body.session_id === 'string' ? body.session_id : undefined,
      })
      res.json({ ok: true, reply })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      res.status(503).json({ ok: false, error: message })
    }
  })

  /**
   * External agents (Hermes, OpenClaw, Pi, CLI tools, …) post into the Orca
   * team chat. Requires `Authorization: Bearer $CANVAS_BRIDGE_TOKEN` when the
   * env var is set. The UI tags the resulting message with
   * `provenance.source = 'external_http'` so sub-agents can distinguish remote
   * directives from in-canvas ones.
   */
  app.post('/api/orchestrator/team-message', async (req, res) => {
    const token = process.env.CANVAS_BRIDGE_TOKEN
    if (token) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${token}`) {
        return res.status(401).json({ error: 'Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>' })
      }
    }
    const body = req.body as {
      agent?: string
      sender_name?: string
      body?: string
      session_id?: string
      team?: string
      to?: string
      channel?: string
      kind?: string
      reply_to?: string
      correlation_id?: string
    }

    const agent = typeof body.agent === 'string' ? body.agent.trim() : ''
    const text = typeof body.body === 'string' ? body.body.trim() : ''
    if (!agent) {
      return res.status(400).json({ ok: false, error: 'agent required (e.g. "hermes@host")' })
    }
    if (!text) {
      return res.status(400).json({ ok: false, error: 'body required' })
    }

    const ALLOWED_KINDS = new Set<TeamMessageKind>([
      'say', 'ask', 'ack', 'update', 'handoff', 'blocker', 'result',
    ])
    const kindRaw = typeof body.kind === 'string' ? body.kind.trim().toLowerCase() : ''
    const kind = ALLOWED_KINDS.has(kindRaw as TeamMessageKind)
      ? (kindRaw as TeamMessageKind)
      : undefined

    try {
      const posted = await enqueueExternalTeamMessage({
        agent,
        senderName:
          typeof body.sender_name === 'string' && body.sender_name.trim()
            ? body.sender_name.trim()
            : agent,
        body: text,
        sessionId:
          typeof body.session_id === 'string' && body.session_id.trim()
            ? body.session_id.trim()
            : undefined,
        team:
          typeof body.team === 'string' && body.team.trim() ? body.team.trim() : undefined,
        to: typeof body.to === 'string' && body.to.trim() ? body.to.trim() : undefined,
        channel:
          typeof body.channel === 'string' && body.channel.trim()
            ? body.channel.trim()
            : undefined,
        kind,
        replyTo:
          typeof body.reply_to === 'string' && body.reply_to.trim()
            ? body.reply_to.trim()
            : undefined,
        correlationId:
          typeof body.correlation_id === 'string' && body.correlation_id.trim()
            ? body.correlation_id.trim()
            : undefined,
      })
      res.json({
        ok: true,
        message_id: posted.id,
        seq: posted.seq,
        thread_id: posted.thread_id,
        deduped: posted.deduped,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      res.status(503).json({ ok: false, error: message })
    }
  })

  app.get('/api/workspace-grep', async (req, res) => {
    try {
      const query = (req.query.pattern as string) ?? ''
      if (!String(query).trim()) {
        return res.status(400).json({ error: 'pattern required' })
      }
      const subPath = String((req.query.path as string) ?? '.')
      const num = (k: string, d: number) => {
        const n = req.query[k]
        if (n == null) return d
        const t = Array.isArray(n) ? n[0] : n
        const x = Number(t)
        return Number.isFinite(x) ? x : d
      }
      const out = await workspaceGrepDev({
        workspaceRoot: WORKSPACE_ROOT,
        subPath,
        pattern: String(query),
        fixedString: (req.query.fixed_string as string) === '1' || req.query.fixed_string === 'true',
        caseInsensitive: (req.query.case_insensitive as string) === '1' || req.query.case_insensitive === 'true',
        glob: typeof req.query.glob === 'string' && req.query.glob.trim() ? String(req.query.glob) : null,
        maxMatches: num('max_matches', 200),
      })
      res.json(out)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      res.status(500).json({ error: message })
    }
  })

  app.get('/api/files', async (req, res) => {
    try {
      const dirPath = (req.query.path as string) || '.'
      const fullPath = resolve(WORKSPACE_ROOT, dirPath)

      const entries = await fs.readdir(fullPath, { withFileTypes: true })
      const files = entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: join(dirPath, entry.name),
      }))

      res.json({ files, path: dirPath })
    } catch {
      res.status(500).json({ error: 'Failed to read directory' })
    }
  })

  app.get('/api/file', async (req, res) => {
    try {
      const filePath = req.query.path as string
      if (!filePath) {
        return res.status(400).json({ error: 'Path required' })
      }

      const fullPath = resolve(WORKSPACE_ROOT, filePath)
      const content = await fs.readFile(fullPath, 'utf-8')

      res.json({ content, path: filePath })
    } catch {
      res.status(500).json({ error: 'Failed to read file' })
    }
  })

  app.post('/api/file', async (req, res) => {
    try {
      const { path: filePath, content } = req.body as { path?: string; content?: unknown }
      if (!filePath || content === undefined) {
        return res.status(400).json({ error: 'Path and content required' })
      }

      const fullPath = resolve(WORKSPACE_ROOT, filePath)
      await fs.mkdir(dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content as string, 'utf-8')

      res.json({ success: true, path: filePath })
    } catch {
      res.status(500).json({ error: 'Failed to write file' })
    }
  })

  app.delete('/api/file', async (req, res) => {
    try {
      const filePath = req.query.path as string
      if (!filePath) {
        return res.status(400).json({ error: 'Path required' })
      }
      const fullPath = resolve(WORKSPACE_ROOT, filePath)
      await fs.unlink(fullPath)
      res.json({ success: true, path: filePath })
    } catch {
      res.status(500).json({ error: 'Failed to delete file' })
    }
  })

  app.use('/api/dev/telemetry', createDevTelemetryRouter())

  return app
}

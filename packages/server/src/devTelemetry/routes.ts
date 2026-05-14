import archiver from 'archiver'
import { Router, type Request, type Response, type NextFunction } from 'express'
import type { DevTelemetryEventInput } from './types.js'
import { eventsToCsv, safeZipEntryName } from './telemetryCsv.js'
import { getDevTelemetryStore } from './store.js'

function authOk(req: Request): boolean {
  const token = process.env.DEV_TELEMETRY_TOKEN?.trim()
  if (!token) return true
  const auth = req.headers.authorization
  if (auth === `Bearer ${token}`) return true
  const q = req.query.token
  if (typeof q === 'string' && q === token) return true
  return false
}

function requireTelemetryAuth(req: Request, res: Response, next: NextFunction) {
  if (!authOk(req)) {
    res
      .status(401)
      .json({ error: 'Unauthorized. Set DEV_TELEMETRY_TOKEN or pass Authorization: Bearer <token> or ?token=' })
    return
  }
  next()
}

export function createDevTelemetryRouter(): Router {
  const r = Router()
  const store = getDevTelemetryStore()

  /** Health for dashboard wiring (no auth — minimal leak). */
  r.get('/health', (_req, res) => {
    res.json({ ok: true, stats: store.stats() })
  })

  r.post('/events', requireTelemetryAuth, expressJsonEvents)
  r.get('/events', requireTelemetryAuth, getEvents)
  r.get('/sessions', requireTelemetryAuth, getSessions)
  r.get('/stats', requireTelemetryAuth, (_req, res) => {
    res.json(store.stats())
  })
  r.delete('/events', requireTelemetryAuth, (_req, res) => {
    store.clear()
    res.json({ ok: true })
  })

  /** Flat CSV of all matching rows (optional sessionId / since / until). */
  r.get('/export.csv', requireTelemetryAuth, exportCsv)
  /** ZIP with one CSV per session_id plus no-session.csv when needed. */
  r.get('/export/by-session.zip', requireTelemetryAuth, exportBySessionZip)

  /** Server-Sent Events — live stream of new events (use ?token= if DEV_TELEMETRY_TOKEN is set). */
  r.get('/stream', requireTelemetryAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const send = (ev: unknown) => {
      res.write(`data: ${JSON.stringify(ev)}\n\n`)
    }

    send({ type: 'hello', stats: store.stats() })

    const unsub = store.subscribe((event) => {
      send({ type: 'event', event })
    })

    const keepAlive = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`)
    }, 25_000)

    req.on('close', () => {
      clearInterval(keepAlive)
      unsub()
    })
  })

  function expressJsonEvents(req: Request, res: Response) {
    const body = req.body as { events?: unknown } | unknown
    let list: unknown[] = []
    if (body && typeof body === 'object' && 'events' in body && Array.isArray((body as { events: unknown }).events)) {
      list = (body as { events: unknown[] }).events
    } else if (Array.isArray(body)) {
      list = body
    } else {
      res.status(400).json({ error: 'Body must be { events: [...] } or a JSON array' })
      return
    }

    const normalized: DevTelemetryEventInput[] = []
    for (const row of list) {
      if (!row || typeof row !== 'object') continue
      const o = row as Record<string, unknown>
      if (typeof o.kind !== 'string' || !o.kind.trim()) {
        res.status(400).json({ error: 'Each event must include a non-empty string "kind"' })
        return
      }
      normalized.push({
        id: typeof o.id === 'string' ? o.id : undefined,
        ts: typeof o.ts === 'string' ? o.ts : undefined,
        sessionId: typeof o.sessionId === 'string' ? o.sessionId : undefined,
        runId: typeof o.runId === 'string' ? o.runId : undefined,
        source: typeof o.source === 'string' ? o.source : undefined,
        kind: o.kind,
        level: o.level as DevTelemetryEventInput['level'],
        provider: typeof o.provider === 'string' ? o.provider : undefined,
        model: typeof o.model === 'string' ? o.model : undefined,
        payload:
          o.payload && typeof o.payload === 'object' && !Array.isArray(o.payload)
            ? (o.payload as Record<string, unknown>)
            : undefined,
      })
    }

    const ingested = store.ingest(normalized)
    res.status(201).json({ ok: true, count: ingested.length, ids: ingested.map((e) => e.id) })
  }

  function getEvents(req: Request, res: Response) {
    const q = req.query
    const limit = q.limit ? parseInt(String(q.limit), 10) : undefined
    const events = store.getEvents({
      limit: Number.isFinite(limit) ? limit : undefined,
      since: typeof q.since === 'string' ? q.since : undefined,
      until: typeof q.until === 'string' ? q.until : undefined,
      sessionId: typeof q.sessionId === 'string' ? q.sessionId : undefined,
      kind: typeof q.kind === 'string' ? q.kind : undefined,
      source: typeof q.source === 'string' ? q.source : undefined,
      provider: typeof q.provider === 'string' ? q.provider : undefined,
      level: q.level as import('./types.js').DevTelemetryLevel | undefined,
    })
    res.json({ events, stats: store.stats() })
  }

  function getSessions(_req: Request, res: Response) {
    res.json({ sessions: store.getSessions() })
  }

  function parseExportQuery(req: Request) {
    const q = req.query
    return {
      since: typeof q.since === 'string' ? q.since : undefined,
      until: typeof q.until === 'string' ? q.until : undefined,
      sessionId: typeof q.sessionId === 'string' ? q.sessionId : undefined,
    }
  }

  function exportCsv(req: Request, res: Response) {
    const { since, until, sessionId } = parseExportQuery(req)
    const events = store.getEventsForExport({ since, until, sessionId })
    const body = eventsToCsv(events)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="telemetry-export.csv"')
    res.send(body)
  }

  function exportBySessionZip(req: Request, res: Response, next: NextFunction) {
    const { since, until } = parseExportQuery(req)
    const archive = archiver('zip', { zlib: { level: 9 } })
    archive.on('error', (err) => {
      next(err)
    })
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="telemetry-by-session.zip"')
    archive.pipe(res)

    const summary = store.getExportSummary({ since, until })
    archive.append(JSON.stringify(summary, null, 2), { name: 'telemetry-export-summary.json' })

    const ids = store.listDistinctSessionIds({ since, until })
    for (const sid of ids) {
      const events = store.getEventsForExport({ sessionId: sid, since, until })
      archive.append(eventsToCsv(events), { name: `${safeZipEntryName(sid)}.csv` })
    }
    if (store.countEventsWithNullSession({ since, until }) > 0) {
      const events = store.getEventsForExport({ since, until, onlyUnassignedSession: true })
      archive.append(eventsToCsv(events), { name: 'no-session.csv' })
    }

    void archive.finalize()
  }

  return r
}

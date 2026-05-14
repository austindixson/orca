import { join } from 'path'
import type Database from 'better-sqlite3'
import type {
  DevTelemetryEvent,
  DevTelemetryEventInput,
  DevTelemetryQuery,
  DevTelemetrySessionSummary,
} from './types.js'
import { openTelemetryDatabase, rowToEvent } from './telemetrySqlite.js'
import { buildExportSummaryFromRows } from './telemetryExportSummary.js'

export type TelemetrySubscriber = (event: DevTelemetryEvent) => void

function normalize(input: DevTelemetryEventInput): DevTelemetryEvent {
  const payload =
    input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? (input.payload as Record<string, unknown>)
      : {}
  return {
    id: input.id?.trim() || crypto.randomUUID(),
    ts: input.ts?.trim() || new Date().toISOString(),
    kind: String(input.kind),
    sessionId: input.sessionId,
    runId: input.runId,
    source: input.source,
    level: input.level,
    provider: input.provider,
    model: input.model,
    payload,
  }
}

function defaultDbPath(): string {
  const env = process.env.DEV_TELEMETRY_SQLITE?.trim()
  if (env) return env
  if (process.env.NODE_ENV === 'test') return ':memory:'
  return join(process.cwd(), '.agent-canvas', 'dev-telemetry.sqlite')
}

export class DevTelemetryStore {
  private readonly db: Database.Database
  private readonly maxEvents: number
  private readonly dbPath: string
  private subscribers = new Set<TelemetrySubscriber>()

  private readonly insertStmt: Database.Statement
  private readonly countStmt: Database.Statement
  private readonly deleteOldestStmt: Database.Statement
  private readonly clearStmt: Database.Statement

  constructor(options?: { maxEvents?: number; dbPath?: string }) {
    const raw = options?.maxEvents ?? 100_000
    this.maxEvents = Math.max(1, Math.min(1_000_000, Number.isFinite(raw) ? Math.floor(raw) : 100_000))
    this.dbPath = options?.dbPath ?? defaultDbPath()
    this.db = openTelemetryDatabase(this.dbPath)

    this.insertStmt = this.db.prepare(`
      INSERT INTO telemetry_events (id, ts, kind, session_id, run_id, source, level, provider, model, payload_json)
      VALUES (@id, @ts, @kind, @session_id, @run_id, @source, @level, @provider, @model, @payload_json)
    `)
    this.countStmt = this.db.prepare(`SELECT COUNT(*) as c FROM telemetry_events`)
    this.deleteOldestStmt = this.db.prepare(`
      DELETE FROM telemetry_events WHERE seq IN (
        SELECT seq FROM telemetry_events ORDER BY seq ASC LIMIT ?
      )
    `)
    this.clearStmt = this.db.prepare(`DELETE FROM telemetry_events`)
  }

  /** Close DB (tests / process shutdown). */
  close(): void {
    try {
      this.db.close()
    } catch {
      /* */
    }
  }

  subscribe(fn: TelemetrySubscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  private emit(ev: DevTelemetryEvent) {
    for (const fn of this.subscribers) {
      try {
        fn(ev)
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  private pruneIfNeeded() {
    const row = this.countStmt.get() as { c: number }
    const total = row?.c ?? 0
    if (total <= this.maxEvents) return
    const excess = total - this.maxEvents
    this.deleteOldestStmt.run(excess)
  }

  /**
   * Append one or more events to SQLite; prune oldest rows past maxEvents.
   */
  ingest(inputs: DevTelemetryEventInput[]): DevTelemetryEvent[] {
    const out: DevTelemetryEvent[] = []
    const insertMany = this.db.transaction((rows: DevTelemetryEvent[]) => {
      for (const ev of rows) {
        this.insertStmt.run({
          id: ev.id,
          ts: ev.ts,
          kind: ev.kind,
          session_id: ev.sessionId ?? null,
          run_id: ev.runId ?? null,
          source: ev.source ?? null,
          level: ev.level ?? null,
          provider: ev.provider ?? null,
          model: ev.model ?? null,
          payload_json: JSON.stringify(ev.payload),
        })
      }
      this.pruneIfNeeded()
    })

    for (const raw of inputs) {
      const ev = normalize(raw)
      out.push(ev)
    }
    if (out.length > 0) {
      insertMany(out)
      for (const ev of out) this.emit(ev)
    }
    return out
  }

  getEvents(q: DevTelemetryQuery = {}): DevTelemetryEvent[] {
    const limit = Math.min(10_000, Math.max(1, q.limit ?? 500))
    const conditions: string[] = ['1=1']
    const params: unknown[] = []

    if (q.since) {
      conditions.push('ts >= ?')
      params.push(q.since)
    }
    if (q.until) {
      conditions.push('ts <= ?')
      params.push(q.until)
    }
    if (q.sessionId) {
      conditions.push('session_id = ?')
      params.push(q.sessionId)
    }
    if (q.kind) {
      conditions.push('kind = ?')
      params.push(q.kind)
    }
    if (q.source) {
      conditions.push('source = ?')
      params.push(q.source)
    }
    if (q.provider) {
      conditions.push('provider = ?')
      params.push(q.provider)
    }
    if (q.level) {
      conditions.push('level = ?')
      params.push(q.level)
    }

    const where = conditions.join(' AND ')
    const sql = `
      SELECT id, ts, kind, session_id, run_id, source, level, provider, model, payload_json
      FROM (
        SELECT seq, id, ts, kind, session_id, run_id, source, level, provider, model, payload_json
        FROM telemetry_events
        WHERE ${where}
        ORDER BY seq DESC
        LIMIT ?
      ) AS sub
      ORDER BY sub.seq ASC
    `
    params.push(limit)
    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string
      ts: string
      kind: string
      session_id: string | null
      run_id: string | null
      source: string | null
      level: string | null
      provider: string | null
      model: string | null
      payload_json: string
    }>
    return rows.map((r) => rowToEvent(r))
  }

  /**
   * All matching events for CSV export (no row cap). Ordered by session_id, then time, then seq.
   */
  getEventsForExport(
    q: {
      sessionId?: string
      since?: string
      until?: string
      /** Only rows with no session_id (exported as `no-session.csv` in zip). */
      onlyUnassignedSession?: boolean
    } = {}
  ): DevTelemetryEvent[] {
    const conditions: string[] = ['1=1']
    const params: unknown[] = []

    if (q.since) {
      conditions.push('ts >= ?')
      params.push(q.since)
    }
    if (q.until) {
      conditions.push('ts <= ?')
      params.push(q.until)
    }
    if (q.onlyUnassignedSession) {
      conditions.push('session_id IS NULL')
    } else if (q.sessionId) {
      conditions.push('session_id = ?')
      params.push(q.sessionId)
    }

    const where = conditions.join(' AND ')
    const sql = `
      SELECT id, ts, kind, session_id, run_id, source, level, provider, model, payload_json
      FROM telemetry_events
      WHERE ${where}
      ORDER BY COALESCE(session_id, ''), ts ASC, seq ASC
    `
    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string
      ts: string
      kind: string
      session_id: string | null
      run_id: string | null
      source: string | null
      level: string | null
      provider: string | null
      model: string | null
      payload_json: string
    }>
    return rows.map((r) => rowToEvent(r))
  }

  /** Distinct non-null session ids (optionally time-filtered), sorted lexicographically. */
  listDistinctSessionIds(q: { since?: string; until?: string } = {}): string[] {
    const conditions: string[] = ['session_id IS NOT NULL']
    const params: unknown[] = []
    if (q.since) {
      conditions.push('ts >= ?')
      params.push(q.since)
    }
    if (q.until) {
      conditions.push('ts <= ?')
      params.push(q.until)
    }
    const where = conditions.join(' AND ')
    const sql = `SELECT DISTINCT session_id FROM telemetry_events WHERE ${where} ORDER BY session_id`
    const rows = this.db.prepare(sql).all(...params) as { session_id: string }[]
    return rows.map((r) => r.session_id)
  }

  countEventsWithNullSession(q: { since?: string; until?: string } = {}): number {
    const conditions: string[] = ['session_id IS NULL']
    const params: unknown[] = []
    if (q.since) {
      conditions.push('ts >= ?')
      params.push(q.since)
    }
    if (q.until) {
      conditions.push('ts <= ?')
      params.push(q.until)
    }
    const where = conditions.join(' AND ')
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM telemetry_events WHERE ${where}`).get(...params) as {
      c: number
    }
    return row?.c ?? 0
  }

  getSessions(limit = 50): DevTelemetrySessionSummary[] {
    const sql = `
      SELECT
        e.session_id AS session_id,
        COUNT(*) AS event_count,
        MIN(e.ts) AS first_ts,
        MAX(e.ts) AS last_ts,
        (
          SELECT kind FROM telemetry_events e2
          WHERE e2.session_id = e.session_id
          ORDER BY e2.seq DESC
          LIMIT 1
        ) AS last_kind,
        (
          SELECT source FROM telemetry_events e2
          WHERE e2.session_id = e.session_id
          ORDER BY e2.seq DESC
          LIMIT 1
        ) AS last_source
      FROM telemetry_events e
      WHERE e.session_id IS NOT NULL
      GROUP BY e.session_id
      ORDER BY last_ts DESC
      LIMIT ?
    `
    const rows = this.db.prepare(sql).all(limit) as Array<{
      session_id: string
      event_count: number
      first_ts: string
      last_ts: string
      last_kind: string | null
      last_source: string | null
    }>
    return rows.map((r) => ({
      sessionId: r.session_id,
      firstTs: r.first_ts,
      lastTs: r.last_ts,
      eventCount: r.event_count,
      lastKind: r.last_kind ?? undefined,
      lastSource: r.last_source ?? undefined,
    }))
  }

  stats() {
    const total = (this.countStmt.get() as { c: number }).c
    const sessionRow = this.db
      .prepare(`SELECT COUNT(DISTINCT session_id) as c FROM telemetry_events WHERE session_id IS NOT NULL`)
      .get() as { c: number }
    return {
      totalEvents: total,
      maxEvents: this.maxEvents,
      subscriberCount: this.subscribers.size,
      sessionCount: sessionRow?.c ?? 0,
      sqlitePath: this.dbPath,
    }
  }

  /**
   * Summary row for ZIP/CSV export metadata (pattern counts are substring scans over payload_json).
   */
  getExportSummary(q: { since?: string; until?: string } = {}) {
    const conditions: string[] = ['1=1']
    const params: unknown[] = []
    if (q.since) {
      conditions.push('ts >= ?')
      params.push(q.since)
    }
    if (q.until) {
      conditions.push('ts <= ?')
      params.push(q.until)
    }
    const where = conditions.join(' AND ')
    const rows = this.db
      .prepare(
        `SELECT kind, session_id, source, payload_json FROM telemetry_events WHERE ${where} ORDER BY seq ASC`
      )
      .all(...params) as Array<{
      kind: string
      session_id: string | null
      source: string | null
      payload_json: string
    }>
    return buildExportSummaryFromRows(rows, q)
  }

  clear() {
    this.clearStmt.run()
  }
}

/** Singleton for the running server process. */
let singleton: DevTelemetryStore | null = null

export function getDevTelemetryStore(): DevTelemetryStore {
  if (!singleton) {
    const max = process.env.DEV_TELEMETRY_MAX_EVENTS
      ? parseInt(process.env.DEV_TELEMETRY_MAX_EVENTS, 10)
      : undefined
    singleton = new DevTelemetryStore({
      maxEvents: Number.isFinite(max) ? max : undefined,
    })
  }
  return singleton
}

export function resetDevTelemetryStoreForTests() {
  if (singleton) {
    singleton.close()
    singleton = null
  }
}

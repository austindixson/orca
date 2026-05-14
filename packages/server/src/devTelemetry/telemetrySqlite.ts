import { mkdirSync } from 'fs'
import { dirname } from 'path'
import Database from 'better-sqlite3'
import type { DevTelemetryEvent } from './types.js'

const SCHEMA_VERSION = 2

function ensureTelemetryEventsTable(db: InstanceType<typeof Database>) {
  const cols = db.prepare(`PRAGMA table_info(telemetry_events)`).all() as { name: string }[]
  if (cols.length > 0 && !cols.some((c) => c.name === 'seq')) {
    db.exec(`DROP TABLE telemetry_events`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      session_id TEXT,
      run_id TEXT,
      source TEXT,
      level TEXT,
      provider TEXT,
      model TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry_events(ts);
    CREATE INDEX IF NOT EXISTS idx_telemetry_ts_seq ON telemetry_events(ts, seq);
    CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_telemetry_kind ON telemetry_events(kind);
    CREATE INDEX IF NOT EXISTS idx_telemetry_source ON telemetry_events(source);
    CREATE INDEX IF NOT EXISTS idx_telemetry_provider ON telemetry_events(provider);
  `)
}

export function openTelemetryDatabase(dbPath: string): InstanceType<typeof Database> {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  ensureTelemetryEventsTable(db)

  const row = db.prepare(`SELECT value FROM telemetry_meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined
  const v = row ? parseInt(row.value, 10) : 0
  if (v < SCHEMA_VERSION) {
    db.prepare(`INSERT OR REPLACE INTO telemetry_meta (key, value) VALUES ('schema_version', ?)`).run(
      String(SCHEMA_VERSION)
    )
  }

  return db
}

export function rowToEvent(row: {
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
}): DevTelemetryEvent {
  let payload: Record<string, unknown> = {}
  try {
    const p = JSON.parse(row.payload_json) as unknown
    if (p && typeof p === 'object' && !Array.isArray(p)) payload = p as Record<string, unknown>
  } catch {
    payload = { _parseError: true, raw: row.payload_json }
  }
  return {
    id: row.id,
    ts: row.ts,
    kind: row.kind,
    sessionId: row.session_id ?? undefined,
    runId: row.run_id ?? undefined,
    source: row.source ?? undefined,
    level: (row.level as DevTelemetryEvent['level']) ?? undefined,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    payload,
  }
}

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { TELEMETRY_CSV_HEADER } from './telemetryCsv.js'
import { createDevTelemetryRouter } from './routes.js'
import { resetDevTelemetryStoreForTests, getDevTelemetryStore } from './store.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/dev/telemetry', createDevTelemetryRouter())
  return app
}

describe('dev telemetry HTTP', () => {
  const prevToken = process.env.DEV_TELEMETRY_TOKEN
  const prevSqlite = process.env.DEV_TELEMETRY_SQLITE

  beforeEach(() => {
    resetDevTelemetryStoreForTests()
    delete process.env.DEV_TELEMETRY_TOKEN
    process.env.DEV_TELEMETRY_SQLITE = ':memory:'
  })

  afterEach(() => {
    if (prevToken === undefined) delete process.env.DEV_TELEMETRY_TOKEN
    else process.env.DEV_TELEMETRY_TOKEN = prevToken
    if (prevSqlite === undefined) delete process.env.DEV_TELEMETRY_SQLITE
    else process.env.DEV_TELEMETRY_SQLITE = prevSqlite
  })

  test('POST /events ingests batch', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/dev/telemetry/events')
      .send({
        events: [
          { kind: 'log', sessionId: 's1', payload: { line: 'hello' } },
          { kind: 'llm_meta', provider: 'xai', model: 'grok-2', payload: { durationMs: 12000 } },
        ],
      })
      .expect(201)

    assert.equal(res.body.ok, true)
    assert.equal(res.body.count, 2)
    assert.equal(res.body.ids.length, 2)

    const q = await request(app).get('/api/dev/telemetry/events').expect(200)
    assert.equal(q.body.events.length, 2)
    assert.equal(q.body.events[1].provider, 'xai')
  })

  test('GET /events filters by kind', async () => {
    const app = makeApp()
    await request(app)
      .post('/api/dev/telemetry/events')
      .send({ events: [{ kind: 'a' }, { kind: 'b' }] })
      .expect(201)

    const res = await request(app).get('/api/dev/telemetry/events').query({ kind: 'b' }).expect(200)
    assert.equal(res.body.events.length, 1)
    assert.equal(res.body.events[0].kind, 'b')
  })

  test('DELETE /events clears', async () => {
    const app = makeApp()
    await request(app).post('/api/dev/telemetry/events').send({ events: [{ kind: 'log' }] }).expect(201)
    await request(app).delete('/api/dev/telemetry/events').expect(200)
    const res = await request(app).get('/api/dev/telemetry/events').expect(200)
    assert.equal(res.body.events.length, 0)
  })

  test('401 when DEV_TELEMETRY_TOKEN set and no auth', async () => {
    process.env.DEV_TELEMETRY_TOKEN = 'secret'
    resetDevTelemetryStoreForTests()
    const app = makeApp()
    await request(app).post('/api/dev/telemetry/events').send({ events: [{ kind: 'log' }] }).expect(401)
  })

  test('Bearer token allows ingest', async () => {
    process.env.DEV_TELEMETRY_TOKEN = 'secret'
    resetDevTelemetryStoreForTests()
    const app = makeApp()
    await request(app)
      .post('/api/dev/telemetry/events')
      .set('Authorization', 'Bearer secret')
      .send({ events: [{ kind: 'log' }] })
      .expect(201)
    assert.equal(getDevTelemetryStore().getEvents().length, 1)
  })

  test('GET /health is unauthenticated', async () => {
    process.env.DEV_TELEMETRY_TOKEN = 'secret'
    resetDevTelemetryStoreForTests()
    const app = makeApp()
    await request(app).get('/api/dev/telemetry/health').expect(200)
  })

  test('GET /export.csv returns CSV with header and rows', async () => {
    const app = makeApp()
    await request(app)
      .post('/api/dev/telemetry/events')
      .send({
        events: [
          { kind: 'log', sessionId: 'sess-a', ts: '2026-01-01T00:00:00.000Z' },
          { kind: 'log', sessionId: 'sess-b', ts: '2026-01-01T00:00:01.000Z' },
        ],
      })
      .expect(201)

    const res = await request(app).get('/api/dev/telemetry/export.csv').expect(200)
    assert.equal(res.headers['content-type']?.includes('text/csv'), true)
    const text = String(res.text)
    assert.ok(text.startsWith(TELEMETRY_CSV_HEADER))
    assert.ok(text.includes('sess-a'))
    assert.ok(text.includes('sess-b'))
  })

  test('GET /export.csv ?sessionId filters', async () => {
    const app = makeApp()
    await request(app)
      .post('/api/dev/telemetry/events')
      .send({
        events: [
          { kind: 'a', sessionId: 'only-me' },
          { kind: 'b', sessionId: 'other' },
        ],
      })
      .expect(201)

    const res = await request(app).get('/api/dev/telemetry/export.csv').query({ sessionId: 'only-me' }).expect(200)
    assert.ok(String(res.text).includes('only-me'))
    assert.ok(!String(res.text).includes('other'))
  })

  test('GET /export/by-session.zip returns zip', async () => {
    const app = makeApp()
    await request(app)
      .post('/api/dev/telemetry/events')
      .send({
        events: [
          { kind: 'x', sessionId: 'zip-s1' },
          { kind: 'y', sessionId: 'zip-s2' },
          { kind: 'z', payload: {} },
        ],
      })
      .expect(201)

    const res = await request(app).get('/api/dev/telemetry/export/by-session.zip').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })

    assert.equal(res.status, 200)
    assert.equal(res.headers['content-type'], 'application/zip')
    const buf = res.body as Buffer
    assert.ok(Buffer.isBuffer(buf))
    assert.equal(buf.slice(0, 4).toString('binary'), 'PK\u0003\u0004')
    assert.ok(
      buf.includes(Buffer.from('telemetry-export-summary.json')),
      'zip should include telemetry-export-summary.json entry name'
    )
  })

  test('401 on export when token required', async () => {
    process.env.DEV_TELEMETRY_TOKEN = 'secret'
    resetDevTelemetryStoreForTests()
    const app = makeApp()
    await request(app).get('/api/dev/telemetry/export.csv').expect(401)
    await request(app).get('/api/dev/telemetry/export/by-session.zip').expect(401)
  })
})

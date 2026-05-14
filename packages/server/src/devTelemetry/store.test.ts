import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DevTelemetryStore, resetDevTelemetryStoreForTests } from './store.js'

describe('DevTelemetryStore', () => {
  beforeEach(() => {
    resetDevTelemetryStoreForTests()
  })

  test('ingest assigns id and ts', () => {
    const s = new DevTelemetryStore({ maxEvents: 100, dbPath: ':memory:' })
    const [a] = s.ingest([{ kind: 'log', payload: { message: 'hi' } }])
    assert.match(a.id, /^[0-9a-f-]{36}$/i)
    assert.ok(a.ts)
    assert.equal(a.kind, 'log')
    assert.equal(a.payload.message, 'hi')
  })

  test('ring buffer drops oldest', () => {
    const s = new DevTelemetryStore({ maxEvents: 3, dbPath: ':memory:' })
    s.ingest([{ kind: 'a' }, { kind: 'b' }, { kind: 'c' }, { kind: 'd' }])
    const evs = s.getEvents({ limit: 10 })
    assert.equal(evs.length, 3)
    assert.equal(evs[0].kind, 'b')
    assert.equal(evs[2].kind, 'd')
  })

  test('filter by sessionId', () => {
    const s = new DevTelemetryStore({ maxEvents: 100, dbPath: ':memory:' })
    s.ingest([
      { kind: 'log', sessionId: 's1' },
      { kind: 'log', sessionId: 's2' },
    ])
    const evs = s.getEvents({ sessionId: 's1' })
    assert.equal(evs.length, 1)
    assert.equal(evs[0].sessionId, 's1')
  })

  test('getSessions aggregates', () => {
    const s = new DevTelemetryStore({ maxEvents: 100, dbPath: ':memory:' })
    s.ingest([
      { kind: 'log', sessionId: 'alpha' },
      { kind: 'tool_call', sessionId: 'alpha' },
      { kind: 'log', sessionId: 'beta' },
    ])
    const sessions = s.getSessions()
    assert.equal(sessions.length, 2)
    const a = sessions.find((x) => x.sessionId === 'alpha')
    assert.ok(a)
    assert.equal(a!.eventCount, 2)
  })

  test('subscriber receives new events', () => {
    const s = new DevTelemetryStore({ maxEvents: 100, dbPath: ':memory:' })
    const seen: string[] = []
    s.subscribe((e) => seen.push(e.kind))
    s.ingest([{ kind: 'x' }, { kind: 'y' }])
    assert.deepEqual(seen, ['x', 'y'])
  })

  test('clear removes all', () => {
    const s = new DevTelemetryStore({ maxEvents: 100, dbPath: ':memory:' })
    s.ingest([{ kind: 'log' }])
    s.clear()
    assert.equal(s.getEvents().length, 0)
  })

  test('getExportSummary aggregates patterns', () => {
    const s = new DevTelemetryStore({ maxEvents: 100, dbPath: ':memory:' })
    s.ingest([
      {
        kind: 'output',
        sessionId: 's1',
        source: 'terminal',
        payload: { text: '[Terminal connection timed out]' },
      },
      { kind: 'log', payload: { line: 'Still waiting' } },
    ])
    const summary = s.getExportSummary({})
    assert.equal(summary.totals.events, 2)
    assert.equal(summary.issueSignals.terminalConnectionTimedOut, 1)
    assert.equal(summary.issueSignals.stillWaiting, 1)
    assert.ok(summary.totals.unassignedSessionEvents >= 1)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildActiveTimelineEntries, entriesThrough } from './buildActiveTimeline'
import type { TimelineJsonlRecord } from '../persistence/sessionPersistence'

describe('buildActiveTimelineEntries', () => {
  it('parses arrow tool lines and merges milestones', () => {
    const raw: TimelineJsonlRecord[] = [
      { at: 100, kind: 'tool_start', line: '→ read_file path/to/x' },
      { at: 200, kind: 'tool_end', line: '← read_file ok' },
      { at: 300, kind: 'tool_end', line: '← run_terminal_cmd Error: exited 1' },
    ]
    const milestones = [
      {
        id: 'm1',
        at: 150,
        title: 'Ship feature X',
        body: 'Worked in staging',
        outcome: 'win' as const,
      },
    ]
    const e = buildActiveTimelineEntries(raw, milestones)
    assert.match(e[0].title, /Started · read_file/)
    assert.equal(e[1].kind, 'milestone')
    assert.equal(e[2].outcome, 'ok')
    assert.equal(e[3].outcome, 'bad')
  })

  it('entriesThrough filters by scrub time', () => {
    const entries = buildActiveTimelineEntries(
      [
        { at: 10, kind: 'tool_start', line: '→ x' },
        { at: 20, kind: 'tool_end', line: '← x ok' },
      ],
      []
    )
    assert.equal(entriesThrough(entries, 15).length, 1)
    assert.equal(entriesThrough(entries, 25).length, 2)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatWorkspaceTraceLine,
  summarizeHermesProviderNoticeLine,
} from './hermesTracePresentation'

describe('summarizeHermesProviderNoticeLine', () => {
  it('suppresses noisy response.created and response.output* event traces', () => {
    assert.equal(summarizeHermesProviderNoticeLine('event: response.created'), null)
    assert.equal(summarizeHermesProviderNoticeLine('event: response.output_text.delta'), null)
    assert.equal(summarizeHermesProviderNoticeLine('event: response.output_item.done'), null)
  })

  it('keeps non-noisy event lines as compact trace chips', () => {
    assert.equal(summarizeHermesProviderNoticeLine('event: response.completed'), '◆ response.completed')
  })

  it('renders skill_view call/done lines with skill name and elapsed duration', () => {
    const added =
      'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"skill_view","call_id":"call_skill_1","arguments":"{\\"name\\":\\"test-driven-development\\"}"}}'
    const done =
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"skill_view","call_id":"call_skill_1"}}'

    assert.equal(
      summarizeHermesProviderNoticeLine(added),
      '┊ skill     test-driven-development'
    )
    assert.match(
      summarizeHermesProviderNoticeLine(done) ?? '',
      /^┊ skill\s+test-driven-development\s+\d+\.\ds$/
    )
  })

  it('renders plan/todo traces with task counts', () => {
    const planAdded =
      'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"plan","call_id":"call_plan_1","arguments":"{\\"action\\":\\"update\\",\\"todos\\":[{\\"id\\":\\"a\\"},{\\"id\\":\\"b\\"},{\\"id\\":\\"c\\"},{\\"id\\":\\"d\\"},{\\"id\\":\\"e\\"}]}"}}'
    const planDone =
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"plan","call_id":"call_plan_1"}}'

    assert.equal(summarizeHermesProviderNoticeLine(planAdded), '┊ plan      5 task(s)')
    assert.match(summarizeHermesProviderNoticeLine(planDone) ?? '', /^┊ plan\s+5 task\(s\)\s+\d+\.\ds$/)
  })

  it('includes useful argument details for generic function-call add events', () => {
    const readCall =
      'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"read_file","arguments":"{\\"path\\":\\"/Users/ghost/Desktop/orca/packages/client/src/lib/orchestrator/executeTools.ts\\"}"}}'
    const searchCall =
      'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"search_files","arguments":"{\\"target\\":\\"content\\",\\"pattern\\":\\"browser_navigate|_stdout_open\\"}"}}'
    assert.equal(
      summarizeHermesProviderNoticeLine(readCall),
      '→ read_file path=/Users/ghost/Desktop/orca/packages/client/src/lib/orchestrator/executeTools.ts'
    )
    assert.equal(
      summarizeHermesProviderNoticeLine(searchCall),
      '→ search_files target=content pattern=browser_navigate|_stdout_open'
    )
  })

  it('clamps very long path arguments for narrow trace surfaces', () => {
    const readCall =
      'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"read_file","arguments":"{\\"path\\":\\"/Users/ghost/Desktop/orca/packages/client/src/components/tiles/agent-tile/super/deep/location/with/extra/segments/AgentTraceDrawer.tsx\\"}"}}'
    const out = summarizeHermesProviderNoticeLine(readCall)
    assert.ok(out)
    assert.match(out ?? '', /^→ read_file path=.+….+AgentTraceDrawer\.tsx$/)
    assert.ok((out ?? '').length < 120)
  })

  it('adds elapsed counters for generic function-call done events', () => {
    const add =
      'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"search_files","call_id":"call_search_1","arguments":"{\\"target\\":\\"content\\",\\"pattern\\":\\"hermes\\"}"}}'
    const done =
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"search_files","call_id":"call_search_1"}}'

    assert.equal(summarizeHermesProviderNoticeLine(add), '→ search_files target=content pattern=hermes')
    assert.match(summarizeHermesProviderNoticeLine(done) ?? '', /^← search_files\s+\d+\.\ds$/)
  })

  it('ignores noisy delta payloads and malformed data', () => {
    assert.equal(
      summarizeHermesProviderNoticeLine(
        'data: {"type":"response.output_text.delta","delta":"Hello"}'
      ),
      null
    )
    assert.equal(summarizeHermesProviderNoticeLine('data: not-json'), null)
  })

  it('supports bracket-style hermes trace markers with noise suppression', () => {
    assert.equal(
      summarizeHermesProviderNoticeLine('[Hermes trace] response.completed'),
      '◆ response.completed'
    )
    assert.equal(summarizeHermesProviderNoticeLine('[Hermes trace] response.created'), null)
  })
})

describe('formatWorkspaceTraceLine', () => {
  it('renders a neutral workspace trace row with active path', () => {
    assert.equal(
      formatWorkspaceTraceLine('/Users/ghost/Desktop/orca'),
      '┊ workspace /Users/ghost/Desktop/orca'
    )
  })

  it('falls back to no-workspace label when root is missing', () => {
    assert.equal(formatWorkspaceTraceLine(null), '┊ workspace (no workspace)')
  })
})

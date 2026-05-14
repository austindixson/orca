import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyAgentLogLine, tallyAgentIssues } from './agentIssueDetector'

test('classifyAgentLogLine: detects hard failures as "fail"', () => {
  assert.equal(classifyAgentLogLine('tests failed'), 'fail')
  assert.equal(classifyAgentLogLine('Build failed while bundling'), 'fail')
  assert.equal(classifyAgentLogLine('deployment failed: timeout'), 'fail')
  assert.equal(classifyAgentLogLine('command exited with code 1'), 'fail')
  assert.equal(classifyAgentLogLine('process exited with code 137'), 'fail')
  assert.equal(classifyAgentLogLine('exit code: 2'), 'fail')
  assert.equal(classifyAgentLogLine('FAIL src/foo.test.ts'), 'fail')
})

test('classifyAgentLogLine: prefers fail over generic error for "build failed"', () => {
  // "build failed" matches FAIL_RE; we should never double-classify it as error.
  assert.equal(classifyAgentLogLine('build failed'), 'fail')
})

test('classifyAgentLogLine: detects explicit errors as "error"', () => {
  assert.equal(classifyAgentLogLine('Error: something broke'), 'error')
  assert.equal(classifyAgentLogLine(' [Error] connection reset'), 'error')
  assert.equal(classifyAgentLogLine('Uncaught Exception: oops'), 'error')
  assert.equal(classifyAgentLogLine('TypeError: x is not a function'), 'error')
  assert.equal(classifyAgentLogLine('ReferenceError: foo is not defined'), 'error')
  assert.equal(classifyAgentLogLine('SyntaxError: Unexpected token'), 'error')
  assert.equal(classifyAgentLogLine('unhandledRejection in worker'), 'error')
  assert.equal(classifyAgentLogLine('HTTP/1.1 500 Internal Server Error'), 'error')
  assert.equal(classifyAgentLogLine('got HTTP 503 from upstream'), 'error')
  assert.equal(classifyAgentLogLine('failed to connect to db'), 'error')
  assert.equal(classifyAgentLogLine('panic: runtime error'), 'error')
})

test('classifyAgentLogLine: detects warnings as "warning"', () => {
  assert.equal(classifyAgentLogLine('Warning: deprecated api'), 'warning')
  assert.equal(classifyAgentLogLine(' [Warning] slow query'), 'warning')
  assert.equal(classifyAgentLogLine(' [warn] retrying'), 'warning')
  assert.equal(classifyAgentLogLine('WARN retrying after 2s'), 'warning')
  assert.equal(classifyAgentLogLine('deprecated: use newThing() instead'), 'warning')
})

test('classifyAgentLogLine: ignores our own [Error: ...] chat banner', () => {
  // runTask pushes "[Error: ...]" into the transcript on throw — we must not
  // double-count that line as an error since the upstream throw already got
  // one.
  assert.equal(classifyAgentLogLine('[Error: connection timed out]'), null)
})

test('classifyAgentLogLine: returns null for unrelated lines', () => {
  assert.equal(classifyAgentLogLine(''), null)
  assert.equal(classifyAgentLogLine('   '), null)
  assert.equal(classifyAgentLogLine('Running 12 tests…'), null)
  assert.equal(classifyAgentLogLine('✓ src/app.test.ts'), null)
  assert.equal(classifyAgentLogLine('exit code: 0'), null)
  assert.equal(classifyAgentLogLine('command exited with code 0'), null)
})

test('tallyAgentIssues: sums issues across multiple lines', () => {
  const text = [
    'Running tests…',
    'Warning: deprecated api',
    '✓ src/a.test.ts',
    'TypeError: x is not a function',
    'FAIL src/b.test.ts',
    'deploy failed: timeout',
    '',
  ].join('\n')
  const counts = tallyAgentIssues(text)
  assert.equal(counts.error, 1)
  assert.equal(counts.warning, 1)
  assert.equal(counts.fail, 2)
})

test('tallyAgentIssues: handles empty input', () => {
  assert.deepEqual(tallyAgentIssues(''), { error: 0, warning: 0, fail: 0 })
})

test('tallyAgentIssues: handles CRLF line endings', () => {
  const text = 'Warning: a\r\nError: b\r\nFAIL c'
  const counts = tallyAgentIssues(text)
  assert.equal(counts.warning, 1)
  assert.equal(counts.error, 1)
  assert.equal(counts.fail, 1)
})

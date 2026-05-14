import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyTerminalFailure,
  classifyTerminalSeverity,
  terminalErrorSignature,
} from './tapTerminalOutput'
import {
  classifyUnhandledRejectionTelemetry,
  classifyWindowErrorTelemetry,
} from './installGlobalErrorCapture'

describe('tapTerminalOutput helpers', () => {
  it('classifies panic/fatal/segfault as critical', () => {
    assert.equal(classifyTerminalSeverity('panic: runtime error'), 'critical')
    assert.equal(classifyTerminalSeverity('FATAL: cannot connect'), 'critical')
    assert.equal(classifyTerminalSeverity('uncaught TypeError'), 'critical')
    assert.equal(
      classifyTerminalSeverity('unhandled promise rejection'),
      'critical'
    )
  })

  it('classifies plain error/failed as high', () => {
    assert.equal(classifyTerminalSeverity('[error] oops'), 'high')
    assert.equal(classifyTerminalSeverity('build failed'), 'high')
    assert.equal(classifyTerminalSeverity('exit (1)'), 'high')
  })

  it('classifies warn/deprecated/timeout as medium', () => {
    assert.equal(classifyTerminalSeverity('warning: stuff'), 'medium')
    assert.equal(classifyTerminalSeverity('deprecated api'), 'medium')
    assert.equal(classifyTerminalSeverity('request timeout, retry 2'), 'medium')
  })

  it('classifies dependency and package resolution failures', () => {
    assert.deepEqual(classifyTerminalFailure("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite'"), {
      severity: 'error',
      kind: 'dependency_missing',
      recoverability: 'user_action_required',
      summary: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite'",
    })
    assert.deepEqual(classifyTerminalFailure('npm error code ERESOLVE'), {
      severity: 'error',
      kind: 'package_resolve',
      recoverability: 'user_action_required',
      summary: 'npm error code ERESOLVE',
    })
  })

  it('signature collapses timestamps, paths, and hex ids for dedupe', () => {
    const a = terminalErrorSignature(
      '2024-01-02T03:04:05.123Z [error] /Users/x/foo/bar.ts:42 0xdeadbeef unhandled'
    )
    const b = terminalErrorSignature(
      '2025-09-12T22:11:00.000Z [error] /opt/app/baz.ts:999 0xabc123 unhandled'
    )
    assert.equal(a, b)
    assert.match(a, /<ts>|<time>/)
    assert.match(a, /<path>/)
    assert.match(a, /<hex>/)
  })

  it('signature is bounded to 240 chars', () => {
    const long = 'x'.repeat(2000)
    assert.ok(terminalErrorSignature(long).length <= 240)
  })

  it('downgrades benign Monaco cancellation rejections', () => {
    const result = classifyUnhandledRejectionTelemetry(
      'Canceled\ncancel@https://cdn.jsdelivr.net/npm/monaco-editor/min/vs/editor.js\ndispose@https://cdn.jsdelivr.net/npm/monaco-editor/min/vs/editor.js\nsetModel@http://localhost:5173/node_modules/.vite/deps/@monaco-editor_react.js:587:79'
    )
    assert.ok(result)
    assert.equal(result?.category, 'log')
    assert.equal(result?.level, 'warn')
    assert.equal(result?.title, 'unhandledrejection (monaco cancellation noise)')
  })

  it('handles nullish rejection reasons without throwing', () => {
    const undefinedResult = classifyUnhandledRejectionTelemetry(undefined)
    assert.ok(undefinedResult)
    assert.equal(undefinedResult?.category, 'error')
    assert.equal(undefinedResult?.text, 'undefined')

    const nullResult = classifyUnhandledRejectionTelemetry(null)
    assert.ok(nullResult)
    assert.equal(nullResult?.category, 'error')
    assert.equal(nullResult?.text, 'null')
  })

  it('downgrades generic cross-origin script error noise', () => {
    const result = classifyWindowErrorTelemetry({
      message: 'Script error.',
      filename: '',
      lineno: 0,
      colno: 0,
      error: undefined,
    } as ErrorEvent)
    assert.equal(result.category, 'log')
    assert.equal(result.level, 'warn')
    assert.equal(result.title, 'window.error (generic script noise)')
  })
})

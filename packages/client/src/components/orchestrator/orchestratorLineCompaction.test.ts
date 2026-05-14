import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compactToolLine } from './orchestratorLineCompaction'

test('compactToolLine maps tool start to running label', () => {
  assert.equal(compactToolLine('→ run_shell_command({"command":"npm test"})'), 'Running run_shell_command')
})

test('compactToolLine maps tool result success/failure', () => {
  assert.equal(compactToolLine('← run_shell_command ok=true'), 'run_shell_command done')
  assert.equal(compactToolLine('← run_shell_command ok=false error=timeout'), 'run_shell_command failed')
})

test('compactToolLine maps phase/resumed tags and ignores plain text', () => {
  assert.equal(compactToolLine('[Phase 2/5] Tool execution'), 'Phase 2/5')
  assert.equal(compactToolLine('[Resumed] continuing run'), 'Resumed')
  assert.equal(compactToolLine('Assistant · Normal prose line'), null)
})

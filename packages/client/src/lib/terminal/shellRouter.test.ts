import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyShellCommand } from './shellRouter'

describe('shellRouter', () => {
  test('classify: dev server patterns prefer PTY', () => {
    assert.equal(classifyShellCommand('npm run dev').hint, 'terminal_pty')
    assert.equal(classifyShellCommand('cd app && pnpm run start').hint, 'terminal_pty')
    assert.equal(classifyShellCommand('npx vite').hint, 'terminal_pty')
  })

  test('classify: install/test patterns prefer subprocess', () => {
    assert.equal(classifyShellCommand('npm ci').hint, 'subprocess')
    assert.equal(classifyShellCommand('git status').hint, 'subprocess')
    assert.equal(classifyShellCommand('cargo test').hint, 'subprocess')
  })
})

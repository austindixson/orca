import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeNonInteractiveShellInput } from './nonInteractiveCommands'

describe('normalizeNonInteractiveShellInput', () => {
  it('adds --no-interactive for create-vite command strings', () => {
    const r = normalizeNonInteractiveShellInput({
      command: 'npx --yes create-vite@latest app --template react-ts && cd app && npm install',
    })
    assert.equal(r.changed, true)
    assert.match(r.command, /create-vite@latest app --template react-ts --no-interactive/)
  })

  it('adds --yes for create-next-app argv', () => {
    const r = normalizeNonInteractiveShellInput({
      command: 'npx create-next-app@latest .',
      argv: ['npx', 'create-next-app@latest', '.'],
    })
    assert.equal(r.changed, true)
    assert.ok(r.argv?.includes('--yes'))
  })

  it('adds -y for npm init', () => {
    const r = normalizeNonInteractiveShellInput({
      command: 'npm init',
    })
    assert.equal(r.changed, true)
    assert.match(r.command, /\bnpm init -y\b/)
  })

  it('does not change when already non-interactive', () => {
    const r = normalizeNonInteractiveShellInput({
      command: 'npx --yes create-vite@latest app --template react-ts --no-interactive',
    })
    assert.equal(r.changed, false)
  })

  it('adds --no-interactive for npm create vite', () => {
    const r = normalizeNonInteractiveShellInput({
      command: 'npm create vite@latest app --yes -- --template react-ts',
    })
    assert.equal(r.changed, true)
    assert.match(r.command, /--no-interactive/)
  })
})

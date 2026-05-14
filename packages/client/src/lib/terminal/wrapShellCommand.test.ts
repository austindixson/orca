import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isCreateNextAppInPlaceArgv,
  shellQuoteArgvZsh,
  wrapOrcaShellCommand,
} from './wrapShellCommand'

describe('wrapShellCommand', () => {
  it('detects create-next-app in current directory argv', () => {
    assert.equal(
      isCreateNextAppInPlaceArgv([
        'npx',
        '--yes',
        'create-next-app@latest',
        '.',
        '--typescript',
        '--import-alias',
        '@/*',
      ]),
      true
    )
    assert.equal(isCreateNextAppInPlaceArgv(['npx', '--yes', 'create-next-app@latest', './']), true)
    assert.equal(isCreateNextAppInPlaceArgv(['npx', '--yes', 'create-next-app', 'my-app']), false)
    assert.equal(isCreateNextAppInPlaceArgv(['echo', 'hi']), false)
  })

  it('prepends package.json seed for create-next-app in .', () => {
    const argv = ['npx', '--yes', 'create-next-app@latest', '.', '--typescript']
    const w = wrapOrcaShellCommand({ command: '', argv })
    assert.ok(w.includes('test -f package.json'))
    assert.ok(w.includes('basename "$PWD"'))
    assert.ok(w.includes(shellQuoteArgvZsh(argv)))
    assert.ok(w.includes('133;C'))
  })

  it('does not seed plain echo', () => {
    const w = wrapOrcaShellCommand({ command: 'echo hi' })
    assert.ok(!w.includes('test -f package.json'))
  })
})

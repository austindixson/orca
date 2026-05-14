import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applySafetyMode,
  scanShellCommandForDanger,
  scanWorkspacePathForSensitivity,
} from './orchestratorSafetyGuard'

describe('orchestratorSafetyGuard', () => {
  it('flags rm -rf', () => {
    const { matchedIds } = scanShellCommandForDanger('rm -rf /tmp/x')
    assert.ok(matchedIds.includes('destructive_rm_rf'))
  })

  it('flags sensitive path', () => {
    const r = scanWorkspacePathForSensitivity('src/.env')
    assert.ok(r.matchedIds.length > 0)
  })

  it('blocks in block mode', () => {
    const scan = scanShellCommandForDanger('git push --force origin main')
    const r = applySafetyMode('block', scan)
    assert.equal(r.allow, false)
  })

  it('allows in warn mode', () => {
    const scan = scanShellCommandForDanger('git push --force origin main')
    const r = applySafetyMode('warn', scan)
    assert.equal(r.allow, true)
  })

  it('blocks interactive create-vite without --no-interactive', () => {
    const scan = scanShellCommandForDanger('npx --yes create-vite@latest test-app --template react-ts')
    assert.equal(scan.blocked, true)
    assert.ok(scan.matchedIds.includes('interactive_create_vite_missing_no_interactive'))
    const r = applySafetyMode('off', scan)
    assert.equal(r.allow, false)
  })

  it('allows create-vite when --no-interactive is present', () => {
    const scan = scanShellCommandForDanger(
      'npx --yes create-vite@latest test-app --no-interactive --template react-ts'
    )
    assert.equal(scan.blocked, false)
  })

  it('blocks create-next-app without --yes', () => {
    const scan = scanShellCommandForDanger('npx create-next-app@latest my-app')
    assert.equal(scan.blocked, true)
    assert.ok(scan.matchedIds.includes('interactive_create_next_app_missing_yes'))
  })

  it('blocks npm init without -y/--yes', () => {
    const scan = scanShellCommandForDanger('npm init')
    assert.equal(scan.blocked, true)
    assert.ok(scan.matchedIds.includes('interactive_npm_init_missing_yes'))
  })

  it('blocks npm create vite without --no-interactive', () => {
    const scan = scanShellCommandForDanger('npm create vite@latest app --yes')
    assert.equal(scan.blocked, true)
    assert.ok(scan.matchedIds.includes('interactive_npm_create_vite_missing_no_interactive'))
  })
})

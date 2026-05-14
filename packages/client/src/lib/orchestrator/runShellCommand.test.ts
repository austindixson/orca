import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildPathMutationRecoveryBranch,
  buildShellRecoveryBranch,
  executeOrchestratorTool,
  enforceRunShellWorkspaceScope,
} from './executeTools'

describe('run_shell_command', () => {
  it('requires non-empty command even when command_argv is provided', async () => {
    const raw = await executeOrchestratorTool(
      'run_shell_command',
      JSON.stringify({ command_argv: ['npm', 'ci'] }),
      { orchestratorTileId: null }
    )
    const out = JSON.parse(raw)
    assert.equal(out.ok, false)
    assert.match(String(out.error), /non-empty `command`/i)
  })

  it('returns desktop-only guidance on web runtimes', async () => {
    const raw = await executeOrchestratorTool(
      'run_shell_command',
      JSON.stringify({ command: 'git status' }),
      { orchestratorTileId: null }
    )
    const out = JSON.parse(raw)
    assert.equal(out.ok, false)
    assert.match(String(out.error), /requires the Orca desktop app/i)
  })
})

describe('enforceRunShellWorkspaceScope', () => {
  const root = '/Users/ghost/Desktop/mactopbar'

  it('allows in-scope absolute cd targets', () => {
    const result = enforceRunShellWorkspaceScope(`cd "${root}" && npm test`, [root])
    assert.deepEqual(result, { ok: true })
  })

  it('blocks out-of-scope absolute cd targets', () => {
    const result = enforceRunShellWorkspaceScope('cd /Users/ghost/Desktop/orca && npm test', [root])
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.error, /out-of-scope cd blocked/i)
    }
  })

  it('blocks parent traversal in relative cd targets', () => {
    const result = enforceRunShellWorkspaceScope('cd ../.. && npm test', [root])
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.error, /parent traversal/i)
    }
  })
})

describe('buildShellRecoveryBranch', () => {
  it('classifies git non-repository failures with deterministic fallback + verification', () => {
    const branch = buildShellRecoveryBranch({
      command: 'git push origin main',
      exitCode: 128,
      stderr: 'fatal: not a git repository (or any of the parent directories): .git',
    })
    assert.ok(branch)
    assert.equal(branch?.classification, 'git_not_repo')
    assert.ok(branch?.next_checks.some((s) => /git rev-parse/i.test(s)))
    assert.ok(branch?.fallback_steps.some((s) => /git init/i.test(s)))
    assert.ok(branch?.verify_steps.some((s) => /commit sha|remote/i.test(s)))
  })

  it('classifies command-not-found failures from exit_code/stderr', () => {
    const branch = buildShellRecoveryBranch({
      command: 'fooctl deploy',
      exitCode: 127,
      stderr: 'fooctl: command not found',
    })
    assert.ok(branch)
    assert.equal(branch?.classification, 'command_not_found')
    assert.ok(branch?.next_checks.some((s) => /command -v|which/i.test(s)))
  })

  it('returns null for successful command results', () => {
    const branch = buildShellRecoveryBranch({ command: 'echo ok', exitCode: 0, stderr: '' })
    assert.equal(branch, null)
  })
})

describe('buildPathMutationRecoveryBranch', () => {
  it('classifies sensitive-path safety blocks for file mutations', () => {
    const branch = buildPathMutationRecoveryBranch({
      tool: 'write_file',
      path: '.env.local',
      error: 'Blocked by harness safety: Path may contain secrets or credentials',
      safetyBlocked: true,
    })
    assert.equal(branch.classification, 'sensitive_path_blocked')
    assert.ok(branch.next_checks.some((s) => /\.env|credentials|secret/i.test(s)))
  })

  it('classifies target-missing delete failures', () => {
    const branch = buildPathMutationRecoveryBranch({
      tool: 'delete_file',
      path: 'missing.txt',
      error: 'No such file or directory (os error 2)',
    })
    assert.equal(branch.classification, 'target_missing')
    assert.ok(branch.verify_steps.some((s) => /presence\/absence/i.test(s)))
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMPTY_EXECUTION_CONTRACT,
  executionContractIsMeaningful,
  mergeExecutionContract,
  normalizeExecutionContract,
  normalizePermissionList,
} from './orchestratorExecutionContract'

describe('execution contract normalization', () => {
  it('maps claw-style read-only mode to read+inspect', () => {
    const p = normalizePermissionList('read-only')
    assert.deepEqual(p, ['read', 'inspect'])
  })

  it('maps workspace-write mode', () => {
    const p = normalizePermissionList('workspace-write')
    assert.deepEqual(p, ['read', 'write', 'inspect', 'spawn'])
  })

  it('drops unknown permission tokens', () => {
    const p = normalizePermissionList(['read', 'fake_perm', 'write'])
    assert.deepEqual(p, ['read', 'write'])
  })

  it('normalizes garbage objects to safe defaults', () => {
    const n = normalizeExecutionContract({
      requiredOutputs: ['a', 2 as unknown as string, '', 'a'],
      completionConditions: new Array(200).fill('x'),
      budgets: { maxToolRounds: 99999, maxSubAgents: -1 },
      permissions: ['nope'],
    } as Record<string, unknown>)
    assert.ok(n.requiredOutputs.includes('a'))
    assert.ok(n.completionConditions.length <= 48)
    assert.equal(n.budgets.maxToolRounds, 500)
    assert.equal(n.budgets.maxSubAgents, 1)
    assert.deepEqual(n.permissions, ['read', 'write', 'execute', 'spawn', 'inspect', 'web'])
  })

  it('merge respects undefined overlay fields (keep base)', () => {
    const base = normalizeExecutionContract({
      label: 'base',
      completionConditions: ['c1'],
      verificationSteps: ['v1'],
    })
    const m = mergeExecutionContract(base, { requiredOutputs: ['out'] })
    assert.equal(m.label, 'base')
    assert.deepEqual(m.completionConditions, ['c1'])
    assert.deepEqual(m.requiredOutputs, ['out'])
    assert.deepEqual(m.verificationSteps, ['v1'])
  })

  it('executionContractIsMeaningful is false for empty partial', () => {
    assert.equal(executionContractIsMeaningful({}), false)
    assert.equal(executionContractIsMeaningful({ permissions: [] }), false)
  })

  it('executionContractIsMeaningful is true when budgets set', () => {
    assert.equal(
      executionContractIsMeaningful({ budgets: { maxToolRounds: 12 } }),
      true
    )
  })

  it('EMPTY contract matches normalized defaults', () => {
    const n = normalizeExecutionContract(EMPTY_EXECUTION_CONTRACT)
    assert.deepEqual(n.requiredOutputs, [])
    assert.deepEqual(n.permissions, normalizePermissionList('default'))
  })
})

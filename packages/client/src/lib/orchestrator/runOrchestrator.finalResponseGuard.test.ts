import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  resolveLeadDelegationForRun,
  shouldRejectEmptyTerminalAssistantMessage,
  shouldNudgeLeadDelegationBeforeTerminalReply,
  ensureWorkingSetHasUserMessage,
  shouldAutoApproveHermesTerminalSecurityGate,
  checkRunBudgetExceeded,
  isPlanOnlyRequest,
  isPlanOnlyDisallowedTool,
} from './runOrchestrator'

describe('runOrchestrator final response guard', () => {
  it('rejects empty terminal assistant message after tool batches', () => {
    const reject = shouldRejectEmptyTerminalAssistantMessage({
      textOnly: '   ',
      toolBatchCount: 2,
      iterations: 3,
      introRound: false,
    })
    assert.equal(reject, true)
  })

  it('rejects empty assistant message after at least one model iteration', () => {
    const reject = shouldRejectEmptyTerminalAssistantMessage({
      textOnly: '',
      toolBatchCount: 0,
      iterations: 1,
      introRound: false,
    })
    assert.equal(reject, true)
  })

  it('does not reject non-empty assistant content', () => {
    const reject = shouldRejectEmptyTerminalAssistantMessage({
      textOnly: 'Done: updated auth middleware.',
      toolBatchCount: 3,
      iterations: 4,
      introRound: false,
    })
    assert.equal(reject, false)
  })

  it('does not reject intro round placeholders', () => {
    const reject = shouldRejectEmptyTerminalAssistantMessage({
      textOnly: '   ',
      toolBatchCount: 0,
      iterations: 0,
      introRound: true,
    })
    assert.equal(reject, false)
  })
})

describe('lead delegation routing', () => {
  it('defaults Hermes lead profile to direct (non-delegation) runs', () => {
    const value = resolveLeadDelegationForRun({
      explicitLeadDelegationOnly: undefined,
      settingsLeadDelegationOnly: true,
      leadProfile: 'hermes',
    })
    assert.equal(value, false)
  })

  it('keeps delegation behavior for default profile when setting is enabled', () => {
    const value = resolveLeadDelegationForRun({
      explicitLeadDelegationOnly: undefined,
      settingsLeadDelegationOnly: true,
      leadProfile: 'default',
    })
    assert.equal(value, true)
  })

  it('honors explicit leadDelegationOnly override', () => {
    const value = resolveLeadDelegationForRun({
      explicitLeadDelegationOnly: true,
      settingsLeadDelegationOnly: false,
      leadProfile: 'hermes',
    })
    assert.equal(value, true)
  })
})

describe('working-set user message guard', () => {
  it('injects a continuation user turn when compaction left no user messages', () => {
    const working = [
      { role: 'system' as const, content: 'sys' },
      { role: 'assistant' as const, content: '', tool_calls: [] },
      { role: 'tool' as const, tool_call_id: 'call_1', content: '{"ok":true}' },
    ]
    const next = ensureWorkingSetHasUserMessage(working)
    assert.equal(next.some((m) => m.role === 'user'), true)
    const tail = next[next.length - 1]
    assert.equal(tail?.role, 'user')
    assert.equal(
      typeof (tail as { content?: unknown }).content === 'string' &&
        String((tail as { content?: unknown }).content).includes('Continue from the latest tool outputs'),
      true
    )
  })

  it('does not inject when at least one user message already exists', () => {
    const working = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'ok' },
    ]
    const next = ensureWorkingSetHasUserMessage(working)
    assert.equal(next.length, working.length)
    assert.equal(next[next.length - 1]?.role, 'assistant')
  })
})

describe('lead delegation nudge guard', () => {
  it('nudges when main lead orchestrator tries to end with plan-only text before any tool batch', () => {
    const should = shouldNudgeLeadDelegationBeforeTerminalReply({
      leadDelegationOnly: true,
      subAgentTileId: undefined,
      introRound: false,
      toolBatchCount: 0,
      textOnly: 'I will coordinate this now.',
      alreadyRetried: false,
    })
    assert.equal(should, true)
  })

  it('does not nudge worker tiles or already-retried runs', () => {
    assert.equal(
      shouldNudgeLeadDelegationBeforeTerminalReply({
        leadDelegationOnly: true,
        subAgentTileId: 'tile-123',
        introRound: false,
        toolBatchCount: 0,
        textOnly: 'plan',
        alreadyRetried: false,
      }),
      false
    )

    assert.equal(
      shouldNudgeLeadDelegationBeforeTerminalReply({
        leadDelegationOnly: true,
        subAgentTileId: undefined,
        introRound: false,
        toolBatchCount: 0,
        textOnly: 'plan',
        alreadyRetried: true,
      }),
      false
    )
  })

  it('does not nudge once a tool batch exists or content is empty', () => {
    assert.equal(
      shouldNudgeLeadDelegationBeforeTerminalReply({
        leadDelegationOnly: true,
        subAgentTileId: undefined,
        introRound: false,
        toolBatchCount: 1,
        textOnly: 'done',
        alreadyRetried: false,
      }),
      false
    )

    assert.equal(
      shouldNudgeLeadDelegationBeforeTerminalReply({
        leadDelegationOnly: true,
        subAgentTileId: undefined,
        introRound: false,
        toolBatchCount: 0,
        textOnly: '   ',
        alreadyRetried: false,
      }),
      false
    )
  })
})

describe('run budget guards', () => {
  it('flags wall-clock overrun', () => {
    const out = checkRunBudgetExceeded({
      startedAtMs: 1_000,
      nowMs: 7_000,
      maxWallClockMs: 5_000,
      estimatedContextTokens: 100,
      maxEstimatedContextTokens: 2_000,
    })
    assert.equal(out.exceeded, true)
    assert.match(out.reason ?? '', /wall-clock budget exceeded/i)
  })

  it('flags estimated-context overrun', () => {
    const out = checkRunBudgetExceeded({
      startedAtMs: 1_000,
      nowMs: 2_000,
      maxWallClockMs: 5_000,
      estimatedContextTokens: 10_001,
      maxEstimatedContextTokens: 10_000,
    })
    assert.equal(out.exceeded, true)
    assert.match(out.reason ?? '', /estimated context budget exceeded/i)
  })

  it('passes when both budgets are within limits', () => {
    const out = checkRunBudgetExceeded({
      startedAtMs: 1_000,
      nowMs: 2_000,
      maxWallClockMs: 5_000,
      estimatedContextTokens: 400,
      maxEstimatedContextTokens: 10_000,
    })
    assert.equal(out.exceeded, false)
  })
})

describe('plan-only guards', () => {
  it('detects plan-only style user requests', () => {
    assert.equal(isPlanOnlyRequest('Plan-only please, do not modify files yet.'), true)
    assert.equal(isPlanOnlyRequest('Give me a read-only analysis first.'), true)
    assert.equal(isPlanOnlyRequest('Implement this end to end.'), false)
  })

  it('blocks mutating tools but allows read-only tools in plan-only mode', () => {
    assert.equal(isPlanOnlyDisallowedTool('write_file'), true)
    assert.equal(isPlanOnlyDisallowedTool('run_shell_command'), true)
    assert.equal(isPlanOnlyDisallowedTool('browser_click'), true)
    assert.equal(isPlanOnlyDisallowedTool('read_file'), false)
    assert.equal(isPlanOnlyDisallowedTool('search_files'), false)
  })
})

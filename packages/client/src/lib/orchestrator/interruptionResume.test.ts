import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildInterruptionResumeDirectivePrefix,
  buildInterruptionCheckpoint,
  summarizeInterruptedTaskFromSession,
  type InterruptionCheckpoint,
} from './interruptionResume'

describe('interruptionResume', () => {
  it('builds deterministic directive prefix with interruption-first then resume-offer order', () => {
    const checkpoint: InterruptionCheckpoint = {
      id: 'cp-1',
      interruptedRunGeneration: 12,
      interruptedTaskSummary: 'Implement auth middleware and run tests',
      interruptedByPreview: 'What is the benefit of this?',
      createdAt: 1,
    }
    const out = buildInterruptionResumeDirectivePrefix(checkpoint)
    assert.match(out, /Answer the user\'s new interruption first/i)
    assert.match(out, /exactly one sentence asking whether to continue/i)
    assert.match(out, /Implement auth middleware and run tests/i)
  })

  it('creates checkpoint with trimmed summaries/previews', () => {
    const cp = buildInterruptionCheckpoint({
      interruptedRunGeneration: 4,
      interruptedTaskSummary: '   prior work   ',
      interruptedByText: '   new question   ',
      id: 'cp-2',
      createdAt: 2,
    })
    assert.equal(cp.interruptedTaskSummary, 'prior work')
    assert.equal(cp.interruptedByPreview, 'new question')
  })

  it('summarizes latest user task from session while ignoring handoff markers', () => {
    const summary = summarizeInterruptedTaskFromSession([
      { role: 'user', content: '[Sub-agent handoff]\n\nfoo' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'Finish pricing phase and wire Stripe checkout' },
    ])
    assert.match(summary, /Finish pricing phase/i)
  })
})

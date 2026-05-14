import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  isOrchestratorTraceLine,
  isOrchestratorTraceVerbBumpLine,
  isSuppressedBracketReasoningBlockBoundary,
  isSuppressedBracketReasoningBlockStart,
  parseFencedSegments,
  shouldSuppressBracketTraceLine,
  suppressBracketReasoningBlocks,
} from './activityLineParsing'

describe('isOrchestratorTraceVerbBumpLine', () => {
  it('is true for trace banners and tool arrows', () => {
    assert.equal(isOrchestratorTraceVerbBumpLine('[Phase 1] x'), true)
    assert.equal(isOrchestratorTraceVerbBumpLine('→ read_file({})'), true)
  })

  it('is false for still-waiting heartbeats', () => {
    assert.equal(isOrchestratorTraceVerbBumpLine('[30s] Still waiting — hint'), false)
  })

  it('is false for user/assistant bubbles', () => {
    assert.equal(isOrchestratorTraceVerbBumpLine('You · hi'), false)
    assert.equal(isOrchestratorTraceVerbBumpLine('Assistant · hi'), false)
  })
})

describe('isOrchestratorTraceLine blockquote vs JSX', () => {
  it('treats markdown blockquote trace lines as trace', () => {
    assert.equal(isOrchestratorTraceLine('> quoted log line'), true)
    assert.equal(isOrchestratorTraceLine('>\tindented quote'), true)
  })

  it('treats Hermes semantic trace rows as trace', () => {
    assert.equal(isOrchestratorTraceLine('┊ skill     nextjs14-shadcn-portal-clone  0.0s'), true)
    assert.equal(isOrchestratorTraceLine('┊ plan      4 task(s)  0.1s'), true)
  })

  it('does not treat bare JSX ">" lines as trace', () => {
    assert.equal(isOrchestratorTraceLine('>'), false)
    assert.equal(isOrchestratorTraceLine('  >'), false)
    assert.equal(isOrchestratorTraceLine('>Sign Up'), false)
  })
})

describe('isSuppressedBracketReasoningBlockStart', () => {
  it('suppresses articulation/delegation style bracket blocks', () => {
    assert.equal(isSuppressedBracketReasoningBlockStart('[Articulation] Notes: ...'), true)
    assert.equal(isSuppressedBracketReasoningBlockStart('  [Delegation] task routing'), true)
    assert.equal(isSuppressedBracketReasoningBlockStart('[Reasoning] internal'), true)
  })

  it('does not suppress normal bracket metadata by default', () => {
    assert.equal(isSuppressedBracketReasoningBlockStart('[Phase 1] planning'), false)
    assert.equal(isSuppressedBracketReasoningBlockStart('[Plan] draft'), false)
  })
})

describe('shouldSuppressBracketTraceLine', () => {
  it('suppresses bracket-prefixed trace rows outside Hermes lead mode', () => {
    assert.equal(shouldSuppressBracketTraceLine('[Phase 1] planning', false), true)
    assert.equal(shouldSuppressBracketTraceLine('  [Plan] detail', false), true)
  })

  it('keeps bracket-prefixed rows in Hermes lead mode, except suppressed reasoning blocks', () => {
    assert.equal(shouldSuppressBracketTraceLine('[Phase 1] planning', true), false)
    assert.equal(shouldSuppressBracketTraceLine('[Articulation] hidden', true), true)
  })

  it('does not suppress non-bracket trace rows', () => {
    assert.equal(shouldSuppressBracketTraceLine('→ read_file({})', false), false)
  })
})

describe('suppressed bracket reasoning block boundaries', () => {
  it('treats trace and bubble headers as boundaries', () => {
    assert.equal(isSuppressedBracketReasoningBlockBoundary('[Phase 2] planning'), true)
    assert.equal(isSuppressedBracketReasoningBlockBoundary('→ read_file({})'), true)
    assert.equal(isSuppressedBracketReasoningBlockBoundary('Assistant · final answer'), true)
  })

  it('does not treat plain continuation text as boundary', () => {
    assert.equal(isSuppressedBracketReasoningBlockBoundary('because this follows the hidden block'), false)
    assert.equal(isSuppressedBracketReasoningBlockBoundary('  - still hidden'), false)
  })
})

describe('suppressBracketReasoningBlocks', () => {
  it('removes full reasoning block continuations until a boundary line', () => {
    const input = [
      '[Articulation] internal plan',
      'step 1 internal thought',
      'step 2 internal thought',
      '[Phase 2] execution',
      '→ read_file({"path":"."})',
      'Assistant · final visible message',
    ]
    assert.deepEqual(suppressBracketReasoningBlocks(input), [
      '[Phase 2] execution',
      '→ read_file({"path":"."})',
      'Assistant · final visible message',
    ])
  })

  it('keeps unrelated lines when no suppressed block is present', () => {
    const input = ['[Phase 1] planning', '→ read_file({})', 'Assistant · hi']
    assert.deepEqual(suppressBracketReasoningBlocks(input), input)
  })
})

describe('parseFencedSegments', () => {
  it('parses a simple fenced block', () => {
    const src = 'Hello\n\n```ts\nconst x = 1\n```'
    const segs = parseFencedSegments(src)
    assert.equal(segs.length, 2)
    assert.equal(segs[0]?.type, 'text')
    assert.equal(segs[1]?.type, 'code')
    assert.equal(segs[1]?.language, 'ts')
    assert.equal(segs[1]?.content.trim(), 'const x = 1')
  })

  it('treats indented fences (CommonMark) as code block boundaries', () => {
    const src = 'Assistant · Here:\n  ```ts\na\n  ```\n'
    const segs = parseFencedSegments(src)
    const code = segs.find((s) => s.type === 'code')
    assert.ok(code)
    assert.equal(code?.language, 'ts')
    assert.equal(code?.content, 'a')
  })

  it('keeps body lines that are not fence lines inside the code segment', () => {
    const src = '```\n  not-a-fence\n```'
    const segs = parseFencedSegments(src)
    assert.equal(segs.length, 1)
    assert.equal(segs[0]?.type, 'code')
    assert.equal(segs[0]?.content, '  not-a-fence')
  })
})

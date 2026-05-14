import { collapseStillWaitingRuns } from '../../../lib/orchestrator/delegatedLogPresentation'
import { classifyAgentLogLine } from '../../../lib/agentIssueDetector'

export type ParsedOutputBlock =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'toolCall'; name: string; args: string }
  | { kind: 'toolResult'; name: string; rest: string }
  | { kind: 'heartbeat'; text: string }
  | { kind: 'systemInfo'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'blank' }
  /** Fenced code block (closed or still streaming). */
  | { kind: 'code'; lang: string; content: string; streaming?: boolean }
  /** Unified diff / patch — streamed incrementally until closing fence. */
  | { kind: 'diff'; content: string; streaming?: boolean }

type FencedSegment =
  | { type: 'text'; lines: string[] }
  | { type: 'fence'; lang: string; lines: string[]; closed: boolean }

const FENCE_OPEN_RE = /^```(\S*)\s*$/

/**
 * Split raw log into alternating prose (parsed as lines) and ``` fenced regions.
 * An unclosed fence at EOF is marked `closed: false` (streaming).
 */
export function splitIntoFencedSegments(raw: string): FencedSegment[] {
  const lines = raw.split(/\r?\n/)
  const out: FencedSegment[] = []
  let textBuf: string[] = []
  let inFence = false
  let lang = ''
  let fenceBuf: string[] = []

  const flushText = () => {
    if (textBuf.length > 0) {
      out.push({ type: 'text', lines: [...textBuf] })
      textBuf = []
    }
  }

  for (const line of lines) {
    const m = line.match(FENCE_OPEN_RE)
    if (m && inFence) {
      out.push({ type: 'fence', lang, lines: [...fenceBuf], closed: true })
      inFence = false
      fenceBuf = []
      lang = ''
      continue
    }
    if (m && !inFence) {
      flushText()
      inFence = true
      lang = (m[1] ?? '').trim()
      fenceBuf = []
      continue
    }
    if (inFence) fenceBuf.push(line)
    else textBuf.push(line)
  }
  if (inFence) {
    out.push({ type: 'fence', lang, lines: [...fenceBuf], closed: false })
  } else {
    flushText()
  }
  return out
}

function inferFenceKind(lang: string, content: string): 'diff' | 'code' {
  const l = lang.toLowerCase()
  if (l === 'diff' || l === 'patch' || l === 'udiff') return 'diff'
  const t = content.trimStart()
  if (
    /^diff --git\b/m.test(content) ||
    /^---\s+/m.test(content) ||
    /^\+\+\+\s+/m.test(content) ||
    /^@@\s/m.test(content) ||
    (/^[-+]\s/.test(t) && content.includes('\n'))
  ) {
    return 'diff'
  }
  return 'code'
}

const STILL_WAITING_RE = /still waiting/i

/** Banner-style lines: [Tag] … or [Using model: …] */
const SYSTEM_INFO_RE =
  /^\[(Using model|Vision preprocess|Z\.AI|Skill|Read\(|Async hook|Cancelled|Error)(?:\]|:|\s)/i

function isUserPromptLine(line: string): boolean {
  return /^\s*>\s+/.test(line) || line.trim() === '>' || /^\s*>\s*\(image attachment\)/.test(line)
}

function stripUserPromptPrefix(line: string): string {
  return line.replace(/^\s*>\s*/, '').trim()
}

const TOOL_RESULT_LINE = /^←\s*([a-z_][a-z0-9_]*)([\s\S]*)$/i

function balanceParens(s: string): number {
  let depth = 0
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
  }
  return depth
}

/**
 * Merge continuation lines into a multi-line tool call until parens balance.
 */
function consumeToolCallBlock(lines: string[], startIdx: number): { block: ParsedOutputBlock; nextIdx: number } {
  const first = lines[startIdx] ?? ''
  const head = first.match(/^→\s*([a-z_][a-z0-9_]*)\s*(\([\s\S]*)$/i)
  if (!head) {
    return { block: { kind: 'assistant', text: first }, nextIdx: startIdx + 1 }
  }
  const name = head[1]
  let body = head[2] ?? '()'
  if (balanceParens(body) === 0) {
    return { block: { kind: 'toolCall', name, args: body }, nextIdx: startIdx + 1 }
  }
  let combined = first
  let i = startIdx + 1
  while (balanceParens(body) !== 0 && i < lines.length) {
    combined += '\n' + lines[i]
    body += '\n' + lines[i]
    i++
  }
  return { block: { kind: 'toolCall', name, args: body }, nextIdx: i }
}

function classifyLine(line: string): ParsedOutputBlock | null {
  const t = line.trim()
  if (!t) return { kind: 'blank' }

  if (isUserPromptLine(line)) {
    return { kind: 'user', text: stripUserPromptPrefix(line) }
  }

  if (/^\[Cancelled\]/i.test(t)) {
    return { kind: 'systemInfo', text: t }
  }

  if (/^\[Error:\s/i.test(t)) {
    return { kind: 'error', text: t.replace(/^\[Error:\s*/i, '').replace(/\]\s*$/, '') }
  }

  if (/^\[Error\]/i.test(t) || /^Error:/i.test(t)) {
    const issue = classifyAgentLogLine(t)
    if (issue === 'error' || issue === 'fail') {
      return { kind: 'error', text: t }
    }
  }

  if (SYSTEM_INFO_RE.test(t) || /^\[(Z\.AI|Vision)/i.test(t)) {
    return { kind: 'systemInfo', text: t }
  }

  if (/^\[[^\]]+\]/.test(t)) {
    const tag = t.match(/^\[([^\]]+)\]/)?.[1] ?? ''
    if (/^(Using model|Vision|Z\.AI|Skill|Read|Async hook|Cancelled|Error|Track|Planning|Routing)/i.test(tag)) {
      return { kind: 'systemInfo', text: t }
    }
  }

  if (t.startsWith('⎿') || /^Read\(/i.test(t)) {
    return { kind: 'systemInfo', text: t }
  }

  if (STILL_WAITING_RE.test(t) || /^\[\d+s\].*still waiting/i.test(t)) {
    return { kind: 'heartbeat', text: t }
  }

  if (/^…\s*\d+×\s*still-waiting/i.test(t)) {
    return { kind: 'heartbeat', text: t }
  }

  if (/^→\s*/.test(t)) {
    return null
  }

  if (TOOL_RESULT_LINE.test(t.trim())) {
    const m = t.trim().match(TOOL_RESULT_LINE)
    if (m) {
      return { kind: 'toolResult', name: m[1], rest: (m[2] ?? '').trim() }
    }
  }

  const issue = classifyAgentLogLine(t)
  if (issue === 'error' || issue === 'fail') {
    return { kind: 'error', text: t }
  }

  return { kind: 'assistant', text: line }
}

/**
 * Parse raw agent log text into display blocks (user / assistant / tools / system).
 * Does **not** split markdown fences — use {@link parseAgentOutputText} for full output.
 */
export function parseAgentOutputLines(raw: string): ParsedOutputBlock[] {
  if (!raw.trim()) return []
  const lines = raw.split(/\r?\n/)
  const collapsed = collapseStillWaitingRuns(lines)
  const out: ParsedOutputBlock[] = []
  let i = 0
  while (i < collapsed.length) {
    const line = collapsed[i] ?? ''
    const t = line.trim()

    if (!t) {
      out.push({ kind: 'blank' })
      i++
      continue
    }

    if (/^→\s*/.test(t)) {
      const { block, nextIdx } = consumeToolCallBlock(collapsed, i)
      out.push(block)
      i = nextIdx
      continue
    }

    const classified = classifyLine(line)
    if (classified) {
      out.push(classified)
      i++
      continue
    }

    out.push({ kind: 'assistant', text: line })
    i++
  }
  return out
}

/**
 * Parse raw agent log: markdown ``` fences (code / diff) + line-oriented tool/user blocks.
 */
export function parseAgentOutputText(raw: string): ParsedOutputBlock[] {
  if (!raw.trim()) return []
  const segments = splitIntoFencedSegments(raw)
  const out: ParsedOutputBlock[] = []
  for (const seg of segments) {
    if (seg.type === 'text') {
      const inner = seg.lines.join('\n')
      out.push(...parseAgentOutputLines(inner))
      continue
    }
    const content = seg.lines.join('\n')
    const streaming = !seg.closed
    const kind = inferFenceKind(seg.lang, content)
    if (kind === 'diff') {
      out.push({ kind: 'diff', content, streaming })
    } else {
      out.push({ kind: 'code', lang: seg.lang || 'text', content, streaming })
    }
  }
  return mergeAssistantBlocks(out)
}

/**
 * Merge adjacent assistant fragments for cleaner rendering.
 * Does not merge across code/diff/tool boundaries.
 */
export function mergeAssistantBlocks(blocks: ParsedOutputBlock[]): ParsedOutputBlock[] {
  const merged: ParsedOutputBlock[] = []
  for (const b of blocks) {
    if (b.kind === 'assistant' && merged.length > 0 && merged[merged.length - 1]!.kind === 'assistant') {
      const prev = merged[merged.length - 1] as { kind: 'assistant'; text: string }
      prev.text += '\n' + b.text
    } else {
      merged.push(b)
    }
  }
  return merged
}

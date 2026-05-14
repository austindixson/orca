/** Segments from a single activity line (markdown + optional fenced ``` blocks). */
export interface ParsedSegment {
  type: 'text' | 'code'
  content: string
  language?: string
}

export function parseFencedSegments(input: string): ParsedSegment[] {
  const src = input.replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  const out: ParsedSegment[] = []
  let inCode = false
  let lang = ''
  let buf: string[] = []

  const flush = (type: 'text' | 'code') => {
    if (buf.length === 0) return
    out.push({
      type,
      content: buf.join('\n'),
      ...(type === 'code' && lang ? { language: lang } : {}),
    })
    buf = []
  }

  for (const line of lines) {
    /** CommonMark: up to 3 spaces before the opening/closing fence (indented fences). */
    const m = line.match(/^\s{0,3}```([A-Za-z0-9_+-]*)\s*$/)
    if (m) {
      if (inCode) {
        flush('code')
        inCode = false
        lang = ''
      } else {
        flush('text')
        inCode = true
        lang = m[1] || ''
      }
      continue
    }
    buf.push(line)
  }
  flush(inCode ? 'code' : 'text')
  return out
}

/** Planning, tools, model banners, etc. — not main reply bubbles. */
export function isOrchestratorTraceLine(line: string): boolean {
  const t = line.trimStart()
  /** User/assistant bubbles are prefixed — never treat as trace (e.g. assistant blockquotes `>`). */
  if (t.startsWith('You ·') || t.startsWith('Assistant ·')) return false
  if (t.startsWith('[Error]') || t.startsWith('[Cancelled]')) return false
  if (t.startsWith('[Project]')) return true
  if (t.startsWith('[Skills]')) return true
  if (t.startsWith('[Prompt]')) return true
  if (t.startsWith('[Budget]')) return true
  if (t.startsWith('[Hierarchy]')) return true
  if (t.startsWith('[Phase ')) return true
  if (t.startsWith('[Decomposition]')) return true
  if (t.startsWith('[Track]')) return true
  if (t.startsWith('[Research]')) return true
  if (t.startsWith('[Understanding]')) return true
  if (t.startsWith('[Plan]')) return true
  if (t.startsWith('[Planning]')) return true
  if (t.startsWith('[Routing]')) return true
  if (t.startsWith('[Execution]')) return true
  if (t.startsWith('[Skill]')) return true
  if (t.startsWith('Subtask ') || t.startsWith('──')) return true
  // Markdown blockquote traces use "> " / ">	". Bare ">" / ">Sign" are usually JSX — keep in chat bubbles.
  if (t.startsWith('>') && (t.startsWith('> ') || t.startsWith('>\t'))) return true
  if (t.startsWith('→') || t.startsWith('←') || t.startsWith('⋯') || t.startsWith('◆')) return true
  if (t.startsWith('⎿')) return true
  if (t.startsWith('┊')) return true
  if (t.startsWith('Read(')) return true
  if (/^\[Z\.AI/i.test(t)) return true
  if (t.startsWith('[Vision')) return true
  if (t.startsWith('[Using model:')) return true
  if (t.startsWith('[HTTP')) return true
  if (t.startsWith('[Rate limited]')) return true
  if (t.startsWith('[Schema guard]')) return true
  if (t.startsWith('[Tool-call fallback]')) return true
  if (t.startsWith('[Stagnation guard]')) return true
  if (t.includes('Still waiting')) return true
  return false
}

/**
 * Trace lines that should advance the status verb. Omits heartbeat spam so the
 * status line does not rotate on the still-waiting timer.
 */
export function isOrchestratorTraceVerbBumpLine(line: string): boolean {
  const t = line.trimStart()
  if (t.includes('Still waiting')) return false
  return isOrchestratorTraceLine(line)
}

const ALWAYS_SUPPRESSED_BRACKET_BLOCK_PREFIXES = [
  '[Articulation]',
  '[Delegation]',
  '[Reasoning]',
  '[Thinking]',
  '[Thought]',
] as const

const TRACE_BOUNDARY_PREFIXES = [
  '[',
  'You ·',
  'Assistant ·',
  'Subtask ',
  '──',
  '→',
  '←',
  '⋯',
  '◆',
  '⎿',
  '┊',
  'Read(',
] as const

/**
 * Bracket-prefixed narration/CoT-style blocks we never want visible in Orca UI.
 * Suppressed in both Hermes and non-Hermes lead modes.
 */
export function isSuppressedBracketReasoningBlockStart(line: string): boolean {
  const t = line.trimStart()
  return ALWAYS_SUPPRESSED_BRACKET_BLOCK_PREFIXES.some((prefix) => t.startsWith(prefix))
}

export function isSuppressedBracketReasoningBlockBoundary(line: string): boolean {
  const t = line.trimStart()
  if (t.length === 0) return false
  if (t.startsWith('> ') || t.startsWith('>\t')) return true
  return TRACE_BOUNDARY_PREFIXES.some((prefix) => t.startsWith(prefix))
}

/**
 * Removes full reasoning blocks that begin with suppressed bracket headers.
 * Once a block starts, all following continuation lines are suppressed until
 * a clear trace/bubble boundary line appears.
 */
export function suppressBracketReasoningBlocks(lines: readonly string[]): string[] {
  const out: string[] = []
  let suppressing = false
  for (const line of lines) {
    if (!suppressing) {
      if (isSuppressedBracketReasoningBlockStart(line)) {
        suppressing = true
        continue
      }
      out.push(line)
      continue
    }

    if (isSuppressedBracketReasoningBlockStart(line)) {
      continue
    }

    if (isSuppressedBracketReasoningBlockBoundary(line)) {
      suppressing = false
      out.push(line)
      continue
    }
  }
  return out
}

export function shouldSuppressBracketTraceLine(line: string, hermesLeadModeActive: boolean): boolean {
  if (isSuppressedBracketReasoningBlockStart(line)) return true
  if (hermesLeadModeActive) return false
  return line.trimStart().startsWith('[')
}

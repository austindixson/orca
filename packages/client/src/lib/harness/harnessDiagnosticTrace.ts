/**
 * Bounded, redacted payloads for Meta-Harness–style diagnostic traces (disk JSONL).
 * Align budgets loosely with {@link applyToolResultBudget}; trace caps are smaller for inline JSONL.
 */
import type { ChatMessage } from '../orchestrator/types'
import type { Provider } from '../../store/settingsStore'

export const HARNESS_TRACE_ARGS_MAX_CHARS = 8_000
export const HARNESS_TRACE_RESULT_MAX_CHARS = 12_000
export const HARNESS_TRACE_PROMPT_PREVIEW_MAX_CHARS = 4_000

const KEY_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  { re: /\bsk-[a-zA-Z0-9]{10,}\b/g, replace: '[REDACTED_TOKEN]' },
  { re: /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/g, replace: '[REDACTED_SLACK]' },
  { re: /Bearer\s+[a-zA-Z0-9._\-\s]+/gi, replace: 'Bearer [REDACTED]' },
  { re: /(api[_-]?key|apikey|secret|password|token)\s*[:=]\s*["']?[^\s"',}\]]+/gi, replace: '$1:[REDACTED]' },
  { re: /OPENAI_API_KEY\s*=\s*\S+/gi, replace: 'OPENAI_API_KEY=[REDACTED]' },
  { re: /(["']?Authorization["']?\s*:\s*["']?)[^\s"',}]+/gi, replace: '$1[REDACTED]' },
]

/**
 * Best-effort redaction for harness traces (not a guarantee of zero leakage — keep traces local).
 */
export function redactSecretsForHarnessTrace(input: string): string {
  let s = input
  for (const { re, replace } of KEY_PATTERNS) {
    s = s.replace(re, replace)
  }
  return s
}

export function truncateForHarnessTrace(
  text: string,
  maxChars: number
): { text: string; truncated: boolean; originalChars: number } {
  const originalChars = text.length
  if (originalChars <= maxChars) {
    return { text, truncated: false, originalChars }
  }
  return {
    text: `${text.slice(0, Math.max(0, maxChars - 80))}\n… [trace truncated ${originalChars} chars]`,
    truncated: true,
    originalChars,
  }
}

export function prepareArgsForHarnessTrace(rawArgs: string): {
  argsRedacted: string
  argsTruncated: boolean
} {
  const redacted = redactSecretsForHarnessTrace(rawArgs)
  const t = truncateForHarnessTrace(redacted, HARNESS_TRACE_ARGS_MAX_CHARS)
  return { argsRedacted: t.text, argsTruncated: t.truncated }
}

export function prepareResultForHarnessTrace(result: string): {
  resultRedacted: string
  resultTruncated: boolean
  resultChars: number
} {
  const redacted = redactSecretsForHarnessTrace(result)
  const t = truncateForHarnessTrace(redacted, HARNESS_TRACE_RESULT_MAX_CHARS)
  return {
    resultRedacted: t.text,
    resultTruncated: t.truncated,
    resultChars: t.originalChars,
  }
}

export function previewForHarnessTrace(text: string): { preview: string; charLen: number } {
  const redacted = redactSecretsForHarnessTrace(text)
  const charLen = redacted.length
  if (charLen <= HARNESS_TRACE_PROMPT_PREVIEW_MAX_CHARS) {
    return { preview: redacted, charLen }
  }
  return {
    preview: `${redacted.slice(0, HARNESS_TRACE_PROMPT_PREVIEW_MAX_CHARS)}\n…`,
    charLen,
  }
}

function userContentLen(u: Extract<ChatMessage, { role: 'user' }>): number {
  const c = u.content
  if (typeof c === 'string') return c.length
  return JSON.stringify(c).length
}

/** Estimate serialized chat size for harness diagnostics. */
export function estimateWorkingChars(working: ChatMessage[]): number {
  let n = 0
  for (const m of working) {
    if (m.role === 'system') n += m.content.length
    else if (m.role === 'user') n += userContentLen(m)
    else if (m.role === 'assistant') {
      n += typeof m.content === 'string' ? m.content.length : 0
      const tc = m.tool_calls
      if (tc && tc.length) n += JSON.stringify(tc).length
    } else if (m.role === 'tool') n += m.content.length
  }
  return n
}

/**
 * One JSONL row: bounded previews of system + last user message (redacted).
 */
export function buildLlmRoundMetaTrace(input: {
  working: ChatMessage[]
  provider: Provider
  model: string
  iteration: number
}): {
  kind: 'llm_round_meta'
  ts: number
  iteration: number
  provider: Provider
  model: string
  workingChars: number
  systemPreview: string
  lastUserPreview: string
  systemCharLen: number
  lastUserCharLen: number
} {
  const { working, provider, model, iteration } = input
  const systemMsg = working.find((m): m is Extract<ChatMessage, { role: 'system' }> => m.role === 'system')
  const systemText = systemMsg && systemMsg.role === 'system' ? systemMsg.content : ''

  let lastUserText = ''
  for (let i = working.length - 1; i >= 0; i--) {
    const m = working[i]
    if (m && m.role === 'user') {
      lastUserText =
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      break
    }
  }

  const sp = previewForHarnessTrace(systemText)
  const up = previewForHarnessTrace(lastUserText)

  return {
    kind: 'llm_round_meta',
    ts: Date.now(),
    iteration,
    provider,
    model,
    workingChars: estimateWorkingChars(working),
    systemPreview: sp.preview,
    lastUserPreview: up.preview,
    systemCharLen: sp.charLen,
    lastUserCharLen: up.charLen,
  }
}

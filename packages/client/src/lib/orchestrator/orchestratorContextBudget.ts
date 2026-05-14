import type { ChatMessage } from './types'

const ELLIPSIS = '\n…[truncated]'

/** Hard cap for a single user text blob sent to the API (Z.AI / vision models hit limits quickly). */
export const MAX_SINGLE_USER_CHARS = 14_000

/** Budget for prior session turns (excluding the new user message the caller adds). */
export const MAX_SESSION_HISTORY_CHARS = 18_000

/** Planning-only call should stay small — no tools, vision summary can be huge. */
export const MAX_PLANNING_USER_CHARS = 8_000

/** Tiny routing classifier — direct vs plan path. */
export const MAX_ROUTER_USER_CHARS = 4_000

export function truncateString(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, Math.max(0, maxChars - ELLIPSIS.length)) + ELLIPSIS
}

function messageCharEstimate(m: ChatMessage): number {
  if (m.role === 'user') {
    const c = m.content
    if (typeof c === 'string') return c.length
    return c.reduce((sum, p) => sum + (p.type === 'text' ? p.text.length : 400), 0)
  }
  if (m.role === 'assistant') {
    const t = typeof m.content === 'string' ? m.content : ''
    const tc = m.tool_calls
      ? JSON.stringify(m.tool_calls).length
      : 0
    return t.length + tc
  }
  if (m.role === 'tool') return m.content.length
  return 0
}

/**
 * Keeps the **most recent** messages whose total estimated size is under `maxChars`.
 * Drops from the front so the latest user intent and tool results stay.
 */
export function trimMessagesForOrchestrator(
  messages: ChatMessage[],
  maxChars: number = MAX_SESSION_HISTORY_CHARS
): ChatMessage[] {
  if (messages.length === 0) return messages
  const total = messages.reduce((s, m) => s + messageCharEstimate(m), 0)
  if (total <= maxChars) return messages

  let drop = 0
  let sum = total
  while (drop < messages.length && sum > maxChars) {
    sum -= messageCharEstimate(messages[drop]!)
    drop += 1
  }
  const trimmed = messages.slice(drop)
  if (trimmed.length === 0) return messages.slice(-2)
  return trimmed
}

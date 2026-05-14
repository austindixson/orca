/**
 * Tiered context compaction: microcompact (cheap dedupe) → snip (drop oldest safe blocks) →
 * summarize (see sessionCompaction.compactSession — caller-triggered, not every round).
 */

import type { ChatMessage } from '../orchestrator/types'

/** Rough character budget for the full message array sent to the model (excluding API overhead). */
export const DEFAULT_MAX_WORKING_CHARS = 450_000

/** Keep at least this many trailing messages after system when snipping (preserve tool chains). */
const SNIP_MIN_TAIL_MESSAGES = 16

function messageApproxChars(m: ChatMessage): number {
  try {
    return JSON.stringify(m).length
  } catch {
    return 10_000
  }
}

/**
 * Merge consecutive `tool` messages with identical `content` into one placeholder.
 * Safe: model still sees that output occurred; reduces duplicate read_file spam.
 */
export function microcompactMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length < 2) return messages
  const out: ChatMessage[] = []
  let i = 0
  while (i < messages.length) {
    const cur = messages[i]
    if (cur.role !== 'tool') {
      out.push(cur)
      i += 1
      continue
    }
    let run = 1
    const content = cur.content
    let j = i + 1
    while (j < messages.length) {
      const n = messages[j]
      if (n.role === 'tool' && n.content === content) {
        run += 1
        j += 1
      } else {
        break
      }
    }
    if (run > 1) {
      out.push({
        role: 'tool',
        tool_call_id: cur.tool_call_id,
        content: `[Orca microcompact] Identical tool output repeated ${run}× (same bytes). Showing once.`,
      })
    } else {
      out.push(cur)
    }
    i = j
  }
  return out
}

/**
 * Remove oldest messages after `system` until under char budget, removing only **safe** blocks:
 * - whole `user` messages
 * - `assistant` without tool_calls
 * - `assistant` + following `tool` messages until the next non-tool
 */
export function snipMessages(
  messages: ChatMessage[],
  maxChars: number,
  minTailMessages: number = SNIP_MIN_TAIL_MESSAGES
): ChatMessage[] {
  if (messages.length === 0) return messages
  const system = messages[0]?.role === 'system' ? messages[0] : null
  const body = system ? messages.slice(1) : messages

  const total = () => messagesApproxTotal(system ? [system, ...body] : body)

  if (total() <= maxChars) {
    return system ? [system, ...body] : [...body]
  }

  let trimmed = [...body]
  while (trimmed.length > minTailMessages && totalChars(system, trimmed) > maxChars) {
    const removed = removeOneSafePrefix(trimmed)
    if (!removed) break
    trimmed = removed
  }

  return system ? [system, ...trimmed] : trimmed
}

function messagesApproxTotal(messages: ChatMessage[]): number {
  let n = 0
  for (const m of messages) n += messageApproxChars(m)
  return n
}

function totalChars(system: ChatMessage | null, body: ChatMessage[]): number {
  let n = system ? messageApproxChars(system) : 0
  for (const m of body) n += messageApproxChars(m)
  return n
}

function countUserMessages(body: ChatMessage[]): number {
  let n = 0
  for (const m of body) {
    if (m.role === 'user') n += 1
  }
  return n
}

function removeSafeBlockAt(body: ChatMessage[], start: number): ChatMessage[] | null {
  if (start < 0 || start >= body.length) return null
  const first = body[start]
  if (first.role === 'user') {
    return [...body.slice(0, start), ...body.slice(start + 1)]
  }
  if (first.role === 'assistant') {
    const hasTools = first.tool_calls && first.tool_calls.length > 0
    if (!hasTools) {
      return [...body.slice(0, start), ...body.slice(start + 1)]
    }
    let k = start + 1
    while (k < body.length && body[k].role === 'tool') k += 1
    return [...body.slice(0, start), ...body.slice(k)]
  }
  if (first.role === 'tool') {
    return [...body.slice(0, start), ...body.slice(start + 1)]
  }
  return null
}

function removeOneSafePrefix(body: ChatMessage[]): ChatMessage[] | null {
  if (body.length === 0) return null
  const first = body[0]
  if (first.role === 'user') {
    const userCount = countUserMessages(body)
    if (userCount > 1) {
      return removeSafeBlockAt(body, 0)
    }
    // Preserve at least one user message for providers that require it.
    // If this is the only user message, trim the next safe block instead.
    return removeSafeBlockAt(body, 1)
  }
  return removeSafeBlockAt(body, 0)
}

export interface CompactionHierarchyOptions {
  maxChars?: number
  minTailMessages?: number
  /** When true, only microcompact (no snip). */
  microcompactOnly?: boolean
}

/**
 * Apply microcompact, then snip if still over budget.
 */
export function applyCompactionHierarchy(
  messages: ChatMessage[],
  options: CompactionHierarchyOptions = {}
): ChatMessage[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_WORKING_CHARS
  const minTail = options.minTailMessages ?? SNIP_MIN_TAIL_MESSAGES
  let m = microcompactMessages(messages)
  if (options.microcompactOnly) return m
  if (messagesApproxTotal(m) <= maxChars) return m
  m = snipMessages(m, maxChars, minTail)
  return m
}

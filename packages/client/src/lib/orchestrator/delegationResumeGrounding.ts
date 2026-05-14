import type { ChatMessage } from './types'
import { getDefaultSessionId } from '../persistence/sessionPersistence'

/** First line must stay stable — used to detect idempotency if storage is cleared. */
export const DELEGATION_RESUME_GROUNDING_MARKER = '[Orca · delegation hierarchy]'

const STORAGE_KEY = 'orca.delegationResumeGrounding.v1'

function readInjectedKeys(): Record<string, true> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return {}
    return o as Record<string, true>
  } catch {
    return {}
  }
}

function writeInjectedKeys(map: Record<string, true>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode */
  }
}

export function delegationResumeGroundingStorageKey(workspaceRoot: string, sessionId: string): string {
  const root = workspaceRoot && workspaceRoot !== '.' ? workspaceRoot : '__default__'
  return `${root}::${sessionId}`
}

export function hasDelegationResumeGroundingBeenInjected(key: string): boolean {
  return readInjectedKeys()[key] === true
}

export function markDelegationResumeGroundingInjected(key: string): void {
  const next = { ...readInjectedKeys(), [key]: true as const }
  writeInjectedKeys(next)
}

/** Full body for the synthetic user turn (marker on first line). */
export function buildDelegationResumeGroundingUserContent(): string {
  return `${DELEGATION_RESUME_GROUNDING_MARKER} This session may include older assistant/tool examples. Apply the **current** rules on every spawn:

- Use \`spawn_sub_agent\` for parallel work (respect max concurrent sub-agents).
- Coordinate with \`post_team_message\` using \`@all\` or \`@<displayName>\` when blocked or for handoffs.`
}

function sessionAlreadyHasGrounding(messages: ChatMessage[]): boolean {
  for (const m of messages) {
    if (m.role !== 'user') continue
    const c = m.content
    const text = typeof c === 'string' ? c : c.find((p) => p.type === 'text')?.text ?? ''
    if (text.includes(DELEGATION_RESUME_GROUNDING_MARKER)) return true
  }
  return false
}

export interface ApplyDelegationResumeGroundingArgs {
  sessionMessages: ChatMessage[]
  workspaceRoot: string
  /** When false, skip (Settings → lead delegation off). */
  leadDelegationOnly: boolean
  /** \`user\` from normal input; skip automatic handoff resumes. */
  source: string
}

/**
 * Once per (workspace, session) key, append a short user message so long legacy history
 * does not drown out current spawn rules. Persists with the session when the caller
 * writes `sessionMessages` to the store.
 */
export function applyDelegationResumeGroundingIfNeeded(
  args: ApplyDelegationResumeGroundingArgs
): { messages: ChatMessage[]; injected: boolean } {
  const { sessionMessages, workspaceRoot, leadDelegationOnly, source } = args
  if (!leadDelegationOnly) return { messages: sessionMessages, injected: false }
  if (source === 'sub_agent_handoff') return { messages: sessionMessages, injected: false }
  if (sessionMessages.length === 0) return { messages: sessionMessages, injected: false }

  const sessionId = getDefaultSessionId()
  const key = delegationResumeGroundingStorageKey(workspaceRoot, sessionId)
  if (hasDelegationResumeGroundingBeenInjected(key)) {
    return { messages: sessionMessages, injected: false }
  }
  if (sessionAlreadyHasGrounding(sessionMessages)) {
    markDelegationResumeGroundingInjected(key)
    return { messages: sessionMessages, injected: false }
  }

  markDelegationResumeGroundingInjected(key)
  const msg: ChatMessage = {
    role: 'user',
    content: buildDelegationResumeGroundingUserContent(),
  }
  return { messages: [...sessionMessages, msg], injected: true }
}

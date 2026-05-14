/**
 * Team-chat inbox injector — formats unseen `@mentions` / `ask` / `blocker` /
 * `handoff` / `result` messages into a compact user-message block that is
 * prepended to a sub-agent's working context **before each LLM round** (see
 * `runOrchestrator.ts#injectUserMessageBeforeRound`).
 *
 * Lets sub-agents actually react to directives from the lead orchestrator or
 * peer agents — without polling. `lastDeliveredSeq` on the agent-team member
 * prevents the same message from being re-delivered on consecutive rounds.
 */
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useGroupChatStore, type GroupChatMessage } from '../../store/groupChatStore'

/** Kinds that should *always* be delivered (directive / blocking semantics). */
const ALWAYS_DELIVER_KINDS = new Set<GroupChatMessage['kind']>([
  'ask',
  'ack',
  'handoff',
  'blocker',
  'result',
])

/** Maximum number of messages injected per round (avoid context blow-up). */
const MAX_INBOX_INJECT = 20
/** Hard cap on the total injected block length. */
const MAX_INBOX_CHARS = 4000

/**
 * Pure predicate — is this message addressed to `tileId`?
 * Exported for tests.
 */
export function messageIsAddressedToTile(m: GroupChatMessage, tileId: string): boolean {
  if (m.senderTileId === tileId) return false
  if (m.mentions.some((x) => x.kind === 'all')) return true
  if (m.mentions.some((x) => x.kind === 'agent' && x.tileId === tileId)) return true
  return false
}

/**
 * Pure predicate — should the message be delivered even without an explicit
 * mention (directive kinds broadcast in the single session channel)?
 */
export function messageIsDirectiveForTile(m: GroupChatMessage, tileId: string): boolean {
  if (m.senderTileId === tileId) return false
  if (!ALWAYS_DELIVER_KINDS.has(m.kind)) return false
  // Session-wide: if there are no explicit mentions, everyone eligible sees it.
  if (m.mentions.length === 0) return true
  return false
}

/** Render a single message as a compact inbox line. */
function formatMessage(m: GroupChatMessage): string {
  const src =
    m.provenance.source === 'external_http' && m.provenance.agent
      ? `${m.senderName} · via ${m.provenance.agent}`
      : m.senderName
  const kindTag = m.kind === 'say' ? '' : ` [${m.kind}]`
  const replyTag = m.replyTo ? ` (re ${m.replyTo})` : ''
  const corrTag = m.correlationId ? ` {corr:${m.correlationId}}` : ''
  return `• #${m.seq}${kindTag} ${src}${replyTag}${corrTag}: ${m.body.trim()} <msg_id=${m.id} thread=${m.threadId ?? ''}>`
}

/**
 * Collect unseen messages for `tileId` in `sessionId`, advance
 * `lastDeliveredSeq`, and return a single `user`-role prompt chunk (or `null`
 * when nothing new). Side-effectful: mutates the agent-team member's
 * `lastDeliveredSeq`.
 */
export function collectAndFormatInboxForTile(sessionId: string, tileId: string): string | null {
  const teamState = useAgentTeamStore.getState()
  const member = teamState.membersByTileId[tileId]
  const sinceSeq = member?.lastDeliveredSeq ?? 0

  const chat = useGroupChatStore.getState()
  const candidates = chat.listSince(sessionId, sinceSeq)
  if (candidates.length === 0) return null

  const now = Date.now()
  const picked: GroupChatMessage[] = []
  let highestSeq = sinceSeq
  for (const m of candidates) {
    if (m.seq > highestSeq) highestSeq = m.seq
    if (m.sensitivity === 'ephemeral' && now - m.createdAt > 60_000) continue
    if (m.freshnessTtlMs && now - m.createdAt > m.freshnessTtlMs) continue
    const addressed = messageIsAddressedToTile(m, tileId)
    const directive = messageIsDirectiveForTile(m, tileId)
    if (!addressed && !directive) continue
    picked.push(m)
    if (picked.length >= MAX_INBOX_INJECT) break
  }

  // Always advance the cursor, even when nothing matched — otherwise irrelevant
  // high-traffic messages would make us re-scan the same messages every round.
  if (highestSeq > sinceSeq) {
    teamState.patchMember(tileId, { lastDeliveredSeq: highestSeq })
  }

  if (picked.length === 0) return null

  let body = ''
  for (const m of picked) {
    const line = `${formatMessage(m)}\n`
    if (body.length + line.length > MAX_INBOX_CHARS) {
      body += `… (${picked.length - (body.match(/\n/g)?.length ?? 0)} more truncated)\n`
      break
    }
    body += line
  }
  return `[Team chat inbox — unseen messages addressed to you]\n${body.trimEnd()}\n\nReply with \`reply_to_team_message({ reply_to: "<msg_id>", body: "…" })\` for asks/blockers. Use \`poll_team_messages\` to fetch older or thread-scoped history.`
}

/**
 * Build the callback used by `runOrchestrator.injectUserMessageBeforeRound`.
 * Curried so the subAgentRunner can hand in `sessionId` + `tileId` once.
 */
export function createInboxInjector(sessionId: string, tileId: string): () => string | null {
  return () => collectAndFormatInboxForTile(sessionId, tileId)
}

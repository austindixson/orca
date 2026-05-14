import type { ResolvedMention } from '../../store/groupChatStore'

/**
 * Narrow view of agent team rows — passed in so this module stays pure-ish.
 */
export interface MentionAgentTeamStoreView {
  membersByTileId: Record<string, { tileId: string; displayName: string }>
}

/**
 * Extract + resolve `@mentions` inside a message body.
 *
 * Supported forms (case-insensitive on names):
 *   - `@all`                → kind: 'all'
 *   - `@Mei` / `@tile-id`   → kind: 'agent'
 */
export function parseMentions(
  body: string,
  ctx: {
    agentTeamStore: MentionAgentTeamStoreView
    /** Optional: tile id of the sender (reserved for future rules). */
    senderTileId?: string
  }
): ResolvedMention[] {
  const out: ResolvedMention[] = []
  const seen = new Set<string>()

  const pushOnce = (m: ResolvedMention) => {
    const key = `${m.kind}|${m.tileId ?? ''}|${m.raw.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(m)
  }

  const tokenRe = /@([a-z0-9_][a-z0-9_-]*)/gi
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(body)) != null) {
    const raw = m[1]!
    const lower = raw.toLowerCase()
    if (lower === 'all') {
      pushOnce({ raw, kind: 'all' })
      continue
    }

    const agentMatch = Object.values(ctx.agentTeamStore.membersByTileId).find(
      (member) =>
        member.tileId === raw ||
        member.displayName.toLowerCase() === lower ||
        member.displayName.toLowerCase().replace(/\s+/g, '') === lower
    )
    if (agentMatch) {
      pushOnce({
        raw,
        kind: 'agent',
        tileId: agentMatch.tileId,
      })
    }
  }

  return out
}

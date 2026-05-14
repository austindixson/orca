import { create } from 'zustand'
import { nanoid } from 'nanoid'

/** Schema version for the team-chat envelope. Bump when fields are removed/renamed. */
export const GROUP_CHAT_SCHEMA_VERSION = 1

/**
 * Message *kind* — drives how sub-agents / orchestrator react when the
 * message is delivered to their inbox.
 *
 * - `say`       — free-form chat, no reply expected
 * - `ask`       — asks a question, the recipient SHOULD reply
 * - `ack`       — acknowledges an earlier `ask`/`update`
 * - `update`    — progress / status update
 * - `handoff`   — explicit work hand-off (scopes + deliverables)
 * - `blocker`   — flags a blocker
 * - `result`    — final deliverable from a task or sub-task
 */
export type GroupChatMessageKind = 'say' | 'ask' | 'ack' | 'update' | 'handoff' | 'blocker' | 'result'

/** Trust level for provenance — used when the UI decides how loudly to surface. */
export type GroupChatProvenanceTrust = 'trusted' | 'untrusted' | 'system'

/**
 * How the message entered the store. Lets the UI badge external posts ("via Hermes")
 * and lets tests assert round-trip delivery.
 */
export interface GroupChatProvenance {
  /** Transport / surface that produced this message. */
  source: 'orchestrator' | 'sub_agent' | 'human' | 'external_http' | 'system'
  /** Free-form agent identifier (e.g. "hermes@local", "openclaw", "pi"). */
  agent?: string
  /** Trust hint; `untrusted` should always be rendered with provenance visible. */
  trust: GroupChatProvenanceTrust
}

/** A single resolved @mention target on a chat message. */
export interface ResolvedMention {
  /** Free-form raw token (without the leading `@`). */
  raw: string
  /** Resolved kind — drives routing + highlight color. */
  kind: 'all' | 'agent'
  /** Tile id for kind=agent. */
  tileId?: string
}

export interface GroupChatMessage {
  id: string
  /**
   * Envelope schema version. Additive fields are safe within the same major
   * version; consumers should tolerate unknown optional fields.
   */
  schemaVersion: number
  /** Orchestrator session the message belongs to (scopes feed). */
  sessionId: string
  /** Tile id of the sender (worker or orchestrator). `undefined` = system. */
  senderTileId?: string
  /** Display label ("Mei", "Hermes", "Lead orchestrator"). */
  senderName: string
  body: string
  mentions: ResolvedMention[]
  /** Epoch ms. */
  createdAt: number
  /** Set of tile ids that have read the message (for future "unread" badges). */
  readBy: string[]
  /**
   * Monotonic per-session sequence number assigned at post time. Used by
   * inbox injection + the `poll_team_messages` tool (`since_seq`).
   */
  seq: number
  /** Message kind; defaults to `say` for legacy / human-typed posts. */
  kind: GroupChatMessageKind
  /**
   * Thread id — every message belonging to the same conversation shares a
   * `threadId`. When `replyTo` is set, `threadId` is inherited from the
   * target message (and falls back to the target's `id` when the target
   * had no `threadId`). When both are absent the message starts a new
   * thread and `threadId === id`.
   */
  threadId?: string
  /** Id of the message being replied to (for `reply_to_team_message`). */
  replyTo?: string
  /** Free-form correlation id (task id, RFC id, …) so external agents can join threads. */
  correlationId?: string
  /** How the message entered the store — UI badge + tests. */
  provenance: GroupChatProvenance
  /**
   * Sensitivity classification. `ephemeral` messages are not mirrored to the
   * workspace vault JSONL; `internal` is mirrored but may be scrubbed.
   * Defaults to `internal`.
   */
  sensitivity?: 'ephemeral' | 'internal' | 'public'
  /**
   * When set, the inbox injector will skip delivery if the message is older
   * than `createdAt + freshnessTtlMs`. Lets senders mark "stale if not seen
   * in N ms" (e.g. a live status ping).
   */
  freshnessTtlMs?: number
  /**
   * Stable content fingerprint used for duplicate suppression inside a short
   * window (see `postMessage` dedupe). Computed at post time.
   */
  fingerprint?: string
}

/**
 * Narrow input shape accepted by `postMessage`. New envelope fields are
 * optional so existing callers remain source-compatible.
 */
export interface PostGroupChatMessageInput {
  sessionId: string
  senderTileId?: string
  senderName: string
  body: string
  mentions: ResolvedMention[]
  kind?: GroupChatMessageKind
  threadId?: string
  replyTo?: string
  correlationId?: string
  provenance?: GroupChatProvenance
  sensitivity?: 'ephemeral' | 'internal' | 'public'
  freshnessTtlMs?: number
}

/**
 * Return type for `postMessage` — includes a transient `deduped` hint that is
 * NOT stored on the message itself (it only exists on the return value of the
 * dedupe path, so callers can inform the agent).
 */
export type PostedGroupChatMessage = GroupChatMessage & { deduped?: boolean }

interface GroupChatState {
  messagesBySession: Record<string, GroupChatMessage[]>
  /** Ring-buffer cap per session to avoid unbounded growth. */
  maxPerSession: number
  /** Monotonic seq counter per session. */
  seqBySession: Record<string, number>

  postMessage: (m: PostGroupChatMessageInput) => PostedGroupChatMessage

  /** Mark a message read by a viewer tile id. */
  markRead: (messageId: string, viewerTileId: string) => void

  /** All messages for a session, ordered oldest → newest. */
  listForSession: (sessionId: string) => GroupChatMessage[]

  /** All messages for the session (single `#all` channel). */
  listForChannel: (sessionId: string) => GroupChatMessage[]

  /**
   * Messages in a session with `seq > sinceSeq`, optionally filtered to a thread.
   * Ordered oldest → newest. Used by the `poll_team_messages` tool + inbox injector.
   */
  listSince: (sessionId: string, sinceSeq: number, threadId?: string) => GroupChatMessage[]

  /** Look up a single message by id within a session. Used by reply_to_team_message. */
  getMessageById: (sessionId: string, messageId: string) => GroupChatMessage | undefined

  clear: () => void
  clearForSession: (sessionId: string) => void
}

const MAX_PER_SESSION_DEFAULT = 500

/**
 * Short dedupe window for `postMessage` — messages with identical
 * (sessionId, senderTileId, body, kind, replyTo) within this many ms
 * collapse to the first posted message.
 */
const DEDUPE_WINDOW_MS = 2000

function computeFingerprint(
  sessionId: string,
  senderTileId: string | undefined,
  body: string,
  kind: GroupChatMessageKind,
  replyTo: string | undefined
): string {
  return [
    sessionId,
    senderTileId ?? '',
    kind,
    replyTo ?? '',
    body.trim().slice(0, 512),
  ].join('\x1f')
}

/**
 * Best-effort mirror hook — invoked after every successful `postMessage`.
 * Wired up outside the store (see `groupChatVaultMirror`) so Zustand stays
 * framework-free for tests.
 */
type GroupChatSink = (m: GroupChatMessage) => void
const sinks = new Set<GroupChatSink>()

/**
 * Register a side-effectful observer (vault mirror, server WS fanout, …).
 * Returns an unsubscribe function. Errors in sinks never propagate.
 */
export function subscribeGroupChatSink(sink: GroupChatSink): () => void {
  sinks.add(sink)
  return () => {
    sinks.delete(sink)
  }
}

export const useGroupChatStore = create<GroupChatState>((set, get) => ({
  messagesBySession: {},
  maxPerSession: MAX_PER_SESSION_DEFAULT,
  seqBySession: {},

  postMessage: (input) => {
    const {
      sessionId,
      senderTileId,
      senderName,
      body,
      mentions,
      kind = 'say',
      threadId: threadIdInput,
      replyTo,
      correlationId,
      provenance,
      sensitivity,
      freshnessTtlMs,
    } = input
    const now = Date.now()
    const fingerprint = computeFingerprint(sessionId, senderTileId, body, kind, replyTo)

    // Dedupe: if an identical fingerprint was posted in the last DEDUPE_WINDOW_MS,
    // return the existing message and skip storage / sink fanout.
    const existing = get().messagesBySession[sessionId] ?? []
    if (existing.length > 0) {
      for (let i = existing.length - 1; i >= 0; i--) {
        const prev = existing[i]!
        if (now - prev.createdAt > DEDUPE_WINDOW_MS) break
        if (prev.fingerprint === fingerprint) {
          return { ...prev, deduped: true }
        }
      }
    }

    const nextSeq = (get().seqBySession[sessionId] ?? 0) + 1

    // Resolve threadId: explicit > inherit from replyTo target > self.
    const id = `gcm-${nanoid(8)}`
    let resolvedThreadId = threadIdInput
    if (!resolvedThreadId && replyTo) {
      const target = existing.find((m) => m.id === replyTo)
      resolvedThreadId = target?.threadId ?? replyTo
    }
    if (!resolvedThreadId) {
      resolvedThreadId = id
    }

    const resolvedProvenance: GroupChatProvenance = provenance ?? {
      source: senderTileId ? 'sub_agent' : 'system',
      trust: 'trusted',
    }

    const msg: GroupChatMessage = {
      id,
      schemaVersion: GROUP_CHAT_SCHEMA_VERSION,
      sessionId,
      senderTileId,
      senderName,
      body,
      mentions,
      createdAt: now,
      readBy: senderTileId ? [senderTileId] : [],
      seq: nextSeq,
      kind,
      threadId: resolvedThreadId,
      replyTo,
      correlationId,
      provenance: resolvedProvenance,
      sensitivity: sensitivity ?? 'internal',
      freshnessTtlMs,
      fingerprint,
    }

    const next = [...existing, msg]
    const capped =
      next.length > get().maxPerSession ? next.slice(next.length - get().maxPerSession) : next
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionId]: capped },
      seqBySession: { ...s.seqBySession, [sessionId]: nextSeq },
    }))

    // Fan out to sinks (vault mirror, external HTTP fanout, …). Never throw.
    if (sinks.size > 0) {
      for (const sink of sinks) {
        try {
          sink(msg)
        } catch {
          // sinks are best-effort
        }
      }
    }

    return msg
  },

  markRead: (messageId, viewerTileId) => {
    const map = get().messagesBySession
    let changed = false
    const nextMap: Record<string, GroupChatMessage[]> = {}
    for (const [sid, arr] of Object.entries(map)) {
      let nextArr = arr
      for (let i = 0; i < arr.length; i++) {
        const m = arr[i]!
        if (m.id === messageId && !m.readBy.includes(viewerTileId)) {
          const copy = [...arr]
          copy[i] = { ...m, readBy: [...m.readBy, viewerTileId] }
          nextArr = copy
          changed = true
          break
        }
      }
      nextMap[sid] = nextArr
    }
    if (changed) set({ messagesBySession: nextMap })
  },

  listForSession: (sessionId) => get().messagesBySession[sessionId] ?? [],

  listForChannel: (sessionId) => get().messagesBySession[sessionId] ?? [],

  listSince: (sessionId, sinceSeq, threadId) => {
    const all = get().messagesBySession[sessionId] ?? []
    return all.filter((m) => m.seq > sinceSeq && (threadId ? m.threadId === threadId : true))
  },

  getMessageById: (sessionId, messageId) => {
    const all = get().messagesBySession[sessionId] ?? []
    return all.find((m) => m.id === messageId)
  },

  clear: () => set({ messagesBySession: {}, seqBySession: {} }),

  clearForSession: (sessionId) => {
    const msgCopy = { ...get().messagesBySession }
    const seqCopy = { ...get().seqBySession }
    delete msgCopy[sessionId]
    delete seqCopy[sessionId]
    set({ messagesBySession: msgCopy, seqBySession: seqCopy })
  },
}))

import { sendToFirstOpenCanvasUiClient } from './canvasBridge.js'

const pending = new Map<
  string,
  { resolve: (v: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>()

const ORCHESTRATOR_REPLY_UI_TIMEOUT_MS = 300_000

/**
 * Forward an orchestrator reply to the Orca UI; wait for `orchestrator:reply:result`.
 */
export function enqueueOrchestratorReply(p: {
  parentTileId: string
  text: string
  role?: string
  childTileId?: string
  sessionId?: string
}): Promise<string> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const sent = sendToFirstOpenCanvasUiClient({
      type: 'orchestrator:reply',
      payload: {
        requestId,
        parentTileId: p.parentTileId,
        childTileId: p.childTileId,
        role: p.role ?? 'external',
        text: p.text,
        sessionId: p.sessionId,
      },
    })
    if (!sent) {
      reject(
        new Error(
          'No Orca UI on the bridge (uiClients: 0). Open Orca on this machine and keep the canvas bridge connected.'
        )
      )
      return
    }

    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('Timed out waiting for Orca UI to acknowledge orchestrator reply.'))
    }, ORCHESTRATOR_REPLY_UI_TIMEOUT_MS)

    pending.set(requestId, { resolve, reject, timer })
  })
}

export function completeOrchestratorReply(requestId: string, result: string): boolean {
  const p = pending.get(requestId)
  if (!p) return false
  clearTimeout(p.timer)
  pending.delete(requestId)
  p.resolve(result)
  return true
}

/**
 * Kind hints that mirror `GroupChatMessageKind` on the client. Kept as a
 * string union here so we don't drag the client type into server code.
 */
export type TeamMessageKind =
  | 'say'
  | 'ask'
  | 'ack'
  | 'update'
  | 'handoff'
  | 'blocker'
  | 'result'

/**
 * External team-message envelope accepted by `POST /api/orchestrator/team-message`.
 * Mirrors the internal `post_team_message` tool; tagged with `provenance.source =
 * 'external_http'` client-side so the UI can badge it ("via Hermes").
 */
export interface EnqueueTeamMessageOptions {
  /** Free-form agent id — "hermes@local", "openclaw", "pi", … */
  agent: string
  body: string
  /** Orca session to post into. When omitted the UI uses its default. */
  sessionId?: string
  /** Optional team name ("Red Team"). When omitted the message goes to #all. */
  team?: string
  /** Optional recipient (tile id or displayName). Adds `@<to>` to the body. */
  to?: string
  /** `"leads"` for the cross-team coordination channel. */
  channel?: string
  /** Structured intent. Defaults to `"say"` client-side. */
  kind?: TeamMessageKind
  /** Reply to a specific message id (inherits thread + correlation). */
  replyTo?: string
  correlationId?: string
  /** Display name to show for the remote sender (falls back to `agent`). */
  senderName?: string
}

const TEAM_MESSAGE_UI_TIMEOUT_MS = 30_000

const pendingTeam = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>()

/**
 * Forward an external team-message post to the Orca UI over the canvas
 * bridge. The UI converts it to a `GroupChatMessage` with
 * `provenance.source = 'external_http'` and acknowledges via
 * `team:message:incoming:result`. Returns the posted message id + seq on
 * success.
 */
export function enqueueExternalTeamMessage(
  opts: EnqueueTeamMessageOptions
): Promise<{ id: string; seq: number; thread_id: string | null; deduped: boolean }> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const sent = sendToFirstOpenCanvasUiClient({
      type: 'team:message:incoming',
      payload: {
        requestId,
        agent: opts.agent,
        senderName: opts.senderName ?? opts.agent,
        body: opts.body,
        sessionId: opts.sessionId,
        team: opts.team,
        to: opts.to,
        channel: opts.channel,
        kind: opts.kind,
        replyTo: opts.replyTo,
        correlationId: opts.correlationId,
      },
    })
    if (!sent) {
      reject(
        new Error(
          'No Orca UI on the bridge (uiClients: 0). Open Orca on this machine and keep the canvas bridge connected.'
        )
      )
      return
    }

    const timer = setTimeout(() => {
      pendingTeam.delete(requestId)
      reject(new Error('Timed out waiting for Orca UI to acknowledge team message.'))
    }, TEAM_MESSAGE_UI_TIMEOUT_MS)

    pendingTeam.set(requestId, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timer,
    })
  })
}

/** Called from `wsRouter` when the UI acknowledges via `team:message:incoming:result`. */
export function completeExternalTeamMessage(
  requestId: string,
  result: { ok: boolean; id?: string; seq?: number; thread_id?: string | null; deduped?: boolean; error?: string }
): boolean {
  const p = pendingTeam.get(requestId)
  if (!p) return false
  clearTimeout(p.timer)
  pendingTeam.delete(requestId)
  if (result.ok && typeof result.id === 'string' && typeof result.seq === 'number') {
    p.resolve({
      id: result.id,
      seq: result.seq,
      thread_id: result.thread_id ?? null,
      deduped: result.deduped === true,
    })
  } else {
    p.reject(new Error(result.error || 'UI rejected team message'))
  }
  return true
}

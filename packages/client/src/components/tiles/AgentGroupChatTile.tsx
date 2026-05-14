import { useEffect, useMemo, useRef, useState } from 'react'
import { useGroupChatStore } from '../../store/groupChatStore'
import type { GroupChatMessage } from '../../store/groupChatStore'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useCanvasStore } from '../../store/canvasStore'
import { agentLinkHueFromTileId } from '../../lib/orchestrator/resolveHubAgentHue'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { activateModuleOnCanvas } from '../../lib/canvasModuleNavigation'
import { executeOrchestratorTool } from '../../lib/orchestrator/executeTools'
import { getDefaultSessionId } from '../../lib/persistence/sessionPersistence'

function formatTs(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface MentionClick {
  onAgent: (tileId: string) => void
}

/**
 * Render the message body, turning `@mentions` into small pill chips.
 * Parsing is pre-resolved by `parseMentions`; this is pure presentation.
 */
function renderBody(msg: GroupChatMessage, click: MentionClick): React.ReactNode {
  if (msg.mentions.length === 0) return msg.body
  const out: React.ReactNode[] = []
  let cursor = 0
  const re = /@([a-z0-9_][a-z0-9_-]*)/gi
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(msg.body)) != null) {
    const start = m.index
    if (start > cursor) out.push(msg.body.slice(cursor, start))
    const shownLabel = m[1] ?? ''
    const matched = msg.mentions.find(
      (mm) => mm.raw.toLowerCase() === shownLabel.toLowerCase()
    )
    const tone =
      matched?.kind === 'all'
        ? 'bg-emerald-500/20 text-emerald-100 border-emerald-400/40'
        : matched?.kind === 'agent'
          ? 'bg-sky-500/20 text-sky-100 border-sky-400/40'
          : 'bg-white/5 text-gray-400 border-white/10'
    const clickable = matched?.kind === 'agent' && matched.tileId
    const onClick = () => {
      if (matched?.kind === 'agent' && matched.tileId) click.onAgent(matched.tileId)
    }
    const pillClass = `mx-[1px] inline-flex items-center rounded-md border px-1 py-[1px] text-[10.5px] font-medium ${tone} ${clickable ? 'cursor-pointer hover:brightness-110' : ''}`
    const pill = clickable ? (
      <button type="button" key={`m-${key++}`} className={pillClass} onClick={onClick}>
        @{shownLabel}
      </button>
    ) : (
      <span key={`m-${key++}`} className={pillClass}>
        @{shownLabel}
      </span>
    )
    out.push(pill)
    cursor = start + m[0].length
  }
  if (cursor < msg.body.length) out.push(msg.body.slice(cursor))
  return out
}

/**
 * **Agent Group Chat** — single `#all` channel for the orchestrator session.
 */
export function AgentGroupChatTile(_: TileComponentProps) {
  const sessionId = getDefaultSessionId()
  const messages = useGroupChatStore((s) => s.messagesBySession[sessionId] ?? [])
  const membersByTileId = useAgentTeamStore((s) => s.membersByTileId)

  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const visibleMessages = useMemo(() => messages, [messages])

  const activeTypingMembers = useMemo(() => {
    return Object.values(membersByTileId)
      .filter((m) => m.status === 'working')
      .sort((a, b) => b.statusUpdatedAt - a.statusUpdatedAt)
      .slice(0, 3)
  }, [membersByTileId])
  const hasMultiAgentTeam = useMemo(() => Object.keys(membersByTileId).length > 1, [membersByTileId])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visibleMessages.length])

  const jumpToTile = (tileId: string) => {
    if (!useCanvasStore.getState().tiles.has(tileId)) return
    activateModuleOnCanvas(tileId, { intent: 'user_sidebar' })
  }

  const handlePost = async () => {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      await executeOrchestratorTool(
        'post_team_message',
        JSON.stringify({ body }),
        { orchestratorTileId: null, sessionId }
      )
      setDraft('')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-canvas-bg">
      <div className="border-b border-tile-border px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Agent group chat
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
          Single <code className="text-accent-teal/90">#all</code> channel. Use{' '}
          <code className="text-accent-teal/90">@all</code> or{' '}
          <code className="text-accent-teal/90">@&lt;name&gt;</code> / tile id.
          {hasMultiAgentTeam ? ' With multiple active agents, post short updates after each completed task.' : ''}
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-tile-border bg-black/20 px-2 py-1.5">
        <span className="rounded-md border border-white/30 bg-white/10 px-2 py-1 text-[11px] font-medium text-gray-100">
          #all
        </span>
      </div>

      <div ref={listRef} className="flex-1 overflow-auto px-3 py-2">
        {visibleMessages.length === 0 ? (
          <div className="mt-2 text-[12px] text-gray-500">
            No messages yet. Agents post with{' '}
            <code className="text-accent-teal/90">post_team_message</code> — or send one below.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleMessages.map((msg) => {
              const hue = msg.senderTileId ? agentLinkHueFromTileId(msg.senderTileId) : 174
              const senderMember = msg.senderTileId ? membersByTileId[msg.senderTileId] : undefined
              const senderClickable = msg.senderTileId
                ? useCanvasStore.getState().tiles.has(msg.senderTileId)
                : false
              return (
                <li
                  key={msg.id}
                  className="rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-1.5"
                  style={{ borderLeft: `3px solid hsl(${hue} 55% 55% / 0.55)` }}
                >
                  <div className="flex items-baseline gap-1.5 text-[11px]">
                    <button
                      type="button"
                      className={`font-semibold ${
                        senderClickable
                          ? 'text-gray-100 hover:text-accent-teal'
                          : 'text-gray-200 cursor-default'
                      }`}
                      onClick={() => msg.senderTileId && jumpToTile(msg.senderTileId)}
                      disabled={!senderClickable}
                      data-tooltip={senderMember?.role ?? undefined}
                    >
                      {msg.senderName}
                    </button>
                    <span className="ml-auto text-[10px] text-gray-500 tabular-nums">
                      {formatTs(msg.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-snug text-gray-200">
                    {renderBody(msg, { onAgent: jumpToTile })}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-tile-border bg-black/20 px-2 py-2">
        {activeTypingMembers.length > 0 ? (
          <div className="mb-1.5 flex items-center gap-2 text-[11px] text-gray-400">
            <span className="truncate">
              {activeTypingMembers.map((m) => m.displayName).join(', ')}
              {activeTypingMembers.length === 1 ? ' is typing' : ' are typing'}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400/70" />
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400/85" />
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
            </span>
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handlePost()
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Post to #all — @all, @name, or plain text…"
            disabled={posting}
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-gray-100 placeholder:text-gray-500 focus:border-accent-teal focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || posting}
            className="rounded-md border border-accent-teal/40 bg-accent-teal/15 px-2.5 py-1.5 text-[11px] font-semibold text-accent-teal hover:bg-accent-teal/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {posting ? 'Posting…' : 'Post'}
          </button>
        </form>
      </div>
    </div>
  )
}

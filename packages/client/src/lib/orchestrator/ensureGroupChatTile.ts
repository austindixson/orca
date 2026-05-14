import { useCanvasStore } from '../../store/canvasStore'
import { getViewportLayoutRect } from '../layoutPresets'
import { revealOrchestratorTile } from './revealOrchestratorTile'

const W = 440
const H = 520
const VIEWPORT_INSET = 16
const STACK_OFFSET = 20

export type EnsureGroupChatTileOpts = {
  /**
   * Create the tile if none exists. Use only when a **sub-agent** is posting so the
   * canvas can show the session chat when they need it; omit for orchestrator-only posts.
   */
  createIfMissing?: boolean
  /**
   * Bring the tile to the front and run orchestrator reveal (auto-focus path).
   * Only for messages posted from a **sub-agent** tool context — not the lead orchestrator
   * and not for poll/read-only paths.
   */
  focus?: boolean
}

/**
 * Optionally ensures an **Agent Group Chat** tile exists and/or is surfaced.
 *
 * - Sub-agent `post_team_message` / `reply_to_team_message`: pass
 *   `{ createIfMissing: true, focus: true }` so the first agent post can create the tile and
 *   steal focus to surface coordination.
 * - Lead orchestrator or human-driven posts: omit (defaults) — messages still land in
 *   `groupChatStore`; no auto-spawn and no focus steal.
 * - Not called from `spawn_sub_agent` — spawning workers does not imply opening group chat.
 */
export function ensureGroupChatTile(opts: EnsureGroupChatTileOpts = {}): string | null {
  const { createIfMissing = false, focus = false } = opts
  const { tiles, pan, zoom, bringToFront, addTile, updateTile } = useCanvasStore.getState()

  const existing = [...tiles.values()].find((t) => t.type === 'agent_group_chat')
  const area = getViewportLayoutRect(pan, zoom)

  const position =
    area != null
      ? {
          x: area.x + VIEWPORT_INSET,
          y: area.y + VIEWPORT_INSET + 420 + STACK_OFFSET,
        }
      : undefined

  if (existing) {
    if (!focus) {
      return existing.id
    }
    bringToFront(existing.id)
    updateTile(existing.id, {
      meta: { ...existing.meta, agentGroupChatTile: true },
    })
    revealOrchestratorTile(existing.id, undefined, undefined, { bypassAutoFocusPreference: true })
    return existing.id
  }

  if (!createIfMissing) {
    return null
  }

  const id = addTile('agent_group_chat', position)
  updateTile(id, {
    w: W,
    h: H,
    title: 'Agent group chat',
    meta: { agentGroupChatTile: true },
  })
  if (focus) {
    revealOrchestratorTile(id, undefined, undefined, { bypassAutoFocusPreference: true })
  }
  return id
}

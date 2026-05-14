import { useCanvasStore } from '../../store/canvasStore'
import { getViewportLayoutRect } from '../layoutPresets'
import { revealOrchestratorTile } from './revealOrchestratorTile'

const W = 380
const H = 420
const VIEWPORT_INSET = 16

/**
 * Ensures an **Agent Team** tracker tile exists (read-only roster of delegated sub-agents).
 * Called on every `spawn_sub_agent` — snaps to the viewport corner, brings to front, and reveals
 * even if **orchestrator auto-focus** is off (delegation should always be visible).
 */
export function ensureAgentTeamTile(): string {
  const { tiles, pan, zoom, bringToFront, addTile, updateTile } = useCanvasStore.getState()

  const existing = [...tiles.values()].find((t) => t.type === 'agent_team')
  const area = getViewportLayoutRect(pan, zoom)

  const position =
    area != null
      ? {
          x: area.x + VIEWPORT_INSET,
          y: area.y + VIEWPORT_INSET,
        }
      : undefined

  if (existing) {
    bringToFront(existing.id)
    updateTile(existing.id, {
      x: position?.x ?? existing.x,
      y: position?.y ?? existing.y,
      meta: { ...existing.meta, agentTeamTracker: true },
    })
    revealOrchestratorTile(existing.id, undefined, undefined, { bypassAutoFocusPreference: true })
    return existing.id
  }

  const id = addTile('agent_team', position)
  updateTile(id, {
    w: W,
    h: H,
    title: 'Agent team',
    meta: { agentTeamTracker: true },
  })
  revealOrchestratorTile(id, undefined, undefined, { bypassAutoFocusPreference: true })
  return id
}

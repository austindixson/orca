import { useCanvasStore } from '../../store/canvasStore'
import { getViewportLayoutRect } from '../layoutPresets'
import { revealOrchestratorTile } from './revealOrchestratorTile'

const W = 440
const H = 540
const VIEWPORT_INSET = 16

/**
 * Ensures the canvas has exactly one **Bug Bounty Board** tile. Opened automatically
 * when the first bounty lands (from terminal/console/inspect/manual), brought to
 * front on subsequent calls. Always reveals, bypassing orchestrator auto-focus prefs.
 */
export function ensureBugBountyTile(): string {
  const { tiles, pan, zoom, bringToFront, addTile, updateTile } = useCanvasStore.getState()

  const existing = [...tiles.values()].find((t) => t.type === 'bug_bounty')
  const area = getViewportLayoutRect(pan, zoom)

  const position =
    area != null
      ? {
          x: area.x + VIEWPORT_INSET,
          y: area.y + VIEWPORT_INSET + 440,
        }
      : undefined

  if (existing) {
    bringToFront(existing.id)
    updateTile(existing.id, {
      x: position?.x ?? existing.x,
      y: position?.y ?? existing.y,
      meta: { ...existing.meta, bugBountyBoard: true },
    })
    revealOrchestratorTile(existing.id, undefined, undefined, {
      bypassAutoFocusPreference: true,
    })
    return existing.id
  }

  const id = addTile('bug_bounty', position)
  updateTile(id, {
    w: W,
    h: H,
    title: 'Bug bounty board',
    meta: { bugBountyBoard: true },
  })
  revealOrchestratorTile(id, undefined, undefined, { bypassAutoFocusPreference: true })
  return id
}

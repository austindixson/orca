import { useCanvasStore } from '../../store/canvasStore'
import { getViewportLayoutRect } from '../layoutPresets'
import { revealOrchestratorTile } from './revealOrchestratorTile'

const WIDGET_W = 630
const WIDGET_H = 500
const VIEWPORT_INSET = 16

/**
 * Ensures an orchestrator canvas tile exists (same module as the sidebar).
 * New tiles spawn **centered** in the visible canvas; existing tiles are brought forward and the
 * camera pans to center them — including when runs start from the orchestrator sidebar.
 */
export function ensureOrchestratorWidgetTile(): string {
  const { tiles, pan, zoom, bringToFront, addTile, updateTile } = useCanvasStore.getState()

  const existing = [...tiles.values()].find((t) => t.type === 'orchestrator')
  const area = getViewportLayoutRect(pan, zoom)

  const upperRight =
    area != null
      ? {
          x: area.x + area.w - WIDGET_W - VIEWPORT_INSET,
          y: area.y + VIEWPORT_INSET,
        }
      : undefined

  const centered =
    area != null
      ? {
          x: area.x + (area.w - WIDGET_W) / 2,
          y: area.y + (area.h - WIDGET_H) / 2,
        }
      : undefined

  const spawnPosition = centered ?? upperRight

  const revealOpts = { bypassAutoFocusPreference: true, forceCamera: true } as const

  if (existing) {
    bringToFront(existing.id)
    updateTile(existing.id, {
      meta: { ...existing.meta, orchestratorWidget: true },
    })
    revealOrchestratorTile(existing.id, undefined, null, revealOpts)
    return existing.id
  }

  const id = addTile('orchestrator', spawnPosition)
  updateTile(id, {
    w: WIDGET_W,
    h: WIDGET_H,
    meta: { orchestratorWidget: true },
  })
  revealOrchestratorTile(id, undefined, null, revealOpts)
  return id
}

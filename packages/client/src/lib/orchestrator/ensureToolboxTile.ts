import { useCanvasStore } from '../../store/canvasStore'
import { getViewportLayoutRect } from '../layoutPresets'
import { revealOrchestratorTile } from './revealOrchestratorTile'

const W = 420
const H = 480
const VIEWPORT_INSET = 16

/**
 * Ensures a **Toolbox** tile exists (orchestrator tool history + skills created via `create_project_skill`).
 * Bottom-right of the viewport; brought to front when the orchestrator starts a run.
 */
export function ensureToolboxTile(): string {
  const { tiles, pan, zoom, bringToFront, addTile, updateTile } = useCanvasStore.getState()
  const existing = [...tiles.values()].find((t) => t.type === 'toolbox')
  const area = getViewportLayoutRect(pan, zoom)

  const position =
    area != null
      ? {
          x: area.x + area.w - W - VIEWPORT_INSET,
          y: area.y + area.h - H - VIEWPORT_INSET,
        }
      : undefined

  if (existing) {
    bringToFront(existing.id)
    updateTile(existing.id, {
      x: position?.x ?? existing.x,
      y: position?.y ?? existing.y,
      meta: { ...existing.meta, toolboxWidget: true },
    })
    revealOrchestratorTile(existing.id, { label: 'Toolbox…', effect: 'pulse' }, undefined, {
      bypassAutoFocusPreference: true,
    })
    return existing.id
  }

  const id = addTile('toolbox', position)
  updateTile(id, {
    w: W,
    h: H,
    title: 'Toolbox',
    meta: { toolboxWidget: true, source: 'orchestrator-auto' },
  })
  revealOrchestratorTile(id, { label: 'Toolbox…', effect: 'pulse' }, undefined, {
    bypassAutoFocusPreference: true,
  })
  return id
}

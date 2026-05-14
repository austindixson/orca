import { useCanvasStore } from '../../store/canvasStore'
import { useSettingsStore } from '../../store/settingsStore'
import { getViewportLayoutRect } from '../layoutPresets'

const TILE_W = 420
const TILE_H = 460
const VIEWPORT_INSET = 16

/**
 * Ensures a single OpenRouter usage / spend tracker tile exists (bottom-left of viewport).
 * No-op if OpenRouter is not an active provider or the selected model is not OpenRouter.
 */
export function ensureOpenRouterUsageTile(): string | null {
  const settings = useSettingsStore.getState()
  if (!settings.getActiveProviders().includes('openrouter')) return null

  const models = settings.getAvailableModels()
  const selectedId = settings.selectedModel
  const selected = models.find((m) => m.id === selectedId) ?? models[0]
  if (!selected || selected.provider !== 'openrouter') return null

  const { tiles, pan, zoom, bringToFront, addTile, updateTile } = useCanvasStore.getState()
  const existing = [...tiles.values()].find((t) => t.type === 'openrouter_usage')
  const area = getViewportLayoutRect(pan, zoom)

  const position =
    area != null
      ? {
          x: area.x + VIEWPORT_INSET,
          y: area.y + area.h - TILE_H - VIEWPORT_INSET,
        }
      : undefined

  if (existing) {
    bringToFront(existing.id)
    updateTile(existing.id, {
      x: position?.x ?? existing.x,
      y: position?.y ?? existing.y,
      meta: { ...existing.meta, openRouterUsageWidget: true },
    })
    return existing.id
  }

  const id = addTile('openrouter_usage', position)
  updateTile(id, {
    w: TILE_W,
    h: TILE_H,
    title: 'OpenRouter usage',
    meta: { openRouterUsageWidget: true, source: 'openrouter-auto' },
  })
  return id
}

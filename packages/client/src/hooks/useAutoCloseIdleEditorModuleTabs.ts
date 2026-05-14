import { useEffect, useRef } from 'react'
import type { TileType } from '../store/canvasStore'
import { useCanvasStore } from '../store/canvasStore'

/** Background editor module tabs close after this long without being selected. */
export const EDITOR_MODULE_TAB_IDLE_CLOSE_MS = 5000

const CHECK_INTERVAL_MS = 400

/**
 * When an editor tile has multiple module tabs, tabs that stay in the background longer than
 * {@link EDITOR_MODULE_TAB_IDLE_CLOSE_MS} are closed automatically (one close per tick).
 */
export function useAutoCloseIdleEditorModuleTabs(
  tileId: string,
  type: TileType,
  activeModuleTabId: string | undefined,
  /** Stable fingerprint of tab ids so add/remove/reorder updates background timers. */
  moduleTabIdsKey: string
): void {
  const prevActiveRef = useRef<string | undefined>(undefined)
  const backgroundSinceRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (type !== 'editor' || !moduleTabIdsKey.includes(',')) {
      prevActiveRef.current = activeModuleTabId
      backgroundSinceRef.current = {}
      return
    }

    const tile = useCanvasStore.getState().tiles.get(tileId)
    const moduleTabs = tile?.moduleTabs
    if (!moduleTabs || moduleTabs.length < 2) return

    const activeId = activeModuleTabId
    const prev = prevActiveRef.current
    const now = Date.now()

    const ids = new Set(moduleTabs.map((t) => t.id))
    for (const k of Object.keys(backgroundSinceRef.current)) {
      if (!ids.has(k)) delete backgroundSinceRef.current[k]
    }

    if (prev !== undefined && prev !== activeId) {
      backgroundSinceRef.current[prev] = now
    }
    if (activeId) delete backgroundSinceRef.current[activeId]

    if (prev === undefined) {
      for (const t of moduleTabs) {
        if (t.id !== activeId) backgroundSinceRef.current[t.id] = now
      }
    }

    prevActiveRef.current = activeId
  }, [tileId, type, activeModuleTabId, moduleTabIdsKey])

  useEffect(() => {
    if (type !== 'editor') return
    const id = window.setInterval(() => {
      const tile = useCanvasStore.getState().tiles.get(tileId)
      if (!tile || tile.type !== 'editor' || !tile.moduleTabs || tile.moduleTabs.length < 2) return
      const aid = tile.activeModuleTabId
      const t0 = Date.now()
      for (const tab of tile.moduleTabs) {
        if (tab.id === aid) continue
        const since = backgroundSinceRef.current[tab.id]
        if (since != null && t0 - since >= EDITOR_MODULE_TAB_IDLE_CLOSE_MS) {
          useCanvasStore.getState().closeModuleTab(tileId, tab.id)
          return
        }
      }
    }, CHECK_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [tileId, type])
}

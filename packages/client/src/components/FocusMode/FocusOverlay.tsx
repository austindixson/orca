import { useEffect, useCallback } from 'react'
import { useFocusStore } from '../../store/focusStore'
import { useCanvasStore, TileType } from '../../store/canvasStore'
import { useToastStore } from '../../store/toastStore'

export function FocusOverlay() {
  const { isActive, focusedTileIds, exitFocus, toggleFocus, layoutFocusedTiles } = useFocusStore()
  const { tiles, addTile, setPan, setZoom } = useCanvasStore()
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    if (!isActive) return

    const handleResize = () => {
      layoutFocusedTiles()
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isActive, layoutFocusedTiles])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Capture phase: Escape must run before Monaco / inputs handle it and stopPropagation,
    // or exitFocus never runs and tiles stay fullscreen while focus UI may already be cleared.
    if (e.key === 'Escape' && isActive) {
      e.preventDefault()
      e.stopPropagation()
      exitFocus()
      return
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      const firstTile = tiles.values().next().value
      toggleFocus(focusedTileIds[0] ?? firstTile?.id)
      return
    }

    if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '6') {
      e.preventDefault()
      const tileTypes: TileType[] = ['agent', 'terminal', 'browser', 'todo', 'editor', 'diff']
      const index = parseInt(e.key) - 1
      if (index < tileTypes.length) {
        const type = tileTypes[index]
        addTile(type)
        addToast({
          type: 'info',
          title: `Added ${type} tile`,
          duration: 2000,
        })
      }
      return
    }

    if ((e.metaKey || e.ctrlKey) && e.key === '0') {
      e.preventDefault()
      setPan({ x: 0, y: 0 })
      setZoom(1)
      addToast({
        type: 'info',
        title: 'View reset',
        duration: 2000,
      })
      return
    }
  }, [isActive, exitFocus, toggleFocus, focusedTileIds, tiles, addTile, addToast, setPan, setZoom])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  if (!isActive) return null

  const focusCount = focusedTileIds.length

  return (
    <div className="fixed inset-0 z-[16000] pointer-events-none">
      {/* Focus mode header bar — above FocusLayout dividers (z-15000) */}
      <div className="absolute top-0 left-0 right-0 z-[1] h-12 bg-canvas-bg/95 backdrop-blur-xl border-b border-tile-border pointer-events-auto flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent-teal shadow-[0_0_8px_rgba(var(--accent-teal-rgb),0.75)]" />
            <span className="text-sm text-white font-medium">Focus Mode</span>
            {focusCount > 1 && (
              <span className="px-2 py-0.5 bg-accent-teal/20 text-accent-teal text-xs rounded-full">
                {focusCount} tiles
              </span>
            )}
          </div>
          <div className="w-px h-4 bg-tile-border" />
          <button
            onClick={exitFocus}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <span>Exit</span>
            <kbd className="px-1.5 py-0.5 bg-tile-hover rounded text-xs">Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

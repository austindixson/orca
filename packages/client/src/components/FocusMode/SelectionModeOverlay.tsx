import { useEffect } from 'react'
import { useFocusStore } from '../../store/focusStore'

export function SelectionModeOverlay() {
  const { 
    isSelectionMode, 
    selectedForFocus, 
    confirmSelection, 
    cancelSelectionMode 
  } = useFocusStore()

  useEffect(() => {
    if (!isSelectionMode) return

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        confirmSelection()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelSelectionMode()
      }
    }

    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSelectionMode, confirmSelection, cancelSelectionMode])

  if (!isSelectionMode) return null

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 h-14 bg-canvas-bg/95 backdrop-blur-xl border-b border-accent-teal/30 flex items-center justify-center pointer-events-auto">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent-teal shadow-[0_0_8px_rgba(var(--accent-teal-rgb),0.75)]" />
            <span className="text-white font-medium">Selection Mode</span>
          </div>
          
          <div className="w-px h-5 bg-tile-border" />
          
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span>Click tiles to select</span>
            <span className="text-gray-600">•</span>
            <span className="flex items-center gap-1">
              Release 
              <kbd className="px-1.5 py-0.5 bg-tile-bg border border-tile-border rounded text-xs text-accent-teal">Shift</kbd>
              to focus
            </span>
          </div>
          
          <div className="w-px h-5 bg-tile-border" />
          
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 bg-accent-teal/20 text-accent-teal text-sm rounded-lg font-medium">
              {selectedForFocus.length} selected
            </span>
          </div>
          
          <button
            onClick={cancelSelectionMode}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <span>Cancel</span>
            <kbd className="px-1 py-0.5 bg-tile-bg border border-tile-border rounded text-xs">Esc</kbd>
          </button>
        </div>
      </div>

      {/* Selection count badge that follows tiles */}
      {selectedForFocus.length > 1 && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-4 py-2 bg-accent-teal text-canvas-bg rounded-full font-medium shadow-lg pointer-events-auto">
          {selectedForFocus.length} tiles selected — release Shift to focus
        </div>
      )}
    </div>
  )
}

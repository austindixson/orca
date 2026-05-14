import { useCanvasStore } from '../../store/canvasStore'
import { useFocusStore } from '../../store/focusStore'

/**
 * Screen-space overlay on the canvas container (sibling to the pan/zoom layer), not scaled with
 * the canvas — keeps hint text readable at any zoom. Stays below tiles via DOM order + z-index.
 */
export function CanvasHintsOverlay() {
  const tiles = useCanvasStore((s) => s.tiles)
  const smartCollapsePicking = useCanvasStore((s) => s.smartCollapsePicking)
  const isActive = useFocusStore((s) => s.isActive)
  const tilesArray = Array.from(tiles.values())

  if (isActive || tilesArray.length === 0) return null

  return (
    <div className="pointer-events-none absolute top-3 left-3 z-[1] flex max-w-[min(24rem,calc(100%-1.5rem))] flex-col gap-1.5 text-xs leading-relaxed text-gray-500">
      {smartCollapsePicking && (
        <div className="flex items-start gap-2 rounded-md bg-canvas-bg/90 px-2 py-1.5 ring-1 ring-accent-teal/50 backdrop-blur-sm">
          <span className="min-w-0 text-accent-teal/90">
            Click a tile to choose your main window.
          </span>
          <kbd className="mt-0.5 shrink-0 rounded border border-tile-border bg-tile-bg px-1.5 py-0.5 text-[11px] text-gray-300 leading-none">
            Esc
          </kbd>
          <span className="shrink-0 text-gray-400">to cancel</span>
        </div>
      )}
      <div className="flex items-start gap-2 rounded-md bg-canvas-bg/90 px-2 py-1.5 ring-1 ring-tile-border/60 backdrop-blur-sm">
        <kbd className="mt-0.5 shrink-0 rounded border border-tile-border bg-tile-bg px-1.5 py-0.5 text-[11px] text-gray-300 leading-none">
          Shift
        </kbd>
        <span className="min-w-0 text-gray-400">+ drag on canvas to select tiles</span>
      </div>
      <div className="flex items-start gap-2 rounded-md bg-canvas-bg/90 px-2 py-1.5 ring-1 ring-tile-border/60 backdrop-blur-sm">
        <kbd className="mt-0.5 shrink-0 rounded border border-tile-border bg-tile-bg px-1.5 py-0.5 text-[11px] text-gray-300 leading-none">
          ⌥
        </kbd>
        <span className="min-w-0 text-gray-400">
          + drag a title bar to snap edges when within ~12px (guides appear at alignment)
        </span>
      </div>
    </div>
  )
}

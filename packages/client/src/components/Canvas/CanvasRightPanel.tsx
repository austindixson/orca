import { useCanvasStore } from '../../store/canvasStore'
import { useFocusStore } from '../../store/focusStore'
import { CanvasNavigator } from './CanvasNavigator'
import { LayoutPresetBar } from './LayoutPresetBar'

/**
 * Minimap + layout presets (bottom-right). During Smart Collapse, focus mode, or tile
 * selection mode, the preview hides so it doesn’t cover tiles — only the layout buttons stay,
 * pinned to the bottom-right corner of the viewport.
 */
export function CanvasRightPanel() {
  const canvasViewMode = useCanvasStore((s) => s.canvasViewMode)
  const tileCount = useCanvasStore((s) => s.tiles.size)
  const smartCollapse = useCanvasStore((s) => s.smartCollapse)
  const smartCollapsePicking = useCanvasStore((s) => s.smartCollapsePicking)
  const isFocus = useFocusStore((s) => s.isActive)
  const isSelectionMode = useFocusStore((s) => s.isSelectionMode)
  const isDeleteSelectionMode = useFocusStore((s) => s.isDeleteSelectionMode)

  if (canvasViewMode === 'plan' || canvasViewMode === 'helix') return null
  if (tileCount === 0) return null

  const hideMinimap =
    smartCollapse != null ||
    smartCollapsePicking ||
    isFocus ||
    isSelectionMode ||
    isDeleteSelectionMode

  if (hideMinimap) {
    return (
      <div
        className="pointer-events-none fixed bottom-3 right-4 z-[110] max-w-[min(100vw-1rem,24rem)] [&>*]:pointer-events-auto"
        data-testid="canvas-layout-buttons-only"
      >
        <LayoutPresetBar />
      </div>
    )
  }

  return (
    <div
      className="pointer-events-none fixed bottom-20 right-4 z-[70] flex flex-col items-end gap-2 [&>*]:pointer-events-auto"
      data-testid="canvas-right-panel"
    >
      <CanvasNavigator />
      <LayoutPresetBar />
    </div>
  )
}

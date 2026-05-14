import { useCallback, useMemo } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { useFocusStore } from '../../store/focusStore'
import {
  computePresetLayout,
  getViewportLayoutRect,
  presetButtonsForCount,
  sortTilesForLayout,
  type PresetId,
} from '../../lib/layoutPresets'

export function LayoutPresetBar() {
  const tiles = useCanvasStore((s) => s.tiles)
  const pan = useCanvasStore((s) => s.pan)
  const zoom = useCanvasStore((s) => s.zoom)
  const applyTilesLayout = useCanvasStore((s) => s.applyTilesLayout)
  const captureLayoutPresetUndoSnapshot = useCanvasStore(
    (s) => s.captureLayoutPresetUndoSnapshot
  )
  const restoreLayoutPresetUndo = useCanvasStore((s) => s.restoreLayoutPresetUndo)
  const layoutPresetUndo = useCanvasStore((s) => s.layoutPresetUndo)
  const smartCollapse = useCanvasStore((s) => s.smartCollapse)
  const smartCollapsePicking = useCanvasStore((s) => s.smartCollapsePicking)
  const startSmartCollapsePicker = useCanvasStore((s) => s.startSmartCollapsePicker)
  const cancelSmartCollapsePicker = useCanvasStore((s) => s.cancelSmartCollapsePicker)
  const exitSmartCollapse = useCanvasStore((s) => s.exitSmartCollapse)
  const isActive = useFocusStore((s) => s.isActive)

  const n = tiles.size
  const buttons = useMemo(() => presetButtonsForCount(n), [n])
  const sorted = useMemo(
    () => sortTilesForLayout(Array.from(tiles.values())),
    [tiles]
  )

  const apply = useCallback(
    (preset: PresetId) => {
      if (smartCollapsePicking) cancelSmartCollapsePicker()
      if (smartCollapse) exitSmartCollapse()
      const area = getViewportLayoutRect(pan, zoom)
      if (!area) return
      captureLayoutPresetUndoSnapshot()
      const layout = computePresetLayout(preset, sorted, area)
      if (layout.length > 0) applyTilesLayout(layout)
    },
    [
      smartCollapsePicking,
      cancelSmartCollapsePicker,
      smartCollapse,
      exitSmartCollapse,
      pan,
      zoom,
      sorted,
      applyTilesLayout,
      captureLayoutPresetUndoSnapshot,
    ]
  )

  if (n === 0 || buttons.length === 0) return null

  const smartCollapseLabel = smartCollapsePicking
    ? 'Cancel'
    : smartCollapse
      ? 'Exit layout'
      : 'Smart Collapse'
  const smartCollapseTitle = smartCollapsePicking
    ? 'Cancel choosing main window'
    : smartCollapse
      ? 'Leave Smart Collapse layout'
      : 'Pick a main window; other tiles collapse to title bars (click a bar to expand)'

  return (
    <div
      className="flex w-full max-w-[17rem] flex-nowrap gap-0.5 overflow-x-auto rounded-md border border-tile-border/30 bg-canvas-bg/60 px-1 py-1 [scrollbar-width:thin] backdrop-blur-sm"
      data-testid="layout-preset-bar"
      data-focus-mode={isActive ? 'true' : 'false'}
    >
      {layoutPresetUndo && (
        <button
          type="button"
          data-tooltip="Restore tile positions and view from before the last layout preset"
          onClick={() => restoreLayoutPresetUndo()}
          className="shrink-0 rounded border border-amber-500/50 bg-canvas-bg/80 px-1.5 py-0.5 text-[9px] font-medium text-amber-200/95 transition-colors hover:border-amber-400/70 hover:bg-tile-bg hover:text-white"
        >
          Restore layout
        </button>
      )}
      {n >= 2 && (
        <button
          type="button"
          data-tooltip={smartCollapseTitle}
          onClick={() => {
            if (smartCollapsePicking) cancelSmartCollapsePicker()
            else if (smartCollapse) exitSmartCollapse()
            else startSmartCollapsePicker()
          }}
          className="shrink-0 rounded border border-accent-teal/35 bg-canvas-bg/80 px-1.5 py-0.5 text-[9px] font-medium text-accent-teal/95 transition-colors hover:border-accent-teal/60 hover:bg-tile-bg hover:text-white"
        >
          {smartCollapseLabel}
        </button>
      )}
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          data-tooltip={b.title}
          onClick={() => apply(b.id)}
          className="shrink-0 rounded border border-tile-border/50 bg-canvas-bg/80 px-1.5 py-0.5 text-[9px] font-medium text-gray-400 transition-colors hover:border-accent-teal/40 hover:bg-tile-bg hover:text-white"
        >
          {b.label}
        </button>
      ))}
    </div>
  )
}

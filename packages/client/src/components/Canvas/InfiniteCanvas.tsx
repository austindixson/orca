import { useCallback, useRef, useEffect, useState, useMemo } from 'react'
import { useCanvasStore, TileType } from '../../store/canvasStore'
import { useFocusStore } from '../../store/focusStore'
import { usePanZoom } from '../../hooks/usePanZoom'
import { attachCanvasTouchPanZoom } from '../../hooks/canvasTouchPanZoom'
import { getViewportLayoutRect } from '../../lib/layoutPresets'
import {
  SMART_COLLAPSE_GAP,
  SMART_COLLAPSE_MARGIN,
} from '../../lib/smartCollapseLayout'
import { CanvasContextMenu } from './CanvasContextMenu'
import { CANVAS_GRID_STEP } from '../../lib/snapTiles'
import { CANVAS_THEMES, useSettingsStore } from '../../store/settingsStore'
import { Tile } from './Tile'
import { CanvasWorldTransform } from './CanvasWorldTransform'
import { CanvasHintsOverlay } from './CanvasHintsOverlay'
import { CanvasAmbientParticles } from './CanvasAmbientParticles'
import { OrchestratorHubLinks } from './OrchestratorHubLinks'
import { ForceGraphCanvas } from './ForceGraphCanvas'
import { PlanChatSplitView } from './PlanChatSplitView'
import { HermesLeadCanvasView } from './HermesLeadCanvasView'
import { metaForTileSpawnFromAddMenu } from '../../lib/tileMenuCatalog'

/** Dot spacing in canvas/world units (matches snap grid step). */
const CANVAS_DOT_STEP = CANVAS_GRID_STEP

/** Isolated pan/zoom subscription so Smart Collapse layout refresh does not re-render all tiles. */
function SmartCollapsePanEffect() {
  const pan = useCanvasStore((s) => s.pan)
  const zoom = useCanvasStore((s) => s.zoom)
  const smartCollapse = useCanvasStore((s) => s.smartCollapse)
  useEffect(() => {
    if (!smartCollapse) return
    const id = window.setTimeout(() => {
      useCanvasStore.getState().refreshSmartCollapseLayout()
    }, 120)
    return () => clearTimeout(id)
  }, [pan.x, pan.y, zoom, smartCollapse?.mainId, smartCollapse?.expandedSideId])
  return null
}

/** Grid background only — subscribes to pan/zoom without touching the tile tree. */
function CanvasDotBackground({ theme }: { theme: (typeof CANVAS_THEMES)[keyof typeof CANVAS_THEMES] }) {
  const pan = useCanvasStore((s) => s.pan)
  const zoom = useCanvasStore((s) => s.zoom)
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        backgroundColor: theme.canvasBg,
        backgroundImage: `radial-gradient(circle at center, rgba(${theme.dotRgba}) 1px, transparent 1px)`,
        backgroundSize: `${CANVAS_DOT_STEP * zoom}px ${CANVAS_DOT_STEP * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        backgroundRepeat: 'repeat',
      }}
    />
  )
}

export function InfiniteCanvas() {
  const tiles = useCanvasStore((s) => s.tiles)
  const canvasViewMode = useCanvasStore((s) => s.canvasViewMode)
  const addTile = useCanvasStore((s) => s.addTile)
  const snapOverlay = useCanvasStore((s) => s.snapOverlay)
  const smartCollapse = useCanvasStore((s) => s.smartCollapse)
  const setSmartCollapseMainRatio = useCanvasStore((s) => s.setSmartCollapseMainRatio)
  const canvasTheme = useSettingsStore((s) => s.canvasTheme)
  const ambientParticlesEnabled = useSettingsStore((s) => s.ambientParticlesEnabled)
  const theme = CANVAS_THEMES[canvasTheme]

  const selectionBox = useFocusStore((s) => s.selectionBox)
  const isSelecting = useFocusStore((s) => s.isSelecting)
  const isFocusActive = useFocusStore((s) => s.isActive)
  const isDeleteSelectionMode = useFocusStore((s) => s.isDeleteSelectionMode)
  const startSelection = useFocusStore((s) => s.startSelection)
  const updateSelection = useFocusStore((s) => s.updateSelection)
  const endSelection = useFocusStore((s) => s.endSelection)
  const enterFocus = useFocusStore((s) => s.enterFocus)
  const addTilesToDeletionSelection = useFocusStore((s) => s.addTilesToDeletionSelection)
  
  const { handlers } = usePanZoom()
  const wheelHandlerRef = useRef(handlers.onWheel)
  wheelHandlerRef.current = handlers.onWheel

  const canvasRef = useRef<HTMLDivElement>(null)
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)

  const handleSmartCollapseDividerDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startClientX = e.clientX
      const startRatio = useCanvasStore.getState().smartCollapseMainRatio

      const onMove = (ev: MouseEvent) => {
        const { pan, zoom } = useCanvasStore.getState()
        const area = getViewportLayoutRect(pan, zoom)
        if (!area) return
        const innerW = area.w - 2 * SMART_COLLAPSE_MARGIN
        if (innerW < 120) return
        const worldDx = (ev.clientX - startClientX) / zoom
        setSmartCollapseMainRatio(startRatio + worldDx / innerW)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setSmartCollapseMainRatio]
  )
  
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null)

  const tilesArray = useMemo(
    () =>
      Array.from(tiles.values()).filter((tile) => {
        const meta = tile.meta as Record<string, unknown> | undefined
        return meta?.suppressCanvasRender !== true
      }),
    [tiles]
  )

  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const { pan, zoom } = useCanvasStore.getState()
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    }
  }, [])

  const finishSelection = useCallback((_clientX: number, _clientY: number) => {
    const currentSelectionBox = useFocusStore.getState().selectionBox
    if (!currentSelectionBox || !selectionStartRef.current) return
    
    const currentTiles = Array.from(useCanvasStore.getState().tiles.values()).filter((tile) => {
      const meta = tile.meta as Record<string, unknown> | undefined
      return meta?.suppressCanvasRender !== true
    })
    const selectedTileIds: string[] = []
    
    const boxLeft = Math.min(currentSelectionBox.x, currentSelectionBox.x + currentSelectionBox.width)
    const boxRight = Math.max(currentSelectionBox.x, currentSelectionBox.x + currentSelectionBox.width)
    const boxTop = Math.min(currentSelectionBox.y, currentSelectionBox.y + currentSelectionBox.height)
    const boxBottom = Math.max(currentSelectionBox.y, currentSelectionBox.y + currentSelectionBox.height)
    
    currentTiles.forEach((tile) => {
      const tileLeft = tile.x
      const tileRight = tile.x + tile.w
      const tileTop = tile.y
      const tileBottom = tile.y + tile.h
      
      const intersects = !(
        tileLeft > boxRight ||
        tileRight < boxLeft ||
        tileTop > boxBottom ||
        tileBottom < boxTop
      )
      
      if (intersects) {
        selectedTileIds.push(tile.id)
      }
    })
    
    endSelection()
    selectionStartRef.current = null

    if (useFocusStore.getState().isDeleteSelectionMode) {
      if (selectedTileIds.length > 0) {
        addTilesToDeletionSelection(selectedTileIds)
      }
      return
    }

    if (selectedTileIds.length > 0) {
      enterFocus(selectedTileIds)
    }
  }, [addTilesToDeletionSelection, endSelection, enterFocus])

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (useFocusStore.getState().isSelecting && selectionStartRef.current) {
        const pos = screenToCanvas(e.clientX, e.clientY)
        updateSelection(pos.x, pos.y)
        e.preventDefault()
      }
    }

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (useFocusStore.getState().isSelecting && selectionStartRef.current) {
        finishSelection(e.clientX, e.clientY)
        e.preventDefault()
      }
    }

    window.addEventListener('mousemove', handleGlobalMouseMove)
    window.addEventListener('mouseup', handleGlobalMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove)
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [screenToCanvas, updateSelection, finishSelection])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (canvasViewMode === 'graph' || canvasViewMode === 'plan' || canvasViewMode === 'helix') return
      const startMarquee =
        (e.shiftKey && !isFocusActive) || (isDeleteSelectionMode && e.target === e.currentTarget)
      if (startMarquee) {
        const pos = screenToCanvas(e.clientX, e.clientY)
        selectionStartRef.current = pos
        startSelection(pos.x, pos.y)
        e.preventDefault()
        e.stopPropagation()
        return
      }

      if (e.target !== e.currentTarget) return
      handlers.onMouseDown(e)
    },
    [canvasViewMode, handlers, isDeleteSelectionMode, isFocusActive, screenToCanvas, startSelection]
  )

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (canvasViewMode === 'graph' || canvasViewMode === 'plan' || canvasViewMode === 'helix') return
    if (isSelecting && selectionStartRef.current) {
      return
    }
    handlers.onMouseMove(e)
  }, [canvasViewMode, handlers, isSelecting])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (canvasViewMode === 'graph' || canvasViewMode === 'plan' || canvasViewMode === 'helix') return
    if (isSelecting) {
      return
    }
    handlers.onMouseUp(e)
  }, [canvasViewMode, handlers, isSelecting])

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    if (canvasViewMode === 'graph' || canvasViewMode === 'plan' || canvasViewMode === 'helix') return
    handlers.onMouseLeave(e)
  }, [canvasViewMode, handlers])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (canvasViewMode === 'graph' || canvasViewMode === 'plan' || canvasViewMode === 'helix') return
    e.preventDefault()
    e.stopPropagation()
    const canvasPos = screenToCanvas(e.clientX, e.clientY)
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      canvasX: canvasPos.x,
      canvasY: canvasPos.y,
    })
  }, [canvasViewMode, screenToCanvas])

  const handleAddTileFromMenu = useCallback((type: TileType) => {
    if (contextMenu) {
      const meta = metaForTileSpawnFromAddMenu(type)
      addTile(type, { x: contextMenu.canvasX, y: contextMenu.canvasY }, meta ? { meta } : undefined)
    }
    setContextMenu(null)
  }, [addTile, contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-context-menu]')) {
        setContextMenu(null)
      }
    }
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null)
      }
    }
    
    const timeoutId = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside)
      window.addEventListener('keydown', handleKeyDown)
    }, 0)
    
    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (useCanvasStore.getState().smartCollapsePicking) {
        e.preventDefault()
        useCanvasStore.getState().cancelSmartCollapsePicker()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  /**
   * React's onWheel is passive in many browsers, so preventDefault() does not stop the
   * webview/window from scrolling — canvas pans AND the view moves. Non-passive listener fixes it.
   */
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const m = useCanvasStore.getState().canvasViewMode
      if (m === 'graph' || m === 'plan') return
      wheelHandlerRef.current(e)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    return attachCanvasTouchPanZoom(el, {
      getIsGraph: () => {
        const m = useCanvasStore.getState().canvasViewMode
        return m === 'graph' || m === 'plan'
      },
    })
  }, [])

  const normalizedSelectionBox = selectionBox ? {
    x: Math.min(selectionBox.x, selectionBox.x + selectionBox.width),
    y: Math.min(selectionBox.y, selectionBox.y + selectionBox.height),
    width: Math.abs(selectionBox.width),
    height: Math.abs(selectionBox.height),
  } : null

  return (
    <div
      ref={canvasRef}
      data-testid="infinite-canvas"
      className="relative h-full w-full cursor-grab touch-none select-none overflow-hidden overscroll-none"
      style={{
        cursor: isSelecting ? 'crosshair' : undefined,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
    >
      <CanvasDotBackground theme={theme} />
      <SmartCollapsePanEffect />
      {/* Brand mark: centered in viewport, inverted for dark canvas, subtle */}
      <div
        className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden"
        aria-hidden
      >
        <img
          src="/logo.png"
          alt=""
          className="max-h-[min(21vh,210px)] max-w-[min(21vw,210px)] w-auto select-none object-contain"
          style={{ opacity: 0.02, filter: 'invert(1)' }}
          draggable={false}
        />
      </div>
      {/* NASA-inspired sparse nodes + faint links (particles.js–style); screen-space, minimal CPU */}
      {ambientParticlesEnabled && <CanvasAmbientParticles />}
      {/* Hints live outside pan/zoom so labels stay crisp (not scaled with the canvas). */}
      <CanvasHintsOverlay />

      {canvasViewMode === 'graph' ? (
        <ForceGraphCanvas />
      ) : canvasViewMode === 'plan' ? (
        <PlanChatSplitView />
      ) : canvasViewMode === 'helix' ? (
        <HermesLeadCanvasView />
      ) : (
        <CanvasWorldTransform>
          <OrchestratorHubLinks />
          {tilesArray.map((tile) => (
            <Tile key={tile.id} data={tile} />
          ))}

        {smartCollapse &&
          (() => {
            const main = tiles.get(smartCollapse.mainId)
            if (!main) return null
            return (
              <div
                key="smart-collapse-divider"
                className="absolute z-[12000] cursor-col-resize group"
                style={{
                  left: main.x + main.w - SMART_COLLAPSE_GAP / 2,
                  top: main.y,
                  width: SMART_COLLAPSE_GAP,
                  height: main.h,
                }}
                onMouseDown={handleSmartCollapseDividerDown}
              >
                <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-transparent group-hover:bg-accent-teal/55 transition-colors rounded-full" />
              </div>
            )
          })()}

        {/* Option-drag snap preview: target tiles + guides + dashed drop outline */}
        {snapOverlay && (
          <>
            {snapOverlay.targetTileIds.map((id) => {
              const t = tiles.get(id)
              if (!t) return null
              return (
                <div
                  key={id}
                  className="pointer-events-none absolute z-[10000] rounded-lg border-2 border-accent-teal/80 bg-accent-teal/[0.12] shadow-[inset_0_0_0_1px_rgba(45,212,191,0.35)]"
                  style={{
                    left: t.x,
                    top: t.y,
                    width: t.w,
                    height: t.h,
                  }}
                />
              )
            })}
            {snapOverlay.guides.verticalX != null && (
              <div
                className="pointer-events-none absolute z-[10000] w-px bg-accent-teal/90 shadow-[0_0_8px_rgba(45,212,191,0.55)]"
                style={{
                  left: snapOverlay.guides.verticalX,
                  top: -500000,
                  height: 1000000,
                }}
              />
            )}
            {snapOverlay.guides.horizontalY != null && (
              <div
                className="pointer-events-none absolute z-[10000] h-px bg-accent-teal/90 shadow-[0_0_8px_rgba(45,212,191,0.55)]"
                style={{
                  left: -500000,
                  top: snapOverlay.guides.horizontalY,
                  width: 1000000,
                }}
              />
            )}
            <div
              className="pointer-events-none absolute z-[10001] rounded-lg border-2 border-dashed border-white/85 bg-accent-teal/[0.08] shadow-[0_0_12px_rgba(45,212,191,0.35)]"
              style={{
                left: snapOverlay.previewRect.x,
                top: snapOverlay.previewRect.y,
                width: snapOverlay.previewRect.w,
                height: snapOverlay.previewRect.h,
              }}
            />
          </>
        )}
        
        {/* Selection Box */}
        {isSelecting && normalizedSelectionBox && (normalizedSelectionBox.width > 2 || normalizedSelectionBox.height > 2) && (
          <div
            className={`absolute rounded-lg pointer-events-none z-[9999] border-2 ${
              isDeleteSelectionMode
                ? 'border-red-400/80 bg-red-500/10'
                : 'border-accent-teal bg-accent-teal/10'
            }`}
            style={{
              left: normalizedSelectionBox.x,
              top: normalizedSelectionBox.y,
              width: normalizedSelectionBox.width,
              height: normalizedSelectionBox.height,
            }}
          />
        )}
        </CanvasWorldTransform>
      )}

      {canvasViewMode === 'tiles' && contextMenu && (
        <CanvasContextMenu
          anchor={contextMenu}
          onClose={() => setContextMenu(null)}
          onAddTile={(type) => handleAddTileFromMenu(type)}
        />
      )}
    </div>
  )
}

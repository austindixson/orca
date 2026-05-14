import { useCallback, useRef, useState, useEffect } from 'react'
import { useCanvasStore, TileData } from '../../store/canvasStore'
import { useFocusStore } from '../../store/focusStore'

interface LayoutCell {
  id: string
  x: number
  y: number
  w: number
  h: number
}

interface DragSwapState {
  draggedId: string
  startX: number
  startY: number
  currentX: number
  currentY: number
  hoveredId: string | null
}

export function FocusLayout() {
  const tiles = useCanvasStore((s) => s.tiles)
  const updateTile = useCanvasStore((s) => s.updateTile)
  const { focusedTileIds, isActive } = useFocusStore()
  
  const [dragging, setDragging] = useState<{
    type: 'vertical' | 'horizontal'
    index: number
    startX: number
    startY: number
    startPositions: LayoutCell[]
  } | null>(null)
  
  const [dragSwap, setDragSwap] = useState<DragSwapState | null>(null)
  
  const containerRef = useRef<HTMLDivElement>(null)

  const focusedTiles = focusedTileIds
    .map(id => tiles.get(id))
    .filter((t): t is TileData => t !== undefined)

  const count = focusedTiles.length

  const getLayoutInfo = useCallback(() => {
    const padding = 8
    const headerHeight = 48
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const availableWidth = viewportWidth - padding * 2
    const availableHeight = viewportHeight - headerHeight - padding

    if (count === 2) {
      return { type: 'two-col' as const, padding, headerHeight, availableWidth, availableHeight }
    } else if (count === 3) {
      return { type: 'one-two' as const, padding, headerHeight, availableWidth, availableHeight }
    } else if (count === 4) {
      return { type: 'grid-2x2' as const, padding, headerHeight, availableWidth, availableHeight }
    }
    return { type: 'other' as const, padding, headerHeight, availableWidth, availableHeight }
  }, [count])

  const handleDividerMouseDown = useCallback((
    e: React.MouseEvent,
    type: 'vertical' | 'horizontal',
    index: number
  ) => {
    e.preventDefault()
    e.stopPropagation()
    
    const currentPositions = focusedTiles.map(t => ({
      id: t.id,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
    }))
    
    setDragging({
      type,
      index,
      startX: e.clientX,
      startY: e.clientY,
      startPositions: currentPositions,
    })
  }, [focusedTiles])

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragging.startX
      const deltaY = e.clientY - dragging.startY
      const layout = getLayoutInfo()
      const gap = 4

      if (layout.type === 'two-col' && dragging.type === 'vertical') {
        const [left, right] = dragging.startPositions
        const minWidth = 200
        
        let newLeftWidth = left.w + deltaX
        let newRightWidth = right.w - deltaX
        
        if (newLeftWidth < minWidth) {
          newLeftWidth = minWidth
          newRightWidth = layout.availableWidth - gap - minWidth
        }
        if (newRightWidth < minWidth) {
          newRightWidth = minWidth
          newLeftWidth = layout.availableWidth - gap - minWidth
        }
        
        updateTile(left.id, { w: newLeftWidth })
        updateTile(right.id, { x: layout.padding + newLeftWidth + gap, w: newRightWidth })
      }
      
      else if (layout.type === 'one-two') {
        if (dragging.type === 'vertical' && dragging.index === 0) {
          const [left, top, bottom] = dragging.startPositions
          const minWidth = 200
          
          let newLeftWidth = left.w + deltaX
          let newRightWidth = top.w - deltaX
          
          if (newLeftWidth < minWidth) {
            newLeftWidth = minWidth
            newRightWidth = layout.availableWidth - gap - minWidth
          }
          if (newRightWidth < minWidth) {
            newRightWidth = minWidth
            newLeftWidth = layout.availableWidth - gap - minWidth
          }
          
          const newRightX = layout.padding + newLeftWidth + gap
          
          updateTile(left.id, { w: newLeftWidth })
          updateTile(top.id, { x: newRightX, w: newRightWidth })
          updateTile(bottom.id, { x: newRightX, w: newRightWidth })
        }
        else if (dragging.type === 'horizontal' && dragging.index === 0) {
          const [, top, bottom] = dragging.startPositions
          const minHeight = 100
          
          let newTopHeight = top.h + deltaY
          let newBottomHeight = bottom.h - deltaY
          
          if (newTopHeight < minHeight) {
            newTopHeight = minHeight
            newBottomHeight = layout.availableHeight - gap - minHeight
          }
          if (newBottomHeight < minHeight) {
            newBottomHeight = minHeight
            newTopHeight = layout.availableHeight - gap - minHeight
          }
          
          const newBottomY = layout.headerHeight + newTopHeight + gap
          
          updateTile(top.id, { h: newTopHeight })
          updateTile(bottom.id, { y: newBottomY, h: newBottomHeight })
        }
      }
      
      else if (layout.type === 'grid-2x2') {
        const [tl, tr, bl, br] = dragging.startPositions
        const minSize = 150
        
        if (dragging.type === 'vertical') {
          let newLeftWidth = tl.w + deltaX
          let newRightWidth = tr.w - deltaX
          
          if (newLeftWidth < minSize) {
            newLeftWidth = minSize
            newRightWidth = layout.availableWidth - gap - minSize
          }
          if (newRightWidth < minSize) {
            newRightWidth = minSize
            newLeftWidth = layout.availableWidth - gap - minSize
          }
          
          const newRightX = layout.padding + newLeftWidth + gap
          
          updateTile(tl.id, { w: newLeftWidth })
          updateTile(tr.id, { x: newRightX, w: newRightWidth })
          updateTile(bl.id, { w: newLeftWidth })
          updateTile(br.id, { x: newRightX, w: newRightWidth })
        }
        else if (dragging.type === 'horizontal') {
          let newTopHeight = tl.h + deltaY
          let newBottomHeight = bl.h - deltaY
          
          if (newTopHeight < minSize) {
            newTopHeight = minSize
            newBottomHeight = layout.availableHeight - gap - minSize
          }
          if (newBottomHeight < minSize) {
            newBottomHeight = minSize
            newTopHeight = layout.availableHeight - gap - minSize
          }
          
          const newBottomY = layout.headerHeight + newTopHeight + gap
          
          updateTile(tl.id, { h: newTopHeight })
          updateTile(tr.id, { h: newTopHeight })
          updateTile(bl.id, { y: newBottomY, h: newBottomHeight })
          updateTile(br.id, { y: newBottomY, h: newBottomHeight })
        }
      }
    }

    const handleMouseUp = () => {
      setDragging(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, getLayoutInfo, updateTile])

  const handleTileDragStart = useCallback((e: React.MouseEvent, tileId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragSwap({
      draggedId: tileId,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      hoveredId: null,
    })
  }, [])

  useEffect(() => {
    if (!dragSwap) return

    const handleMouseMove = (e: MouseEvent) => {
      const hoveredTile = focusedTiles.find(tile => {
        if (tile.id === dragSwap.draggedId) return false
        return (
          e.clientX >= tile.x &&
          e.clientX <= tile.x + tile.w &&
          e.clientY >= tile.y &&
          e.clientY <= tile.y + tile.h
        )
      })

      setDragSwap(prev => prev ? {
        ...prev,
        currentX: e.clientX,
        currentY: e.clientY,
        hoveredId: hoveredTile?.id ?? null,
      } : null)
    }

    const handleMouseUp = () => {
      if (dragSwap.hoveredId) {
        const draggedTile = tiles.get(dragSwap.draggedId)
        const targetTile = tiles.get(dragSwap.hoveredId)
        
        if (draggedTile && targetTile) {
          updateTile(dragSwap.draggedId, {
            x: targetTile.x,
            y: targetTile.y,
            w: targetTile.w,
            h: targetTile.h,
          })
          updateTile(dragSwap.hoveredId, {
            x: draggedTile.x,
            y: draggedTile.y,
            w: draggedTile.w,
            h: draggedTile.h,
          })
        }
      }
      setDragSwap(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragSwap, focusedTiles, tiles, updateTile])

  if (!isActive || count < 2) return null

  const layout = getLayoutInfo()

  const renderDividers = () => {
    const dividers: React.ReactNode[] = []

    const divHit = 12

    if (layout.type === 'two-col') {
      const leftTile = focusedTiles[0]
      if (leftTile) {
        dividers.push(
          <div
            key="v-divider"
            className="absolute cursor-col-resize z-[16000] group pointer-events-auto"
            style={{
              left: leftTile.x + leftTile.w - divHit / 2,
              top: layout.headerHeight,
              width: divHit,
              height: layout.availableHeight,
            }}
            onMouseDown={(e) => handleDividerMouseDown(e, 'vertical', 0)}
          >
            <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-transparent group-hover:bg-accent-teal/50 transition-colors rounded-full" />
          </div>
        )
      }
    }

    else if (layout.type === 'one-two') {
      const leftTile = focusedTiles[0]
      const topRight = focusedTiles[1]
      
      if (leftTile) {
        dividers.push(
          <div
            key="v-divider"
            className="absolute cursor-col-resize z-[16000] group pointer-events-auto"
            style={{
              left: leftTile.x + leftTile.w - divHit / 2,
              top: layout.headerHeight,
              width: divHit,
              height: layout.availableHeight,
            }}
            onMouseDown={(e) => handleDividerMouseDown(e, 'vertical', 0)}
          >
            <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-transparent group-hover:bg-accent-teal/50 transition-colors rounded-full" />
          </div>
        )
      }
      
      if (topRight) {
        dividers.push(
          <div
            key="h-divider"
            className="absolute cursor-row-resize z-[16000] group pointer-events-auto"
            style={{
              left: topRight.x,
              top: topRight.y + topRight.h - divHit / 2,
              width: topRight.w,
              height: divHit,
            }}
            onMouseDown={(e) => handleDividerMouseDown(e, 'horizontal', 0)}
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-transparent group-hover:bg-accent-teal/50 transition-colors rounded-full" />
          </div>
        )
      }
    }

    else if (layout.type === 'grid-2x2') {
      const tl = focusedTiles[0]
      
      if (tl) {
        dividers.push(
          <div
            key="v-divider"
            className="absolute cursor-col-resize z-[16000] group pointer-events-auto"
            style={{
              left: tl.x + tl.w - divHit / 2,
              top: layout.headerHeight,
              width: divHit,
              height: layout.availableHeight,
            }}
            onMouseDown={(e) => handleDividerMouseDown(e, 'vertical', 0)}
          >
            <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-transparent group-hover:bg-accent-teal/50 transition-colors rounded-full" />
          </div>
        )
        
        dividers.push(
          <div
            key="h-divider"
            className="absolute cursor-row-resize z-[16000] group pointer-events-auto"
            style={{
              left: layout.padding,
              top: tl.y + tl.h - divHit / 2,
              width: layout.availableWidth,
              height: divHit,
            }}
            onMouseDown={(e) => handleDividerMouseDown(e, 'horizontal', 0)}
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-transparent group-hover:bg-accent-teal/50 transition-colors rounded-full" />
          </div>
        )
      }
    }

    return dividers
  }

  const renderDragHandles = () => {
    return focusedTiles.map(tile => (
      <div
        key={`drag-${tile.id}`}
        className={`absolute cursor-grab active:cursor-grabbing transition-all ${
          dragSwap?.hoveredId === tile.id 
            ? 'ring-2 ring-accent-teal ring-inset bg-accent-teal/10' 
            : ''
        } ${
          dragSwap?.draggedId === tile.id
            ? 'opacity-50'
            : ''
        }`}
        style={{
          left: tile.x,
          top: tile.y,
          width: tile.w,
          height: 32,
          zIndex: 15500,
        }}
        onMouseDown={(e) => handleTileDragStart(e, tile.id)}
        data-tooltip="Drag to swap with another tile"
      />
    ))
  }

  const renderSwapPreview = () => {
    if (!dragSwap) return null
    
    const draggedTile = tiles.get(dragSwap.draggedId)
    if (!draggedTile) return null

    const deltaX = dragSwap.currentX - dragSwap.startX
    const deltaY = dragSwap.currentY - dragSwap.startY
    const isDragging = Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5

    if (!isDragging) return null

    return (
      <div
        className="fixed pointer-events-none z-[100] bg-tile-bg/80 border-2 border-accent-teal rounded-lg shadow-xl flex items-center justify-center"
        style={{
          left: dragSwap.currentX - 60,
          top: dragSwap.currentY - 20,
          width: 120,
          height: 40,
        }}
      >
        <span className="text-sm text-white font-medium">{draggedTile.title}</span>
      </div>
    )
  }

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 z-[15000] pointer-events-none"
      style={{ 
        cursor: dragging 
          ? (dragging.type === 'vertical' ? 'col-resize' : 'row-resize') 
          : dragSwap 
            ? 'grabbing' 
            : undefined 
      }}
    >
      <div className="pointer-events-auto">
        {renderDividers()}
        {renderDragHandles()}
      </div>
      {renderSwapPreview()}
    </div>
  )
}

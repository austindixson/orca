import { useCallback, useRef } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useFocusStore } from '../store/focusStore'

const MIN_WIDTH = 200
const MIN_HEIGHT = 150

export function useResize(tileId: string) {
  const zoom = useCanvasStore((s) => s.zoom)
  const updateTile = useCanvasStore((s) => s.updateTile)
  const bringToFront = useCanvasStore((s) => s.bringToFront)
  const isResizing = useRef(false)
  const startPos = useRef({ x: 0, y: 0 })
  const startSize = useRef({ w: 0, h: 0 })

  const handleResizeStart = useCallback((e: React.MouseEvent, currentW: number, currentH: number) => {
    e.preventDefault()
    e.stopPropagation()
    isResizing.current = true
    startPos.current = { x: e.clientX, y: e.clientY }
    startSize.current = { w: currentW, h: currentH }
    bringToFront(tileId)

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      
      const dx = (e.clientX - startPos.current.x) / zoom
      const dy = (e.clientY - startPos.current.y) / zoom
      
      updateTile(tileId, {
        w: Math.max(MIN_WIDTH, startSize.current.w + dx),
        h: Math.max(MIN_HEIGHT, startSize.current.h + dy),
      })
    }

    const handleMouseUp = () => {
      isResizing.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (!useFocusStore.getState().isActive) {
        useCanvasStore.getState().resolveOverlapsForTile(tileId, {
          frozenIds: new Set([tileId]),
        })
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [tileId, zoom, updateTile, bringToFront])

  return { handleResizeStart }
}

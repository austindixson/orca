import { useCallback, useRef } from 'react'
import { useCanvasStore, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX } from '../store/canvasStore'

export function usePanZoom() {
  /** Do not subscribe to pan/zoom here — callers only need handlers; pan-driven re-renders would remount every tile. */
  const setPan = useCanvasStore((s) => s.setPan)
  const setZoom = useCanvasStore((s) => s.setZoom)
  const activeInteractionTileId = useCanvasStore((s) => s.activeInteractionTileId)
  const setActiveInteractionTile = useCanvasStore((s) => s.setActiveInteractionTile)
  const isPanning = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return
    setActiveInteractionTile(null)
    isPanning.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as HTMLElement).style.cursor = 'grabbing'
  }, [setActiveInteractionTile])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return

    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }

    const cur = useCanvasStore.getState().pan
    setPan({ x: cur.x + dx, y: cur.y + dy })
  }, [setPan])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    isPanning.current = false
    ;(e.currentTarget as HTMLElement).style.cursor = 'grab'
  }, [])

  /** DOM WheelEvent — use with a non-passive listener so preventDefault stops page/webview scroll. */
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const st = useCanvasStore.getState()
      const panNow = st.pan
      const zoomNow = st.zoom

      // Branch 1: explicit gesture zoom only (trackpad pinch / cmd|ctrl + wheel)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const el = e.currentTarget
        if (!(el instanceof HTMLElement)) return
        const rect = el.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top
        const delta = e.deltaY > 0 ? 0.9 : 1.1
        const newZoom = Math.max(CANVAS_ZOOM_MIN, Math.min(CANVAS_ZOOM_MAX, zoomNow * delta))
        const scale = newZoom / zoomNow
        const newPanX = mouseX - (mouseX - panNow.x) * scale
        const newPanY = mouseY - (mouseY - panNow.y) * scale
        setZoom(newZoom)
        setPan({ x: newPanX, y: newPanY })
        return
      }

      // Branch 2: wheel over a module that has been clicked (armed) — never pan the canvas.
      const target = e.target as HTMLElement | null
      if (target && target !== e.currentTarget) {
        const tileEl = target.closest<HTMLElement>('[data-tile-id]')
        const tileId = tileEl?.dataset.tileId ?? null
        if (tileId == null || tileId !== activeInteractionTileId) {
          e.preventDefault()
          const p = useCanvasStore.getState().pan
          setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY })
          return
        }
        return
      }

      e.preventDefault()
      const p = useCanvasStore.getState().pan
      setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY })
    },
    [setZoom, setPan, activeInteractionTileId]
  )

  return {
    handlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onWheel: handleWheel,
    },
  }
}

import { useCanvasStore, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX } from '../store/canvasStore'

function touchPointOnTile(clientX: number, clientY: number): boolean {
  const hit = document.elementFromPoint(clientX, clientY)
  return Boolean(hit?.closest?.('[data-tile-id]'))
}

function localPoint(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect()
  return { x: clientX - r.left, y: clientY - r.top }
}

/**
 * Non-passive touch listeners for the infinite canvas: one-finger pan on empty canvas,
 * two-finger pinch zoom (same anchor math as wheel pinch). Touches that start on a tile
 * are left to the tile (browser iframe, editors, etc.).
 */
export function attachCanvasTouchPanZoom(
  el: HTMLElement,
  opts: { getIsGraph: () => boolean }
): () => void {
  let touchPanLast: { x: number; y: number } | null = null
  let pinch: { lastDist: number; lastMid: { x: number; y: number } } | null = null

  const onTouchStart = (e: TouchEvent) => {
    if (opts.getIsGraph()) return
    if (e.touches.length === 1) {
      const t = e.touches[0]
      if (touchPointOnTile(t.clientX, t.clientY)) return
      useCanvasStore.getState().setActiveInteractionTile(null)
      const p = localPoint(el, t.clientX, t.clientY)
      touchPanLast = { x: p.x, y: p.y }
      pinch = null
    } else if (e.touches.length === 2) {
      const t0 = e.touches[0]
      const t1 = e.touches[1]
      if (
        touchPointOnTile(t0.clientX, t0.clientY) ||
        touchPointOnTile(t1.clientX, t1.clientY)
      ) {
        return
      }
      const p0 = localPoint(el, t0.clientX, t0.clientY)
      const p1 = localPoint(el, t1.clientX, t1.clientY)
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y)
      if (dist < 1e-3) return
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
      pinch = { lastDist: dist, lastMid: mid }
      touchPanLast = null
    }
  }

  const onTouchMove = (e: TouchEvent) => {
    if (opts.getIsGraph()) return
    if (e.touches.length === 1 && touchPanLast) {
      const t = e.touches[0]
      if (touchPointOnTile(t.clientX, t.clientY)) return
      e.preventDefault()
      const p = localPoint(el, t.clientX, t.clientY)
      const dx = p.x - touchPanLast.x
      const dy = p.y - touchPanLast.y
      touchPanLast = { x: p.x, y: p.y }
      const cur = useCanvasStore.getState().pan
      useCanvasStore.getState().setPan({ x: cur.x + dx, y: cur.y + dy })
      return
    }
    if (e.touches.length === 2 && pinch) {
      const t0 = e.touches[0]
      const t1 = e.touches[1]
      const p0 = localPoint(el, t0.clientX, t0.clientY)
      const p1 = localPoint(el, t1.clientX, t1.clientY)
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y)
      if (dist < 1e-3) return
      e.preventDefault()
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
      const st = useCanvasStore.getState()
      const zoomNow = st.zoom
      const pan = st.pan
      const zoomFactor = dist / pinch.lastDist
      const newZoom = Math.max(CANVAS_ZOOM_MIN, Math.min(CANVAS_ZOOM_MAX, zoomNow * zoomFactor))
      const scale = newZoom / zoomNow
      let newPanX = mid.x - (mid.x - pan.x) * scale
      let newPanY = mid.y - (mid.y - pan.y) * scale
      newPanX += mid.x - pinch.lastMid.x
      newPanY += mid.y - pinch.lastMid.y
      st.setZoom(newZoom)
      st.setPan({ x: newPanX, y: newPanY })
      pinch.lastDist = dist
      pinch.lastMid = mid
    }
  }

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      touchPanLast = null
      pinch = null
      return
    }
    if (e.touches.length === 1) {
      pinch = null
      const t = e.touches[0]
      if (!touchPointOnTile(t.clientX, t.clientY)) {
        const p = localPoint(el, t.clientX, t.clientY)
        touchPanLast = { x: p.x, y: p.y }
      } else {
        touchPanLast = null
      }
    }
  }

  el.addEventListener('touchstart', onTouchStart, { passive: true })
  el.addEventListener('touchmove', onTouchMove, { passive: false })
  el.addEventListener('touchend', onTouchEnd)
  el.addEventListener('touchcancel', onTouchEnd)

  return () => {
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('touchcancel', onTouchEnd)
  }
}

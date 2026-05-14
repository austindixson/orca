import { useEffect, useRef, type ReactNode } from 'react'
import { useCanvasStore } from '../../store/canvasStore'

/**
 * Applies pan/zoom via direct DOM updates + zustand subscribe so panning does not React-re-render
 * every tile (major smoothness + memory win on large workspaces).
 */
export function CanvasWorldTransform({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let lastKey = ''
    const apply = () => {
      const { pan, zoom } = useCanvasStore.getState()
      const key = `${pan.x},${pan.y},${zoom}`
      if (key === lastKey) return
      lastKey = key
      el.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
    }
    apply()
    return useCanvasStore.subscribe(apply)
  }, [])
  return (
    <div ref={ref} className="absolute z-[2] origin-top-left will-change-transform">
      {children}
    </div>
  )
}

import { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { useFocusStore } from '../../store/focusStore'

const TILE_COLORS: Record<string, string> = {
  terminal: '#00d4aa',
  editor: '#3b82f6',
  browser: '#a855f7',
  diff: '#ff6b35',
  todo: '#ec4899',
  agent: '#00d4aa',
  changelog: '#34d399',
  research: '#6366f1',
  reasoning: '#a78bfa',
}

/** Tiny minimap glyphs so preview tiles are recognizable by type. */
const TILE_TYPE_GLYPH: Record<string, string> = {
  terminal: '>_',
  editor: '[]',
  browser: 'WWW',
  github: 'GH',
  diff: '+-',
  todo: 'TD',
  agent: 'AI',
  agent_team: 'AT',
  changelog: 'CL',
  orchestrator: 'OR',
  benchmark: 'BM',
  remotion: 'RM',
  openrouter_usage: 'OR',
  toolbox: 'TB',
  research: 'RS',
  reasoning: 'TH',
  project_status: 'PS',
  telemetry: 'TM',
  hermes_bridge: 'HB',
  hermes_agent: 'HA',
  telegram_onboard: 'TG',
  native_gateway: 'NG',
  bug_bounty: 'BB',
}

const NAV_MAX_WIDTH = 200
const NAV_MAX_HEIGHT = 120
const NAV_PADDING = 8

export function CanvasNavigator() {
  // All hooks at the top, unconditionally
  const tiles = useCanvasStore((s) => s.tiles)
  const pan = useCanvasStore((s) => s.pan)
  const zoom = useCanvasStore((s) => s.zoom)
  const setPan = useCanvasStore((s) => s.setPan)
  const isActive = useFocusStore((s) => s.isActive)
  
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const tilesArray = useMemo(
    () =>
      Array.from(tiles.values()).filter((tile) => {
        const meta = tile.meta as Record<string, unknown> | undefined
        return meta?.suppressCanvasRender !== true
      }),
    [tiles]
  )

  const layout = useMemo(() => {
    if (tilesArray.length === 0) {
      return { 
        minX: 0, minY: 0, 
        navWidth: 100, navHeight: 60, 
        scale: 1,
        isEmpty: true 
      }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    
    tilesArray.forEach(tile => {
      minX = Math.min(minX, tile.x)
      minY = Math.min(minY, tile.y)
      maxX = Math.max(maxX, tile.x + tile.w)
      maxY = Math.max(maxY, tile.y + tile.h)
    })

    const contentPadding = 50
    minX -= contentPadding
    minY -= contentPadding
    maxX += contentPadding
    maxY += contentPadding

    const contentWidth = maxX - minX
    const contentHeight = maxY - minY
    const contentAspect = contentWidth / contentHeight

    let navWidth: number
    let navHeight: number
    
    if (contentAspect > NAV_MAX_WIDTH / NAV_MAX_HEIGHT) {
      navWidth = NAV_MAX_WIDTH
      navHeight = NAV_MAX_WIDTH / contentAspect
    } else {
      navHeight = NAV_MAX_HEIGHT
      navWidth = NAV_MAX_HEIGHT * contentAspect
    }

    navWidth = Math.max(60, navWidth)
    navHeight = Math.max(40, navHeight)

    const scale = navWidth / contentWidth

    return { minX, minY, navWidth, navHeight, scale, isEmpty: false }
  }, [tilesArray])

  const applyPanFromClient = useCallback(
    (clientX: number, clientY: number) => {
      if (layout.isEmpty) return
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      const viewportWidth = window.innerWidth / zoom
      const viewportHeight = window.innerHeight / zoom
      const mouseX = clientX - rect.left - NAV_PADDING
      const mouseY = clientY - rect.top - NAV_PADDING

      const canvasX = (mouseX / layout.scale) + layout.minX
      const canvasY = (mouseY / layout.scale) + layout.minY

      const newPanX = -(canvasX - viewportWidth / 2) * zoom
      const newPanY = -(canvasY - viewportHeight / 2) * zoom

      setPan({ x: newPanX, y: newPanY })
    },
    [layout, zoom, setPan]
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (layout.isEmpty) return
      e.preventDefault()
      setIsDragging(true)
      applyPanFromClient(e.clientX, e.clientY)
    },
    [layout.isEmpty, applyPanFromClient]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || layout.isEmpty) return
      applyPanFromClient(e.clientX, e.clientY)
    },
    [isDragging, layout.isEmpty, applyPanFromClient]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  /** Touch drag on minimap (non-passive move so the page doesn’t scroll). */
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    let dragging = false
    const onTouchStart = (e: TouchEvent) => {
      if (layout.isEmpty || e.touches.length !== 1) return
      dragging = true
      const t = e.touches[0]
      applyPanFromClient(t.clientX, t.clientY)
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging || layout.isEmpty || e.touches.length !== 1) return
      e.preventDefault()
      const t = e.touches[0]
      applyPanFromClient(t.clientX, t.clientY)
    }
    const onTouchEnd = () => {
      dragging = false
    }
    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    node.addEventListener('touchend', onTouchEnd)
    node.addEventListener('touchcancel', onTouchEnd)
    return () => {
      node.removeEventListener('touchstart', onTouchStart)
      node.removeEventListener('touchmove', onTouchMove)
      node.removeEventListener('touchend', onTouchEnd)
      node.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [applyPanFromClient])

  // Early return AFTER all hooks have been called
  if (layout.isEmpty || isActive) {
    return null
  }

  const { minX, minY, navWidth, navHeight, scale } = layout
  const viewportWidth = window.innerWidth / zoom
  const viewportHeight = window.innerHeight / zoom
  const viewportX = (-pan.x / zoom) - minX
  const viewportY = (-pan.y / zoom) - minY

  return (
    <div 
      ref={containerRef}
      data-testid="canvas-navigator"
      className="cursor-crosshair select-none overflow-hidden rounded-lg border border-tile-border/50 bg-canvas-bg/90 backdrop-blur-sm"
      style={{ 
        width: navWidth + NAV_PADDING * 2, 
        height: navHeight + NAV_PADDING * 2,
        padding: NAV_PADDING,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <div className="relative w-full h-full">
        {tilesArray.map(tile => (
          <div
            key={tile.id}
            className="absolute rounded-sm"
            style={{
              left: (tile.x - minX) * scale,
              top: (tile.y - minY) * scale,
              width: Math.max(tile.w * scale, 3),
              height: Math.max(tile.h * scale, 2),
              backgroundColor: TILE_COLORS[tile.type] || '#888',
              opacity: 0.85,
            }}
            data-tooltip={`${tile.title} (${tile.type})`}
          >
            {tile.w * scale >= 18 && tile.h * scale >= 11 ? (
              <span
                className="pointer-events-none absolute inset-0 flex items-center justify-center text-[7px] font-semibold tracking-tight text-white/85"
                aria-hidden
              >
                {TILE_TYPE_GLYPH[tile.type] ?? tile.type.slice(0, 2).toUpperCase()}
              </span>
            ) : null}
          </div>
        ))}
        <div
          className="absolute border border-white/60 bg-white/5 rounded-sm pointer-events-none"
          style={{
            left: viewportX * scale,
            top: viewportY * scale,
            width: viewportWidth * scale,
            height: viewportHeight * scale,
          }}
        />
      </div>
    </div>
  )
}

import { useCallback, useRef } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useFocusStore } from '../store/focusStore'
import { useSettingsStore } from '../store/settingsStore'
import {
  snapTileToOthers,
  snapThresholdCanvas,
  CANVAS_GRID_STEP,
} from '../lib/snapTiles'
import { clientToCanvasPoint, topTileIdAtCanvasPoint } from '../lib/canvasCoordinates'

/** Option (⌥) — snap while dragging tile title bars. */
function snapModifierDown(e: MouseEvent | React.MouseEvent): boolean {
  return e.altKey
}

export function useDrag(tileId: string) {
  const zoom = useCanvasStore((s) => s.zoom)
  const updateTile = useCanvasStore((s) => s.updateTile)
  const translateTilesByIds = useCanvasStore((s) => s.translateTilesByIds)
  const bringToFront = useCanvasStore((s) => s.bringToFront)
  const setSnapOverlay = useCanvasStore((s) => s.setSnapOverlay)
  const swapTileRects = useCanvasStore((s) => s.swapTileRects)
  const isDragging = useRef(false)
  const startPos = useRef({ x: 0, y: 0 })
  const startTilePos = useRef({ x: 0, y: 0 })
  /** Geometry at drag start (for swap-on-drop). */
  const startGeom = useRef({ x: 0, y: 0, w: 0, h: 0 })
  /** True if ⌥ was held during any move — skip swap on drop so we never swap after a snap session. */
  const snapDragUsedRef = useRef(false)
  const liveResolveRafRef = useRef<number | null>(null)
  const lastLiveResolveAtRef = useRef(0)
  const lastLiveResolvePosRef = useRef<{ x: number; y: number } | null>(null)
  const dragTileTypeRef = useRef<string | null>(null)
  const dragLastLeaderPosRef = useRef<{ x: number; y: number } | null>(null)
  const orchestratorDragStartAtRef = useRef(0)
  const orchestratorDragDistanceRef = useRef(0)

  const handleDragStart = useCallback(
    (e: React.MouseEvent, currentX: number, currentY: number) => {
      e.preventDefault()
      e.stopPropagation()
      isDragging.current = true
      snapDragUsedRef.current = false
      startPos.current = { x: e.clientX, y: e.clientY }
      startTilePos.current = { x: currentX, y: currentY }
      orchestratorDragStartAtRef.current = performance.now()
      orchestratorDragDistanceRef.current = 0
      const t0 = useCanvasStore.getState().tiles.get(tileId)
      if (t0) {
        startGeom.current = { x: t0.x, y: t0.y, w: t0.w, h: t0.h }
        dragTileTypeRef.current = t0.type
        dragLastLeaderPosRef.current = { x: t0.x, y: t0.y }
      }
      bringToFront(tileId)

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return

        const dx = (e.clientX - startPos.current.x) / zoom
        const dy = (e.clientY - startPos.current.y) / zoom

        let nx = startTilePos.current.x + dx
        let ny = startTilePos.current.y + dy

        const driveOrchestratorFlock = (leaderDelta: { x: number; y: number }) => {
          if (dragTileTypeRef.current !== 'orchestrator') return
          if (!useSettingsStore.getState().orchestratorGroupFollowEnabled) return
          const state = useCanvasStore.getState()
          const leader = state.tiles.get(tileId)
          if (!leader) return

          const stepDist = Math.hypot(leaderDelta.x, leaderDelta.y)
          if (stepDist <= 0.001) return
          orchestratorDragDistanceRef.current += stepDist

          const elapsedMs = performance.now() - orchestratorDragStartAtRef.current
          const followStrength = useSettingsStore.getState().orchestratorGroupFollowStrength
          const delayMs = 120
          const followStartDistance = 92
          const rampWindowMs = 220
          const rampWindowDistance = 220

          const tByTime =
            elapsedMs <= delayMs
              ? 0
              : Math.min(1, (elapsedMs - delayMs) / rampWindowMs)
          const tByDistance =
            orchestratorDragDistanceRef.current <= followStartDistance
              ? 0
              : Math.min(
                  1,
                  (orchestratorDragDistanceRef.current - followStartDistance) / rampWindowDistance
                )
          const followRamp = Math.max(tByTime, tByDistance)
          if (followRamp <= 0.001) return

          const lcx = leader.x + leader.w / 2
          const lcy = leader.y + leader.h / 2
          const followRadius = 760
          const followerIds = Array.from(state.tiles.values())
            .filter((t) => t.id !== tileId && t.type !== 'orchestrator')
            .filter((t) => {
              const tcx = t.x + t.w / 2
              const tcy = t.y + t.h / 2
              const dist = Math.hypot(tcx - lcx, tcy - lcy)
              return dist <= followRadius
            })
            .map((t) => t.id)
          if (followerIds.length === 0) return

          // Delayed, spring-like catch-up instead of immediate parallax lockstep.
          const alpha = Math.max(0.06, Math.min(0.82, followStrength * followRamp))
          translateTilesByIds(followerIds, leaderDelta, { alpha })
        }

        const optionSnap = snapModifierDown(e)
        const applyLeaderMove = (nextX: number, nextY: number, nextW?: number, nextH?: number) => {
          const leaderPrev = dragLastLeaderPosRef.current
          if (typeof nextW === 'number' && typeof nextH === 'number') {
            updateTile(tileId, { x: nextX, y: nextY, w: nextW, h: nextH })
          } else {
            updateTile(tileId, { x: nextX, y: nextY })
          }
          if (leaderPrev) {
            const delta = { x: nextX - leaderPrev.x, y: nextY - leaderPrev.y }
            driveOrchestratorFlock(delta)
          }
          dragLastLeaderPosRef.current = { x: nextX, y: nextY }
        }
        if (optionSnap) {
          snapDragUsedRef.current = true
          const { tiles, layoutAnchor } = useCanvasStore.getState()
          const tile = tiles.get(tileId)
          if (tile) {
            const thr = snapThresholdCanvas(zoom)
            const gridContext = layoutAnchor
              ? {
                  originX: layoutAnchor.x,
                  originY: layoutAnchor.y,
                  step: CANVAS_GRID_STEP,
                }
              : null
            const s = snapTileToOthers(
              nx,
              ny,
              tile.w,
              tile.h,
              tileId,
              tiles,
              thr,
              gridContext
            )
            const activeSnap =
              s.guides.verticalX != null ||
              s.guides.horizontalY != null ||
              s.targetTileIds.length > 0
            if (activeSnap) {
              setSnapOverlay({
                guides: s.guides,
                previewRect: { x: s.x, y: s.y, w: s.w, h: s.h },
                targetTileIds: s.targetTileIds,
              })
            } else {
              setSnapOverlay(null)
            }
            applyLeaderMove(s.x, s.y, s.w, s.h)
            scheduleLiveResolve(s.x, s.y)
            return
          }
        } else {
          setSnapOverlay(null)
        }

        applyLeaderMove(nx, ny)
        scheduleLiveResolve(nx, ny)
      }

      const scheduleLiveResolve = (x: number, y: number) => {
        if (!useSettingsStore.getState().tileLiveMagneticDragEnabled) return
        if (useFocusStore.getState().isActive) return
        const now = performance.now()
        const last = lastLiveResolvePosRef.current
        const movedEnough = !last || Math.hypot(last.x - x, last.y - y) >= 2
        if (!movedEnough) return
        if (now - lastLiveResolveAtRef.current < 14) return
        lastLiveResolveAtRef.current = now
        lastLiveResolvePosRef.current = { x, y }
        if (liveResolveRafRef.current != null) return
        liveResolveRafRef.current = window.requestAnimationFrame(() => {
          liveResolveRafRef.current = null
          if (!isDragging.current) return
          useCanvasStore.getState().resolveOverlapsForTileLive(tileId, {
            frozenIds: new Set([tileId]),
            settleIterations: 2,
            desiredGap: 30,
          })
        })
      }

      const handleMouseUp = (e: MouseEvent) => {
        isDragging.current = false
        setSnapOverlay(null)

        let didSwap = false
        if (!e.altKey && !snapDragUsedRef.current) {
          const { tiles, pan, zoom: z } = useCanvasStore.getState()
          const pt = clientToCanvasPoint(e.clientX, e.clientY, pan, z)
          if (pt) {
            const targetId = topTileIdAtCanvasPoint(tiles, pt.x, pt.y, tileId)
            if (targetId) {
              swapTileRects(tileId, targetId, startGeom.current)
              didSwap = true
            }
          }
        }

        if (!didSwap && !snapDragUsedRef.current && !useFocusStore.getState().isActive) {
          useCanvasStore.getState().resolveOverlapsForTile(tileId, {
            frozenIds: new Set([tileId]),
          })
        }

        if (liveResolveRafRef.current != null) {
          window.cancelAnimationFrame(liveResolveRafRef.current)
          liveResolveRafRef.current = null
        }
        lastLiveResolvePosRef.current = null
        dragTileTypeRef.current = null
        dragLastLeaderPosRef.current = null
        orchestratorDragStartAtRef.current = 0
        orchestratorDragDistanceRef.current = 0

        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [tileId, zoom, updateTile, translateTilesByIds, bringToFront, setSnapOverlay, swapTileRects]
  )

  return { handleDragStart }
}

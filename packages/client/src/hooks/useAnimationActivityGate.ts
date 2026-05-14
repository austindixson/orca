import { useCallback, useEffect, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useSettingsStore } from '../store/settingsStore'
import { useSystemPrefersReducedMotion } from './useReducedMotionPreference'

/**
 * Enables animation only when the tile is the active interaction target,
 * page is visible, element is in viewport, and reduced-motion is not requested.
 */
export function useAnimationActivityGate(tileId: string, animateIntent = true): {
  containerRef: (node: HTMLElement | null) => void
  allowAnimation: boolean
} {
  const activeInteractionTileId = useCanvasStore((s) => s.activeInteractionTileId)
  const onlyAnimateFocusedTile = useSettingsStore((s) => s.onlyAnimateFocusedTile)
  const prefersReducedMotion = useSystemPrefersReducedMotion()
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  )
  const [isInViewport, setIsInViewport] = useState(true)
  const [observedNode, setObservedNode] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      setIsDocumentVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    const node = observedNode
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsInViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0]
        setIsInViewport(Boolean(first?.isIntersecting))
      },
      { threshold: 0.05 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [observedNode])

  const containerRef = useCallback((node: HTMLElement | null) => {
    setObservedNode(node)
  }, [])

  const allowAnimation =
    animateIntent &&
    !prefersReducedMotion &&
    isDocumentVisible &&
    isInViewport &&
    (!onlyAnimateFocusedTile || activeInteractionTileId === tileId)

  return { containerRef, allowAnimation }
}

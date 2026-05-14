import { useSyncExternalStore } from 'react'

function getReducedMotionMediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia('(prefers-reduced-motion: reduce)')
}

/** Live `prefers-reduced-motion: reduce` (SSR-safe). */
export function useSystemPrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = getReducedMotionMediaQueryList()
      if (!mq) return () => {}
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => getReducedMotionMediaQueryList()?.matches === true,
    () => false
  )
}

/** When user opts in to respect system setting, combine with live media query. */
export function useEffectiveMotionBlocked(respectPrefersReducedMotion: boolean): boolean {
  const system = useSystemPrefersReducedMotion()
  return respectPrefersReducedMotion && system
}

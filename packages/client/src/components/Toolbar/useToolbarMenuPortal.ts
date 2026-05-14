import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

/** Above canvas HUD / quick input; below `DeleteTilesConfirmModal` (z-[200]). */
export const TOOLBAR_MENU_PORTAL_Z_INDEX = 150

export type ToolbarMenuAnchorAlign = 'left' | 'center' | 'right'

/**
 * Fixed position (viewport) for a menu portaled to `document.body`, anchored above a toolbar
 * control. Escapes the toolbar’s transform + z-stacking context so menus paint above the
 * narrator and quick orchestrator input.
 */
export function useToolbarMenuPortal(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  align: ToolbarMenuAnchorAlign
) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [fixedStyle, setFixedStyle] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setFixedStyle(null)
      return
    }
    const update = () => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      let left: number
      if (align === 'left') left = r.left
      else if (align === 'right') left = r.right
      else left = r.left + r.width / 2

      const style: CSSProperties = {
        position: 'fixed',
        left,
        bottom: window.innerHeight - r.top + 8,
        zIndex: TOOLBAR_MENU_PORTAL_Z_INDEX,
      }
      if (align === 'center') style.transform = 'translateX(-50%)'
      else if (align === 'right') style.transform = 'translateX(-100%)'

      setFixedStyle(style)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, align, anchorRef])

  return { menuRef, fixedStyle }
}

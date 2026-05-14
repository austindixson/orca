import { useEffect } from 'react'
import { handleShiftArrowNavigation } from '../../lib/canvasModuleNavigation'

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return el.closest('[role="textbox"]') != null
}

export function CanvasModuleShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (isTypingTarget(e.target)) return

      const dir =
        e.key === 'ArrowLeft'
          ? 'left'
          : e.key === 'ArrowRight'
            ? 'right'
            : e.key === 'ArrowUp'
              ? 'up'
              : 'down'

      if (handleShiftArrowNavigation(dir)) {
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return null
}

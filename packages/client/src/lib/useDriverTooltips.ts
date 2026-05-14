import { useEffect } from 'react'
import { driver, type Driver } from 'driver.js'

/**
 * Hover tooltips via driver.js highlight popovers (no dimmed backdrop), with native browser
 * tooltips suppressed.
 *
 * Strategy:
 *  1. Prefer `data-tooltip="..."` in JSX for hover copy. Any remaining `title="..."`
 *     is migrated to `data-tooltip` at runtime so native browser tooltips stay off.
 *     (Iframes keep `title` for embedded document names — do not use `data-tooltip`.)
 *  2. After the pointer rests on an element with `data-tooltip` or (for interactive
 *     controls) `aria-label` for {@link HOVER_DELAY_MS}, driver.js shows a popover
 *     anchored to that element.
 *  3. Moving off the element, mousedown, Escape, scrolling, or window blur cancels
 *     the pending tooltip and/or destroys the active driver.
 *
 * Iframes are skipped: their `title` names the embedded document for a11y and must
 * not become a hover popup.
 */
const HOVER_DELAY_MS = 500
/** How far the cursor may drift after hover-start before we restart the timer. */
const HOVER_JITTER_PX = 6

let driverInstance: Driver | null = null

function getDriver(): Driver {
  return (driverInstance ??= driver({
    animate: false,
    allowClose: true,
    showButtons: [],
    overlayOpacity: 0,
    overlayColor: 'transparent',
    stagePadding: 0,
    stageRadius: 6,
    popoverOffset: 8,
    popoverClass: 'orca-tooltip',
    allowKeyboardControl: false,
    disableActiveInteraction: false,
  }))
}

function destroyDriver(): void {
  if (driverInstance) {
    driverInstance.destroy()
    driverInstance = null
  }
}

export function useDriverTooltips(): void {
  useEffect(() => {
    const migrate = (el: Element): void => {
      if (el instanceof HTMLIFrameElement) return
      if (!el.hasAttribute('title')) return
      const value = el.getAttribute('title') ?? ''
      el.removeAttribute('title')
      const trimmed = value.trim()
      if (!trimmed) return
      if (!el.hasAttribute('data-tooltip')) {
        el.setAttribute('data-tooltip', value)
      }
    }

    const migrateUnder = (root: ParentNode): void => {
      if (root instanceof Element) migrate(root)
      if (root instanceof Element || root instanceof Document || root instanceof DocumentFragment) {
        const nodes = root.querySelectorAll<Element>('[title]')
        nodes.forEach(migrate)
      }
    }

    migrateUnder(document)

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node instanceof Element) migrateUnder(node)
          }
        } else if (
          m.type === 'attributes' &&
          m.attributeName === 'title' &&
          m.target instanceof Element &&
          !(m.target instanceof HTMLIFrameElement)
        ) {
          migrate(m.target)
        }
      }
    })
    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title'],
    })

    let timerId: number | null = null
    let currentTarget: Element | null = null
    let visible = false
    let lastX = 0
    let lastY = 0
    let anchorX = 0
    let anchorY = 0

    const trackMove = (e: MouseEvent): void => {
      lastX = e.clientX
      lastY = e.clientY
    }
    document.addEventListener('mousemove', trackMove, { passive: true, capture: true })

    const cancelTimer = (): void => {
      if (timerId !== null) {
        window.clearTimeout(timerId)
        timerId = null
      }
    }

    const hide = (): void => {
      cancelTimer()
      currentTarget = null
      if (!visible) return
      visible = false
      destroyDriver()
    }

    const isInteractiveLike = (el: Element): boolean => {
      const tag = el.tagName
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true
      if (tag === 'INPUT') {
        const t = (el as HTMLInputElement).type
        return (
          t === 'button' ||
          t === 'submit' ||
          t === 'reset' ||
          t === 'checkbox' ||
          t === 'radio'
        )
      }
      const role = el.getAttribute('role')
      return (
        role === 'button' ||
        role === 'link' ||
        role === 'menuitem' ||
        role === 'tab' ||
        role === 'switch' ||
        role === 'checkbox' ||
        role === 'radio'
      )
    }

    const tooltipTextFor = (el: Element): string | null => {
      const dt = el.getAttribute('data-tooltip')
      if (dt && dt.trim()) return dt
      if (isInteractiveLike(el)) {
        const aria = el.getAttribute('aria-label')
        if (aria && aria.trim()) return aria
      }
      return null
    }

    const showFor = (target: Element): void => {
      const text = tooltipTextFor(target)
      if (!text || !text.trim()) return
      getDriver().highlight({
        element: target,
        popover: {
          description: text,
        },
      })
      visible = true
    }

    const findTipTarget = (el: EventTarget | null): Element | null => {
      let cur: Element | null = el instanceof Element ? el : null
      while (cur && cur !== document.documentElement) {
        if (tooltipTextFor(cur)) return cur
        if (isInteractiveLike(cur)) return null
        cur = cur.parentElement
      }
      return null
    }

    const scheduleFor = (target: Element): void => {
      cancelTimer()
      if (visible) {
        visible = false
        destroyDriver()
      }
      currentTarget = target
      anchorX = lastX
      anchorY = lastY
      timerId = window.setTimeout(() => {
        timerId = null
        if (currentTarget !== target) return
        if (!document.body.contains(target)) return
        const under = document.elementFromPoint(lastX, lastY)
        const hit = findTipTarget(under)
        if (hit !== target) return
        const dx = lastX - anchorX
        const dy = lastY - anchorY
        if (Math.hypot(dx, dy) > HOVER_JITTER_PX * 6) {
          scheduleFor(target)
          return
        }
        showFor(target)
      }, HOVER_DELAY_MS)
    }

    const onOver = (e: MouseEvent): void => {
      lastX = e.clientX
      lastY = e.clientY
      const target = findTipTarget(e.target)
      if (!target) {
        if (currentTarget || visible) hide()
        return
      }
      if (target === currentTarget) return
      scheduleFor(target)
    }

    const onOut = (e: MouseEvent): void => {
      if (!currentTarget) return
      const related = e.relatedTarget instanceof Element ? e.relatedTarget : null
      if (related && currentTarget.contains(related)) return
      hide()
    }

    const onDown = (): void => hide()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    const onScroll = (): void => hide()
    const onBlur = (): void => hide()
    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') hide()
    }

    document.addEventListener('mouseover', onOver, true)
    document.addEventListener('mouseout', onOut, true)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      mo.disconnect()
      document.removeEventListener('mousemove', trackMove, { capture: true } as EventListenerOptions)
      document.removeEventListener('mouseover', onOver, true)
      document.removeEventListener('mouseout', onOut, true)
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      cancelTimer()
      destroyDriver()
    }
  }, [])
}

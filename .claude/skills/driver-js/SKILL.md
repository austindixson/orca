---
name: driver-js
description: Use driver.js (kamranahmedse/driver.js) for product tours, element highlights, and Orca’s quiet hover tooltips — popovers anchored to DOM nodes with optional dim overlay.
license: MIT
---

# driver.js skill

Official docs: [driverjs.com](https://driverjs.com) · [GitHub](https://github.com/kamranahmedse/driver.js)

## Install

```bash
npm install driver.js
```

```ts
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
```

CDN (non-bundler): load `driver.js.iife.js` + `driver.css` from jsDelivr; use `window.driver.js.driver`.

## API essentials

- `driver(config?: Config)` returns a `Driver` with `highlight(step)`, `drive()`, `destroy()`, `setConfig`, `getState`, etc.
- Single-step highlight: `driver().highlight({ element: '#x', popover: { title?, description? } })` — `element` can be a selector, `Element`, or `() => Element`.
- Multi-step tour: `driver({ steps: [...], showProgress: true }).drive()` — `steps` is `DriveStep[]` with `element` + `popover` each.
- **Popover** supports `side` / `align`, HTML in `title` / `description`, `popoverClass`, `showButtons` / `disableButtons`, `onPopoverRender` to tweak DOM.
- **Global config** (`Config`): `overlayOpacity`, `overlayColor`, `overlayClickBehavior` (`'close' | 'nextStep' | fn`), `stagePadding`, `stageRadius`, `animate`, `smoothScroll`, `allowClose`, `disableActiveInteraction`, `allowKeyboardControl`, `popoverClass`, `popoverOffset`, hooks (`onHighlighted`, `onDeselected`, `onDestroyStarted`, `onDestroyed`, …).
- **Theming**: set `popoverClass`, then target `.driver-popover`, `.driver-popover-title`, `.driver-popover-description`, `.driver-popover-arrow`, `.driver-popover-footer`, etc. Body gets `.driver-active` / `.driver-fade` / `.driver-simple`; highlighted element gets `.driver-active-element`.
- **Hooks**: overriding `onNextClick` / `onPrevClick` at driver or step level **takes over** navigation — you must call `driver.moveNext()` / `movePrevious()` yourself.

## Orca “quiet tooltip” mode (no dim, hover)

Used by `useDriverTooltips` — hover-reveal help without a visible backdrop:

```ts
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'

let d: Driver | null = null
function getDriver() {
  return (d ??= driver({
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
function hide() {
  d?.destroy()
  d = null
}
// On hover settle: getDriver().highlight({ element: el, popover: { description: text } })
// On leave / scroll / Esc: hide()
```

Pitfalls:

- Only one active tour/highlight at a time — reuse one `Driver` or `destroy()` before a new `highlight`.
- Call `destroy()` on unmount and when hiding the tooltip.
- Transparent overlay may still exist — watch z-index vs modals; `overlayOpacity: 0` keeps the UI undimmed.

## Product tour (onboarding)

```ts
const tour = driver({
  showProgress: true,
  steps: [
    { element: '.page-header', popover: { title: 'Title', description: '…' } },
    { element: '.sidebar', popover: { title: 'Sidebar', description: '…', side: 'right' } },
  ],
})
tour.drive()
```

## References

- [Installation](https://driverjs.com/docs/installation)
- [Configuration](https://driverjs.com/docs/configuration)
- [Basic usage](https://driverjs.com/docs/basic-usage)
- [Theming](https://driverjs.com/docs/theming)

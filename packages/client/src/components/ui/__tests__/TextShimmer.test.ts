/** TextShimmer: optional neutral RGB override for trace/status copy. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

function setupDom(): void {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  })
  const win = dom.window
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
    writable: true,
  })
  globalThis.window = win as unknown as Window & typeof globalThis
  globalThis.document = win.document
  globalThis.HTMLElement = win.HTMLElement
  globalThis.SVGElement = win.SVGElement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
}

test('shimmerRgb sets --orca-shimmer-rgb on the span', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render } = await import('@testing-library/react')
  const { TextShimmer } = await import('../TextShimmer')

  const view = render(
    createElement(
      TextShimmer,
      {
        tileType: 'orchestrator',
        shimmerRgb: [148, 163, 184] as const,
        testId: 'shimmer-rgb-test',
      },
      'Status',
    ),
  )

  const el = view.getByTestId('shimmer-rgb-test') as HTMLElement
  assert.equal(el.style.getPropertyValue('--orca-shimmer-rgb').trim(), '148 163 184')

  view.unmount()
})

/**
 * Trace peek: newest row uses gray shimmer class while run is active.
 */
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
  Object.defineProperty(win, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
      win.setTimeout(() => cb(performance.now()), 0) as unknown as number
  }
  if (typeof globalThis.cancelAnimationFrame === 'undefined') {
    globalThis.cancelAnimationFrame = (id: number) => {
      win.clearTimeout(id)
    }
  }
}

test('last peek row uses shimmer while running', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render } = await import('@testing-library/react')
  const {
    OrchestratorTracePeekRows,
    ORCHESTRATOR_TRACE_PEEK_ROW_SHIMMER_TEST_ID,
  } = await import('../OrchestratorTracePeekRows')

  const tracePeekRows = ['', '', 'earlier', 'newest tail line']
  const view = render(
    createElement(OrchestratorTracePeekRows, {
      tracePeekRows,
      running: true,
      traceLineCount: 2,
    }),
  )

  const shimmer = view.getByTestId(ORCHESTRATOR_TRACE_PEEK_ROW_SHIMMER_TEST_ID)
  assert.ok(shimmer.className.includes('orca-text-shimmer'))
  view.getByText('newest tail line')

  view.unmount()
})

test('last peek row is plain text when not running', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render } = await import('@testing-library/react')
  const {
    OrchestratorTracePeekRows,
    ORCHESTRATOR_TRACE_PEEK_ROW_SHIMMER_TEST_ID,
  } = await import('../OrchestratorTracePeekRows')

  const tracePeekRows = ['', '', 'earlier', 'done']
  const view = render(
    createElement(OrchestratorTracePeekRows, {
      tracePeekRows,
      running: false,
      traceLineCount: 2,
    }),
  )

  assert.equal(view.queryByTestId(ORCHESTRATOR_TRACE_PEEK_ROW_SHIMMER_TEST_ID), null)
  view.getByText('done')

  view.unmount()
})

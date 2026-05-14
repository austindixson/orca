/**
 * Planning panel: never surface raw streaming tokens; show placeholder until formatted.
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

test('streaming phase shows placeholder and does not render raw draft body', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render } = await import('@testing-library/react')
  const { OrchestratorPlanningDraftPanel } = await import('../OrchestratorPlanningDraftPanel')

  const secretChunk = '{"articulation":{"tracks":["TOP_SECRET_STREAM"]}}'
  const view = render(
    createElement(OrchestratorPlanningDraftPanel, {
      planningDraft: {
        phase: 'streaming',
        title: 'Decomposition',
        body: secretChunk,
      },
    }),
  )

  view.getByTestId('orchestrator-planning-streaming-placeholder')
  assert.equal(view.queryByText(secretChunk), null)
  assert.equal(view.container.textContent?.includes('TOP_SECRET_STREAM'), false)

  view.unmount()
})

test('formatted phase renders markdown body', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render } = await import('@testing-library/react')
  const { OrchestratorPlanningDraftPanel } = await import('../OrchestratorPlanningDraftPanel')

  const view = render(
    createElement(OrchestratorPlanningDraftPanel, {
      planningDraft: {
        phase: 'formatted',
        title: 'Plan',
        body: '## Hello\n\n- item',
      },
    }),
  )

  assert.equal(view.queryByTestId('orchestrator-planning-streaming-placeholder'), null)
  view.getByText('Hello')
  view.getByText('item')

  view.unmount()
})

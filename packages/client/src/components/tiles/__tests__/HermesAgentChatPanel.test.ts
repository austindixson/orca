/**
 * RTL smoke: Hermes transcript user rows use the exported user bubble class (normal flow).
 * DOM setup must run before importing React components.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

import {
  HERMES_USER_MESSAGE_BUBBLE_CLASS,
} from '../HermesAgentChatPanel'

function setupDom(): void {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  })
  const win = dom.window
  // Node may define `globalThis.navigator` as read-only; override for jsdom.
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
    writable: true,
  })
  globalThis.window = win as unknown as Window & typeof globalThis
  globalThis.document = win.document
  globalThis.HTMLElement = win.HTMLElement
  globalThis.SVGElement = win.SVGElement
  // Keep Node's `performance` — assigning jsdom's Performance bridges to window.performance and can recurse.
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

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: 'm1' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
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

test('HERMES_USER_MESSAGE_BUBBLE_CLASS is normal-flow user bubble (no sticky / z-index)', () => {
  assert.match(HERMES_USER_MESSAGE_BUBBLE_CLASS, /\bml-8\b/)
  assert.match(HERMES_USER_MESSAGE_BUBBLE_CLASS, /\bbg-teal-950\/60\b/)
  assert.ok(!/\bsticky\b/.test(HERMES_USER_MESSAGE_BUBBLE_CLASS))
  assert.ok(!/\btop-0\b/.test(HERMES_USER_MESSAGE_BUBBLE_CLASS))
  assert.ok(!/\bz-\d/.test(HERMES_USER_MESSAGE_BUBBLE_CLASS))
  assert.ok(!/\bisolate\b/.test(HERMES_USER_MESSAGE_BUBBLE_CLASS))
  assert.ok(!/\bbackdrop-blur/.test(HERMES_USER_MESSAGE_BUBBLE_CLASS))
})

test('renders hydrated user rows with user bubble class (two user turns)', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render, waitFor } = await import('@testing-library/react')
  const { HermesAgentChatPanel } = await import('../HermesAgentChatPanel')
  const { useCanvasStore } = await import('../../../store/canvasStore')

  const tileId = 'hermes-rtl-test-tile'
  useCanvasStore.setState({
    tiles: new Map([
      [
        tileId,
        {
          id: tileId,
          type: 'hermes_agent',
          x: 0,
          y: 0,
          w: 400,
          h: 300,
          zIndex: 1,
          title: 'Hermes',
          meta: {},
        },
      ],
    ]),
  })

  const tileMeta = {
    hermesChat: [
      { id: 'u1', role: 'user', content: 'First prompt' },
      { id: 'a1', role: 'assistant', content: 'Reply one' },
      { id: 'u2', role: 'user', content: 'Second prompt' },
      { id: 'a2', role: 'assistant', content: 'Reply two' },
    ],
  }

  const view = render(createElement(HermesAgentChatPanel, { tileId, tileMeta }))

  await waitFor(() => {
    const youLabels = view.getAllByText('You')
    assert.ok(
      youLabels.length >= 2,
      `expected at least 2 user turns (You labels), got ${youLabels.length}`,
    )
  })

  view.unmount()
})

test('renders assistant fenced diff/code output in code blocks', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render, waitFor } = await import('@testing-library/react')
  const { HermesAgentChatPanel } = await import('../HermesAgentChatPanel')
  const { useCanvasStore } = await import('../../../store/canvasStore')

  const tileId = 'hermes-rtl-fence-tile'
  useCanvasStore.setState({
    tiles: new Map([
      [
        tileId,
        {
          id: tileId,
          type: 'hermes_agent',
          x: 0,
          y: 0,
          w: 400,
          h: 300,
          zIndex: 1,
          title: 'Hermes',
          meta: {},
        },
      ],
    ]),
  })

  const tileMeta = {
    hermesChat: [
      {
        id: 'a1',
        role: 'assistant',
        content: 'Here is the patch:\n```diff\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new\n```\n\n```ts\nconst x = 1\n```',
      },
    ],
  }

  const view = render(createElement(HermesAgentChatPanel, { tileId, tileMeta }))

  await waitFor(() => {
    assert.equal(view.container.querySelectorAll('[data-testid="hermes-chat-diff-block"]').length, 1)
    assert.equal(view.container.querySelectorAll('[data-testid="hermes-chat-code-block"]').length, 1)
  })

  view.unmount()
})

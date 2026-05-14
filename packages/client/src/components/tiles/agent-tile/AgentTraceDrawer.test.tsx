import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import type { DelegatedTraceChip } from '../../../lib/orchestrator/delegatedLogPresentation'

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
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
}

type AgentTraceDrawerProps = {
  tileId: string
  traceExpanded: boolean
  setTraceExpanded: (v: boolean | ((p: boolean) => boolean)) => void
  traceChips: DelegatedTraceChip[]
  hiddenChipCount: number
  recentChips: DelegatedTraceChip[]
  delegated: boolean
  delegatedFullTraceText: string
  orchestratorToolLog: string[] | undefined
  showTraceSection: boolean
  runActive?: boolean
  nowMsOverride?: number
}

function baseProps(overrides: Partial<AgentTraceDrawerProps> = {}): AgentTraceDrawerProps {
  const baseChip: DelegatedTraceChip = {
    id: 'c1',
    kind: 'call',
    name: 'read_file',
    icon: '📖',
    target: '/tmp/a.ts',
    duration: '1.1s',
  }
  return {
    tileId: 'tile-trace-test',
    traceExpanded: false,
    setTraceExpanded: () => {},
    traceChips: [baseChip],
    hiddenChipCount: 0,
    recentChips: [baseChip],
    delegated: false,
    delegatedFullTraceText: '',
    orchestratorToolLog: ['→ read_file /tmp/a.ts 1.1s', '← read_file ok 1.2s'],
    showTraceSection: true,
    runActive: false,
    ...overrides,
  }
}

test('collapsed drawer shows explicit expand control with preview', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render } = await import('@testing-library/react')
  const { AgentTraceDrawer } = await import('./AgentTraceDrawer')

  const view = render(createElement(AgentTraceDrawer, baseProps()))

  assert.ok(view.getByText('Expand (2)'))
  assert.ok(view.getByText(/← read_file ok 1.2s/))
  view.unmount()
})

test('expanded drawer shows full trace and collapse control', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render } = await import('@testing-library/react')
  const { AgentTraceDrawer } = await import('./AgentTraceDrawer')

  const view = render(
    createElement(
      AgentTraceDrawer,
      baseProps({
        traceExpanded: true,
        traceChips: [{ id: 'c1', kind: 'call', name: 'grep', icon: '🔎', target: 'useReasoningTraceStore', duration: '0.6s' }],
        recentChips: [{ id: 'c1', kind: 'call', name: 'grep', icon: '🔎', target: 'useReasoningTraceStore', duration: '0.6s' }],
        orchestratorToolLog: ['→ grep useReasoningTraceStore 0.6s', '← grep ok 0.7s'],
      })
    )
  )

  assert.ok(view.getByText('Collapse (2)'))
  assert.ok(view.getByText('Orchestrator trace (tools)'))
  view.unmount()
})

test('renders visual node states and category tokens for trace chips', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render } = await import('@testing-library/react')
  const { AgentTraceDrawer } = await import('./AgentTraceDrawer')

  const chips: DelegatedTraceChip[] = [
    { id: 'q', kind: 'info', name: '[Planning] queue', state: 'queued', category: 'plan' },
    { id: 'r', kind: 'call', name: 'search_files', state: 'running', category: 'search' },
    { id: 's', kind: 'result', name: 'read_file ok', state: 'success', category: 'file' },
    { id: 'e', kind: 'result', name: 'patch failed', state: 'error', category: 'edit' },
  ]

  const view = render(
    createElement(
      AgentTraceDrawer,
      baseProps({
        traceExpanded: true,
        traceChips: chips,
        recentChips: chips,
      })
    )
  )

  assert.equal(view.container.querySelectorAll('[data-testid="trace-state-queued"]').length > 0, true)
  assert.equal(view.container.querySelectorAll('[data-testid="trace-state-running"]').length > 0, true)
  assert.equal(view.container.querySelectorAll('[data-testid="trace-state-success"]').length > 0, true)
  assert.equal(view.container.querySelectorAll('[data-testid="trace-state-error"]').length > 0, true)
  assert.equal(view.container.querySelectorAll('[data-testid="trace-category-plan"]').length > 0, true)
  assert.equal(view.container.querySelectorAll('[data-testid="trace-category-search"]').length > 0, true)
  assert.equal(view.container.querySelectorAll('[data-testid="trace-category-file"]').length > 0, true)
  assert.equal(view.container.querySelectorAll('[data-testid="trace-category-edit"]').length > 0, true)
  view.unmount()
})

test('enforces in-canvas node cap and surfaces overflow controls', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render } = await import('@testing-library/react')
  const { AgentTraceDrawer } = await import('./AgentTraceDrawer')

  const chips: DelegatedTraceChip[] = Array.from({ length: 20 }, (_, i) => ({
    id: `chip-${i}`,
    kind: i % 2 === 0 ? 'call' : 'result',
    name: i % 2 === 0 ? 'search_files' : 'search_files ok',
  }))

  const view = render(
    createElement(
      AgentTraceDrawer,
      baseProps({
        traceExpanded: true,
        traceChips: chips,
        recentChips: chips,
        nowMsOverride: 10_000,
      })
    )
  )

  const expanded = view.container.querySelectorAll('[data-testid="trace-chip-expanded"]')
  assert.equal(expanded.length, 14, 'should cap expanded in-canvas nodes at budget max')
  assert.ok(view.getByText('+6'))
  view.unmount()
})

test('narrow-width layout keeps wrap/truncation invariants for readable trace chips', async () => {
  setupDom()
  const { createElement } = await import('react')
  const { render } = await import('@testing-library/react')
  const { AgentTraceDrawer } = await import('./AgentTraceDrawer')

  const longTarget = '/Users/ghost/Desktop/orca/packages/client/src/components/tiles/agent-tile/very/deep/path/to/file.tsx'
  const chips: DelegatedTraceChip[] = [
    {
      id: 'long',
      kind: 'call',
      name: 'search_files_with_a_really_long_function_name_for_narrow_tile_readability',
      target: longTarget,
      duration: '1.2s',
    },
  ]

  const view = render(
    createElement(
      'div',
      { style: { width: '170px' } },
      createElement(
        AgentTraceDrawer,
        baseProps({
          traceExpanded: false,
          traceChips: chips,
          recentChips: chips,
        })
      )
    )
  )

  const row = view.container.querySelector('.flex.flex-wrap.items-center.gap-1\\.5')
  assert.ok(row, 'chip row should wrap at narrow widths')
  const chip = view.container.querySelector('[data-testid="trace-chip"]') as HTMLElement | null
  assert.ok(chip)
  assert.match(chip.className, /max-w-\[min\(100%,280px\)\]/)
  assert.ok(chip.querySelector('.min-w-0.truncate'))
  view.unmount()
})

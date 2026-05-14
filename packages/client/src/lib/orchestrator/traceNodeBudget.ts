import type { DelegatedTraceChip } from './delegatedLogPresentation'

export type TraceNodeVisualState = 'queued' | 'running' | 'success' | 'error'
export type TraceNodeCategory = 'file' | 'search' | 'edit' | 'exec' | 'network' | 'plan' | 'info' | 'other'

export type TraceCanvasNode = {
  id: string
  chip: DelegatedTraceChip
  state: TraceNodeVisualState
  category: TraceNodeCategory
  firstSeenAt: number
  lastSeenAt: number
}

export type TraceNodeBudgetInput = {
  nodes: TraceCanvasNode[]
  nowMs: number
  maxNodes?: number
  ttlMs?: number
  minFrameMs?: number
  lastFrameAtMs?: number | null
}

export type TraceNodeBudgetResult = {
  visibleNodes: TraceCanvasNode[]
  hiddenCount: number
  ttlCollapsedCount: number
  capCollapsedCount: number
  throttled: boolean
  nextFrameAtMs: number | null
}

const DEFAULT_MAX_NODES = 14
const DEFAULT_TTL_MS = 16_000
const DEFAULT_MIN_FRAME_MS = 48

function clampInt(v: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(max, Math.floor(v as number)))
}

export function inferTraceNodeState(chip: DelegatedTraceChip): TraceNodeVisualState {
  if (chip.state) return chip.state
  if (chip.kind === 'call') return 'running'
  if (chip.kind === 'info') return 'queued'
  const source = `${chip.name} ${chip.target ?? ''}`.toLowerCase()
  if (/\berror\b|\bfail(?:ed|ure)?\b|\bdenied\b|\bexception\b|\btimeout\b/.test(source)) {
    return 'error'
  }
  return 'success'
}

export function inferTraceNodeCategory(chip: DelegatedTraceChip): TraceNodeCategory {
  if (chip.category) return chip.category
  const n = `${chip.name} ${chip.target ?? ''}`.toLowerCase()
  if (chip.kind === 'info') return 'info'
  if (/read_file|cat\b|open\b|path=|\.tsx?\b|\.jsx?\b|\.json\b|\.md\b/.test(n)) return 'file'
  if (/search|grep|rg\b|find\b|pattern=/.test(n)) return 'search'
  if (/patch|write|edit|apply|rename|delete/.test(n)) return 'edit'
  if (/terminal|shell|npm\b|pnpm\b|yarn\b|python\b|node\b|test\b|build\b/.test(n)) return 'exec'
  if (/http|fetch|curl|browser_|navigate|request|api\b/.test(n)) return 'network'
  if (/plan|todo|track|routing|decomposition|phase/.test(n)) return 'plan'
  return 'other'
}

export function applyTraceNodeBudget(input: TraceNodeBudgetInput): TraceNodeBudgetResult {
  const maxNodes = clampInt(input.maxNodes, DEFAULT_MAX_NODES, 2, 128)
  const ttlMs = clampInt(input.ttlMs, DEFAULT_TTL_MS, 1000, 10 * 60_000)
  const minFrameMs = clampInt(input.minFrameMs, DEFAULT_MIN_FRAME_MS, 8, 1000)
  const lastFrameAtMs = Number.isFinite(input.lastFrameAtMs) ? (input.lastFrameAtMs as number) : null

  const throttled = lastFrameAtMs != null && input.nowMs - lastFrameAtMs < minFrameMs

  const sorted = [...input.nodes].sort((a, b) => {
    if (a.lastSeenAt !== b.lastSeenAt) return a.lastSeenAt - b.lastSeenAt
    return a.id.localeCompare(b.id)
  })

  const unexpired: TraceCanvasNode[] = []
  let ttlCollapsedCount = 0
  for (const node of sorted) {
    const active = node.state === 'queued' || node.state === 'running'
    const stale = input.nowMs - node.lastSeenAt > ttlMs
    if (stale && !active) {
      ttlCollapsedCount += 1
      continue
    }
    unexpired.push(node)
  }

  const capCollapsedCount = Math.max(0, unexpired.length - maxNodes)
  const visibleNodes = capCollapsedCount > 0 ? unexpired.slice(-maxNodes) : unexpired

  return {
    visibleNodes,
    hiddenCount: ttlCollapsedCount + capCollapsedCount,
    ttlCollapsedCount,
    capCollapsedCount,
    throttled,
    nextFrameAtMs: throttled ? lastFrameAtMs : input.nowMs,
  }
}

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  formatTraceChipLabel,
  type DelegatedTraceChip,
} from '../../../lib/orchestrator/delegatedLogPresentation'
import {
  applyTraceNodeBudget,
  inferTraceNodeCategory,
  inferTraceNodeState,
  type TraceNodeCategory,
  type TraceNodeVisualState,
} from '../../../lib/orchestrator/traceNodeBudget'
import { agentTileLabelClass, chipClass } from './styles'
import { useAnimationActivityGate } from '../../../hooks/useAnimationActivityGate'

type Props = {
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
  /** Sub-agent run actively streaming — drives live trace snippet + fade-out when false. */
  runActive?: boolean
  /** Testing hook for deterministic frame/TTL behavior. */
  nowMsOverride?: number
}

const MAX_TRACE_NODES = 14
const TRACE_NODE_TTL_MS = 16_000
const TRACE_MIN_FRAME_MS = 48

function categoryTokenClass(category: TraceNodeCategory): string {
  if (category === 'file') return 'border-sky-500/40 bg-sky-500/15 text-sky-200'
  if (category === 'search') return 'border-violet-500/40 bg-violet-500/15 text-violet-200'
  if (category === 'edit') return 'border-orange-500/40 bg-orange-500/15 text-orange-100'
  if (category === 'exec') return 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
  if (category === 'network') return 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
  if (category === 'plan') return 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200'
  if (category === 'info') return 'border-gray-500/40 bg-gray-500/15 text-gray-300'
  return 'border-tile-border bg-black/35 text-gray-300'
}

function stateBubbleClass(state: TraceNodeVisualState, animate: boolean): string {
  if (state === 'queued') return 'border-gray-500/70 bg-gray-500/60'
  if (state === 'running') {
    return animate
      ? 'border-cyan-400/80 bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.8)]'
      : 'border-cyan-400/80 bg-cyan-300'
  }
  if (state === 'success') return 'border-emerald-400/80 bg-emerald-300'
  return 'border-rose-400/80 bg-rose-300'
}

function chipClassFor(chip: DelegatedTraceChip): string {
  const state = inferTraceNodeState(chip)
  if (state === 'error') return chipClass('rose') + ' max-w-[min(100%,280px)] py-0'
  if (state === 'success') return chipClass('emerald') + ' max-w-[min(100%,280px)] py-0'
  if (state === 'running') return chipClass('cyan') + ' max-w-[min(100%,280px)] py-0'
  if (chip.kind === 'info') return chipClass('amber') + ' max-w-[min(100%,280px)] py-0'
  return chipClass('gray') + ' max-w-[min(100%,280px)] py-0'
}

function categoryTokenLabel(category: TraceNodeCategory): string {
  if (category === 'file') return 'FILE'
  if (category === 'search') return 'SEARCH'
  if (category === 'edit') return 'EDIT'
  if (category === 'exec') return 'EXEC'
  if (category === 'network') return 'NET'
  if (category === 'plan') return 'PLAN'
  if (category === 'info') return 'INFO'
  return 'GEN'
}

function ChipBody({ chip, animate }: { chip: DelegatedTraceChip; animate: boolean }) {
  const state = inferTraceNodeState(chip)
  const category = inferTraceNodeCategory(chip)
  if (chip.kind === 'info') {
    return (
      <>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full border ${stateBubbleClass(state, animate)}`}
          data-testid={`trace-state-${state}`}
        />
        <span
          className={`shrink-0 rounded border px-1 py-0 text-[8px] font-semibold tracking-wide ${categoryTokenClass(category)}`}
          data-testid={`trace-category-${category}`}
        >
          {categoryTokenLabel(category)}
        </span>
        <span className="min-w-0 truncate">{formatTraceChipLabel(chip)}</span>
      </>
    )
  }
  return (
    <>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full border ${stateBubbleClass(state, animate)}`}
        data-testid={`trace-state-${state}`}
      />
      <span className="shrink-0 opacity-70">{chip.icon ?? (chip.kind === 'call' ? '→' : '←')}</span>
      <span
        className={`shrink-0 rounded border px-1 py-0 text-[8px] font-semibold tracking-wide ${categoryTokenClass(category)}`}
        data-testid={`trace-category-${category}`}
      >
        {categoryTokenLabel(category)}
      </span>
      <span className="min-w-0 truncate">{chip.name}</span>
      {chip.target ? <span className="min-w-0 truncate opacity-80">{chip.target}</span> : null}
      {chip.duration ? <span className="shrink-0 tabular-nums opacity-75">{chip.duration}</span> : null}
    </>
  )
}

export function AgentTraceDrawer({
  tileId,
  traceExpanded,
  setTraceExpanded,
  traceChips,
  hiddenChipCount,
  recentChips,
  delegated,
  delegatedFullTraceText,
  orchestratorToolLog,
  showTraceSection,
  runActive = false,
  nowMsOverride,
}: Props) {
  const { containerRef, allowAnimation } = useAnimationActivityGate(tileId, runActive)
  /** Keep snippet mounted briefly after run ends so opacity can fade out. */
  const [snippetMounted, setSnippetMounted] = useState(false)
  const nodeSeenRef = useRef(new Map<string, { firstSeenAt: number; lastSeenAt: number }>())
  const frameRef = useRef<{ lastFrameAtMs: number | null; visibleIds: string[]; hiddenCount: number }>({
    lastFrameAtMs: null,
    visibleIds: [],
    hiddenCount: 0,
  })

  useEffect(() => {
    if (runActive && delegated) {
      setSnippetMounted(true)
      return
    }
    if (!snippetMounted) return
    const id = window.setTimeout(() => setSnippetMounted(false), 420)
    return () => window.clearTimeout(id)
  }, [runActive, delegated, snippetMounted])

  const nowMs = nowMsOverride ?? Date.now()

  const nodeLedger = useMemo(() => {
    const seen = nodeSeenRef.current
    const activeIds = new Set<string>()
    for (const chip of traceChips) {
      activeIds.add(chip.id)
      const existing = seen.get(chip.id)
      if (existing) {
        existing.lastSeenAt = nowMs
      } else {
        seen.set(chip.id, { firstSeenAt: nowMs, lastSeenAt: nowMs })
      }
    }

    for (const [id, entry] of seen) {
      if (activeIds.has(id)) continue
      if (nowMs - entry.lastSeenAt > TRACE_NODE_TTL_MS * 4) seen.delete(id)
    }

    return traceChips.map((chip) => {
      const seenEntry = seen.get(chip.id) ?? { firstSeenAt: nowMs, lastSeenAt: nowMs }
      return {
        id: chip.id,
        chip,
        state: inferTraceNodeState(chip),
        category: inferTraceNodeCategory(chip),
        firstSeenAt: seenEntry.firstSeenAt,
        lastSeenAt: seenEntry.lastSeenAt,
      }
    })
  }, [traceChips, nowMs])

  const budget = useMemo(
    () =>
      applyTraceNodeBudget({
        nodes: nodeLedger,
        nowMs,
        maxNodes: MAX_TRACE_NODES,
        ttlMs: TRACE_NODE_TTL_MS,
        minFrameMs: TRACE_MIN_FRAME_MS,
        lastFrameAtMs: frameRef.current.lastFrameAtMs,
      }),
    [nodeLedger, nowMs]
  )

  const visibleNodes = useMemo(() => {
    if (!budget.throttled) return budget.visibleNodes
    if (frameRef.current.visibleIds.length === 0) return budget.visibleNodes
    const ids = new Set(frameRef.current.visibleIds)
    const throttledNodes = nodeLedger.filter((n) => ids.has(n.id))
    return throttledNodes.length > 0 ? throttledNodes : budget.visibleNodes
  }, [budget, nodeLedger])

  const budgetHiddenCount = budget.throttled ? frameRef.current.hiddenCount : budget.hiddenCount

  useEffect(() => {
    if (budget.throttled) return
    frameRef.current = {
      lastFrameAtMs: budget.nextFrameAtMs,
      visibleIds: budget.visibleNodes.map((n) => n.id),
      hiddenCount: budget.hiddenCount,
    }
  }, [budget])

  const liveSnippetLines = useMemo(() => {
    if (!delegated || !delegatedFullTraceText.trim()) return []
    const lines = delegatedFullTraceText.split(/\r?\n/).filter((l) => l.trim().length > 0)
    return lines.slice(-6)
  }, [delegated, delegatedFullTraceText])

  const showLiveSnippet = delegated && snippetMounted && liveSnippetLines.length > 0

  if (!showTraceSection) return null

  const visibleChips = visibleNodes.map((n) => n.chip)
  const collapsedRowChips = visibleChips.length > 0 ? visibleChips.slice(-3) : recentChips
  const totalHiddenCount = Math.max(hiddenChipCount, Math.max(0, traceChips.length - visibleChips.length), budgetHiddenCount)

  const hasRawTrace =
    (delegated && delegatedFullTraceText.trim().length > 0) ||
    (!delegated && Array.isArray(orchestratorToolLog) && orchestratorToolLog.length > 0)
  const canExpand = hasRawTrace || visibleChips.length > 1 || totalHiddenCount > 0
  const rawTraceLineCount = delegated
    ? delegatedFullTraceText.split(/\r?\n/).filter((l) => l.trim().length > 0).length
    : Array.isArray(orchestratorToolLog)
      ? orchestratorToolLog.length
      : 0
  const collapsedPreview = delegated
    ? liveSnippetLines.join('\n')
    : (orchestratorToolLog ?? []).slice(-2).join('\n')

  return (
    <div ref={containerRef} className="shrink-0 border-t border-tile-border bg-black/25 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={agentTileLabelClass}>Trace</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {collapsedRowChips.map((chip) => (
              <span
                key={chip.id}
                className={chipClassFor(chip)}
                data-tooltip={formatTraceChipLabel(chip)}
                data-testid="trace-chip"
              >
                <ChipBody chip={chip} animate={allowAnimation} />
              </span>
            ))}
            {totalHiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setTraceExpanded((v) => !v)}
                className="shrink-0 rounded border border-tile-border bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-300"
                data-tooltip={`${totalHiddenCount} earlier events (${budget.ttlCollapsedCount} stale, ${budget.capCollapsedCount} over cap) — expand trace`}
                aria-expanded={traceExpanded}
              >
                +{totalHiddenCount}
              </button>
            ) : null}
          </div>
        </div>
        {canExpand ? (
          <button
            type="button"
            onClick={() => setTraceExpanded((v) => !v)}
            className="shrink-0 rounded border border-tile-border bg-black/35 px-2 py-0.5 text-[10px] text-gray-400 hover:bg-tile-hover hover:text-gray-200"
            data-tooltip={traceExpanded ? 'Collapse trace' : 'Expand full trace'}
            aria-expanded={traceExpanded}
          >
            {traceExpanded ? 'Collapse' : 'Expand'} ({rawTraceLineCount || traceChips.length})
          </button>
        ) : null}
      </div>

      {showLiveSnippet ? (
        <div
          className={`mt-2 overflow-hidden rounded border border-tile-border/70 bg-black/35 transition-[opacity,max-height] duration-300 ease-out ${
            runActive ? 'opacity-100' : 'opacity-0'
          }`}
          aria-live="polite"
        >
          <div className={agentTileLabelClass + ' border-b border-tile-border/50 px-2 py-1 text-gray-500'}>
            Exploring
          </div>
          <div className="max-h-28 space-y-0.5 overflow-y-auto px-2 py-1.5 font-mono text-[10px] leading-snug">
            {liveSnippetLines.map((line, i) => {
              const isOlder = i < liveSnippetLines.length - 2
              return (
                <div
                  key={`${i}-${line.slice(0, 24)}`}
                  className={`whitespace-pre-wrap break-all ${isOlder ? 'text-gray-600' : 'text-gray-300'}`}
                >
                  {line}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {!traceExpanded && !showLiveSnippet && collapsedPreview ? (
        <p className="mt-2 line-clamp-2 font-mono text-[10px] leading-snug text-gray-500">{collapsedPreview}</p>
      ) : null}

      {traceExpanded ? (
        <div className="mt-2 space-y-2">
          {visibleChips.length > 0 ? (
            <div className="max-h-48 overflow-y-auto rounded border border-tile-border bg-black/30 px-2 py-1.5">
              <div className="flex flex-col gap-1">
                {visibleChips.map((chip) => (
                  <span
                    key={chip.id}
                    className={chipClassFor(chip) + ' w-full self-start sm:w-auto'}
                    data-tooltip={formatTraceChipLabel(chip)}
                    data-testid="trace-chip-expanded"
                  >
                    <ChipBody chip={chip} animate={allowAnimation} />
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {delegated && delegatedFullTraceText ? (
            <div className="max-h-48 overflow-auto rounded border border-tile-border bg-black/40 px-2 py-1.5 text-[10px] leading-snug text-gray-400">
              <div className={agentTileLabelClass + ' mb-1 text-gray-500'}>Sub-agent trace (full)</div>
              <div className="whitespace-pre-wrap break-words font-mono">{delegatedFullTraceText}</div>
            </div>
          ) : null}
          {!delegated && orchestratorToolLog && orchestratorToolLog.length > 0 ? (
            <div className="max-h-40 overflow-auto rounded border border-tile-border bg-black/40 px-2 py-1.5 text-[10px] leading-snug text-gray-400">
              <div className={agentTileLabelClass + ' mb-1 text-gray-500'}>Orchestrator trace (tools)</div>
              {orchestratorToolLog.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  {line}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

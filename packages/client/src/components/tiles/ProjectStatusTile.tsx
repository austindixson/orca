import { useMemo, useCallback } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { useBugBountyStore } from '../../store/bugBountyStore'
import { useTodoStore } from '../../store/todoStore'
import { useToastStore } from '../../store/toastStore'

type Rec = { id: string; label: string; detail: string }

/**
 * Aggregates inspect / bounty / console signals into a health score and actionable recommendations.
 */
export function ProjectStatusTile({ data }: TileComponentProps) {
  const bountyItems = useBugBountyStore((s) => s.items)
  const addTask = useTodoStore((s) => s.addTask)
  const addToast = useToastStore((s) => s.addToast)

  const metrics = useMemo(() => {
    const crit = bountyItems.filter((i) => i.severity === 'critical').length
    const high = bountyItems.filter((i) => i.severity === 'high').length
    const medium = bountyItems.filter((i) => i.severity === 'medium').length
    const low = bountyItems.filter((i) => i.severity === 'low').length
    const open = bountyItems.filter((i) =>
      ['queued', 'investigating', 'triaged', 'reproducing', 'fixing', 'validated'].includes(i.status)
    ).length
    return { crit, high, medium, low, open }
  }, [bountyItems])

  const health = useMemo(() => {
    let score = 10
    score -= Math.min(2, metrics.crit * 0.8 + metrics.high * 0.35)
    score -= Math.min(1.5, metrics.medium * 0.12 + metrics.low * 0.05)
    score -= Math.min(1.5, metrics.open * 0.06)
    return Math.max(0, Math.min(10, Math.round(score * 10) / 10))
  }, [metrics])

  const recommendations: Rec[] = useMemo(() => {
    const out: Rec[] = []
    let n = 1
    if (metrics.crit > 0 || metrics.high > 0 || metrics.medium > 0) {
      out.push({
        id: `r${n++}`,
        label: `Triage ${metrics.crit + metrics.high + metrics.medium} high-priority bounty item(s)`,
        detail: 'Assign top items and track verification notes.',
      })
    }
    if (bountyItems.length > 0) {
      out.push({
        id: `r${n++}`,
        label: `Review ${bountyItems.length} bug bounty item(s)`,
        detail: 'High-severity items were routed to the bounty queue.',
      })
    }
    if (metrics.open > 0) {
      out.push({
        id: `r${n++}`,
        label: `Close ${metrics.open} open bounty item(s)`,
        detail: 'Investigate, resolve, and mark statuses as completed.',
      })
    }
    if (out.length === 0) {
      out.push({
        id: 'r0',
        label: 'No major issues detected',
        detail: 'Keep shipping; re-check after the next deploy or heavy edit session.',
      })
    }
    return out.slice(0, 6)
  }, [metrics, bountyItems.length])

  const dispatchRec = useCallback(
    (rec: Rec) => {
      addTask(`[Project status] ${rec.label}`, 'user', 'pending')
      addToast({
        type: 'success',
        title: 'Task added',
        message: rec.detail,
      })
    },
    [addTask, addToast]
  )

  return (
    <div className="flex h-full flex-col bg-[#0f1118] text-gray-200">
      <div className="border-b border-white/10 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Project health</div>
        <div className="mt-1 flex items-end gap-2">
          <span className="text-3xl font-semibold text-accent-teal">{health.toFixed(1)}</span>
          <span className="pb-1 text-[11px] text-gray-500">/ 10</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-gray-400">
          <span>Critical: {metrics.crit}</span>
          <span>High: {metrics.high}</span>
          <span>Medium: {metrics.medium}</span>
          <span>Low: {metrics.low}</span>
          <span>Open bounty: {metrics.open}</span>
          <span>Bounty queue: {bountyItems.length}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Recommendations</div>
        <ol className="flex flex-col gap-2">
          {recommendations.map((rec, idx) => (
            <li
              key={rec.id}
              className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-[11px]"
            >
              <div className="flex gap-2">
                <span className="shrink-0 font-mono text-[10px] text-gray-500">{idx + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="text-gray-200">{rec.label}</div>
                  <div className="mt-0.5 text-[10px] text-gray-500">{rec.detail}</div>
                  <button
                    type="button"
                    className="mt-2 rounded border border-accent-teal/40 bg-accent-teal/10 px-2 py-0.5 text-[10px] text-accent-teal hover:bg-accent-teal/20"
                    onClick={() => dispatchRec(rec)}
                  >
                    Add task
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="border-t border-white/10 px-2 py-1 text-[9px] text-gray-600">
        Tile: {data.title}
      </div>
    </div>
  )
}

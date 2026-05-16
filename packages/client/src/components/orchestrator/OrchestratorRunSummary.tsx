import { useMemo } from 'react'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { useCanvasStore } from '../../store/canvasStore'

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return rs > 0 ? `${m}m ${rs}s` : `${m}m`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

function countToolInvocations(activityFeed: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const line of activityFeed) {
    const m = line.trimStart().match(/^→\s*([A-Za-z0-9_:-]+)/)
    if (m) {
      const name = m[1]
      counts[name] = (counts[name] ?? 0) + 1
    }
  }
  return counts
}

export function OrchestratorRunSummary() {
  const running = useOrchestratorActivityStore((s) => s.running)
  const writePreviews = useOrchestratorActivityStore((s) => s.writePreviewItems)
  const activityFeed = useOrchestratorActivityStore((s) => s.activityFeed)
  const totalTokens = useOrchestratorActivityStore((s) => s.runUsageTotalTokens)
  const runStartedAtMs = useOrchestratorActivityStore((s) => s.runStartedAtMs)
  const tiles = useCanvasStore((s) => s.tiles)

  const summary = useMemo(() => {
    if (running || writePreviews.length === 0) return null

    const doneWrites = writePreviews.filter((w) => w.done)
    const failedWrites = writePreviews.filter((w) => !w.done)
    const totalAdded = doneWrites.reduce((sum, w) => sum + w.added, 0)
    const totalRemoved = doneWrites.reduce((sum, w) => sum + w.removed, 0)
    const toolCounts = countToolInvocations(activityFeed)
    const duration = runStartedAtMs ? Date.now() - runStartedAtMs : 0

    // Count new tiles created during this run (tiles with generation matching)
    const tileCount = Array.from(tiles.values()).filter(
      (t) => t.meta?.source === 'orchestrator-auto'
    ).length

    return {
      filesWritten: doneWrites.length,
      filesFailed: failedWrites.length,
      totalAdded,
      totalRemoved,
      toolCounts,
      duration,
      totalTokens,
      tileCount,
      fileNames: doneWrites.map((w) => w.fileName),
    }
  }, [running, writePreviews, activityFeed, totalTokens, runStartedAtMs, tiles])

  if (!summary || summary.filesWritten === 0) return null

  const topTools = Object.entries(summary.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)

  return (
    <div className="mx-3 mb-3 rounded-xl border border-tile-border/60 bg-canvas-bg/70 px-4 py-3 backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-200">Run complete</span>
        <span className="text-[11px] text-gray-500">
          {formatDuration(summary.duration)} · {formatTokens(summary.totalTokens)} tok
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-gray-400">Files:</span>
          <span className="font-mono text-emerald-300">
            {summary.filesWritten} written (+{summary.totalAdded}/−{summary.totalRemoved})
          </span>
          {summary.filesFailed > 0 && (
            <span className="font-mono text-rose-300">{summary.filesFailed} failed</span>
          )}
        </div>

        {summary.fileNames.length <= 6 && (
          <div className="flex flex-wrap gap-1">
            {summary.fileNames.map((name) => (
              <span
                key={name}
                className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-gray-400"
              >
                {name}
              </span>
            ))}
          </div>
        )}

        {topTools.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
            <span className="text-gray-600">Tools:</span>
            {topTools.map(([name, count]) => (
              <span key={name} className="font-mono">
                {name} ×{count}
              </span>
            ))}
          </div>
        )}

        {summary.tileCount > 0 && (
          <div className="text-[10px] text-gray-500">
            <span className="text-gray-600">Tiles: </span>
            <span className="text-gray-400">{summary.tileCount} on canvas</span>
          </div>
        )}
      </div>
    </div>
  )
}

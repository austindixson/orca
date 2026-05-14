import { useMemo } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { isTauri, openWorkspaceRelativePath } from '../../lib/tauri'

function parseResults(meta: Record<string, unknown>): unknown {
  if (meta.benchmarkResults != null) return meta.benchmarkResults
  if (typeof meta.resultsJson === 'string') {
    try {
      return JSON.parse(meta.resultsJson) as unknown
    } catch {
      return meta.resultsJson
    }
  }
  if (meta.results != null) return meta.results
  return null
}

/** Canvas module for Criterion / custom JSON benchmark output (orchestrator `record_benchmark_session`). */
export function BenchmarkTile({ data }: TileComponentProps) {
  const summary = typeof data.meta?.summary === 'string' ? data.meta.summary : ''
  const reportRel =
    typeof data.meta?.reportRelativePath === 'string' ? data.meta.reportRelativePath.trim() : ''
  const results = useMemo(() => parseResults(data.meta ?? {}), [data.meta])

  const rows = useMemo(() => {
    if (results == null) return null
    if (Array.isArray(results)) {
      return results.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
    }
    if (typeof results === 'object' && results !== null) {
      const o = results as Record<string, unknown>
      if (Array.isArray(o.benchmarks)) {
        return o.benchmarks.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
      }
    }
    return null
  }, [results])

  const openReport = () => {
    if (!reportRel || !isTauri()) return
    void openWorkspaceRelativePath(reportRel)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-bg">
      <div className="shrink-0 border-b border-tile-border px-3 py-2">
        <p className="text-[11px] uppercase tracking-wide text-gray-500">Benchmark results</p>
        {summary ? (
          <p className="mt-1 text-sm text-gray-200 leading-snug">{summary}</p>
        ) : (
          <p className="mt-1 text-xs text-gray-600">No summary — see JSON below.</p>
        )}
        {reportRel ? (
          <button
            type="button"
            onClick={openReport}
            className="mt-2 rounded-md border border-accent-teal/45 bg-accent-teal/10 px-2 py-1 text-[11px] text-accent-teal hover:bg-accent-teal/20"
          >
            Open HTML report (system browser)
          </button>
        ) : null}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3 font-mono text-[11px] text-gray-300">
        {rows && rows.length > 0 ? (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-tile-border text-gray-500">
                <th className="py-1 pr-2">Case</th>
                <th className="py-1 pr-2">Value</th>
                <th className="py-1">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-tile-border/40">
                  <td className="py-1 pr-2 align-top text-accent-teal/90">
                    {String(r.name ?? r.id ?? r.benchmark ?? i)}
                  </td>
                  <td className="py-1 pr-2 align-top">
                    {r.mean != null
                      ? String(r.mean)
                      : r.time != null
                        ? String(r.time)
                        : r.value != null
                          ? String(r.value)
                          : '—'}
                  </td>
                  <td className="py-1 align-top text-gray-500">
                    {typeof r.unit === 'string' ? r.unit : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="whitespace-pre-wrap break-words text-gray-400">
            {results == null ? 'No results yet. Orchestrator should call record_benchmark_session.' : JSON.stringify(results, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { useTestRunStore } from '../../store/testRunStore'

export function TestsSidebarPanel() {
  const runs = useTestRunStore((s) => s.runs)
  const clearRuns = useTestRunStore((s) => s.clearRuns)

  const summary = useMemo(() => {
    let pass = 0
    let fail = 0
    for (const r of runs) {
      pass += r.pass.length
      fail += r.fail.length
    }
    return { pass, fail, runs: runs.length }
  }, [runs])

  return (
    <div className="flex h-full min-h-0 flex-col bg-tile-bg/60 text-gray-300 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-tile-border/80 px-3 py-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Tests</div>
          <div className="text-xs text-gray-400">
            {summary.runs} run{summary.runs === 1 ? '' : 's'} · {summary.pass} passed · {summary.fail} failed
          </div>
        </div>
        {runs.length > 0 && (
          <button
            type="button"
            onClick={() => clearRuns()}
            className="text-[10px] uppercase tracking-wide text-gray-500 hover:text-gray-300"
          >
            Clear
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {runs.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-gray-500">
            Run <code className="text-gray-400">npm test</code>, Vitest, or Jest in a terminal tile. Pass/fail lines
            appear here for this session.
          </p>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <li
                key={r.id}
                className="rounded border border-tile-border/80 bg-black/20 px-2 py-1.5 text-xs"
              >
                <div className="font-medium text-gray-200">{r.title}</div>
                <div className="mt-0.5 text-[10px] text-gray-500">
                  {r.pass.length} passed · {r.fail.length} failed
                  {r.exitCode !== undefined ? ` · exit ${r.exitCode}` : ''}
                </div>
                {r.fail.length > 0 && (
                  <ul className="mt-1 max-h-24 list-inside list-disc overflow-y-auto text-red-300/90">
                    {r.fail.slice(-8).map((f, i) => (
                      <li key={`${r.id}-fail-${i}`} className="truncate">
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

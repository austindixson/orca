import { useCallback, useState } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { useToolboxSessionStore } from '../../store/toolboxSessionStore'
import { isTauri, openWorkspaceRelativePath } from '../../lib/tauri'
import clsx from 'clsx'

type TabId = 'history' | 'skills' | 'hints'

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour12: false })
  } catch {
    return '—'
  }
}

export function ToolboxTile(_props: TileComponentProps) {
  const [tab, setTab] = useState<TabId>('history')
  const events = useToolboxSessionStore((s) => s.events)
  const skills = useToolboxSessionStore((s) => s.skills)
  const hints = useToolboxSessionStore((s) => s.learningHints)
  const clear = useToolboxSessionStore((s) => s.clear)
  const dismissLearning = useToolboxSessionStore((s) => s.dismissLearning)

  const openPath = useCallback((rel: string) => {
    if (!isTauri()) return
    void openWorkspaceRelativePath(rel)
  }, [])

  const tabBtn = (id: TabId, label: string, count: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={clsx(
        'rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition',
        tab === id
          ? 'bg-accent-teal/20 text-accent-teal'
          : 'text-gray-500 hover:bg-black/30 hover:text-gray-300'
      )}
    >
      {label}
      <span className="ml-1 text-gray-600">({count})</span>
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-bg">
      <div className="shrink-0 border-b border-tile-border px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Toolbox</p>
            <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
              Orchestrator tool runs and <span className="text-accent-teal/90">create_project_skill</span> installs.
              When a tool fails then succeeds, capture the working recipe as a skill for the next run.
            </p>
          </div>
          <button
            type="button"
            onClick={() => clear()}
            className="shrink-0 rounded border border-tile-border/80 px-2 py-0.5 text-[10px] text-gray-500 hover:border-rose-500/40 hover:text-rose-200"
          >
            Clear all
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {tabBtn('history', 'History', events.length)}
          {tabBtn('skills', 'Skills', skills.length)}
          {tabBtn('hints', 'Hints', hints.length)}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tab === 'history' && (
          <ul className="space-y-2">
            {events.length === 0 ? (
              <li className="rounded-lg border border-dashed border-tile-border px-3 py-6 text-center text-xs text-gray-600">
                No tool calls recorded yet. History fills as the orchestrator runs tools (main agent and sub-agents).
              </li>
            ) : (
              events.map((ev) => (
                <li
                  key={ev.id}
                  className="rounded-lg border border-tile-border/80 bg-black/20 px-2.5 py-2 text-[11px] leading-snug"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={clsx(
                        'rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                        ev.ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'
                      )}
                    >
                      {ev.ok ? 'ok' : 'err'}
                    </span>
                    <span className="font-mono text-accent-teal/90">{ev.tool}</span>
                    <span className="text-[10px] text-gray-600">{fmtTime(ev.ts)}</span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-gray-500 break-all">{ev.argsPreview}</div>
                  <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-black/35 p-1.5 font-mono text-[10px] text-gray-400">
                    {ev.resultPreview}
                  </pre>
                </li>
              ))
            )}
          </ul>
        )}

        {tab === 'skills' && (
          <ul className="space-y-2">
            {skills.length === 0 ? (
              <li className="rounded-lg border border-dashed border-tile-border px-3 py-6 text-center text-xs text-gray-600">
                No skills yet. When the orchestrator calls{' '}
                <code className="text-accent-teal/80">create_project_skill</code>, entries appear here with paths to{' '}
                <code className="text-gray-500">SKILL.md</code>.
              </li>
            ) : (
              skills.map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2 text-[11px] leading-snug"
                >
                  <div className="font-medium text-emerald-100/95">{s.title}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-emerald-300/90">{s.slashCommand}</div>
                  {s.description ? (
                    <p className="mt-1 text-[10px] text-gray-400">{s.description}</p>
                  ) : null}
                  <ul className="mt-2 space-y-1">
                    {s.paths.map((p) => (
                      <li key={p}>
                        <button
                          type="button"
                          onClick={() => openPath(p)}
                          className="text-left font-mono text-[10px] text-sky-300/90 underline decoration-sky-500/40 hover:text-sky-200"
                        >
                          {p}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))
            )}
          </ul>
        )}

        {tab === 'hints' && (
          <ul className="space-y-2">
            {hints.length === 0 ? (
              <li className="rounded-lg border border-dashed border-tile-border px-3 py-6 text-center text-xs text-gray-600">
                No recovery hints. When the **same** tool fails once then succeeds on the next try, a hint appears
                suggesting you codify the fix with <code className="text-accent-teal/80">create_project_skill</code>.
              </li>
            ) : (
              hints.map((h) => (
                <li
                  key={h.id}
                  className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-50/95"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{h.title}</div>
                    <button
                      type="button"
                      onClick={() => dismissLearning(h.id)}
                      className="shrink-0 text-[10px] text-gray-500 hover:text-gray-300"
                    >
                      Dismiss
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-amber-100/85">{h.detail}</p>
                  <p className="mt-1 font-mono text-[9px] text-gray-600">{fmtTime(h.ts)}</p>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

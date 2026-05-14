import type { AgentTaskEntry } from '../../../store/agentTaskStore'
import { agentTileLabelClass, chipClass } from './styles'

type Props = {
  tasksExpanded: boolean
  setTasksExpanded: (v: boolean | ((p: boolean) => boolean)) => void
  agentTasks: AgentTaskEntry[]
  currentTaskEntry: AgentTaskEntry | undefined
}

export function AgentHistoryDrawer({
  tasksExpanded,
  setTasksExpanded,
  agentTasks,
  currentTaskEntry,
}: Props) {
  if (agentTasks.length === 0 && !currentTaskEntry) return null

  return (
    <div className="shrink-0 border-t border-tile-border bg-black/25 px-3 py-2">
      <button
        type="button"
        onClick={() => setTasksExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={tasksExpanded}
        data-tooltip={tasksExpanded ? 'Collapse history' : 'Expand history'}
      >
        <div className={agentTileLabelClass}>History</div>
        {currentTaskEntry ? (
          <span
            className={
              currentTaskEntry.status === 'running'
                ? chipClass('teal') + ' max-w-[260px] py-0'
                : currentTaskEntry.status === 'done'
                  ? chipClass('emerald') + ' max-w-[260px] py-0'
                  : currentTaskEntry.status === 'cancelled'
                    ? chipClass('amber') + ' max-w-[260px] py-0'
                    : chipClass('rose') + ' max-w-[260px] py-0'
            }
            data-tooltip={currentTaskEntry.text}
          >
            <span className="opacity-80">
              {currentTaskEntry.status === 'running'
                ? '▶'
                : currentTaskEntry.status === 'done'
                  ? '✓'
                  : currentTaskEntry.status === 'cancelled'
                    ? '■'
                    : '✖'}
            </span>
            <span className="truncate">{currentTaskEntry.text}</span>
            {currentTaskEntry.issues.error + currentTaskEntry.issues.fail > 0 ? (
              <span
                className="ml-1 rounded border border-rose-500/40 bg-rose-500/10 px-1 py-0.5 text-[9px] font-semibold text-rose-200"
                data-tooltip={`${currentTaskEntry.issues.error} errors · ${currentTaskEntry.issues.fail} fails`}
              >
                {currentTaskEntry.issues.error + currentTaskEntry.issues.fail}✖
              </span>
            ) : null}
            {currentTaskEntry.issues.warning > 0 ? (
              <span
                className="ml-1 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] font-semibold text-amber-200"
                data-tooltip={`${currentTaskEntry.issues.warning} warnings`}
              >
                {currentTaskEntry.issues.warning}!
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="ml-auto text-[10px] text-gray-500">
          {agentTasks.length} task{agentTasks.length === 1 ? '' : 's'}
        </span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${tasksExpanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {tasksExpanded ? (
        <div className="mt-2 max-h-40 space-y-1 overflow-auto rounded border border-tile-border bg-black/40 px-2 py-1.5">
          {agentTasks
            .slice()
            .reverse()
            .map((t) => (
              <div key={t.id} className="flex items-start gap-2 text-[11px] leading-snug">
                <span
                  className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                    t.status === 'running'
                      ? 'bg-accent-teal shadow-[0_0_6px_rgba(var(--accent-teal-rgb),0.7)]'
                      : t.status === 'done'
                        ? 'bg-emerald-400'
                        : t.status === 'cancelled'
                          ? 'bg-amber-400'
                          : 'bg-red-500'
                  }`}
                  data-tooltip={t.status}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-gray-200" data-tooltip={t.text}>
                    {t.text}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-wider text-gray-500">
                    <span>{t.source}</span>
                    <span>·</span>
                    <span>{new Date(t.startedAt).toLocaleTimeString()}</span>
                    {t.issues.error > 0 ? <span className="text-red-300">{t.issues.error} err</span> : null}
                    {t.issues.fail > 0 ? <span className="text-red-300">{t.issues.fail} fail</span> : null}
                    {t.issues.warning > 0 ? <span className="text-amber-300">{t.issues.warning} warn</span> : null}
                    {t.errorMessage ? (
                      <span className="truncate text-red-300" data-tooltip={t.errorMessage}>
                        {t.errorMessage}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  )
}

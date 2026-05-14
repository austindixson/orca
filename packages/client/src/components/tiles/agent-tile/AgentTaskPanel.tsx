import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAgentSubtaskStore } from '../../../store/agentSubtaskStore'
import { useTodoStore } from '../../../store/todoStore'
import { detectCompletedSubtasks, parseSubtasks } from '../../../lib/orchestrator/parseSubtasks'
import { agentTileLabelClass, agentTilePanelClass, agentTileTealStripeClass } from './styles'

type Props = {
  tileId: string
  taskPanelText: string
  taskPanelRole: string
  delegated: boolean
  /** Full log/output text used for the auto-check heuristic. Optional. */
  logText?: string
  /** Current delegated run status (drives in-progress highlight; completion is evidence-driven only). */
  runStatus?: 'idle' | 'working' | 'done' | 'error' | 'needs_review'
}

/** Split task text into a one-line title + the remaining detail block (e.g. "Subtasks:\n..."). */
function splitTaskText(text: string): { title: string; rest: string } {
  if (!text) return { title: '', rest: '' }
  const trimmed = text.replace(/^\s+/, '')
  const nlIdx = trimmed.indexOf('\n')
  if (nlIdx === -1) return { title: trimmed, rest: '' }
  return {
    title: trimmed.slice(0, nlIdx).trim(),
    rest: trimmed.slice(nlIdx + 1).trim(),
  }
}

const MAX_COMPACT_LEN = 52

function truncateOneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + '…'
}

/** Ring + optional check — progress = completedCount / total (0–1). */
function TaskProgressGlyph({
  completedCount,
  total,
  runStatus,
  active,
}: {
  completedCount: number
  total: number
  runStatus?: 'idle' | 'working' | 'done' | 'error' | 'needs_review'
  active: boolean
}) {
  const size = 18
  const stroke = 2
  const r = (size - stroke) / 2
  const c = size / 2
  const circumference = 2 * Math.PI * r
  const frac = total > 0 ? Math.min(1, completedCount / total) : 0
  const dashOffset = circumference * (1 - frac)
  const allDone = total > 0 && completedCount >= total

  if (allDone) {
    return (
      <span
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-emerald-400/70 bg-emerald-500/20 text-emerald-200"
        aria-hidden
      >
        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }

  return (
    <span className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center" aria-hidden>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          className="text-gray-700"
          stroke="currentColor"
          strokeWidth={stroke}
        />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          className={
            active && (runStatus === 'working' || runStatus === 'needs_review')
              ? runStatus === 'needs_review'
                ? 'text-violet-400/85'
                : 'text-cyan-400/90'
              : 'text-emerald-500/75'
          }
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.35s ease' }}
        />
      </svg>
      {active && runStatus === 'working' ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-1 w-1 rounded-full bg-cyan-300/90" />
        </span>
      ) : null}
      {active && runStatus === 'needs_review' ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[8px] font-bold text-violet-200">
          ?
        </span>
      ) : null}
    </span>
  )
}

export function AgentTaskPanel({
  tileId,
  taskPanelText,
  taskPanelRole,
  delegated,
  logText,
  runStatus,
}: Props) {
  const { title, rest } = useMemo(() => splitTaskText(taskPanelText), [taskPanelText])

  /** Ordered bullet list parsed from the delegated task's subtasks block. */
  const parsedSubtasks = useMemo(() => (delegated ? parseSubtasks(rest) : []), [delegated, rest])
  const hasChecklist = parsedSubtasks.length > 0

  const syncSubtasks = useAgentSubtaskStore((s) => s.syncSubtasks)
  const applyAutoDone = useAgentSubtaskStore((s) => s.applyAutoDone)
  const toggle = useAgentSubtaskStore((s) => s.toggle)
  const items = useAgentSubtaskStore(useShallow((s) => s.byTileId[tileId] ?? []))

  /** Keep store in sync with the parsed list (only rebuilds when texts change). */
  useEffect(() => {
    if (!delegated) return
    syncSubtasks(tileId, parsedSubtasks)
  }, [delegated, tileId, parsedSubtasks, syncSubtasks])

  /** Heuristic auto-check from the log tail — progressive, never unchecks. */
  useEffect(() => {
    if (!delegated || !hasChecklist) return
    const text = logText ?? ''
    if (!text) return
    const flags = detectCompletedSubtasks(parsedSubtasks, text)
    if (flags.some(Boolean)) applyAutoDone(tileId, flags)
  }, [delegated, hasChecklist, parsedSubtasks, logText, tileId, applyAutoDone])

  /**
   * Global Todo hygiene: agent checklist rows are view-local state and should never
   * appear as standalone global tasks.
   */
  useEffect(() => {
    const todo = useTodoStore.getState()
    const toRemove = todo.tasks
      .filter((t) => t.source === 'orchestrator' && t.text.startsWith('[Agent subtask] '))
      .map((t) => t.id)
    if (toRemove.length === 0) return
    for (const id of toRemove) todo.removeTask(id)
  }, [])

  /** Collapse toggle for the prose-only detail block (non-checklist rest text). */
  const [restExpanded, setRestExpanded] = useState(false)
  /** Delegated checklist: default collapsed (compact row + expand). */
  const [taskChecklistExpanded, setTaskChecklistExpanded] = useState(false)

  const hasRest = rest.length > 0
  const completedCount = items.filter((it) => it.done).length
  const total = items.length
  /**
   * Index of the subtask currently considered "in progress": first not-done
   * item while the delegated run is actively working. `-1` when nothing is
   * running (idle/done/error) or all items are complete.
   */
  const activeIdx =
    delegated && runStatus === 'working' ? items.findIndex((it) => !it.done) : -1

  const firstIncompleteIdx = items.findIndex((it) => !it.done)
  /** 1-based step for compact row (e.g. 1/4 = first of four). All complete => total/total. */
  const stepOneBased = useMemo(() => {
    if (total === 0) return 0
    if (firstIncompleteIdx === -1) return total
    return firstIncompleteIdx + 1
  }, [total, firstIncompleteIdx])

  const compactTaskLabel = useMemo(() => {
    if (!delegated || !hasChecklist || items.length === 0) {
      return title || taskPanelText
    }
    if (activeIdx >= 0 && items[activeIdx]) {
      return truncateOneLine(items[activeIdx].text, MAX_COMPACT_LEN)
    }
    const next = items.find((it) => !it.done)
    if (next) return truncateOneLine(next.text, MAX_COMPACT_LEN)
    return truncateOneLine(title || taskPanelText, MAX_COMPACT_LEN)
  }, [delegated, hasChecklist, items, activeIdx, title, taskPanelText])

  const showCompactChecklistRow = delegated && hasChecklist

  if (!taskPanelText && !taskPanelRole) return null

  return (
    <div
      className={`relative flex min-h-0 flex-1 basis-0 flex-col overflow-hidden border-b border-tile-border px-3 py-2 pl-4 ${agentTilePanelClass} ${agentTileTealStripeClass}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className={agentTileLabelClass + ' text-gray-400'}>{delegated ? 'Task' : 'Last prompt'}</div>
        {taskPanelRole ? (
          <div className="truncate text-[10px] font-medium text-cyan-200/90" data-tooltip={taskPanelRole}>
            {taskPanelRole}
          </div>
        ) : null}
      </div>

      {showCompactChecklistRow ? (
        <button
          type="button"
          onClick={() => setTaskChecklistExpanded((e) => !e)}
          className="mt-2 flex w-full shrink-0 items-center gap-2 rounded-md border border-tile-border bg-black/35 px-2.5 py-2 text-left transition-colors hover:bg-black/45"
          aria-expanded={taskChecklistExpanded}
          data-tooltip={taskChecklistExpanded ? 'Collapse task list' : 'Expand task list'}
        >
          <TaskProgressGlyph
            completedCount={completedCount}
            total={total}
            runStatus={runStatus}
            active={activeIdx >= 0}
          />
          <span
            className="min-w-0 flex-1 truncate text-[12px] leading-snug text-gray-200"
            data-tooltip={compactTaskLabel}
          >
            {compactTaskLabel}
          </span>
          <span className="shrink-0 tabular-nums text-[11px] font-semibold text-gray-300">
            {stepOneBased}/{total}
          </span>
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${taskChecklistExpanded ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <div className="mt-1 flex shrink-0 items-center justify-between gap-2">
          <div
            className="min-w-0 flex-1 truncate text-[12px] leading-snug text-gray-200"
            data-tooltip={title || taskPanelText}
          >
            {title || taskPanelText}
          </div>
          {hasRest ? (
            <button
              type="button"
              onClick={() => setRestExpanded((e) => !e)}
              className="shrink-0 rounded border border-tile-border bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-300"
              aria-expanded={restExpanded}
              data-tooltip={restExpanded ? 'Hide subtasks' : 'Show subtasks'}
            >
              Subtasks
            </button>
          ) : null}
        </div>
      )}

      {delegated && hasChecklist && taskChecklistExpanded ? (
        <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto border-t border-tile-border/60 pt-2">
          {items.map((item, idx) => {
            const isActive = idx === activeIdx
            return (
              <li
                key={idx}
                className={`flex items-start gap-2 text-[11px] leading-snug ${
                  isActive ? '-mx-1 rounded-sm bg-cyan-500/5 px-1' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(tileId, idx)}
                  role="checkbox"
                  aria-checked={item.done}
                  aria-label={item.done ? `Mark "${item.text}" as not done` : `Mark "${item.text}" as done`}
                  className={`mt-[2px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                    item.done
                      ? 'border-emerald-400/70 bg-emerald-500/25 text-emerald-200'
                      : isActive
                        ? 'border-cyan-400/70 bg-cyan-500/10 text-transparent hover:bg-cyan-500/20'
                        : 'border-tile-border bg-black/40 text-transparent hover:border-cyan-400/60 hover:bg-cyan-500/10'
                  }`}
                >
                  <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <span
                  className={`min-w-0 flex-1 ${
                    item.done
                      ? 'text-gray-500 line-through decoration-gray-600'
                      : isActive
                        ? 'text-cyan-100'
                        : 'text-gray-200'
                  }`}
                  data-tooltip={item.text}
                >
                  {item.text}
                </span>
                {isActive ? (
                  <span
                    className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-400/50 bg-cyan-500/15 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-cyan-100"
                    data-tooltip="This task is currently running"
                    aria-label="In progress"
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="relative h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_7px_rgba(103,232,249,0.85)]" />
                    </span>
                    Running
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {hasRest && restExpanded && !showCompactChecklistRow ? (
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words border-t border-tile-border/60 pt-2 text-[11px] leading-snug text-gray-300">
          {rest}
        </div>
      ) : null}
    </div>
  )
}

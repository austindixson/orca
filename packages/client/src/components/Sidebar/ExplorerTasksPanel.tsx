import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useTodoStore, type TodoStatus, type TodoTask } from '../../store/todoStore'
import { AgentTaskIndicator } from '../tasks/AgentTaskIndicator'
import { ExpandableText } from '../common/ExpandableText'

export type ExplorerTasksPanelVariant = 'split' | 'full'

interface ExplorerTasksPanelProps {
  /** split = shared with file tree (flex); full = tasks tab / full sidebar height */
  variant?: ExplorerTasksPanelVariant
}

const LEGACY_PHASE_ORDER = ['backend', 'frontend', 'integration'] as const

type DisplayRow =
  | { kind: 'header'; title: string; subtitle?: string }
  | { kind: 'row'; todo: TodoTask }

function buildDisplayRows(tasks: TodoTask[]): DisplayRow[] {
  const sorted = [...tasks].sort((a, b) => {
    const wA = a.waveNumber ?? 10_000
    const wB = b.waveNumber ?? 10_000
    if (wA !== wB) return wA - wB
    const iA = a.phaseTag ? LEGACY_PHASE_ORDER.indexOf(a.phaseTag as (typeof LEGACY_PHASE_ORDER)[number]) : -1
    const iB = b.phaseTag ? LEGACY_PHASE_ORDER.indexOf(b.phaseTag as (typeof LEGACY_PHASE_ORDER)[number]) : -1
    const pA = iA >= 0 ? iA : 100
    const pB = iB >= 0 ? iB : 100
    if (pA !== pB) return pA - pB
    const weight = (s: TodoStatus) =>
      s === 'in_progress' ? 0 : s === 'pending' ? 1 : s === 'completed' ? 2 : 3
    return weight(a.status) - weight(b.status) || a.createdAt - b.createdAt
  })

  const rows: DisplayRow[] = []
  let lastSection = ''

  for (const todo of sorted) {
    const section =
      todo.waveNumber != null
        ? `wave:${todo.waveNumber}`
        : todo.phaseTag
          ? `phase:${todo.phaseTag}`
          : 'rest'

    if (section !== lastSection) {
      lastSection = section
      if (todo.waveNumber != null) {
        const inWave = sorted.filter((t) => t.waveNumber === todo.waveNumber).length
        rows.push({
          kind: 'header',
          title: `Wave ${todo.waveNumber}`,
          subtitle: `${inWave} task${inWave === 1 ? '' : 's'} · parallel-eligible batch`,
        })
      } else if (todo.phaseTag) {
        rows.push({
          kind: 'header',
          title: `${todo.phaseTag}`,
          subtitle: 'Legacy 1-shot phase',
        })
      } else {
        rows.push({ kind: 'header', title: 'Tasks' })
      }
    }
    rows.push({ kind: 'row', todo })
  }

  return rows
}

/**
 * Task list for the left sidebar. Shares state with the canvas Todo tile via todoStore.
 */
export function ExplorerTasksPanel({ variant = 'split' }: ExplorerTasksPanelProps) {
  const isFull = variant === 'full'
  const [newTodo, setNewTodo] = useState('')
  const tasks = useTodoStore((s) => s.tasks)
  const addTask = useTodoStore((s) => s.addTask)
  const setTaskStatus = useTodoStore((s) => s.setTaskStatus)
  const removeTask = useTodoStore((s) => s.removeTask)

  const displayRows = useMemo(() => buildDisplayRows(tasks), [tasks])

  const pending = useMemo(() => tasks.filter((t) => t.status === 'pending').length, [tasks])
  const active = useMemo(() => tasks.filter((t) => t.status === 'in_progress').length, [tasks])
  const done = useMemo(() => tasks.filter((t) => t.status === 'completed').length, [tasks])

  const cycleStatus = (id: string, current: TodoStatus) => {
    const next: TodoStatus =
      current === 'pending'
        ? 'in_progress'
        : current === 'in_progress'
          ? 'completed'
          : current === 'completed'
            ? 'pending'
            : 'pending'
    setTaskStatus(id, next)
  }

  const addTodo = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTodo.trim()) return
    addTask(newTodo, 'user', 'pending')
    setNewTodo('')
  }

  return (
    <div
      className={clsx(
        'flex flex-col min-h-0 bg-tile-bg/60 backdrop-blur-xl',
        isFull
          ? 'h-full flex-1 border-t border-tile-border/80'
          : 'flex-1 shrink-0 min-h-0 overflow-hidden border-t border-tile-border/80'
      )}
    >
      <div
        className={clsx(
          'flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 shrink-0',
          isFull && 'py-2 border-b border-tile-border/80 bg-tile-header/50'
        )}
      >
        <span>Tasks</span>
        <span className="text-[9px] font-normal normal-case text-gray-500">
          {tasks.length} total · {pending + active} open · {done} completed
        </span>
      </div>
      <form onSubmit={addTodo} className="px-2 pb-1.5 shrink-0">
        <input
          type="text"
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          placeholder="Add task…"
          className="w-full px-2 py-1 text-xs rounded bg-black/25 border border-tile-border/80 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal/80"
        />
      </form>
      <div className={clsx('flex-1 min-h-0 overflow-y-auto px-1 pb-2', isFull && 'min-h-[8rem]')}>
        {displayRows.length === 0 ? (
          <p className="px-2 py-1 text-[11px] text-gray-600">No tasks yet</p>
        ) : (
          displayRows.map((row, idx) => {
            if (row.kind === 'header') {
              return (
                <div
                  key={`h-${idx}-${row.title}`}
                  className="px-2 pt-2 pb-0.5 text-[9px] uppercase tracking-wide text-gray-500 border-t border-tile-border/40 first:border-t-0 first:pt-1"
                >
                  <div className="font-semibold text-gray-400">{row.title}</div>
                  {row.subtitle ? (
                    <div className="normal-case text-[8px] text-gray-600 mt-0.5">{row.subtitle}</div>
                  ) : null}
                </div>
              )
            }

            const todo = row.todo
            const isSubtask = Boolean(todo.parentId)
            const metaBits = [
              todo.category ?? todo.phaseTag,
              todo.difficulty,
              typeof todo.weight === 'number' ? `w${todo.weight}` : null,
            ].filter(Boolean)
            const metaLine = metaBits.length > 0 ? metaBits.join(' · ') : null
            const depsLine =
              todo.dependsOn && todo.dependsOn.length > 0
                ? `deps: ${todo.dependsOn.join(', ')}`
                : null

            const statusGlyph =
              todo.status === 'completed'
                ? '●'
                : todo.status === 'in_progress'
                  ? '◐'
                  : todo.status === 'cancelled'
                    ? '✕'
                    : todo.status === 'failed'
                      ? '!'
                      : '○'
            const statusColor =
              todo.status === 'completed'
                ? 'text-accent-teal'
                : todo.status === 'in_progress'
                  ? 'text-amber-300'
                  : todo.status === 'cancelled'
                    ? 'text-red-400'
                    : todo.status === 'failed'
                      ? 'text-red-300'
                      : 'text-gray-500'

            return (
              <div
                key={todo.id}
                className="group flex flex-col gap-1 px-1 py-1 rounded hover:bg-tile-hover/80"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => cycleStatus(todo.id, todo.status)}
                    className={clsx(
                      'shrink-0 w-5 h-5 rounded border border-tile-border/60 flex items-center justify-center text-[10px]',
                      statusColor
                    )}
                    data-tooltip={todo.status}
                  >
                    {statusGlyph}
                  </button>
                  {todo.source === 'orchestrator' ? (
                    <AgentTaskIndicator
                      compact
                      status={todo.status}
                      agentName={todo.assignedAgentName}
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeTask(todo.id)}
                    className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 text-[10px] text-gray-500 hover:text-red-400 px-0.5"
                    data-tooltip="Remove"
                  >
                    ×
                  </button>
                </div>
                <div
                  className={clsx(
                    'w-full min-w-0 pl-0',
                    isSubtask && 'ml-2 border-l border-tile-border/50 pl-2'
                  )}
                >
                  {metaLine ? (
                    <span className="mb-0.5 block text-[9px] uppercase tracking-wide text-gray-600">
                      {metaLine}
                      {typeof todo.predictedToolCalls === 'number' ? (
                        <span className="ml-1 normal-case text-gray-500">
                          (~{todo.predictedToolCalls} tools)
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  {depsLine ? (
                    <span className="mb-0.5 block text-[9px] text-gray-500 font-mono">{depsLine}</span>
                  ) : null}
                  <ExpandableText
                    text={todo.text}
                    maxChars={220}
                    className={clsx(
                      'w-full text-[11px] leading-snug text-gray-300',
                      todo.status === 'completed' && 'line-through text-gray-500'
                    )}
                    buttonClassName="underline-offset-2 hover:underline"
                    moreLabel="Read more"
                    lessLabel="Show less"
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

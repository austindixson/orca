import clsx from 'clsx'
import type { TodoStatus } from '../../store/todoStore'

/** Shows when a task was created by the orchestrator agent (`source === 'orchestrator'`). */
export function AgentTaskIndicator({
  compact,
  status,
  agentName,
}: {
  compact?: boolean
  status?: TodoStatus
  /** Model or sub-agent display name while this task is actively assigned. */
  agentName?: string
}) {
  const active = status === 'in_progress'
  const trimmedName = agentName?.trim()
  const displayText = trimmedName ?? (compact ? '' : 'Agent')
  const title = trimmedName
    ? `${trimmedName} · ${status ?? 'orchestrator'}`
    : active
      ? 'In progress · orchestrator'
      : 'Assigned to orchestrator agent'

  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-0.5 rounded border font-medium max-w-full min-w-0',
        active
          ? 'border-amber-400/65 bg-amber-500/18 text-amber-100 shadow-[0_0_10px_rgba(251,191,36,0.18)]'
          : 'border-accent-teal/45 bg-accent-teal/12 text-accent-teal',
        compact ? 'px-1 py-px text-[8px] uppercase tracking-wide' : 'px-1.5 py-0.5 text-[9px]',
        active && 'shadow-[0_0_8px_rgba(56,189,248,0.55)]'
      )}
      data-tooltip={title}
    >
      <svg
        className={clsx(compact ? 'h-2.5 w-2.5' : 'h-3 w-3', 'shrink-0')}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
      >
        <rect x="5" y="9" width="14" height="10" rx="2" />
        <path d="M9 9V7a3 3 0 0 1 6 0v2" />
        <circle cx="9.5" cy="14" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="14" r="1" fill="currentColor" stroke="none" />
      </svg>
      {displayText ? (
        <span className={clsx('truncate', compact && 'normal-case tracking-normal max-w-[7rem]')}>
          {displayText}
        </span>
      ) : null}
    </span>
  )
}

import { useEffect, useRef, type DragEvent } from 'react'
import type { ImageAttachment } from '../../../lib/imageAttachments'

type Props = {
  task: string
  onTaskChange: (v: string) => void
  onSubmit: () => void
  onStop: () => void
  streaming: boolean
  delegated: boolean
  disabled: boolean
  dragActive: boolean
  onDragOver: (e: DragEvent) => void
  onDragLeave: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  attachments: ImageAttachment[]
  onRemoveAttachment: (id: string) => void
  attachmentsDisabled: boolean
  /** When false, the text field is hidden; use the affordance to expand. Stop/Run stay available as needed. */
  composeExpanded: boolean
  onExpandCompose: () => void
}

export function AgentInputRow({
  task,
  onTaskChange,
  onSubmit,
  onStop,
  streaming,
  delegated,
  disabled,
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  attachments,
  onRemoveAttachment,
  attachmentsDisabled,
  composeExpanded,
  onExpandCompose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!composeExpanded) return
    inputRef.current?.focus()
  }, [composeExpanded])

  const dropZoneClass = `space-y-2 rounded-lg border border-transparent transition-colors ${
    dragActive ? 'bg-accent-teal/5 ring-1 ring-accent-teal/30' : ''
  }`

  if (!composeExpanded) {
    return (
      <div className="shrink-0 border-t border-tile-border p-3">
        <div
          className={dropZoneClass}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onExpandCompose}
              aria-expanded={false}
              className="min-w-0 flex-1 rounded-lg border border-tile-border bg-black/35 px-3 py-2 text-left text-sm text-gray-400 transition-colors hover:border-accent-teal/50 hover:text-gray-200"
            >
              {delegated
                ? 'Orchestrator-controlled — click to show input'
                : 'Click to type a task…'}
            </button>
            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
              >
                Stop
              </button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shrink-0 border-t border-tile-border p-3">
      <div
        className={`${dropZoneClass}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-0.5">
            {attachments.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={attachmentsDisabled}
                onClick={() => onRemoveAttachment(a.id)}
                className="inline-flex items-center gap-1 rounded border border-accent-teal/40 bg-black/30 px-2 py-0.5 text-[11px] text-accent-teal disabled:opacity-50"
                data-tooltip={`${a.name} (${Math.max(1, Math.round(a.size / 1024))}KB) — click to remove`}
              >
                <span aria-hidden>🖼</span>
                <span className="max-w-[180px] truncate">{a.name}</span>
                <span className="text-gray-400">×</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={task}
            onChange={(e) => onTaskChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !disabled && onSubmit()}
            placeholder={
              delegated
                ? 'Orchestrator-controlled sub-agent — use Stop to cancel'
                : 'Enter task for agent... (drag images here)'
            }
            disabled={disabled}
            readOnly={delegated}
            aria-readonly={delegated}
            className={`flex-1 rounded-lg border border-tile-border bg-tile-bg px-3 py-2 text-sm text-white placeholder-gray-600 transition-colors focus:border-accent-teal focus:outline-none disabled:opacity-50 ${
              delegated ? 'cursor-not-allowed bg-black/40 text-gray-400' : ''
            }`}
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={delegated || (!task.trim() && attachments.length === 0)}
              className="rounded-lg bg-accent-teal px-4 py-2 text-sm text-canvas-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Run
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

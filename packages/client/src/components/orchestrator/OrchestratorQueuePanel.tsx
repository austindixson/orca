import { useCallback, useEffect, useState } from 'react'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function IconArrowUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

/**
 * Queued messages: edit, force now (↑ stops the current orchestrator turn, then runs this), remove.
 */
export function OrchestratorQueuePanel() {
  const queuedInputs = useOrchestratorSessionStore((s) => s.queuedInputs)
  const running = useOrchestratorSessionStore((s) => s.running)
  const removeQueuedInput = useOrchestratorSessionStore((s) => s.removeQueuedInput)
  const updateQueuedInputText = useOrchestratorSessionStore((s) => s.updateQueuedInputText)
  const runQueuedInputNow = useOrchestratorSessionStore((s) => s.runQueuedInputNow)
  const clearQueue = useOrchestratorSessionStore((s) => s.clearQueue)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [sectionOpen, setSectionOpen] = useState(true)

  useEffect(() => {
    if (editingId && !queuedInputs.some((q) => q.id === editingId)) {
      setEditingId(null)
      setEditDraft('')
    }
  }, [editingId, queuedInputs])

  const startEdit = useCallback(
    (id: string, text: string) => {
      setEditingId(id)
      setEditDraft(text)
    },
    []
  )

  const saveEdit = useCallback(() => {
    if (!editingId) return
    updateQueuedInputText(editingId, editDraft)
    setEditingId(null)
    setEditDraft('')
  }, [editingId, editDraft, updateQueuedInputText])

  if (queuedInputs.length === 0) return null

  const iconBtn =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-tile-border/70 bg-black/30 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100'

  return (
    <details
      className="mb-2 rounded-lg border border-tile-border/50 bg-canvas-bg/60 font-sans text-[11px] text-gray-400"
      open={sectionOpen}
      onToggle={(e) => setSectionOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-2 py-1.5 font-mono text-[10px] marker:content-none hover:text-gray-200 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex w-full items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded border border-tile-border/60 bg-black/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-gray-500">
              Queue
            </span>
            <span>{queuedInputs.length} queued</span>
            <span className="hidden text-[9px] text-gray-600 sm:inline">· runs after the current task</span>
          </span>
          <button
            type="button"
            className="rounded border border-rose-400/35 bg-rose-950/20 px-2 py-0.5 text-[10px] text-rose-200/95 hover:bg-rose-900/35"
            data-tooltip="Remove all queued messages"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              clearQueue()
            }}
          >
            Clear all
          </button>
        </span>
      </summary>
      <div className="space-y-0 border-t border-tile-border/40 px-0 pb-1">
        {queuedInputs.map((q) => (
          <div
            key={q.id}
            className="flex items-start gap-2 border-b border-tile-border/25 px-2 py-2 last:border-b-0"
          >
            <span
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border border-gray-500 bg-transparent"
              data-tooltip="Pending"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              {editingId === q.id ? (
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingId(null)
                      setEditDraft('')
                    }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      saveEdit()
                    }
                  }}
                  rows={Math.min(8, Math.max(2, editDraft.split('\n').length))}
                  className="w-full resize-y rounded-md border border-accent-teal/40 bg-black/40 px-2 py-1 text-[12px] text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-accent-teal/50"
                  autoFocus
                />
              ) : (
                <p className="whitespace-pre-wrap break-words text-[12px] font-medium leading-snug text-gray-200">
                  {q.text.trim() ? q.text : '(attachment only)'}
                </p>
              )}
              {q.attachments.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[10px] text-gray-500 marker:text-gray-600">
                    {q.attachments.length} file{q.attachments.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-2 text-[10px] text-gray-600">
                    {q.attachments.map((a) => (
                      <li key={a.id} className="truncate" data-tooltip={a.name}>
                        {a.kind === 'image' ? '🖼 ' : '📄 '}
                        {a.name}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {editingId === q.id && (
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-accent-teal/45 bg-accent-teal/15 px-2 py-0.5 text-[10px] text-accent-teal"
                    onClick={saveEdit}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="rounded border border-tile-border/60 px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-300"
                    onClick={() => {
                      setEditingId(null)
                      setEditDraft('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:items-center" onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={iconBtn}
                data-tooltip="Edit message"
                disabled={editingId === q.id}
                onClick={() => startEdit(q.id, q.text)}
              >
                <IconPencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={iconBtn}
                data-tooltip={
                  running
                    ? 'Stop the current run and send this message now'
                    : 'Run this message now'
                }
                onClick={() => void runQueuedInputNow(q.id)}
              >
                <IconArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={iconBtn}
                data-tooltip="Remove from queue"
                onClick={() => removeQueuedInput(q.id)}
              >
                <IconTrash className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

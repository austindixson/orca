import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

type DeleteTilesConfirmModalProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: (dontShowAgain: boolean) => void
  onCancel: () => void
}

export function DeleteTilesConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: DeleteTilesConfirmModalProps) {
  const labelId = useId()
  const [dontShowAgain, setDontShowAgain] = useState(false)

  useEffect(() => {
    if (!open) setDontShowAgain(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  // Portal to document.body: the canvas toolbar uses transform (-translate-x-1/2), which
  // makes nested position:fixed overlays size to that strip instead of the viewport — buttons
  // were clipped off-screen. Rendering at body restores full-screen modal behavior.
  const overlay = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="my-auto w-full max-w-md max-h-[min(90dvh,32rem)] overflow-y-auto rounded-xl border border-tile-border bg-tile-bg/98 p-4 shadow-tile"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={labelId} className="text-base font-semibold text-gray-100">
          {title}
        </h2>
        <p className="mt-2 text-sm text-gray-400">{message}</p>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="rounded border-tile-border bg-black/30 text-accent-teal focus:ring-accent-teal/50"
          />
          Don&apos;t show this again
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-tile-border/80 bg-black/20 px-3 py-1.5 text-sm text-gray-300 hover:bg-tile-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(dontShowAgain)}
            className="rounded-lg border border-red-500/50 bg-red-500/20 px-3 py-1.5 text-sm font-medium text-red-100 hover:bg-red-500/30"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null

  return createPortal(overlay, document.body)
}

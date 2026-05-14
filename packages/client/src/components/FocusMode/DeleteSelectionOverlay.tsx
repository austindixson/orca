import { useCallback, useEffect, useState } from 'react'
import { useFocusStore } from '../../store/focusStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useToastStore } from '../../store/toastStore'
import { DeleteTilesConfirmModal } from '../Canvas/DeleteTilesConfirmModal'
import { getSkipDeleteTilesConfirm, setSkipDeleteTilesConfirm } from '../../lib/deleteTilesConfirmPrefs'

function targetIsTextInput(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false
  const tag = t.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return t.isContentEditable
}

export function DeleteSelectionOverlay() {
  const isDeleteSelectionMode = useFocusStore((s) => s.isDeleteSelectionMode)
  const selectedForDeletion = useFocusStore((s) => s.selectedForDeletion)
  const cancelDeleteSelectionMode = useFocusStore((s) => s.cancelDeleteSelectionMode)
  const removeTile = useCanvasStore((s) => s.removeTile)
  const addToast = useToastStore((s) => s.addToast)

  const [confirmOpen, setConfirmOpen] = useState(false)

  const performDelete = useCallback(
    (dontShowAgain: boolean) => {
      if (dontShowAgain) setSkipDeleteTilesConfirm(true)
      const ids = [...useFocusStore.getState().selectedForDeletion]
      cancelDeleteSelectionMode()
      for (const id of ids) {
        removeTile(id)
      }
      addToast({
        type: 'info',
        title: 'Tiles removed',
        message: ids.length === 1 ? 'Removed 1 tile.' : `Removed ${ids.length} tiles.`,
      })
      setConfirmOpen(false)
    },
    [addToast, cancelDeleteSelectionMode, removeTile]
  )

  const requestDelete = useCallback(() => {
    const n = useFocusStore.getState().selectedForDeletion.length
    if (n === 0) {
      addToast({
        type: 'info',
        title: 'Nothing selected',
        message: 'Click tile headers or drag a box on the canvas to select tiles.',
      })
      return
    }
    if (getSkipDeleteTilesConfirm()) {
      performDelete(false)
      return
    }
    setConfirmOpen(true)
  }, [addToast, performDelete])

  useEffect(() => {
    if (!isDeleteSelectionMode) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelDeleteSelectionMode()
        return
      }
      if (e.key !== 'Enter' && e.key !== 'Backspace') return
      if (targetIsTextInput(e.target)) return
      e.preventDefault()
      requestDelete()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isDeleteSelectionMode, cancelDeleteSelectionMode, requestDelete])

  if (!isDeleteSelectionMode) return null

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[100]">
        <div className="pointer-events-auto absolute left-0 right-0 top-0 flex h-14 items-center justify-center border-b border-red-500/25 bg-canvas-bg/95 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-center gap-3 px-3 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.75)]" />
              <span className="font-medium text-gray-100">Delete selection</span>
            </div>
            <div className="hidden h-5 w-px bg-tile-border sm:block" />
            <span className="text-gray-400">
              Click headers to toggle · Drag on empty canvas to box-select ·{' '}
              <kbd className="rounded border border-tile-border bg-black/40 px-1.5 py-0.5 font-mono text-xs text-gray-300">
                Enter
              </kbd>{' '}
              or{' '}
              <kbd className="rounded border border-tile-border bg-black/40 px-1.5 py-0.5 font-mono text-xs text-gray-300">
                ⌫
              </kbd>{' '}
              to delete
            </span>
            <div className="hidden h-5 w-px bg-tile-border sm:block" />
            <span className="rounded-lg bg-red-500/15 px-2 py-1 text-sm font-medium text-red-200/95">
              {selectedForDeletion.length} selected
            </span>
            <button
              type="button"
              onClick={cancelDeleteSelectionMode}
              className="rounded-lg border border-tile-border/80 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-tile-hover hover:text-white"
            >
              Cancel
              <kbd className="ml-1.5 rounded border border-tile-border px-1 py-0.5 font-mono text-[10px] text-gray-500">Esc</kbd>
            </button>
          </div>
        </div>
      </div>

      <DeleteTilesConfirmModal
        open={confirmOpen}
        title="Delete selected tiles?"
        message={
          selectedForDeletion.length === 1
            ? 'This tile will be closed and removed from the canvas.'
            : `${selectedForDeletion.length} tiles will be closed and removed from the canvas.`
        }
        confirmLabel="Delete"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={(dontShowAgain) => performDelete(dontShowAgain)}
      />
    </>
  )
}

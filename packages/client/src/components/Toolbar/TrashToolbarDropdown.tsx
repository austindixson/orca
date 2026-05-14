import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCanvasStore } from '../../store/canvasStore'
import { useFocusStore } from '../../store/focusStore'
import { useToastStore } from '../../store/toastStore'
import { DeleteTilesConfirmModal } from '../Canvas/DeleteTilesConfirmModal'
import { getSkipDeleteTilesConfirm, setSkipDeleteTilesConfirm } from '../../lib/deleteTilesConfirmPrefs'
import { useToolbarMenuPortal } from './useToolbarMenuPortal'

export function TrashToolbarDropdown() {
  const tiles = useCanvasStore((s) => s.tiles)
  const clearAllTiles = useCanvasStore((s) => s.clearAllTiles)
  const enterDeleteSelectionMode = useFocusStore((s) => s.enterDeleteSelectionMode)
  const exitFocus = useFocusStore((s) => s.exitFocus)
  const cancelSelectionMode = useFocusStore((s) => s.cancelSelectionMode)
  const cancelDeleteSelectionMode = useFocusStore((s) => s.cancelDeleteSelectionMode)
  const addToast = useToastStore((s) => s.addToast)

  const [open, setOpen] = useState(false)
  const [confirmAllOpen, setConfirmAllOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { menuRef, fixedStyle } = useToolbarMenuPortal(open, wrapRef, 'center')

  const tileCount = tiles.size

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      close()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open, close, menuRef])

  const handleDeleteAllClick = useCallback(() => {
    close()
    if (tileCount === 0) {
      addToast({ type: 'info', title: 'Canvas empty', message: 'There are no tiles to remove.' })
      return
    }
    if (getSkipDeleteTilesConfirm()) {
      if (useFocusStore.getState().isActive) exitFocus()
      if (useFocusStore.getState().isSelectionMode) cancelSelectionMode()
      if (useFocusStore.getState().isDeleteSelectionMode) cancelDeleteSelectionMode()
      clearAllTiles()
      addToast({ type: 'info', title: 'Canvas cleared', message: 'All tiles were removed.' })
      return
    }
    setConfirmAllOpen(true)
  }, [addToast, cancelDeleteSelectionMode, cancelSelectionMode, clearAllTiles, close, exitFocus, tileCount])

  const handleSelectModeClick = useCallback(() => {
    close()
    if (tileCount === 0) {
      addToast({ type: 'info', title: 'Canvas empty', message: 'Add tiles before using delete selection.' })
      return
    }
    enterDeleteSelectionMode()
  }, [addToast, close, enterDeleteSelectionMode, tileCount])

  const onConfirmDeleteAll = useCallback(
    (dontShowAgain: boolean) => {
      if (dontShowAgain) setSkipDeleteTilesConfirm(true)
      if (useFocusStore.getState().isActive) exitFocus()
      if (useFocusStore.getState().isSelectionMode) cancelSelectionMode()
      if (useFocusStore.getState().isDeleteSelectionMode) cancelDeleteSelectionMode()
      clearAllTiles()
      setConfirmAllOpen(false)
      addToast({ type: 'info', title: 'Canvas cleared', message: 'All tiles were removed.' })
    },
    [addToast, cancelDeleteSelectionMode, cancelSelectionMode, clearAllTiles, exitFocus]
  )

  return (
    <>
      <div className="relative" ref={wrapRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-gray-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
          data-tooltip="Remove tiles"
          aria-label="Remove tiles"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" strokeLinecap="round" />
          </svg>
        </button>

        {open &&
          fixedStyle &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={fixedStyle}
              className="min-w-[200px] rounded-lg border border-tile-border bg-tile-bg/98 py-1 shadow-tile backdrop-blur-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleDeleteAllClick}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-200 hover:bg-tile-hover"
              >
                <span className="text-red-400/90">Delete all tiles</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleSelectModeClick}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-200 hover:bg-tile-hover"
              >
                Select to delete…
              </button>
            </div>,
            document.body
          )}
      </div>

      <DeleteTilesConfirmModal
        open={confirmAllOpen}
        title="Delete all tiles?"
        message={
          tileCount === 0
            ? 'There are no tiles on the canvas.'
            : `All ${tileCount} tiles will be closed and removed from the canvas. This cannot be undone.`
        }
        confirmLabel="Delete all"
        onCancel={() => setConfirmAllOpen(false)}
        onConfirm={onConfirmDeleteAll}
      />
    </>
  )
}

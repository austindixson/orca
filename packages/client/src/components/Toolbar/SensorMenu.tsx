import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useProjectTaskCompletion } from '../../hooks/useProjectTaskCompletion'
import { useToolbarMenuPortal } from './useToolbarMenuPortal'

const SENSOR_MENU_PANEL_ID = 'orca-sensor-menu'

/**
 * Toolbar “sensor” control: dropdown with project task completion (tiny bar + %).
 * Choosing the panel opens the Tasks sidebar.
 */
export function SensorMenu() {
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel)
  const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed)
  const expandSidebar = useWorkspaceStore((s) => s.expandSidebar)

  const { pct, done, total } = useProjectTaskCompletion()

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { menuRef, fixedStyle } = useToolbarMenuPortal(open, wrapRef, 'right')

  const openTasksSidebar = useCallback(() => {
    setActivePanel('tasks')
    if (sidebarCollapsed) expandSidebar()
    setOpen(false)
  }, [setActivePanel, sidebarCollapsed, expandSidebar])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open, menuRef])

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors',
          open
            ? 'border-accent-teal/55 bg-accent-teal/15 text-accent-teal'
            : 'border-tile-border/80 bg-black/15 text-gray-400 hover:text-gray-200'
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? SENSOR_MENU_PANEL_ID : undefined}
        data-tooltip="Sensor menu — project task completion (click panel to open Tasks)"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 12h2l2-7 3 14 3-10 3 8h2" />
        </svg>
      </button>
      {open &&
        fixedStyle &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            id={SENSOR_MENU_PANEL_ID}
            role="menu"
            style={fixedStyle}
            className="w-44 overflow-hidden rounded-lg border border-tile-border bg-[#2d2d2d] shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              onClick={openTasksSidebar}
              className="flex w-full flex-col gap-1.5 px-2.5 py-2 text-left hover:bg-[#3c3c3c]"
            >
              <div className="flex items-center justify-between gap-2 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                <span>Project</span>
                <span className="tabular-nums text-gray-400">{total === 0 ? '—' : `${pct}%`}</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-black/40" aria-hidden>
                <div
                  className="h-full rounded-full bg-accent-teal/85 transition-[width] duration-200"
                  style={{ width: total === 0 ? '0%' : `${pct}%` }}
                />
              </div>
              <span className="text-[10px] leading-tight text-gray-500">
                {total === 0 ? 'No tasks yet' : `${done} of ${total} complete`}
              </span>
              <span className="text-[9px] text-accent-teal/80">Open Tasks sidebar</span>
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}

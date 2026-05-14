import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useCanvasStore } from '../../store/canvasStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useToastStore } from '../../store/toastStore'
import { openKeyboardShortcutsModal } from '../../lib/uiEvents'
import {
  CANVAS_TILE_OPTIONS,
  filterCanvasTileOptionsForHermesSetting,
  metaForTileSpawnFromAddMenu,
} from '../../lib/tileMenuCatalog'
import type { TileType } from '../../store/canvasStore'
import * as tauri from '../../lib/tauri'
import { dispatchOrcaMenuPayload } from '../../lib/menuBridge'
import { openIntegrationWizard } from '../../lib/integrations/openIntegrationWizard'
import { runObsidianIntegrationOneClick } from '../../lib/integrations/obsidianOneClick'
import { WorkspaceRebuildBanner } from './WorkspaceRebuildBanner'
import { useWelcomeUi } from '../../context/WelcomeUiContext'
type MenuId = 'file' | 'edit' | 'view' | 'tiles' | 'help' | null

function MenuButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={clsx(
        'rounded px-2 py-0.5 text-sm transition-colors',
        active
          ? 'bg-[#3c3c3c] text-white'
          : 'text-gray-400 hover:bg-[#3c3c3c] hover:text-white'
      )}
      onClick={onClick}
      aria-expanded={active}
    >
      {label}
    </button>
  )
}

function MenuPanel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      role="menu"
      className={clsx(
        'absolute left-0 top-full z-[200] mt-0.5 min-w-[14rem] rounded-md border border-[#3c3c3c] bg-[#2d2d2d] py-1 shadow-xl',
        className
      )}
    >
      {children}
    </div>
  )
}

function MenuItem({
  label,
  shortcut,
  onClick,
  disabled,
}: {
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-[#3c3c3c] disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
    >
      <span>{label}</span>
      {shortcut && <span className="text-xs text-gray-500">{shortcut}</span>}
    </button>
  )
}

function MenuDivider() {
  return <div className="my-1 border-t border-[#3c3c3c]" role="separator" />
}

export function TitleBar() {
  const { welcomeMode } = useWelcomeUi()
  const { rootName, rootPath } = useWorkspaceStore()
  const showWorkspaceTitleCenter =
    !welcomeMode && Boolean(rootPath && rootPath !== '.')
  const openFolder = useWorkspaceStore((s) => s.openFolder)
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar)
  const addTile = useCanvasStore((s) => s.addTile)
  const zoom = useCanvasStore((s) => s.zoom)
  const setZoom = useCanvasStore((s) => s.setZoom)
  const setPan = useCanvasStore((s) => s.setPan)
  const toggleSettings = useSettingsStore((s) => s.toggleSettings)
  const showHermesAgentTile = useSettingsStore((s) => s.showHermesAgentTile)
  const addToast = useToastStore((s) => s.addToast)

  const titleBarTileOptions = useMemo(
    () => filterCanvasTileOptionsForHermesSetting(CANVAS_TILE_OPTIONS, showHermesAgentTile),
    [showHermesAgentTile]
  )

  const [open, setOpen] = useState<MenuId>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
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
  }, [open, close])

  const handleAddTile = (type: TileType) => {
    const meta = metaForTileSpawnFromAddMenu(type)
    addTile(type, undefined, meta ? { meta } : undefined)
    const label = CANVAS_TILE_OPTIONS.find((o) => o.type === type)?.label ?? type
    addToast({ type: 'info', title: label, message: 'New tile added to the canvas.' })
    close()
  }

  const handleOpenFolder = async () => {
    await openFolder()
    close()
  }

  const handleResetView = () => {
    setPan({ x: 0, y: 0 })
    setZoom(1)
    close()
  }

  const handleZoomIn = () => {
    setZoom(zoom * 1.2)
    close()
  }

  const handleZoomOut = () => {
    setZoom(zoom / 1.2)
    close()
  }

  const handleQuit = async () => {
    close()
    if (tauri.isTauri()) {
      await tauri.quitApp()
    } else {
      window.close()
    }
  }

  /**
   * Render in `document.body` with a very high z-index so the menu bar stays above
   * `fixed` overlays portaled to `body` (settings, delete confirm, file context menu, etc.).
   * Without this, those layers paint above `#root` and swallow clicks on File / Edit / …
   */
  const bar = (
    <div className="fixed top-0 left-0 right-0 z-[100000] flex h-8 min-h-8 w-full min-w-0 shrink-0 select-none items-center border-b border-[#2d2d2d] bg-[#1e1e1e] px-2">
      {/* Three columns: menus | centered title | traffic lights — grid keeps the middle truly centered. */}
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
      {/* Do not use overflow-x-auto on this node: paired overflow creates a scrollport that clips
          absolutely positioned dropdowns (MenuPanel) below the bar — menus highlight but stay invisible. */}
      <div
        ref={wrapRef}
        className="flex min-h-0 min-w-0 items-center justify-start gap-0.5 overflow-visible"
      >
        <div
          className="mr-1.5 flex shrink-0 items-center border-r border-[#3c3c3c] pr-2"
          data-tooltip="Orca Coder"
        >
          <span className="select-none text-[11px] font-semibold leading-none tracking-tight sm:text-xs">
            <span className="text-accent-teal">Orca</span>
            <span className="text-gray-200"> Coder</span>
          </span>
        </div>
        <div className="relative">
          <MenuButton label="File" active={open === 'file'} onClick={() => setOpen(open === 'file' ? null : 'file')} />
          {open === 'file' && (
            <MenuPanel>
              <MenuItem
                label="New Text File"
                shortcut="⌘N"
                onClick={() => {
                  void dispatchOrcaMenuPayload({ id: 'file.new-text-file' })
                  close()
                }}
              />
              <MenuItem
                label="New Window"
                shortcut="⌘⇧N"
                onClick={() => {
                  void dispatchOrcaMenuPayload({ id: 'file.new-window' })
                  close()
                }}
              />
              <MenuDivider />
              <MenuItem
                label="Open…"
                shortcut="⌘O"
                onClick={() => {
                  void dispatchOrcaMenuPayload({ id: 'file.open-file' })
                  close()
                }}
              />
              <MenuItem label="Open Folder…" onClick={handleOpenFolder} />
              <MenuDivider />
              <MenuItem
                label="Save"
                shortcut="⌘S"
                onClick={() => {
                  void dispatchOrcaMenuPayload({ id: 'file.save' })
                  close()
                }}
              />
              <MenuItem
                label="Save As…"
                shortcut="⇧⌘S"
                onClick={() => {
                  void dispatchOrcaMenuPayload({ id: 'file.save-as' })
                  close()
                }}
              />
              <MenuItem
                label="Save All"
                shortcut="⌥⌘S"
                onClick={() => {
                  void dispatchOrcaMenuPayload({ id: 'file.save-all' })
                  close()
                }}
              />
              <MenuDivider />
              <MenuItem label="Settings…" shortcut="⌘," onClick={() => { toggleSettings(); close() }} />
              <MenuDivider />
              <MenuItem label="Quit" shortcut="⌘Q" onClick={handleQuit} />
            </MenuPanel>
          )}
        </div>

        <div className="relative">
          <MenuButton label="Edit" active={open === 'edit'} onClick={() => setOpen(open === 'edit' ? null : 'edit')} />
          {open === 'edit' && (
            <MenuPanel>
              <MenuItem label="Preferences…" shortcut="⌘," onClick={() => { toggleSettings(); close() }} />
            </MenuPanel>
          )}
        </div>

        <div className="relative">
          <MenuButton label="View" active={open === 'view'} onClick={() => setOpen(open === 'view' ? null : 'view')} />
          {open === 'view' && (
            <MenuPanel>
              <MenuItem label="Settings…" shortcut="⌘," onClick={() => { toggleSettings(); close() }} />
              <MenuDivider />
              <MenuItem label="Reset Canvas View" shortcut="⌘0" onClick={handleResetView} />
              <MenuItem label="Zoom In" onClick={handleZoomIn} />
              <MenuItem label="Zoom Out" onClick={handleZoomOut} />
              <MenuDivider />
              <MenuItem label="Toggle Sidebar" onClick={() => { toggleSidebar(); close() }} />
              <MenuDivider />
              <MenuItem
                label="Telemetry dashboard…"
                onClick={() => {
                  window.location.hash = '#/telemetry'
                  close()
                }}
              />
            </MenuPanel>
          )}
        </div>

        <button
          type="button"
          className="rounded px-2 py-0.5 text-sm text-accent-teal/95 transition-colors hover:bg-[#3c3c3c] hover:text-accent-teal"
          data-tooltip="Open Obsidian brain and scan your vault (current workspace folder)"
          onClick={() => void runObsidianIntegrationOneClick()}
        >
          Obsidian
        </button>

        <button
          type="button"
          className="rounded px-2 py-0.5 text-sm text-gray-400 transition-colors hover:bg-[#3c3c3c] hover:text-white"
          onClick={() => {
            openIntegrationWizard()
          }}
        >
          Integrations
        </button>

        <div className="relative">
          <MenuButton
            label="Tiles"
            active={open === 'tiles'}
            onClick={() => setOpen(open === 'tiles' ? null : 'tiles')}
          />
          {open === 'tiles' && (
            <MenuPanel className="min-w-[16rem]">
              {titleBarTileOptions.map((opt) => (
                <MenuItem
                  key={opt.type}
                  label={`${opt.icon} ${opt.label}`}
                  shortcut={opt.shortcut}
                  onClick={() => handleAddTile(opt.type)}
                />
              ))}
            </MenuPanel>
          )}
        </div>

        <div className="relative">
          <MenuButton label="Help" active={open === 'help'} onClick={() => setOpen(open === 'help' ? null : 'help')} />
          {open === 'help' && (
            <MenuPanel>
              <MenuItem
                label="Keyboard Shortcuts"
                shortcut="⌘?"
                onClick={() => {
                  openKeyboardShortcutsModal()
                  close()
                }}
              />
              <MenuItem
                label="About Orca Coder"
                onClick={() => {
                  close()
                  addToast({
                    type: 'info',
                    title: 'Orca Coder',
                    message: 'Orchestrated canvas IDE with orchestrator, tiles, and workspace tools.',
                  })
                }}
              />
            </MenuPanel>
          )}
        </div>
      </div>

      {showWorkspaceTitleCenter ? (
        <div
          className="hidden min-w-0 shrink-0 flex-row items-center justify-center px-1 sm:flex"
          data-tooltip={`${rootName} — Orca Coder`}
        >
          <div className="max-w-[min(10rem,22vw)] truncate text-center text-[11px] leading-tight text-gray-400 md:max-w-[min(12rem,20vw)]">
            <span className="text-gray-300">{rootName}</span>
            <span className="text-gray-600"> — </span>
            <span className="text-gray-500">Orca Coder</span>
          </div>
        </div>
      ) : (
        <div className="hidden min-w-0 shrink-0 sm:flex" aria-hidden />
      )}

      <div className="flex shrink-0 items-center justify-end gap-2">
        <button
          type="button"
          className="h-3 w-3 rounded-full bg-[#ffbd2e] hover:opacity-90"
          data-tooltip="Minimize"
          aria-label="Minimize"
          onClick={() => void tauri.minimizeWindow()}
        />
        <button
          type="button"
          className="h-3 w-3 rounded-full bg-[#28c940] hover:opacity-90"
          data-tooltip="Zoom"
          aria-label="Zoom"
          onClick={() => void tauri.toggleMaximizeWindow()}
        />
        <button
          type="button"
          className="h-3 w-3 rounded-full bg-[#ff5f56] hover:opacity-90"
          data-tooltip="Close window"
          aria-label="Close window"
          onClick={() => void tauri.closeCurrentWindow()}
        />
      </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined' || !document.body) return null
  return (
    <>
      {createPortal(bar, document.body)}
      {createPortal(<WorkspaceRebuildBanner />, document.body)}
    </>
  )
}

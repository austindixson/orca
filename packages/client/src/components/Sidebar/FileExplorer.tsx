import { useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useWorkspaceStore, type FileEntry } from '../../store/workspaceStore'
import { useCanvasStore } from '../../store/canvasStore'
import * as tauri from '../../lib/tauri'
import {
  IconAddCanvasTile,
  IconChevronRight,
  IconFolderClosed,
  IconNewFileWorkspace,
  IconNewFolder,
  IconOpenWorkspace,
  IconRefresh,
} from './explorerIcons'
const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  ts: { icon: 'TS', color: '#3178c6' },
  tsx: { icon: 'TSX', color: '#3178c6' },
  js: { icon: 'JS', color: '#f7df1e' },
  jsx: { icon: 'JSX', color: '#61dafb' },
  json: { icon: '{ }', color: '#cbcb41' },
  md: { icon: 'M↓', color: '#519aba' },
  css: { icon: '#', color: '#563d7c' },
  html: { icon: '<>', color: '#e34c26' },
  py: { icon: 'PY', color: '#3572A5' },
  go: { icon: 'GO', color: '#00ADD8' },
  rs: { icon: 'RS', color: '#dea584' },
  yaml: { icon: 'Y', color: '#cb171e' },
  yml: { icon: 'Y', color: '#cb171e' },
  sh: { icon: '$', color: '#89e051' },
  default: { icon: '◇', color: '#6b7280' },
}

function getFileIcon(name: string, isDirectory: boolean) {
  if (isDirectory) {
    return { icon: '', color: '#dcb67a' }
  }
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return FILE_ICONS[ext] || FILE_ICONS.default
}

/** Workspace-relative path segments use `/` (matches Tauri `read_directory` output). */
function dirnameWorkspacePath(p: string): string {
  const n = p.replace(/\\/g, '/')
  const i = n.lastIndexOf('/')
  if (i <= 0) return '.'
  return n.slice(0, i)
}

function joinWorkspacePath(dir: string, baseName: string): string {
  const name = baseName.replace(/^[/\\]+/, '').replace(/[/\\]+$/g, '')
  if (!name) return dir === '.' ? '.' : dir
  if (dir === '.' || dir === '') return name
  return `${dir.replace(/[/\\]+$/, '')}/${name}`
}

interface FileTreeItemProps {
  entry: FileEntry
  depth: number
  onRowContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
}

function FileTreeItem({ entry, depth, onRowContextMenu }: FileTreeItemProps) {
  const { 
    expandedPaths, 
    toggleDirectory, 
    selectFile, 
    selectedPath,
  } = useWorkspaceStore()
  const addTile = useCanvasStore((s) => s.addTile)
  const updateTile = useCanvasStore((s) => s.updateTile)
  
  const isExpanded = expandedPaths.has(entry.path)
  const isSelected = selectedPath === entry.path
  const icon = getFileIcon(entry.name, entry.isDirectory)

  const handleClick = () => {
    if (entry.isDirectory) {
      toggleDirectory(entry.path)
    } else {
      selectFile(entry.path)
    }
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (entry.isDirectory) return
    const id = addTile('editor', undefined)
    updateTile(id, {
      title: entry.name,
      meta: {
        file: entry.path,
        fileVersion: Date.now(),
      },
    })
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onRowContextMenu(e, entry)
  }

  return (
    <div>
      <div
        className={clsx(
          'flex items-center gap-0.5 px-2 py-0.5 cursor-pointer text-sm min-w-0',
          'hover:bg-tile-hover',
          isSelected && 'bg-accent-blue/35'
        )}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="w-4 h-4 shrink-0 flex items-center justify-center">
          {entry.isDirectory ? (
            <IconChevronRight
              className={clsx(
                'w-3.5 h-3.5 text-gray-400 transition-transform',
                isExpanded && 'rotate-90'
              )}
            />
          ) : null}
        </span>
        {entry.isDirectory ? (
          <IconFolderClosed className="w-4 h-4 shrink-0 text-[#c19a6b]" />
        ) : (
          <span
            className="text-[10px] font-bold w-5 text-center shrink-0 tabular-nums"
            style={{ color: icon.color }}
          >
            {icon.icon}
          </span>
        )}
        <span className="text-gray-300 truncate min-w-0">{entry.name}</span>
      </div>
      
      {entry.isDirectory && isExpanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeItem
              key={child.path}
              entry={child}
              depth={depth + 1}
              onRowContextMenu={onRowContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type FileContextMenuState = { x: number; y: number; entry: FileEntry }

export function FileExplorer() {
  const {
    files,
    rootName,
    rootPath,
    loadDirectory,
    isLoading,
    error,
    refreshFiles,
    openFolder,
    workspaceBootstrapDone,
    syncExplorerAfterWrite,
    syncExplorerAfterDelete,
    selectFile,
    selectedPath,
  } = useWorkspaceStore()
  const addTile = useCanvasStore((s) => s.addTile)
  const updateTile = useCanvasStore((s) => s.updateTile)

  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null)
  const [treeActionError, setTreeActionError] = useState<string | null>(null)

  useEffect(() => {
    // Load tree when a real folder is selected (Rust workspace is synced inside loadDirectory).
    // Wait for Tauri bootstrap so we do not list files for a stale persisted path before recents win.
    if (!workspaceBootstrapDone) return
    if (rootPath && rootPath !== '.') {
      void loadDirectory('.')
    }
  }, [workspaceBootstrapDone, loadDirectory, rootPath])

  const handleNewFile = useCallback(() => {
    addTile('editor', undefined)
  }, [addTile])

  const handleNewTerminal = useCallback(() => {
    addTile('terminal', undefined)
  }, [addTile])

  const handleCreateFolder = useCallback(() => {
    setIsCreatingFolder(true)
    setIsCreatingFile(false)
    setNewItemName('')
    setCreateError(null)
  }, [])

  const handleCreateFile = useCallback(() => {
    setIsCreatingFile(true)
    setIsCreatingFolder(false)
    setNewItemName('')
    setCreateError(null)
  }, [])

  const handleSubmitCreate = useCallback(async () => {
    if (!newItemName.trim()) {
      setCreateError('Name cannot be empty')
      return
    }

    try {
      setCreateError(null)
      if (isCreatingFolder) {
        await tauri.createDirectory(newItemName.trim())
      } else if (isCreatingFile) {
        await tauri.writeFile(newItemName.trim(), '')
      }
      
      setIsCreatingFolder(false)
      setIsCreatingFile(false)
      setNewItemName('')
      
      // Refresh the file list
      await refreshFiles()
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create')
    }
  }, [newItemName, isCreatingFolder, isCreatingFile, refreshFiles])

  const handleCancelCreate = useCallback(() => {
    setIsCreatingFolder(false)
    setIsCreatingFile(false)
    setNewItemName('')
    setCreateError(null)
  }, [])

  const openFileInEditor = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) return
      const id = addTile('editor', undefined)
      updateTile(id, {
        title: entry.name,
        meta: {
          file: entry.path,
          fileVersion: Date.now(),
        },
      })
    },
    [addTile, updateTile]
  )

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const openRowContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      selectFile(entry.path)
      const approxW = 220
      const approxH = 260
      let x = e.clientX
      let y = e.clientY
      x = Math.min(x, window.innerWidth - approxW - 6)
      y = Math.min(y, window.innerHeight - approxH - 6)
      x = Math.max(6, x)
      y = Math.max(6, y)
      setTreeActionError(null)
      setContextMenu({ x, y, entry })
    },
    [selectFile]
  )

  useEffect(() => {
    if (!contextMenu) return
    const onMouseDown = (ev: MouseEvent) => {
      const t = ev.target as Node | null
      if (t && (t as HTMLElement).closest?.('[data-file-context-menu]')) return
      setContextMenu(null)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  const parentForNewItem = useCallback((entry: FileEntry) => {
    return entry.isDirectory ? entry.path : dirnameWorkspacePath(entry.path)
  }, [])

  const runDelete = useCallback(
    async (entry: FileEntry) => {
      const label = entry.isDirectory
        ? `Delete folder "${entry.name}" and everything inside?`
        : `Delete "${entry.name}"?`
      if (!window.confirm(label)) return
      try {
        setTreeActionError(null)
        await tauri.deletePath(entry.path)
        await syncExplorerAfterDelete(entry.path)
        closeContextMenu()
      } catch (err) {
        setTreeActionError(err instanceof Error ? err.message : 'Delete failed')
      }
    },
    [syncExplorerAfterDelete, closeContextMenu]
  )

  const runRename = useCallback(
    async (entry: FileEntry) => {
      if (!tauri.isTauri()) {
        setTreeActionError('Rename requires the desktop app.')
        return
      }
      const next = window.prompt('New name (same folder)', entry.name)?.trim()
      if (!next || next === entry.name) return
      if (next.includes('/') || next.includes('\\')) {
        setTreeActionError('Use a single file or folder name (no slashes).')
        return
      }
      const parent = dirnameWorkspacePath(entry.path)
      const newPath = joinWorkspacePath(parent, next)
      try {
        setTreeActionError(null)
        await tauri.renamePath(entry.path, newPath)
        if (selectedPath === entry.path) selectFile(newPath)
        await syncExplorerAfterWrite(newPath)
        closeContextMenu()
      } catch (err) {
        setTreeActionError(err instanceof Error ? err.message : 'Rename failed')
      }
    },
    [selectedPath, selectFile, syncExplorerAfterWrite, closeContextMenu]
  )

  const runNewFileHere = useCallback(
    async (entry: FileEntry) => {
      const parent = parentForNewItem(entry)
      const name = window.prompt('New file name', 'untitled.ts')?.trim()
      if (!name) return
      if (name.includes('/') || name.includes('\\')) {
        setTreeActionError('Use a file name only (no slashes), or create folders first.')
        return
      }
      const rel = joinWorkspacePath(parent, name)
      try {
        setTreeActionError(null)
        await tauri.writeFile(rel, '')
        await syncExplorerAfterWrite(rel)
        closeContextMenu()
      } catch (err) {
        setTreeActionError(err instanceof Error ? err.message : 'Could not create file')
      }
    },
    [parentForNewItem, syncExplorerAfterWrite, closeContextMenu]
  )

  const runNewFolderHere = useCallback(
    async (entry: FileEntry) => {
      if (!tauri.isTauri()) {
        setTreeActionError('New folder requires the desktop app.')
        return
      }
      const parent = parentForNewItem(entry)
      const name = window.prompt('New folder name', 'folder')?.trim()
      if (!name) return
      if (name.includes('/') || name.includes('\\')) {
        setTreeActionError('Use a single folder name (no slashes).')
        return
      }
      const rel = joinWorkspacePath(parent, name)
      try {
        setTreeActionError(null)
        await tauri.createDirectory(rel)
        await syncExplorerAfterWrite(rel)
        closeContextMenu()
      } catch (err) {
        setTreeActionError(err instanceof Error ? err.message : 'Could not create folder')
      }
    },
    [parentForNewItem, syncExplorerAfterWrite, closeContextMenu]
  )

  const copyPath = useCallback(
    (entry: FileEntry) => {
      void navigator.clipboard.writeText(entry.path).catch(() => {})
      closeContextMenu()
    },
    [closeContextMenu]
  )

  const menuButtonClass =
    'w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 rounded-sm disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div className="h-full flex flex-col bg-tile-bg/70 text-gray-300">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-2 py-2 text-xs uppercase tracking-wider text-gray-400 border-b border-tile-border/80 min-w-0">
        <span className="shrink-0">Explorer</span>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={handleCreateFile}
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded hover:bg-tile-hover transition-colors text-gray-300"
            data-tooltip="Create a new file under the selected folder in the workspace."
          >
            <IconNewFileWorkspace className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleCreateFolder}
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded hover:bg-tile-hover transition-colors text-gray-300"
            data-tooltip="Create a new folder under the selected path in the workspace."
          >
            <IconNewFolder className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleNewFile}
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded hover:bg-tile-hover transition-colors text-gray-300"
            data-tooltip="Add a new editor tile on the canvas for the current selection."
          >
            <IconAddCanvasTile className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleNewTerminal}
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded hover:bg-tile-hover transition-colors text-gray-300"
            data-tooltip="Add a new terminal tile on the canvas for running commands."
          >
            <span className="text-xs font-mono text-accent-teal" aria-hidden>
              ▸
            </span>
          </button>
          <button
            type="button"
            onClick={refreshFiles}
            disabled={isLoading}
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded hover:bg-tile-hover transition-colors text-gray-300 disabled:opacity-50"
            data-tooltip="Reload the file tree from disk."
          >
            <IconRefresh className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {treeActionError && (
        <div className="border-b border-red-500/25 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
          {treeActionError}
        </div>
      )}

      {/* Workspace Name */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-sm font-semibold bg-tile-header border-b border-tile-border/80 min-w-0">
        <IconFolderClosed className="w-4 h-4 shrink-0 text-[#c19a6b]" />
        <span className="truncate flex-1 min-w-0">{rootName}</span>
        <button
          type="button"
          onClick={() => void openFolder()}
          className="h-7 w-7 shrink-0 flex items-center justify-center rounded hover:bg-tile-hover transition-colors text-gray-400 hover:text-gray-200"
          data-tooltip="Switch to a different workspace folder using the system picker."
        >
          <IconOpenWorkspace className="w-4 h-4" />
        </button>
      </div>
      
      {/* Create New Item Input */}
      {(isCreatingFolder || isCreatingFile) && (
        <div className="px-2 py-2 border-b border-tile-border/80 bg-tile-header">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-gray-400">
              {isCreatingFolder ? 'New Folder' : 'New File'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitCreate()
                if (e.key === 'Escape') handleCancelCreate()
              }}
              placeholder={isCreatingFolder ? 'folder-name' : 'filename.ts'}
              className="flex-1 px-2 py-1 bg-black/20 text-gray-200 text-sm rounded outline-none border border-tile-border focus:border-accent-teal"
              autoFocus
            />
            <button
              onClick={handleSubmitCreate}
              className="p-1.5 bg-accent-blue/80 hover:bg-accent-blue rounded transition-colors"
              data-tooltip="Create the file or folder with the name you entered."
            >
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button
              onClick={handleCancelCreate}
              className="p-1.5 hover:bg-tile-hover rounded transition-colors"
              data-tooltip="Discard this new file or folder draft."
            >
              <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          {createError && (
            <p className="text-xs text-red-400 mt-1">{createError}</p>
          )}
        </div>
      )}

      {/* File tree — full height (tasks live in the Tasks activity + Todo tiles) */}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {isLoading && files.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            Loading...
          </div>
        ) : !rootPath || rootPath === '.' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-sm text-gray-500">
            <span>No folder opened</span>
            <button
              type="button"
              onClick={() => void openFolder()}
              className="rounded bg-accent-blue/80 px-3 py-1.5 text-sm text-white hover:bg-accent-blue"
            >
              Open Folder
            </button>
          </div>
        ) : error && files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-red-400">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void refreshFiles()}
              className="rounded bg-accent-blue/80 px-3 py-1.5 text-sm text-white hover:bg-accent-blue"
            >
              Retry
            </button>
          </div>
        ) : files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-gray-500">
            <span>Folder is empty</span>
            <span className="text-xs text-gray-600">No non-hidden items in this workspace.</span>
          </div>
        ) : (
          files.map((entry) => (
            <FileTreeItem
              key={entry.path}
              entry={entry}
              depth={0}
              onRowContextMenu={openRowContextMenu}
            />
          ))
        )}
      </div>

      {contextMenu &&
        createPortal(
          <div
            role="menu"
            data-file-context-menu
            className="fixed z-[300] min-w-[200px] rounded-md border border-tile-border/90 bg-canvas-bg py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(ev) => ev.stopPropagation()}
          >
            {!contextMenu.entry.isDirectory && (
              <button
                type="button"
                role="menuitem"
                className={menuButtonClass}
                onClick={() => {
                  openFileInEditor(contextMenu.entry)
                  closeContextMenu()
                }}
              >
                Open in editor
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className={menuButtonClass}
              disabled={!tauri.isTauri()}
              data-tooltip={!tauri.isTauri() ? 'Available in the desktop app' : undefined}
              onClick={() => void runRename(contextMenu.entry)}
            >
              Rename…
            </button>
            <button type="button" role="menuitem" className={menuButtonClass} onClick={() => void runDelete(contextMenu.entry)}>
              Delete…
            </button>
            <div className="my-1 border-t border-tile-border/60" />
            <button
              type="button"
              role="menuitem"
              className={menuButtonClass}
              onClick={() => copyPath(contextMenu.entry)}
            >
              Copy relative path
            </button>
            <div className="my-1 border-t border-tile-border/60" />
            <button
              type="button"
              role="menuitem"
              className={menuButtonClass}
              onClick={() => void runNewFileHere(contextMenu.entry)}
            >
              New file here…
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuButtonClass}
              disabled={!tauri.isTauri()}
              data-tooltip={!tauri.isTauri() ? 'Available in the desktop app' : undefined}
              onClick={() => void runNewFolderHere(contextMenu.entry)}
            >
              New folder here…
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}

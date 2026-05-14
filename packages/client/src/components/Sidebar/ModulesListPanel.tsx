import { useMemo, useCallback, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { useCanvasStore, type TileData, type TileType } from '../../store/canvasStore'
import { activateModuleOnCanvas } from '../../lib/canvasModuleNavigation'
import { DeleteTilesConfirmModal } from '../Canvas/DeleteTilesConfirmModal'
import { getSkipDeleteTilesConfirm, setSkipDeleteTilesConfirm } from '../../lib/deleteTilesConfirmPrefs'
import { useToastStore } from '../../store/toastStore'
import { tileTypeDescription } from '../../lib/tileMenuCatalog'

const TYPE_LABEL: Record<TileType, string> = {
  terminal: 'Terminal',
  editor: 'Editor',
  browser: 'Browser',
  agent_browser: 'Agent Browser',
  github: 'GitHub',
  diff: 'Diff',
  todo: 'Todo',
  agent: 'Agent',
  agent_team: 'Agent team',
  agent_group_chat: 'Agent group chat',
  changelog: 'Changelog',
  orchestrator: 'Orchestrator',
  benchmark: 'Benchmark',
  remotion: 'Remotion',
  openrouter_usage: 'OpenRouter',
  toolbox: 'Toolbox',
  research: 'Research',
  reasoning: 'Thinking · Trace',
  project_status: 'Project status',
  telemetry: 'Telemetry',
  hermes_bridge: 'Hermes bridge',
  hermes_agent: 'Hermes agent',
  telegram_onboard: 'Telegram onboard',
  native_gateway: 'Native gateway',
  bug_bounty: 'Bug bounty',
}

function statusLabel(s: TileData['tileStatus']): string {
  if (!s) return 'idle'
  return s
}

function statusClass(s: TileData['tileStatus']): string {
  switch (s) {
    case 'working':
      return 'bg-sky-500/25 text-sky-200 border-sky-500/40'
    case 'done':
      return 'bg-emerald-500/20 text-emerald-200 border-emerald-500/35'
    case 'error':
      return 'bg-rose-500/25 text-rose-200 border-rose-500/40'
    default:
      return 'bg-white/5 text-gray-400 border-white/10'
  }
}

function subtitleFor(tile: TileData): string | null {
  const m = tile.meta
  if (!m || typeof m !== 'object') return null
  const sub = m.subtitle
  if (typeof sub === 'string' && sub.trim()) return sub.trim()
  if (tile.type === 'editor' && typeof m.file === 'string') return m.file
  if (tile.type === 'browser' && m.url != null) return String(m.url).slice(0, 80)
  if (tile.type === 'agent' && m.delegatedTask != null) return String(m.delegatedTask).slice(0, 100)
  return null
}

function tileTypeIcon(type: TileType): ReactNode {
  const cls = 'h-3.5 w-3.5'
  switch (type) {
    case 'editor':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M4 4h16v16H4z" />
          <path d="M8 9h8M8 13h5" />
        </svg>
      )
    case 'terminal':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M4 5h16v14H4z" />
          <path d="M7 10l3 2-3 2M12 14h5" />
        </svg>
      )
    case 'browser':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16" />
        </svg>
      )
    case 'agent':
    case 'hermes_agent':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 19c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5" />
        </svg>
      )
    case 'agent_team':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="8" cy="9" r="2.5" />
          <circle cx="16" cy="9" r="2.5" />
          <path d="M3.5 18c1-2.2 2.7-3.3 4.5-3.3M20.5 18c-1-2.2-2.7-3.3-4.5-3.3" />
        </svg>
      )
    case 'agent_group_chat':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
          <path d="M17 9H9M17 13H9" strokeLinecap="round" />
        </svg>
      )
    case 'orchestrator':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      )
    default:
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
      )
  }
}

/**
 * Sidebar list of all canvas tiles with type + status; click focuses and pans to the tile.
 */
export function ModulesListPanel() {
  const tilesMap = useCanvasStore((s) => s.tiles)
  const activeInteractionTileId = useCanvasStore((s) => s.activeInteractionTileId)
  const removeTile = useCanvasStore((s) => s.removeTile)
  const addToast = useToastStore((s) => s.addToast)

  const [editMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)

  const rows = useMemo(() => {
    const list = Array.from(tilesMap.values())
    return list.sort((a, b) => {
      if (b.zIndex !== a.zIndex) return b.zIndex - a.zIndex
      return a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
    })
  }, [tilesMap])

  const selectedCount = selectedIds.size

  const onPick = useCallback((id: string) => {
    activateModuleOnCanvas(id, { intent: 'user_sidebar' })
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(rows.map((r) => r.id)))
  }, [rows])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const exitEdit = useCallback(() => {
    setEditMode(false)
    setSelectedIds(new Set())
  }, [])

  const requestRemoveSelected = useCallback(() => {
    if (selectedCount === 0) return
    if (getSkipDeleteTilesConfirm()) {
      const ids = [...selectedIds]
      ids.forEach((id) => removeTile(id))
      addToast({
        type: 'info',
        title: 'Removed from canvas',
        message: ids.length === 1 ? '1 tile closed.' : `${ids.length} tiles closed.`,
      })
      exitEdit()
      return
    }
    setConfirmRemoveOpen(true)
  }, [addToast, exitEdit, removeTile, selectedCount, selectedIds])

  const confirmRemove = useCallback(
    (dontShowAgain: boolean) => {
      if (dontShowAgain) setSkipDeleteTilesConfirm(true)
      const ids = [...selectedIds]
      ids.forEach((id) => removeTile(id))
      setConfirmRemoveOpen(false)
      addToast({
        type: 'info',
        title: 'Removed from canvas',
        message: ids.length === 1 ? '1 tile closed.' : `${ids.length} tiles closed.`,
      })
      exitEdit()
    },
    [addToast, exitEdit, removeTile, selectedIds]
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-tile-bg/70 text-gray-300">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-tile-border/80 px-2 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400">Tiles</span>
            <span className="text-[10px] font-normal normal-case text-gray-600">{rows.length}</span>
          </div>
          {editMode && rows.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
              <button
                type="button"
                onClick={selectAll}
                data-tooltip="Select every tile on the canvas for bulk removal."
                className="text-accent-teal/90 hover:text-accent-teal hover:underline"
              >
                All
              </button>
              <span className="text-gray-600">·</span>
              <button
                type="button"
                onClick={clearSelection}
                data-tooltip="Clear the current tile selection."
                className="text-gray-500 hover:text-gray-300 hover:underline"
              >
                None
              </button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {editMode ? (
            <>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={requestRemoveSelected}
                  disabled={selectedCount === 0}
                  data-tooltip="Close the selected tiles and remove them from the canvas."
                  className="rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-200/95 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Remove{selectedCount > 0 ? ` (${selectedCount})` : ''}
                </button>
                <button
                  type="button"
                  onClick={exitEdit}
                  data-tooltip="Leave bulk-edit mode and keep the remaining tiles."
                  className="rounded-md border border-tile-border/80 bg-black/20 px-2 py-1 text-[10px] text-gray-400 hover:bg-tile-hover hover:text-gray-200"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditMode(true)}
              data-tooltip="Select multiple tiles to remove them from the canvas at once."
              className="rounded-md border border-tile-border/80 bg-black/20 px-2 py-1 text-[10px] font-medium text-gray-400 hover:bg-tile-hover hover:text-gray-200"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-gray-500">No tiles on the canvas yet.</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((tile) => {
              const active = activeInteractionTileId === tile.id
              const sub = subtitleFor(tile)
              const typeLabel = TYPE_LABEL[tile.type] ?? tile.type
              const selected = selectedIds.has(tile.id)
              const rowTitle = [tile.title, sub].filter(Boolean).join(' — ')
              const rowTooltip = [tileTypeDescription(tile.type), rowTitle].filter(Boolean).join(' — ')

              return (
                <li key={tile.id}>
                  <button
                    type="button"
                    data-tooltip={rowTooltip}
                    onClick={() => (editMode ? toggleSelect(tile.id) : onPick(tile.id))}
                    className={clsx(
                      'w-full rounded-lg border px-2 py-2 text-left transition-colors',
                      editMode && selected
                        ? 'border-red-400/40 bg-red-500/10'
                        : active
                          ? 'border-accent-teal/40 bg-accent-teal/15'
                          : 'border-transparent hover:border-tile-border/60 hover:bg-white/[0.04]'
                    )}
                  >
                    <div className="flex gap-2">
                      {editMode && (
                        <span
                          className={clsx(
                            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none',
                            selected
                              ? 'border-accent-teal bg-accent-teal/30 text-accent-teal'
                              : 'border-gray-600 bg-black/30 text-gray-600/0'
                          )}
                          aria-hidden
                        >
                          {selected ? '✓' : ''}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-3 break-words text-[13px] font-medium leading-snug text-gray-100">
                          <span className="inline-flex items-start gap-1.5">
                            <span
                              className="mt-[1px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-white/10 bg-black/25 text-gray-300"
                              data-tooltip={typeLabel}
                            >
                              {tileTypeIcon(tile.type)}
                            </span>
                            <span>{tile.title}</span>
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <span className="inline-flex max-w-full break-words rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-gray-500 ring-1 ring-inset ring-white/10">
                            {typeLabel}
                          </span>
                          <span
                            className={clsx(
                              'inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide',
                              statusClass(tile.tileStatus)
                            )}
                          >
                            {statusLabel(tile.tileStatus)}
                          </span>
                          <span className="text-[9px] text-gray-600">z{tile.zIndex}</span>
                        </div>
                        {sub ? (
                          <div
                            className="mt-1 line-clamp-2 break-words font-mono text-[10px] leading-snug text-gray-500"
                            data-tooltip={sub}
                          >
                            {sub}
                          </div>
                        ) : null}
                        <div className="mt-1 truncate text-[9px] text-gray-600 font-mono" data-tooltip={tile.id}>
                          {tile.id}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <DeleteTilesConfirmModal
        open={confirmRemoveOpen}
        title="Remove tiles from canvas?"
        message={
          selectedCount === 1
            ? 'This tile will be closed and removed from the canvas.'
            : `${selectedCount} tiles will be closed and removed from the canvas.`
        }
        confirmLabel="Remove"
        onCancel={() => setConfirmRemoveOpen(false)}
        onConfirm={confirmRemove}
      />
    </div>
  )
}

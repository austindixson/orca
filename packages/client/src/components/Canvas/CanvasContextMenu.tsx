import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { TileType } from '../../store/canvasStore'
import {
  CANVAS_TILE_MENU_GROUPS,
  CANVAS_TILE_OPTIONS,
  filterCanvasTileOptionsForHermesSetting,
  tileMenuOption,
} from '../../lib/tileMenuCatalog'
import { useSettingsStore } from '../../store/settingsStore'

const FLYOUT_W = 240

function favoriteGridColumns(count: number): number {
  if (count <= 0) return 1
  if (count <= 6) return 1
  if (count <= 12) return 2
  if (count <= 20) return 3
  return 4
}

function clampMenuPosition(left: number, top: number, width: number, height: number) {
  const m = 8
  let l = left
  let t = top
  if (l + width > window.innerWidth - m) l = Math.max(m, window.innerWidth - m - width)
  if (t + height > window.innerHeight - m) t = Math.max(m, window.innerHeight - m - height)
  if (l < m) l = m
  if (t < m) t = m
  return { left: l, top: t }
}

type Anchor = { x: number; y: number; canvasX: number; canvasY: number }

export function CanvasContextMenu({
  anchor,
  onClose,
  onAddTile,
}: {
  anchor: Anchor
  onClose: () => void
  onAddTile: (type: TileType) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState({ left: anchor.x, top: anchor.y })
  const [flyout, setFlyout] = useState<{ groupId: string; top: number; left: number } | null>(null)

  const tilePicker = useSettingsStore((s) => s.tilePicker)
  const showHermesAgentTile = useSettingsStore((s) => s.showHermesAgentTile)
  const tilePickerAddCounts = useSettingsStore((s) => s.tilePickerAddCounts)
  const recordTilePickerAdd = useSettingsStore((s) => s.recordTilePickerAdd)

  const allVisible = useMemo(
    () =>
      filterCanvasTileOptionsForHermesSetting(
        CANVAS_TILE_OPTIONS.filter((opt) => {
          const pref = tilePicker[opt.type]
          return pref?.visible !== false
        }),
        showHermesAgentTile
      ),
    [tilePicker, showHermesAgentTile]
  )

  const favoritesOrdered = useMemo(() => {
    const favs = allVisible.filter((opt) => tilePicker[opt.type]?.favorite === true)
    return [...favs].sort((a, b) => {
      const ca = tilePickerAddCounts[a.type] ?? 0
      const cb = tilePickerAddCounts[b.type] ?? 0
      if (ca !== cb) return cb - ca
      return a.label.localeCompare(b.label)
    })
  }, [allVisible, tilePicker, tilePickerAddCounts])

  const favCols = favoriteGridColumns(favoritesOrdered.length)

  const pick = useCallback(
    (type: TileType) => {
      recordTilePickerAdd(type)
      onAddTile(type)
      onClose()
    },
    [onAddTile, onClose, recordTilePickerAdd]
  )

  const refreshApp = useCallback(() => {
    onClose()
    window.location.reload()
  }, [onClose])

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const p = clampMenuPosition(anchor.x, anchor.y, r.width, r.height)
    setMenuPos(p)
  }, [anchor.x, anchor.y, favoritesOrdered.length])

  const openFlyout = (groupId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const estH = 320
    let left = rect.right + 4
    let top = rect.top
    if (left + FLYOUT_W > window.innerWidth - 8) {
      left = Math.max(8, rect.left - FLYOUT_W - 4)
    }
    if (top + estH > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - 8 - estH)
    }
    setFlyout((prev) => (prev?.groupId === groupId ? null : { groupId, top, left }))
  }

  const renderTileRow = (type: TileType) => {
    const opt = tileMenuOption(type)
    if (!opt) return null
    const hidden = tilePicker[type]?.visible === false
    if (hidden) return null
    return (
      <button
        key={type}
        type="button"
        role="menuitem"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          pick(type)
        }}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] leading-tight text-gray-200 hover:bg-tile-hover"
      >
        <span className={clsx('w-4 shrink-0 text-center font-mono text-[10px]', opt.colorClass)}>{opt.icon}</span>
        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
      </button>
    )
  }

  return (
    <>
      <div
        ref={menuRef}
        data-canvas-ctx-menu
        data-context-menu
        className="fixed z-[9999] flex w-[min(92vw,268px)] flex-col overflow-hidden rounded-xl border border-tile-border bg-tile-bg/95 shadow-tile backdrop-blur-xl"
        style={{ left: menuPos.left, top: menuPos.top, maxHeight: 'min(92vh, 720px)' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="shrink-0 border-b border-tile-border/80 px-1 py-1">
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-gray-100 hover:bg-tile-hover"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              refreshApp()
            }}
          >
            <span className="text-base" aria-hidden>
              ↻
            </span>
            <span>Refresh app</span>
          </button>
        </div>

        <div className="min-h-0 shrink overflow-y-auto overflow-x-hidden border-b border-tile-border/60">
          <div className="sticky top-0 z-[1] flex items-center gap-1.5 bg-[#1a1a1a]/95 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400/95 backdrop-blur-sm">
            <span aria-hidden>★</span>
            Favorites
          </div>
          {favoritesOrdered.length === 0 ? (
            <div className="px-2 py-2 text-xs text-gray-500">Star tiles in Settings → Canvas or the Add tile menu.</div>
          ) : (
            <div
              className="grid gap-1 p-1.5"
              style={{
                gridTemplateColumns: `repeat(${favCols}, minmax(0, 1fr))`,
              }}
            >
              {favoritesOrdered.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  role="menuitem"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    pick(opt.type)
                  }}
                  className="flex min-h-[2rem] min-w-0 items-center gap-1 rounded-md border border-tile-border/40 bg-[#252525] px-1.5 py-1 text-left text-[11px] leading-tight text-gray-200 hover:bg-[#333]"
                  data-tooltip={opt.label}
                >
                  <span className={clsx('w-3.5 shrink-0 text-center font-mono text-[9px]', opt.colorClass)}>{opt.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 shrink overflow-y-auto overflow-x-hidden">
          <div className="sticky top-0 z-[1] bg-[#1a1a1a]/95 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 backdrop-blur-sm">
            Add tile
          </div>
          <div className="flex flex-col px-1 py-1">
            {CANVAS_TILE_MENU_GROUPS.map((g) => {
              const visibleTypes = g.types.filter((t) => tilePicker[t]?.visible !== false)
              if (visibleTypes.length === 0) return null
              const open = flyout?.groupId === g.id
              return (
                <div key={g.id} className="relative">
                  <button
                    type="button"
                    className={clsx(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm',
                      open ? 'bg-tile-hover text-white' : 'text-gray-200 hover:bg-tile-hover'
                    )}
                    onMouseDown={(e) => openFlyout(g.id, e)}
                  >
                    <span className="min-w-0 flex-1">{g.label}</span>
                    <span className="text-gray-500" aria-hidden>
                      ›
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {flyout &&
        (() => {
          const group = CANVAS_TILE_MENU_GROUPS.find((x) => x.id === flyout.groupId)
          if (!group) return null
          const items = group.types
            .map((t) => tileMenuOption(t))
            .filter((o): o is NonNullable<typeof o> => o != null && tilePicker[o.type]?.visible !== false)
          return (
            <div
              data-canvas-ctx-flyout
              data-context-menu
              className="fixed z-[10000] flex max-h-[min(70vh,420px)] w-[min(92vw,240px)] flex-col overflow-hidden rounded-lg border border-tile-border bg-[#2a2a2a] py-1 shadow-xl"
              style={{ left: flyout.left, top: flyout.top, width: FLYOUT_W }}
              onMouseDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="border-b border-tile-border/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {group.label}
              </div>
              <div className="overflow-y-auto overscroll-contain px-1 py-0.5">{items.map((o) => renderTileRow(o.type))}</div>
            </div>
          )
        })()}
    </>
  )
}

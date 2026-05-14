import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { TileType } from '../../store/canvasStore'
import {
  CANVAS_TILE_OPTIONS,
  filterCanvasTileOptionsForHermesSetting,
  groupVisibleTilesByMenuCategory,
  sortTileOptionsForAddMenu,
  TILE_ADD_SORT_STORAGE_KEY,
  tileTypeDescription,
  type TileAddSortMode,
} from '../../lib/tileMenuCatalog'
import { useSettingsStore } from '../../store/settingsStore'
import { TOOLBAR_MENU_PORTAL_Z_INDEX } from './useToolbarMenuPortal'

function readStoredTileSortMode(): TileAddSortMode {
  if (typeof window === 'undefined') return 'default'
  const v = localStorage.getItem(TILE_ADD_SORT_STORAGE_KEY)
  if (v === 'alpha' || v === 'category' || v === 'color' || v === 'default') return v
  return 'default'
}

function StarIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

/** Viewport-fixed position for the portaled tile picker (above the toolbar control). */
type MenuLayout = { left: number; bottom: number; maxHeight: number }

export function AddTileDropdown({ onSelect }: { onSelect: (type: TileType) => void }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuLayout, setMenuLayout] = useState<MenuLayout | null>(null)
  const tilePicker = useSettingsStore((s) => s.tilePicker)
  const showHermesAgentTile = useSettingsStore((s) => s.showHermesAgentTile)
  const tilePickerAddCounts = useSettingsStore((s) => s.tilePickerAddCounts)
  const setTileFavorite = useSettingsStore((s) => s.setTileFavorite)
  const recordTilePickerAdd = useSettingsStore((s) => s.recordTilePickerAdd)
  const [sortMode, setSortMode] = useState<TileAddSortMode>(readStoredTileSortMode)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    try {
      localStorage.setItem(TILE_ADD_SORT_STORAGE_KEY, sortMode)
    } catch {
      /* ignore */
    }
  }, [sortMode])

  const updateMenuLayout = useCallback(() => {
    const wrap = wrapRef.current
    const menu = menuRef.current
    if (!wrap || !open) {
      setMenuLayout(null)
      return
    }
    const r = wrap.getBoundingClientRect()
    const topMargin = 8
    const sideMargin = 8
    const maxH = Math.max(120, r.top - topMargin)
    const menuW = menu?.offsetWidth ?? Math.min(38 * 16, window.innerWidth - 2 * sideMargin)
    const rightBound = window.innerWidth - sideMargin - menuW
    const leftViewport = Math.min(Math.max(sideMargin, r.left), Math.max(sideMargin, rightBound))
    setMenuLayout({
      left: leftViewport,
      bottom: window.innerHeight - r.top + 8,
      maxHeight: maxH,
    })
  }, [open])

  useLayoutEffect(() => {
    updateMenuLayout()
  }, [open, updateMenuLayout])

  useEffect(() => {
    if (!open) return
    const onResize = () => updateMenuLayout()
    const onScroll = () => updateMenuLayout()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, updateMenuLayout])

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
  }, [open, close])

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

  /** Visible tiles that are not favorited — favorited ones only appear under Favorites. */
  const unfavoritedVisible = useMemo(
    () => allVisible.filter((opt) => tilePicker[opt.type]?.favorite !== true),
    [allVisible, tilePicker]
  )

  const favoritesOrdered = useMemo(() => {
    const favs = allVisible.filter((opt) => tilePicker[opt.type]?.favorite === true)
    if (sortMode === 'default') {
      return [...favs].sort((a, b) => {
        const ca = tilePickerAddCounts[a.type] ?? 0
        const cb = tilePickerAddCounts[b.type] ?? 0
        if (ca !== cb) return ca - cb
        return a.label.localeCompare(b.label)
      })
    }
    if (sortMode === 'category') {
      return sortTileOptionsForAddMenu(favs, 'alpha')
    }
    return sortTileOptionsForAddMenu(favs, sortMode)
  }, [allVisible, tilePicker, tilePickerAddCounts, sortMode])

  const otherTilesFlat = useMemo(
    () => sortTileOptionsForAddMenu(unfavoritedVisible, sortMode),
    [unfavoritedVisible, sortMode]
  )

  const otherTilesByCategory = useMemo(
    () => groupVisibleTilesByMenuCategory(unfavoritedVisible),
    [unfavoritedVisible]
  )

  useLayoutEffect(() => {
    if (!open) return
    updateMenuLayout()
  }, [open, unfavoritedVisible.length, favoritesOrdered.length, sortMode, updateMenuLayout])

  const pick = (type: TileType) => {
    recordTilePickerAdd(type)
    onSelect(type)
    close()
  }

  const toggleStar = (e: ReactMouseEvent, type: TileType, next: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    setTileFavorite(type, next)
  }

  const renderTileCell = (opt: (typeof CANVAS_TILE_OPTIONS)[number], opts: { favoritedRow?: boolean }) => {
    const fav = tilePicker[opt.type]?.favorite === true
    return (
      <div
        key={opt.type}
        role="presentation"
        className="flex min-h-0 min-w-0 items-stretch rounded-md border border-tile-border/50 bg-[#282828]"
      >
        <button
          type="button"
          role="menuitem"
          data-tooltip={tileTypeDescription(opt.type)}
          className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1.5 text-left text-[12px] leading-tight text-gray-200 hover:bg-[#3c3c3c]"
          onClick={() => pick(opt.type)}
        >
          {opts.favoritedRow && (
            <span className="shrink-0 text-[10px] text-amber-400" aria-hidden>
              ★
            </span>
          )}
          <span className={clsx('w-4 shrink-0 text-center font-mono text-[10px]', opt.colorClass)}>{opt.icon}</span>
          <span className="min-w-0 flex-1 truncate">{opt.label}</span>
        </button>
        <button
          type="button"
          className={clsx(
            'flex w-7 shrink-0 items-center justify-center border-l border-tile-border/40 hover:bg-[#3c3c3c]',
            fav ? 'text-amber-400' : 'text-gray-600 hover:text-amber-400/90'
          )}
          data-tooltip={fav ? 'Remove this tile type from the favorites section below.' : 'Pin this tile type to the favorites section for faster access.'}
          aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={fav}
          onClick={(e) => toggleStar(e, opt.type, !fav)}
        >
          <StarIcon filled={fav} className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex h-7 shrink-0 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11px] font-medium text-gray-300 transition-colors hover:bg-tile-hover hover:text-gray-100'
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        data-tooltip="Add a module tile to the canvas; sort the list by default order, A–Z, category, or accent color."
      >
        <span className="text-[12px] leading-none text-gray-400">+</span>
        <span>Tiles</span>
      </button>

      {open &&
        menuLayout &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              left: menuLayout.left,
              bottom: menuLayout.bottom,
              maxHeight: menuLayout.maxHeight,
              zIndex: TOOLBAR_MENU_PORTAL_Z_INDEX,
            }}
            className="flex w-[min(38rem,calc(100vw-1rem))] flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-tile-border bg-[#2d2d2d] shadow-xl"
          >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-tile-border/80 bg-[#1f1f1f]/90 px-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Other tiles</span>
            <label className="flex min-w-0 items-center gap-1.5 text-[10px] text-gray-400">
              <span className="shrink-0">Sort</span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as TileAddSortMode)}
                className="max-w-[11rem] cursor-pointer rounded border border-tile-border/60 bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] font-medium text-gray-200 focus:border-accent-teal/50 focus:outline-none"
                aria-label="Sort tile list"
              >
                <option value="default">Default</option>
                <option value="alpha">A–Z</option>
                <option value="category">Category (tools)</option>
                <option value="color">Color</option>
              </select>
            </label>
          </div>
          {allVisible.length === 0 ? (
            <div className="shrink-0 px-2 py-2 text-xs text-gray-500">No tiles visible. Update Settings → Tiles.</div>
          ) : unfavoritedVisible.length === 0 ? (
            <div className="shrink-0 px-2 py-2 text-xs text-gray-500">Everything visible is in favorites below.</div>
          ) : sortMode === 'category' ? (
            <div className="flex min-h-0 flex-col gap-2 p-1">
              {otherTilesByCategory.map((section) => (
                <div key={section.id} className="min-w-0">
                  <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                    {section.label}
                  </div>
                  <div className="grid grid-cols-2 gap-1">{section.options.map((opt) => renderTileCell(opt, {}))}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid shrink-0 grid-cols-2 gap-1 p-1">
              {otherTilesFlat.map((opt) => renderTileCell(opt, {}))}
            </div>
          )}

          <div className="flex shrink-0 items-center gap-1.5 border-b border-tile-border/80 bg-[#262626] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400/95">
            <StarIcon filled className="h-3 w-3 shrink-0 text-amber-400" />
            Favorites
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-1 p-1">
            {favoritesOrdered.length === 0 ? (
              <div className="col-span-2 px-2 py-2 text-xs text-gray-500">
                Star a tile in Other tiles to list it here.
              </div>
            ) : (
              favoritesOrdered.map((opt) => renderTileCell(opt, { favoritedRow: true }))
            )}
          </div>
        </div>,
          document.body
        )}
    </div>
  )
}

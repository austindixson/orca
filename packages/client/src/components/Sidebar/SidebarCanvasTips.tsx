import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useCanvasStore, type TileData } from '../../store/canvasStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useWorkspaceStore } from '../../store/workspaceStore'

const ROTATE_MS = 14_000
const ROTATE_MS_REDUCED = 28_000

interface CanvasTip {
  id: string
  title: string
  body: string
}

function browserTileUrl(tile: TileData): string | null {
  if (tile.type !== 'browser') return null
  const m = tile.meta
  if (!m || typeof m !== 'object') return null
  const u = (m as { url?: unknown; initialUrl?: unknown }).url ?? (m as { initialUrl?: unknown }).initialUrl
  return typeof u === 'string' && u.trim() ? u.trim() : null
}

function looksLikeLoopbackDevUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const h = u.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url)
  }
}

function collectTips(args: {
  tiles: TileData[]
  picassoMode: boolean
  intelligentLayoutEnabled: boolean
  hermesOrchestratorMode: boolean
  rootPath: string | null | undefined
}): CanvasTip[] {
  const { tiles, picassoMode, intelligentLayoutEnabled, hermesOrchestratorMode, rootPath } = args
  const list: CanvasTip[] = []
  const push = (t: CanvasTip) => {
    if (!list.some((x) => x.id === t.id)) list.push(t)
  }

  const noWorkspace = !rootPath || rootPath === '.'
  if (noWorkspace) {
    push({
      id: 'open-workspace',
      title: 'Open a workspace folder',
      body: 'Use Open Folder in the explorer or title bar so tiles can resolve project paths, tasks, and file picks against a real tree.',
    })
  }

  if (tiles.length === 0) {
    push({
      id: 'empty-canvas',
      title: 'Start from the toolbar',
      body: 'Add tiles from the canvas toolbar — terminal, editor, browser, agent, and more. Each tile can be dragged and resized.',
    })
  }

  if (tiles.length >= 6 && !picassoMode) {
    push({
      id: 'picasso',
      title: 'Many tiles?',
      body: 'Picasso mode (Settings → Canvas) keeps one tile per module type with in-tile tabs so the canvas stays readable on large projects.',
    })
  }

  if (!intelligentLayoutEnabled) {
    push({
      id: 'intel-layout',
      title: 'Intelligent layout',
      body: 'Turn intelligent layout back on in Settings → Canvas to get anchor-aware placement when spawning tiles.',
    })
  }

  if (hermesOrchestratorMode) {
    push({
      id: 'hermes-mode',
      title: 'External orchestrator',
      body: 'Hermes orchestrator mode hands planning to your external agent; Orca runs tools on the canvas. Keep this app open while the bridge is active.',
    })
  }

  const agentBusy = tiles.some((t) => t.type === 'agent' && t.tileStatus === 'working')
  if (agentBusy) {
    push({
      id: 'agent-busy',
      title: 'Agent on the canvas',
      body: 'While an agent tile shows Working, follow its trace and sub-tiles. You can pan and zoom without interrupting the run.',
    })
  }

  const browserTiles = tiles.filter((t) => t.type === 'browser')
  if (browserTiles.length > 0) {
    push({
      id: 'browser-live-preview',
      title: 'Browser tile vs default browser',
      body: 'Browser tiles now control native Orca preview windows. Use Focus to bring the preview forward and DevTools to inspect the live page.',
    })
  }

  const hasOrcaManagedWebPreview = browserTiles.some(
    (t) =>
      t.meta?.source === 'orchestrator-auto' &&
      t.meta?.previewRole === 'orca-web-preview'
  )
  if (hasOrcaManagedWebPreview) {
    push({
      id: 'orca-web-preview-workspace',
      title: 'Web preview is workspace-scoped',
      body:
        'Orca’s auto-preview browser tile is tied to this project folder. localhost shows whatever process is listening on that port on your machine — set the URL to your dev server (call find_available_port first; do not assume 5173 is free, especially while Orca itself runs on 5173 in dev).',
    })
  }

  const hasLocalhostBrowser = browserTiles.some((t) => {
    const u = browserTileUrl(t)
    return u ? looksLikeLoopbackDevUrl(u) : false
  })
  if (hasLocalhostBrowser) {
    push({
      id: 'preview-localhost',
      title: 'Live preview and localhost',
      body:
        'Set browser tile URLs to your real local server (for example http://localhost:3000). The tile opens a native preview window, so no iframe embedding headers are needed.',
    })
  }

  const fallbacks: CanvasTip[] = [
    {
      id: 'pan-zoom',
      title: 'Navigate the canvas',
      body: 'Pan with space + drag or middle mouse; zoom with the scroll wheel. Fit all tiles from the toolbar when things drift off-screen.',
    },
    {
      id: 'add-tiles',
      title: 'Add modules',
      body: 'Use the + control on the canvas toolbar to spawn new tiles. Hide types you rarely use from the tile picker in Settings.',
    },
  ]

  for (const f of fallbacks) {
    if (list.length >= 5) break
    push(f)
  }

  return list.slice(0, 6)
}

export function SidebarCanvasTips() {
  const sidebarCanvasTipsEnabled = useSettingsStore((s) => s.sidebarCanvasTipsEnabled)
  const setSidebarCanvasTipsEnabled = useSettingsStore((s) => s.setSidebarCanvasTipsEnabled)
  const respectReducedMotion = useSettingsStore((s) => s.respectPrefersReducedMotion)
  const tiles = useCanvasStore((s) => Array.from(s.tiles.values()))
  const picassoMode = useSettingsStore((s) => s.picassoMode)
  const intelligentLayoutEnabled = useSettingsStore((s) => s.intelligentLayoutEnabled)
  const hermesOrchestratorMode = useSettingsStore((s) => s.hermesOrchestratorMode)
  const rootPath = useWorkspaceStore((s) => s.rootPath)

  const tips = useMemo(
    () =>
      collectTips({
        tiles,
        picassoMode,
        intelligentLayoutEnabled,
        hermesOrchestratorMode,
        rootPath,
      }),
    [tiles, picassoMode, intelligentLayoutEnabled, hermesOrchestratorMode, rootPath]
  )

  const tipKey = useMemo(() => tips.map((t) => t.id).join('|'), [tips])

  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
  }, [tipKey])

  const rotateMs = respectReducedMotion ? ROTATE_MS_REDUCED : ROTATE_MS

  useEffect(() => {
    if (!sidebarCanvasTipsEnabled || tips.length <= 1) return
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % tips.length)
    }, rotateMs)
    return () => window.clearInterval(id)
  }, [sidebarCanvasTipsEnabled, tips.length, rotateMs, tipKey])

  const current = tips[index] ?? tips[0]

  const toggleRow = (
    <div className="flex items-center justify-between gap-2 bg-black/15 px-2.5 py-1.5">
      <label htmlFor="sidebar-canvas-tips-toggle" className="cursor-pointer select-none text-[11px] text-gray-500">
        Canvas tips
      </label>
      <input
        id="sidebar-canvas-tips-toggle"
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-tile-border/80 bg-black/30 text-accent-teal focus:ring-accent-teal/40"
        checked={sidebarCanvasTipsEnabled}
        onChange={(e) => setSidebarCanvasTipsEnabled(e.target.checked)}
        data-tooltip="Show rotating tips based on your canvas"
      />
    </div>
  )

  if (!sidebarCanvasTipsEnabled) {
    return (
      <div className="shrink-0 border-t border-tile-border/80 bg-black/15">
        {toggleRow}
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-tile-border/80 bg-black/20">
      <div className="min-h-[4.5rem] px-2.5 py-2">
        {current ? (
          <div key={current.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent-teal/90">{current.title}</div>
            <p className="text-[11px] leading-snug text-gray-400 line-clamp-5" aria-live="polite">
              {current.body}
            </p>
          </div>
        ) : null}
        {tips.length > 1 ? (
          <div className="mt-2 flex items-center justify-center gap-1" role="group" aria-label="Canvas tip pages">
            {tips.map((t, i) => (
              <button
                key={t.id}
                type="button"
                aria-current={i === index ? 'true' : undefined}
                className={clsx(
                  'h-1.5 rounded-full transition-all',
                  i === index ? 'w-4 bg-accent-teal/80' : 'w-1.5 bg-gray-600 hover:bg-gray-500'
                )}
                onClick={() => setIndex(i)}
                data-tooltip={`Tip: ${t.title}`}
              />
            ))}
          </div>
        ) : null}
      </div>
      <div className="border-t border-tile-border/70">{toggleRow}</div>
    </div>
  )
}

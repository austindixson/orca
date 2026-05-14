import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMemPalaceStore, MEM_PALACE_LAYOUT } from '../../store/memPalaceStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useSettingsStore } from '../../store/settingsStore'
import * as tauri from '../../lib/tauri'
import type { ObsidianVaultsSnapshot } from '../../lib/tauri'
import {
  isPlaceholderWorkspace,
  workspaceHasObsidianConfig,
} from '../../lib/integrations/obsidianBrainSetup'

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Quadratic Bezier between two node centers — slight perpendicular bend (Obsidian-style curves; reduces overlap).
 */
function quadraticEdgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bendSign: 1 | -1
): string {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const bend = Math.min(32, len * 0.24)
  const ox = (-dy / len) * bend * bendSign
  const oy = (dx / len) * bend * bendSign
  return `M ${x1} ${y1} Q ${mx + ox} ${my + oy} ${x2} ${y2}`
}

export function ObsidianBrainPanel() {
  const graph = useMemPalaceStore((s) => s.graph)
  const positions = useMemPalaceStore((s) => s.positions)
  const view = useMemPalaceStore((s) => s.view)
  const setView = useMemPalaceStore((s) => s.setView)
  const resetView = useMemPalaceStore((s) => s.resetView)
  const centerViewOnRoot = useMemPalaceStore((s) => s.centerViewOnRoot)
  const brainRootPath = useMemPalaceStore((s) => s.rootPath)
  const selectedPath = useMemPalaceStore((s) => s.selectedPath)
  const setSelectedPath = useMemPalaceStore((s) => s.setSelectedPath)
  const scanning = useMemPalaceStore((s) => s.scanning)
  const error = useMemPalaceStore((s) => s.error)
  const scan = useMemPalaceStore((s) => s.scan)
  const roomColor = useMemPalaceStore((s) => s.roomColor)

  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const rootName = useWorkspaceStore((s) => s.rootName)
  const openFolder = useWorkspaceStore((s) => s.openFolder)
  const setRootPath = useWorkspaceStore((s) => s.setRootPath)
  const defaultObsidianVaultPath = useWorkspaceStore((s) => s.defaultObsidianVaultPath)
  const setDefaultObsidianVaultPath = useWorkspaceStore((s) => s.setDefaultObsidianVaultPath)
  const syncExplorerAfterWrite = useWorkspaceStore((s) => s.syncExplorerAfterWrite)
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel)
  const brainGraphAnimationEnabled = useSettingsStore((s) => s.obsidianBrainGraphAnimationEnabled)
  const setBrainGraphAnimationEnabled = useSettingsStore((s) => s.setObsidianBrainGraphAnimationEnabled)

  const [obsidianProbe, setObsidianProbe] = useState<'idle' | 'loading' | 'yes' | 'no'>('idle')
  const [obsidianSnap, setObsidianSnap] = useState<ObsidianVaultsSnapshot | null>(null)
  const [obsidianSnapLoading, setObsidianSnapLoading] = useState(false)

  const refreshObsidianVaults = useCallback(async () => {
    if (!tauri.isTauri()) return
    setObsidianSnapLoading(true)
    try {
      const snap = await tauri.obsidianVaultsSnapshot()
      setObsidianSnap(snap)
    } finally {
      setObsidianSnapLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshObsidianVaults()
  }, [refreshObsidianVaults])

  const placeholderWs = isPlaceholderWorkspace(rootPath, rootName)
  const noteCount = graph?.nodes.length ?? 0

  useEffect(() => {
    if (placeholderWs) {
      setObsidianProbe('idle')
      return
    }
    setObsidianProbe('loading')
    let cancelled = false
    void workspaceHasObsidianConfig().then((yes) => {
      if (!cancelled) setObsidianProbe(yes ? 'yes' : 'no')
    })
    return () => {
      cancelled = true
    }
  }, [rootPath, rootName, placeholderWs])

  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ px: number; py: number; active: boolean }>({
    px: 0,
    py: 0,
    active: false,
  })

  useEffect(() => {
    if (rootPath && rootPath !== '.') {
      void scan()
    }
  }, [rootPath, scan])

  /** Keep the vault root note in the middle of the SVG after scan (layout pins root at graph center). */
  useLayoutEffect(() => {
    if (scanning || !graph?.nodes.length) return
    const svg = svgRef.current
    if (!svg) return
    const r = svg.getBoundingClientRect()
    centerViewOnRoot(r.width, r.height)
  }, [scanning, graph, brainRootPath, centerViewOnRoot])

  const recenterRoot = useCallback(() => {
    resetView()
    requestAnimationFrame(() => {
      const svg = svgRef.current
      if (!svg) return
      const r = svg.getBoundingClientRect()
      centerViewOnRoot(r.width, r.height)
    })
  }, [resetView, centerViewOnRoot])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const delta = e.deltaY > 0 ? -0.08 : 0.08
      const prev = useMemPalaceStore.getState().view
      const nextScale = Math.min(3, Math.max(0.35, prev.scale + delta))
      const k = nextScale / prev.scale
      const ntx = mx - (mx - prev.tx) * k
      const nty = my - (my - prev.ty) * k
      setView({ scale: nextScale, tx: ntx, ty: nty })
    },
    [setView]
  )

  const onMouseDownBg = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    drag.current = { px: e.clientX, py: e.clientY, active: true }
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current.active) return
      const dx = e.clientX - drag.current.px
      const dy = e.clientY - drag.current.py
      drag.current = { px: e.clientX, py: e.clientY, active: true }
      const v = useMemPalaceStore.getState().view
      setView({ tx: v.tx + dx, ty: v.ty + dy })
    }
    const onUp = () => {
      drag.current.active = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setView])

  const revealInExplorer = useCallback(async () => {
    if (!selectedPath) return
    await syncExplorerAfterWrite(selectedPath)
    setActivePanel('explorer')
  }, [selectedPath, syncExplorerAfterWrite, setActivePanel])

  const { width: lw, height: lh } = MEM_PALACE_LAYOUT

  const showReadyStrip =
    !placeholderWs && !scanning && noteCount > 0 && obsidianProbe === 'yes'

  const showSetupWizard =
    !showReadyStrip &&
    (placeholderWs ||
      (!scanning && noteCount === 0) ||
      (!scanning && noteCount > 0 && (obsidianProbe === 'loading' || obsidianProbe === 'no')))

  return (
    <div className="flex h-full min-h-0 flex-col bg-tile-bg/60 text-gray-300 backdrop-blur-xl">
      <div className="shrink-0 border-b border-tile-border/80 px-4 py-2">
        <div className="text-xs font-medium uppercase tracking-wider text-gray-200">Obsidian brain</div>
        <div className="mt-0.5 text-[10px] leading-snug text-gray-500">
          MemPalace: notes as rooms (folder color), links as edges. Scan your workspace markdown &amp; wikilinks.
        </div>
      </div>

      {tauri.isTauri() && (
        <div className="shrink-0 border-b border-tile-border/80 px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Local Obsidian</div>
            <button
              type="button"
              onClick={() => void refreshObsidianVaults()}
              disabled={obsidianSnapLoading}
              className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-300 disabled:opacity-50"
            >
              {obsidianSnapLoading ? '…' : 'Refresh'}
            </button>
          </div>
          {obsidianSnapLoading && !obsidianSnap ? (
            <p className="mt-1 text-[10px] text-gray-600">Reading vault list…</p>
          ) : obsidianSnap ? (
            <div className="mt-2 space-y-2 text-[10px] leading-snug">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-gray-500">
                <span>
                  App:{' '}
                  <span className={obsidianSnap.obsidianAppInstalled ? 'text-emerald-400/90' : 'text-amber-200/80'}>
                    {obsidianSnap.obsidianAppInstalled ? 'detected' : 'not detected'}
                  </span>
                </span>
                <span>
                  obsidian.json:{' '}
                  <span className={obsidianSnap.configFileFound ? 'text-emerald-400/90' : 'text-gray-500'}>
                    {obsidianSnap.configFileFound ? 'found' : 'not found'}
                  </span>
                </span>
              </div>
              {obsidianSnap.configPath && (
                <div className="truncate font-mono text-[9px] text-gray-600" data-tooltip={obsidianSnap.configPath}>
                  {obsidianSnap.configPath}
                </div>
              )}
              {defaultObsidianVaultPath && (
                <div className="flex flex-wrap items-center gap-2 rounded border border-accent-teal/25 bg-accent-teal/5 px-2 py-1.5">
                  <span className="text-gray-400">Default vault:</span>
                  <span className="max-w-[min(100%,12rem)] truncate font-mono text-[9px] text-gray-300" data-tooltip={defaultObsidianVaultPath}>
                    {defaultObsidianVaultPath}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void setRootPath(defaultObsidianVaultPath, { orchestratorSessionPolicy: 'follow-workspace' })
                    }
                    className="rounded border border-accent-teal/40 bg-accent-teal/15 px-1.5 py-0.5 text-[10px] text-accent-teal hover:bg-accent-teal/25"
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => setDefaultObsidianVaultPath(null)}
                    className="text-[10px] text-gray-500 hover:text-gray-300"
                  >
                    Clear
                  </button>
                </div>
              )}
              {obsidianSnap.vaults.length === 0 ? (
                <p className="text-gray-500">
                  No vaults in Obsidian&apos;s config yet. Open Obsidian once and add a vault, or use File → Open Folder…
                </p>
              ) : (
                <ul className="max-h-36 space-y-1.5 overflow-y-auto pr-0.5">
                  {obsidianSnap.vaults.map((v) => {
                    const isCurrent = normPath(rootPath) === normPath(v.path)
                    const isDefault = defaultObsidianVaultPath != null && normPath(defaultObsidianVaultPath) === normPath(v.path)
                    return (
                      <li
                        key={v.id}
                        className="flex flex-col gap-1 rounded border border-tile-border/50 bg-black/15 px-2 py-1.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-gray-200" data-tooltip={v.path}>
                            {v.name}
                            {isCurrent && (
                              <span className="ml-1.5 text-[9px] font-normal text-emerald-400/90">current workspace</span>
                            )}
                            {isDefault && (
                              <span className="ml-1.5 text-[9px] font-normal text-accent-teal/80">default</span>
                            )}
                          </div>
                          <div className="truncate font-mono text-[9px] text-gray-600" data-tooltip={v.path}>
                            {v.path}
                            {!v.pathExists && (
                              <span className="ml-1 text-amber-200/80">(folder missing)</span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={!v.pathExists}
                            onClick={() => void setRootPath(v.path, { orchestratorSessionPolicy: 'follow-workspace' })}
                            className="rounded border border-tile-border/60 bg-black/25 px-2 py-0.5 text-[10px] text-gray-200 hover:border-accent-teal/45 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Open workspace
                          </button>
                          <button
                            type="button"
                            onClick={() => setDefaultObsidianVaultPath(v.path)}
                            className="rounded border border-tile-border/40 px-2 py-0.5 text-[10px] text-gray-400 hover:border-accent-teal/35 hover:text-gray-200"
                          >
                            Save as default
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-gray-600">Vault list unavailable.</p>
          )}
        </div>
      )}

      {showReadyStrip && (
        <div className="shrink-0 border-b border-emerald-500/25 bg-emerald-500/10 px-4 py-2">
          <div className="text-[11px] font-medium text-emerald-200/95">Vault linked</div>
          <div className="mt-0.5 text-[10px] leading-snug text-emerald-100/70">
            Obsidian config found ({rootName}) · {noteCount} note{noteCount === 1 ? '' : 's'} in the graph.
          </div>
        </div>
      )}

      {showSetupWizard && (
        <div className="max-h-[46vh] shrink-0 overflow-y-auto border-b border-tile-border/80 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">Setup</div>

          {placeholderWs && (
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-gray-400">
              <p>
                Orca does <span className="text-gray-300">not</span> connect to the Obsidian app over the network.
                You point Orca at the <span className="text-gray-300">same folder on disk</span> as your vault.
              </p>
              <ol className="list-decimal space-y-1.5 pl-4 text-[10px] text-gray-400">
                <li>
                  In <strong className="text-gray-300">Obsidian</strong>, create a vault or note the folder path of an
                  existing vault (the folder that contains your <code className="text-accent-teal/90">.md</code> notes).
                </li>
                <li>
                  In <strong className="text-gray-300">Orca</strong>, use{' '}
                  <strong className="text-gray-300">File → Open Folder…</strong> and choose{' '}
                  <strong className="text-gray-300">that exact folder</strong>.
                </li>
                <li>
                  Return here and click <strong className="text-gray-300">Refresh graph</strong> (or wait for auto-scan).
                </li>
              </ol>
              <button
                type="button"
                onClick={() => void openFolder()}
                className="mt-1 w-full rounded-md border border-amber-400/35 bg-amber-500/15 px-2 py-1.5 text-[11px] font-medium text-amber-100 hover:bg-amber-500/25"
              >
                Open folder…
              </button>
            </div>
          )}

          {!placeholderWs && noteCount > 0 && obsidianProbe === 'loading' && (
            <p className="mt-2 text-[10px] text-gray-500">
              Checking vault for Obsidian metadata… ({noteCount} note{noteCount === 1 ? '' : 's'} scanned)
            </p>
          )}

          {!placeholderWs && noteCount === 0 && obsidianProbe === 'loading' && (
            <p className="mt-2 text-[10px] text-gray-500">Checking vault for Obsidian metadata…</p>
          )}

          {!placeholderWs && !scanning && noteCount === 0 && (
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-gray-400">
              <p>
                Workspace <span className="font-mono text-[10px] text-gray-300">{rootName}</span> has no markdown
                notes yet, or the scan failed.
              </p>
              <ul className="list-disc space-y-1 pl-4 text-[10px] text-gray-500">
                <li>Add <code className="text-gray-400">.md</code> files here, or open a different folder.</li>
                <li>
                  If this <em>is</em> your Obsidian vault, create a note in Obsidian so at least one{' '}
                  <code className="text-gray-400">.md</code> exists, then refresh.
                </li>
              </ul>
              <button
                type="button"
                onClick={() => void openFolder()}
                className="w-full rounded-md border border-tile-border/60 bg-black/20 px-2 py-1.5 text-[11px] text-gray-200 hover:border-accent-teal/45"
              >
                Choose another folder…
              </button>
            </div>
          )}

          {!placeholderWs && !scanning && noteCount > 0 && obsidianProbe === 'no' && (
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-gray-400">
              <p className="text-sky-200/90">Graph is working ({noteCount} notes).</p>
              <p className="text-[10px] text-gray-500">
                We do not see an <code className="text-gray-400">.obsidian</code> folder yet. That is optional: Orca
                only needs markdown. To use the <em>same</em> vault you use in Obsidian, open that vault folder in
                Obsidian once (Obsidian creates <code className="text-gray-400">.obsidian</code>), or continue with
                plain markdown in this folder.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-tile-border/80 px-4 py-2">
        <button
          type="button"
          disabled={scanning}
          onClick={() => void scan()}
          className="rounded-md border border-tile-border/60 bg-black/20 px-2 py-1 text-[11px] text-gray-200 hover:border-accent-teal/45 hover:bg-tile-hover/80 disabled:opacity-50"
        >
          {scanning ? 'Scanning…' : 'Refresh graph'}
        </button>
        <button
          type="button"
          onClick={recenterRoot}
          className="rounded-md border border-tile-border/60 bg-black/20 px-2 py-1 text-[11px] text-gray-400 hover:border-accent-teal/45"
          data-tooltip="Reset zoom and center on the wiki root (e.g. wiki/index.md)"
        >
          Recenter root
        </button>
        <span className="text-[10px] text-gray-600">
          {graph ? `${graph.nodes.length} notes · ${graph.edges.length} links` : '—'}
        </span>
        <label className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-gray-500">
          <input
            type="checkbox"
            checked={brainGraphAnimationEnabled}
            onChange={(e) => setBrainGraphAnimationEnabled(e.target.checked)}
            className="h-3.5 w-3.5 accent-accent-teal"
          />
          Animate edges
        </label>
      </div>

      {graph && graph.nodes.length > 1 && graph.edges.length === 0 && (
        <div className="shrink-0 border-b border-tile-border/60 px-4 py-2 text-[10px] leading-relaxed text-gray-500">
          No links yet. Edges appear when notes reference each other with{' '}
          <code className="rounded bg-black/40 px-0.5 text-gray-400">[[Note title]]</code> wikilinks or{' '}
          <code className="rounded bg-black/40 px-0.5 text-gray-400">[text](other.md)</code> markdown links. Then
          refresh the graph.
        </div>
      )}

      {error && (
        <div className="shrink-0 px-4 py-2 text-[11px] text-amber-200/90">{error}</div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!graph || graph.nodes.length === 0 ? (
          <p className="px-4 py-6 text-center text-[11px] text-gray-600">
            {scanning
              ? 'Scanning markdown…'
              : placeholderWs
                ? 'Use Setup above, then refresh.'
                : 'No .md files found in this workspace.'}
          </p>
        ) : (
          <svg
            ref={svgRef}
            className="h-full w-full cursor-grab active:cursor-grabbing touch-none bg-black/20"
            onWheel={onWheel}
            onMouseDown={onMouseDownBg}
          >
            <defs>
              <pattern id="brain-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M 24 0 L 0 0 0 24"
                  fill="none"
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth="1"
                />
              </pattern>
              <filter id="mempalace-edge-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect width="100%" height="100%" fill="url(#brain-grid)" />

            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
              <rect
                x={0}
                y={0}
                width={lw}
                height={lh}
                fill="none"
                stroke="rgba(0,212,170,0.12)"
                strokeWidth="1"
                rx="6"
              />

              {graph.edges.map((e, i) => {
                const pa = positions.get(e.from)
                const pb = positions.get(e.to)
                if (!pa || !pb) return null
                const bendSign: 1 | -1 = i % 2 === 0 ? 1 : -1
                const d = quadraticEdgePath(pa.x, pa.y, pb.x, pb.y, bendSign)
                const strokeMain =
                  e.kind === 'embed'
                    ? 'rgba(147, 197, 253, 0.72)'
                    : e.kind === 'wiki'
                      ? 'rgba(0, 212, 170, 0.7)'
                      : 'rgba(167, 139, 250, 0.65)'
                const strokeGlow =
                  e.kind === 'embed'
                    ? 'rgba(147, 197, 253, 0.45)'
                    : e.kind === 'wiki'
                      ? 'rgba(0, 212, 170, 0.4)'
                      : 'rgba(167, 139, 250, 0.38)'
                return (
                  <g key={`${e.from}-${e.to}-${i}`} className="pointer-events-none">
                    <path
                      d={d}
                      fill="none"
                      stroke={strokeGlow}
                      strokeWidth={5}
                      strokeLinecap="round"
                      opacity={0.42}
                      filter="url(#mempalace-edge-glow)"
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke={strokeMain}
                      strokeWidth={1.35}
                      strokeLinecap="round"
                      className={brainGraphAnimationEnabled ? 'mempalace-edge-animated' : undefined}
                    />
                  </g>
                )
              })}

              {graph.nodes.map((n) => {
                const p = positions.get(n.id)
                if (!p) return null
                const r = 5 + Math.min(6, n.degree * 0.6)
                const sel = selectedPath === n.path
                const fill = roomColor(n.room)
                return (
                  <g key={n.id}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r + (sel ? 3 : 0)}
                      fill="none"
                      stroke={sel ? 'rgba(255,255,255,0.85)' : 'transparent'}
                      strokeWidth={sel ? 2 : 0}
                    />
                    <circle
                      role="button"
                      tabIndex={0}
                      cx={p.x}
                      cy={p.y}
                      r={r}
                      fill={fill}
                      fillOpacity={0.9}
                      stroke="rgba(0,0,0,0.35)"
                      strokeWidth={0.8}
                      className="cursor-pointer hover:opacity-100"
                      onMouseDown={(ev) => {
                        ev.stopPropagation()
                        setSelectedPath(n.path)
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault()
                          setSelectedPath(n.path)
                        }
                      }}
                    />
                    <text
                      x={p.x + r + 4}
                      y={p.y + 3}
                      fill="rgba(200,210,220,0.85)"
                      fontSize="9"
                      fontFamily="system-ui, sans-serif"
                      style={{ pointerEvents: 'none' }}
                    >
                      {n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        )}
      </div>

      <div className="shrink-0 border-t border-tile-border/80 px-4 py-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">MemPalace rooms</div>
        <div className="mt-1 flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
          {graph
            ? [...new Set(graph.nodes.map((n) => n.room))].sort().map((room) => (
                <span
                  key={room}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-gray-300"
                  style={{
                    backgroundColor: `${roomColor(room)}22`,
                    border: `1px solid ${roomColor(room)}55`,
                  }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: roomColor(room) }}
                  />
                  {room}
                </span>
              ))
            : null}
        </div>
        {selectedPath && (
          <div className="mt-2 space-y-1">
            <div className="truncate font-mono text-[10px] text-gray-400" data-tooltip={selectedPath}>
              {selectedPath}
            </div>
            <button
              type="button"
              onClick={() => void revealInExplorer()}
              className="w-full rounded-md border border-accent-teal/40 bg-accent-teal/10 px-2 py-1.5 text-[11px] text-accent-teal hover:bg-accent-teal/20"
            >
              Reveal in explorer
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore, type TileData } from '../../store/canvasStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { buildHermesLeadGraphModel, type HermesLeadNode } from '../../lib/hermesLeadGraph'
import { computeHermesLeadClusterLayout, type HermesLeadLayoutMode } from '../../lib/hermesLeadLayout'
import { computeHermesLeadLens } from '../../lib/hermesLeadLens'
import { computeCardShellMorph, computeTileFrameHandoff } from '../../lib/hermesLeadMorph'
import { projectGraphWithFileDepthLimit } from '../../lib/hermesLeadFileProjection'
import { pruneCollapsedFolderIds } from '../../lib/hermesLeadFolderCollapseMemory'
import { createHermesTileDesignerDraft, validateHermesTileDesignerDraft } from '../../lib/hermesLeadTileDesigner'

interface PositionedNode extends HermesLeadNode {
  x: number
  y: number
}

interface MorphShell {
  fromLeft: number
  fromTop: number
  fromWidth: number
  fromHeight: number
  fromRadius: number
  toLeft: number
  toTop: number
  toWidth: number
  toHeight: number
  toRadius: number
  durationMs: number
  active: boolean
}

interface TileOpenHandoff {
  fromLeft: number
  fromTop: number
  fromWidth: number
  fromHeight: number
  toLeft: number
  toTop: number
  toWidth: number
  toHeight: number
  durationMs: number
  active: boolean
}

function nearestTileCenterPan(tile: TileData, zoom: number, host: HTMLElement | null) {
  if (!host) return null
  const rect = host.getBoundingClientRect()
  const centerX = tile.x + tile.w / 2
  const centerY = tile.y + tile.h / 2
  return {
    x: rect.width / 2 - centerX * zoom,
    y: rect.height / 2 - centerY * zoom,
  }
}

function nodeRadius(node: HermesLeadNode, selected: boolean): number {
  const base =
    node.kind === 'hermes'
      ? 14
      : node.kind === 'agent'
        ? 11
        : node.kind === 'tool'
          ? 9
          : node.kind === 'folder'
            ? 8
            : 6
  return selected ? base + 2 : base
}

function nodeColor(node: HermesLeadNode): string {
  if (node.kind === 'hermes') return '#2dd4bf'
  if (node.kind === 'agent') return '#38bdf8'
  if (node.kind === 'tool') return '#a78bfa'
  if (node.kind === 'folder') return '#f59e0b'
  if (node.kind === 'file') return '#94a3b8'
  return '#a78bfa'
}

function collectRecentToolNames(toolFeed: string[], latestToolName: string | null): string[] {
  const fromFeed = toolFeed
    .map((line) => line.trim().match(/^(?:→|←)\s*([A-Za-z0-9_:-]+)/)?.[1] ?? null)
    .filter((v): v is string => !!v)
  const base = latestToolName ? [latestToolName, ...fromFeed] : fromFeed
  return Array.from(new Set(base)).slice(0, 10)
}

export function HermesLeadCanvasView() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const graphPaneRef = useRef<HTMLDivElement | null>(null)
  const focusCardRef = useRef<HTMLDivElement | null>(null)

  const tiles = useCanvasStore((s) => s.tiles)
  const zoom = useCanvasStore((s) => s.zoom)
  const pan = useCanvasStore((s) => s.pan)
  const bringToFront = useCanvasStore((s) => s.bringToFront)
  const setPan = useCanvasStore((s) => s.setPan)
  const setCanvasViewMode = useCanvasStore((s) => s.setCanvasViewMode)
  const setActiveInteractionTile = useCanvasStore((s) => s.setActiveInteractionTile)
  const files = useWorkspaceStore((s) => s.files)
  const orchestratorAutoFocus = useWorkspaceStore((s) => s.orchestratorAutoFocus)
  const collapsedFolderIds = useWorkspaceStore((s) => s.hermesLeadCollapsedFolderIds)
  const setCollapsedFolderIds = useWorkspaceStore((s) => s.setHermesLeadCollapsedFolderIds)
  const toggleCollapsedFolderId = useWorkspaceStore((s) => s.toggleHermesLeadCollapsedFolderId)
  const activeTileFocus = useOrchestratorActivityStore((s) => s.lastOrchestratorTileId)
  const latestToolName = useOrchestratorActivityStore((s) => s.latestToolName)
  const latestToolRunning = useOrchestratorActivityStore((s) => s.latestToolRunning)
  const latestToolElapsedMs = useOrchestratorActivityStore((s) => s.latestToolElapsedMs)
  const toolFeed = useOrchestratorActivityStore((s) => s.toolFeed)
  const running = useOrchestratorActivityStore((s) => s.running)
  const verb = useOrchestratorActivityStore((s) => s.verb)
  const iteration = useOrchestratorActivityStore((s) => s.iteration)
  const sessionToolDepthByKey = useOrchestratorActivityStore((s) => s.sessionToolDepthByKey)

  const recentToolNames = useMemo(
    () => collectRecentToolNames(toolFeed.slice(-20), latestToolName),
    [latestToolName, toolFeed]
  )

  const model = useMemo(
    () =>
      buildHermesLeadGraphModel({
        tiles,
        files,
        focusTileId: activeTileFocus,
        maxFileNodes: 120,
        toolNames: recentToolNames,
        maxToolNodes: 10,
      }),
    [activeTileFocus, files, recentToolNames, tiles]
  )

  const [selectedNodeId, setSelectedNodeId] = useState<string>('hermes:lead')
  const [filters, setFilters] = useState({ agents: true, files: true, tools: true, tiles: true })
  const [layoutMode, setLayoutMode] = useState<HermesLeadLayoutMode>('auto')
  const [fileDepthLimit, setFileDepthLimit] = useState<number>(3)
  const [interFamilyRelaxIterations, setInterFamilyRelaxIterations] = useState<number>(4)
  const [interFamilyRelaxStrength, setInterFamilyRelaxStrength] = useState<number>(1)
  const [tileDesignerName, setTileDesignerName] = useState('')
  const [tileDesignerDescription, setTileDesignerDescription] = useState('')
  const [tileDesignerTools, setTileDesignerTools] = useState('read_file, search_files')
  const [tileDesignerOutput, setTileDesignerOutput] = useState('')
  const [tileDesignerErrors, setTileDesignerErrors] = useState<string[]>([])
  const [morphShell, setMorphShell] = useState<MorphShell | null>(null)
  const [tileOpenHandoff, setTileOpenHandoff] = useState<TileOpenHandoff | null>(null)

  useEffect(() => {
    if (!orchestratorAutoFocus || !activeTileFocus) return
    setSelectedNodeId(`tile:${activeTileFocus}`)
  }, [activeTileFocus, orchestratorAutoFocus])

  useEffect(() => {
    const visibleFolders = new Set(model.nodes.filter((n) => n.kind === 'folder').map((n) => n.id))
    const pruned = pruneCollapsedFolderIds(collapsedFolderIds, visibleFolders)
    if (pruned.changed) {
      setCollapsedFolderIds(pruned.ids)
    }
  }, [collapsedFolderIds, model.nodes, setCollapsedFolderIds])

  const visibleNodeIds = useMemo(() => {
    const set = new Set<string>()
    for (const n of model.nodes) {
      if (n.kind === 'hermes') {
        set.add(n.id)
        continue
      }
      if (n.kind === 'agent' && filters.agents) {
        set.add(n.id)
        continue
      }
      if ((n.kind === 'folder' || n.kind === 'file') && filters.files) {
        set.add(n.id)
        continue
      }
      if (n.kind === 'tool' && filters.tools) {
        set.add(n.id)
        continue
      }
      if (n.kind === 'tile' && filters.tiles) {
        set.add(n.id)
      }
    }
    return set
  }, [filters.agents, filters.files, filters.tiles, filters.tools, model.nodes])

  const baseFilteredNodes = useMemo(
    () => model.nodes.filter((n) => visibleNodeIds.has(n.id)),
    [model.nodes, visibleNodeIds]
  )

  const baseFilteredEdges = useMemo(
    () => model.edges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)),
    [model.edges, visibleNodeIds]
  )

  const fileProjected = useMemo(
    () =>
      projectGraphWithFileDepthLimit({
        nodes: baseFilteredNodes,
        edges: baseFilteredEdges,
        maxFileDepth: fileDepthLimit,
        collapsedFolderIds,
      }),
    [baseFilteredEdges, baseFilteredNodes, collapsedFolderIds, fileDepthLimit]
  )

  const filteredNodes = fileProjected.nodes
  const filteredEdges = fileProjected.edges

  const resolvedLayoutMode = useMemo(() => {
    if (layoutMode !== 'auto') return layoutMode
    return filteredNodes.length >= 46 ? 'pack' : 'semantic'
  }, [filteredNodes.length, layoutMode])

  const positioned = useMemo<PositionedNode[]>(() => {
    const points = computeHermesLeadClusterLayout(filteredNodes, {
      width: 1000,
      height: 760,
      mode: layoutMode,
      packThreshold: 46,
      relaxIterations: 7,
      interFamilyRelaxIterations: resolvedLayoutMode === 'pack' ? interFamilyRelaxIterations : 0,
      interFamilyRelaxStrength: resolvedLayoutMode === 'pack' ? interFamilyRelaxStrength : 1,
    })
    const byId = new Map(points.map((p) => [p.id, p]))
    return filteredNodes.map((node) => {
      const pt = byId.get(node.id)
      if (pt) return { ...node, x: pt.x, y: pt.y }
      return { ...node, x: 500, y: 420 }
    })
  }, [filteredNodes, interFamilyRelaxIterations, interFamilyRelaxStrength, layoutMode, resolvedLayoutMode])

  const positionedById = useMemo(() => {
    const out: Record<string, PositionedNode> = {}
    for (const n of positioned) out[n.id] = n
    return out
  }, [positioned])

  useEffect(() => {
    if (!positioned.length) return
    if (!positionedById[selectedNodeId]) {
      setSelectedNodeId('hermes:lead')
    }
  }, [positioned, positionedById, selectedNodeId])

  const selectedNode = positionedById[selectedNodeId] ?? positioned[0] ?? null
  const selectedTile = selectedNode?.tileId ? tiles.get(selectedNode.tileId) ?? null : null
  const selectedFolderCollapsed = selectedNode?.kind === 'folder' ? collapsedFolderIds.has(selectedNode.id) : false

  const handleGenerateTileDraft = () => {
    const requestedTools = tileDesignerTools
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const draft = createHermesTileDesignerDraft({
      name: tileDesignerName,
      description: tileDesignerDescription,
      requestedTools,
    })
    const validation = validateHermesTileDesignerDraft(draft)
    setTileDesignerErrors(validation.errors)
    setTileDesignerOutput(JSON.stringify(draft, null, 2))
  }

  const lens = useMemo(
    () =>
      computeHermesLeadLens({
        model,
        running,
        iteration,
        latestToolName,
        latestToolRunning,
        latestToolElapsedMs,
        verb,
        sessionToolDepthByKey,
        toolFeed,
      }),
    [
      iteration,
      latestToolElapsedMs,
      latestToolName,
      latestToolRunning,
      model,
      running,
      sessionToolDepthByKey,
      toolFeed,
      verb,
    ]
  )

  useEffect(() => {
    if (!selectedNode) return
    if (!rootRef.current || !graphPaneRef.current || !focusCardRef.current) return

    const rootRect = rootRef.current.getBoundingClientRect()
    const graphRect = graphPaneRef.current.getBoundingClientRect()
    const focusRect = focusCardRef.current.getBoundingClientRect()
    const shell = computeCardShellMorph({
      node: {
        x: selectedNode.x,
        y: selectedNode.y,
        radius: nodeRadius(selectedNode, true),
      },
      graphRect,
      focusRect,
      viewBox: { width: 1000, height: 760 },
    })

    setMorphShell({
      fromLeft: shell.from.left - rootRect.left,
      fromTop: shell.from.top - rootRect.top,
      fromWidth: shell.from.width,
      fromHeight: shell.from.height,
      fromRadius: shell.from.radius,
      toLeft: shell.to.left - rootRect.left,
      toTop: shell.to.top - rootRect.top,
      toWidth: shell.to.width,
      toHeight: shell.to.height,
      toRadius: shell.to.radius,
      durationMs: shell.durationMs,
      active: false,
    })

    const raf = window.requestAnimationFrame(() => {
      setMorphShell((prev) => (prev ? { ...prev, active: true } : null))
    })
    const timer = window.setTimeout(() => {
      setMorphShell(null)
    }, shell.durationMs + 120)

    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [selectedNode?.id, selectedNode?.x, selectedNode?.y])

  return (
    <div ref={rootRef} className="pointer-events-auto absolute inset-0 z-[15] flex min-h-0 min-w-0 bg-[#0d0d0d]">
      {morphShell && (
        <div
          className="pointer-events-none absolute z-40 border border-teal-300/70 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.45)]"
          style={{
            left: morphShell.active ? morphShell.toLeft : morphShell.fromLeft,
            top: morphShell.active ? morphShell.toTop : morphShell.fromTop,
            width: morphShell.active ? morphShell.toWidth : morphShell.fromWidth,
            height: morphShell.active ? morphShell.toHeight : morphShell.fromHeight,
            borderRadius: morphShell.active ? morphShell.toRadius : morphShell.fromRadius,
            opacity: morphShell.active ? 0 : 0.95,
            transition: `all ${morphShell.durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          }}
        />
      )}

      {tileOpenHandoff && (
        <div
          className="pointer-events-none absolute z-50 border border-cyan-300/70 bg-cyan-400/10 shadow-[0_0_22px_rgba(56,189,248,0.45)]"
          style={{
            left: tileOpenHandoff.active ? tileOpenHandoff.toLeft : tileOpenHandoff.fromLeft,
            top: tileOpenHandoff.active ? tileOpenHandoff.toTop : tileOpenHandoff.fromTop,
            width: tileOpenHandoff.active ? tileOpenHandoff.toWidth : tileOpenHandoff.fromWidth,
            height: tileOpenHandoff.active ? tileOpenHandoff.toHeight : tileOpenHandoff.fromHeight,
            borderRadius: 12,
            opacity: tileOpenHandoff.active ? 0 : 0.95,
            transition: `all ${tileOpenHandoff.durationMs}ms cubic-bezier(0.2, 0.9, 0.2, 1), opacity ${tileOpenHandoff.durationMs}ms ease-out`,
          }}
        />
      )}

      <div className="flex min-h-0 w-1/2 min-w-0 flex-col border-r border-white/[0.08] bg-[#111111] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-100">Hermes Lead Focus</h2>
          <span className="rounded bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-300">beta</span>
        </div>

        <div className="mb-3 rounded-xl border border-tile-border/60 bg-black/20 p-2.5 text-[11px] text-gray-300">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-gray-400">Hermes Lens</div>
          <div className="grid grid-cols-2 gap-2">
            <div>Agents: <span className="text-gray-100">{lens.agentCount}</span></div>
            <div>Files: <span className="text-gray-100">{lens.fileCount}</span></div>
            <div>Tools: <span className="text-violet-300">{lens.toolCount}</span></div>
            <div>Active: <span className="text-teal-300">{lens.activeCount}</span></div>
            <div>Links: <span className="text-gray-100">{lens.edgeCount}</span></div>
            <div>Depth: <span className="text-sky-300">{lens.delegationDepth}</span></div>
            <div className="col-span-2">Intent: <span className="text-gray-100">{lens.intent}</span></div>
            <div>Hotspots: <span className="text-amber-300">{lens.delegationHotspots}</span></div>
            <div>Iteration: <span className="text-gray-100">{iteration}</span></div>
          </div>
          <div className="mt-2 space-y-1.5">
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] text-gray-400">
                <span>Confidence</span>
                <span className="text-emerald-300">{Math.round(lens.confidence * 100)}%</span>
              </div>
              <div className="h-1.5 rounded bg-gray-800/80">
                <div className="h-1.5 rounded bg-emerald-400/80" style={{ width: `${Math.round(lens.confidence * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] text-gray-400">
                <span>Risk</span>
                <span className="text-rose-300">{Math.round(lens.risk * 100)}%</span>
              </div>
              <div className="h-1.5 rounded bg-gray-800/80">
                <div className="h-1.5 rounded bg-rose-400/80" style={{ width: `${Math.round(lens.risk * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {([
            ['agents', 'Agents'],
            ['files', 'Files'],
            ['tools', 'Tools'],
            ['tiles', 'Tiles'],
          ] as const).map(([key, label]) => {
            const active = filters[key]
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, [key]: !prev[key] }))}
                className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                  active
                    ? 'border-teal-500/45 bg-teal-500/12 text-teal-200'
                    : 'border-tile-border/70 bg-black/20 text-gray-400 hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            )
          })}
          {(['auto', 'semantic', 'pack'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setLayoutMode(mode)}
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                layoutMode === mode
                  ? 'border-violet-500/45 bg-violet-500/15 text-violet-200'
                  : 'border-tile-border/70 bg-black/20 text-gray-400 hover:text-gray-200'
              }`}
            >
              {mode}
            </button>
          ))}
          {([1, 2, 3] as const).map((depth) => (
            <button
              key={`depth-${depth}`}
              type="button"
              onClick={() => setFileDepthLimit(depth)}
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                fileDepthLimit === depth
                  ? 'border-amber-500/45 bg-amber-500/12 text-amber-200'
                  : 'border-tile-border/70 bg-black/20 text-gray-400 hover:text-gray-200'
              }`}
            >
              files≤{depth}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFileDepthLimit(99)}
            className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
              fileDepthLimit >= 99
                ? 'border-amber-500/45 bg-amber-500/12 text-amber-200'
                : 'border-tile-border/70 bg-black/20 text-gray-400 hover:text-gray-200'
            }`}
          >
            files:all
          </button>

          <span className="self-center text-[10px] text-gray-500">relax:</span>
          {[0, 2, 4, 6].map((iters) => (
            <button
              key={`inter-relax-${iters}`}
              type="button"
              onClick={() => setInterFamilyRelaxIterations(iters)}
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                interFamilyRelaxIterations === iters
                  ? 'border-fuchsia-500/45 bg-fuchsia-500/12 text-fuchsia-200'
                  : 'border-tile-border/70 bg-black/20 text-gray-400 hover:text-gray-200'
              }`}
            >
              r{iters}
            </button>
          ))}

          <span className="self-center text-[10px] text-gray-500">strength:</span>
          {([
            { label: 'low', value: 0.7 },
            { label: 'med', value: 1 },
            { label: 'high', value: 1.4 },
          ] as const).map((entry) => (
            <button
              key={`inter-strength-${entry.label}`}
              type="button"
              onClick={() => setInterFamilyRelaxStrength(entry.value)}
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                Math.abs(interFamilyRelaxStrength - entry.value) < 0.01
                  ? 'border-fuchsia-500/45 bg-fuchsia-500/12 text-fuchsia-200'
                  : 'border-tile-border/70 bg-black/20 text-gray-400 hover:text-gray-200'
              }`}
            >
              {entry.label}
            </button>
          ))}
          <span className="self-center text-[10px] text-gray-500">layout:{resolvedLayoutMode}</span>
        </div>

        {selectedNode ? (
          <div ref={focusCardRef} className="rounded-xl border border-tile-border/70 bg-black/25 p-3 transition-all duration-200">
            <div className="text-xs uppercase tracking-wide text-gray-400">{selectedNode.kind}</div>
            <div className="mt-1 text-sm font-semibold text-gray-100">{selectedNode.label}</div>
            {selectedNode.path && <div className="mt-1 text-[11px] text-gray-400">{selectedNode.path}</div>}
            {selectedNode.status && (
              <div className="mt-2 inline-flex rounded-md border border-tile-border/60 bg-black/30 px-2 py-0.5 text-[10px] text-gray-300">
                {selectedNode.status}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedTile && (
                <button
                  type="button"
                  className="rounded-lg border border-teal-500/40 bg-teal-500/10 px-2 py-1 text-[11px] text-teal-200 hover:bg-teal-500/20"
                  onClick={() => {
                    const rootRect = rootRef.current?.getBoundingClientRect() ?? null
                    const focusRect = focusCardRef.current?.getBoundingClientRect() ?? null
                    const host = document.querySelector('[data-testid="infinite-canvas"]') as HTMLElement | null
                    const hostRect = host?.getBoundingClientRect() ?? null

                    if (rootRect && focusRect && hostRect) {
                      const handoff = computeTileFrameHandoff({
                        tile: {
                          x: selectedTile.x,
                          y: selectedTile.y,
                          w: selectedTile.w,
                          h: selectedTile.h,
                        },
                        pan,
                        zoom,
                        rootRect,
                        hostRect,
                        focusRect,
                      })

                      setTileOpenHandoff({
                        fromLeft: handoff.from.left,
                        fromTop: handoff.from.top,
                        fromWidth: handoff.from.width,
                        fromHeight: handoff.from.height,
                        toLeft: handoff.to.left,
                        toTop: handoff.to.top,
                        toWidth: handoff.to.width,
                        toHeight: handoff.to.height,
                        durationMs: handoff.durationMs,
                        active: false,
                      })

                      window.requestAnimationFrame(() => {
                        setTileOpenHandoff((prev) => (prev ? { ...prev, active: true } : null))
                      })

                      window.setTimeout(() => {
                        setCanvasViewMode('tiles')
                        bringToFront(selectedTile.id)
                        setActiveInteractionTile(selectedTile.id)
                        const centeredPan = nearestTileCenterPan(selectedTile, zoom, host)
                        if (centeredPan) setPan(centeredPan)
                        setTileOpenHandoff(null)
                      }, handoff.durationMs)
                      return
                    }

                    setCanvasViewMode('tiles')
                    bringToFront(selectedTile.id)
                    setActiveInteractionTile(selectedTile.id)
                    const centeredPan = nearestTileCenterPan(selectedTile, zoom, host)
                    if (centeredPan) setPan(centeredPan)
                  }}
                >
                  Open tile
                </button>
              )}
              {selectedNode?.kind === 'folder' && (
                <button
                  type="button"
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/20"
                  onClick={() => toggleCollapsedFolderId(selectedNode.id)}
                >
                  {selectedFolderCollapsed ? 'Expand branch' : 'Collapse branch'}
                </button>
              )}
              <button
                type="button"
                className="rounded-lg border border-tile-border/70 bg-black/20 px-2 py-1 text-[11px] text-gray-200 hover:bg-black/35"
                onClick={() => setSelectedNodeId('hermes:lead')}
              >
                Collapse back
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-tile-border/60 p-4 text-xs text-gray-400">No node selected.</div>
        )}

        <div className="mt-3 rounded-xl border border-fuchsia-500/25 bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fuchsia-200">Tile Designer (wave 8)</div>
            <span className="text-[10px] text-fuchsia-300/80">scaffold + conformance</span>
          </div>
          <div className="grid gap-2">
            <input
              value={tileDesignerName}
              onChange={(e) => setTileDesignerName(e.target.value)}
              placeholder="Tile name (e.g. Release Radar)"
              className="rounded border border-tile-border/70 bg-black/30 px-2 py-1 text-[11px] text-gray-100 outline-none focus:border-fuchsia-400/60"
            />
            <input
              value={tileDesignerDescription}
              onChange={(e) => setTileDesignerDescription(e.target.value)}
              placeholder="What should this tile do?"
              className="rounded border border-tile-border/70 bg-black/30 px-2 py-1 text-[11px] text-gray-100 outline-none focus:border-fuchsia-400/60"
            />
            <input
              value={tileDesignerTools}
              onChange={(e) => setTileDesignerTools(e.target.value)}
              placeholder="Comma-separated tools"
              className="rounded border border-tile-border/70 bg-black/30 px-2 py-1 text-[11px] text-gray-100 outline-none focus:border-fuchsia-400/60"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded border border-fuchsia-500/45 bg-fuchsia-500/15 px-2 py-1 text-[11px] text-fuchsia-200 hover:bg-fuchsia-500/25"
                onClick={handleGenerateTileDraft}
              >
                Generate draft
              </button>
              <button
                type="button"
                className="rounded border border-tile-border/70 bg-black/20 px-2 py-1 text-[11px] text-gray-300 hover:bg-black/35"
                onClick={() => {
                  setTileDesignerOutput('')
                  setTileDesignerErrors([])
                }}
              >
                Clear
              </button>
            </div>
            {tileDesignerErrors.length > 0 && (
              <div className="rounded border border-rose-500/35 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-200">
                {tileDesignerErrors.join(' | ')}
              </div>
            )}
            {tileDesignerOutput && (
              <pre className="max-h-40 overflow-auto rounded border border-fuchsia-500/20 bg-black/40 p-2 text-[10px] text-fuchsia-100">
                {tileDesignerOutput}
              </pre>
            )}
          </div>
        </div>
      </div>

      <div ref={graphPaneRef} className="relative min-h-0 w-1/2 min-w-0 bg-[#0a0a0a] p-2">
        <svg viewBox="0 0 1000 760" className="h-full w-full rounded-xl border border-tile-border/60 bg-black/20">
          {filteredEdges.map((edge) => {
            const a = positionedById[edge.source]
            const b = positionedById[edge.target]
            if (!a || !b) return null
            const isContains = edge.kind === 'contains'
            const containsToFile = isContains && b.kind === 'file'
            const stroke =
              edge.kind === 'focus'
                ? '#2dd4bf'
                : edge.kind === 'spawn'
                  ? '#38bdf8'
                  : edge.kind === 'tool'
                    ? '#a78bfa'
                    : containsToFile
                      ? '#94a3b8'
                      : '#64748b'
            const opacity = edge.kind === 'contains' ? 0.24 : 0.56
            return (
              <line
                key={edge.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeOpacity={opacity}
                strokeWidth={edge.kind === 'contains' ? 1 : 1.2}
                strokeDasharray={edge.kind === 'contains' ? '4 3' : undefined}
                style={{ transition: 'all 220ms ease' }}
              />
            )
          })}

          {positioned.map((node) => {
            const selected = selectedNodeId === node.id
            return (
              <g
                key={node.id}
                onClick={() => setSelectedNodeId(node.id)}
                style={{ cursor: 'pointer', transition: 'transform 180ms ease' }}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={nodeRadius(node, selected)}
                  fill={nodeColor(node)}
                  fillOpacity={selected ? 0.95 : 0.72}
                  stroke={selected ? '#e2e8f0' : 'transparent'}
                  strokeWidth={selected ? 1.5 : 0}
                  style={{ transition: 'all 180ms ease' }}
                />
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

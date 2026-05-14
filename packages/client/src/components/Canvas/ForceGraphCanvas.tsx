import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph from 'force-graph'
import { forceCollide } from 'd3-force'
import { useCanvasStore, type CanvasGraphLink, type TileData } from '../../store/canvasStore'
import { useSettingsStore } from '../../store/settingsStore'
import { deriveGraphLinks } from '../../lib/tileLinks'
import { type GraphNodeDatum, renderGraphNode } from './GraphNodeRenderer'
import { useToastStore } from '../../store/toastStore'

interface GraphNode extends GraphNodeDatum {
  x?: number
  y?: number
  vx?: number
  vy?: number
}

interface GraphLink {
  id: string
  source: string | GraphNode
  target: string | GraphNode
  type: CanvasGraphLink['type']
  label?: string
}

interface ForceLinkLike {
  distance?: (distance: number) => ForceLinkLike
  strength?: (strength: number) => ForceLinkLike
}

interface ForceChargeLike {
  strength?: (strength: number) => ForceChargeLike
}

interface ForceCollideLike {
  radius?: (fn: (node: GraphNode) => number) => ForceCollideLike
  strength?: (value: number) => ForceCollideLike
  iterations?: (value: number) => ForceCollideLike
}

function edgeNodeId(endpoint: string | GraphNode): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function simpleScore(query: string, title: string, type: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const t = title.toLowerCase()
  const ty = type.toLowerCase()
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (t.includes(q)) return 60
  if (ty.includes(q)) return 35
  return 0
}

function graphTitleFromTile(tile: TileData): string {
  const raw = tile.title?.trim()
  if (raw) return raw
  return tile.type.replace(/_/g, ' ')
}

function linkColor(link: GraphLink): string {
  if (link.type === 'delegation') return 'rgba(45, 212, 191, 0.78)'
  if (link.type === 'dataFlow') return 'rgba(245, 158, 11, 0.72)'
  return 'rgba(148, 163, 184, 0.62)'
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

export function ForceGraphCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ReturnType<ReturnType<typeof ForceGraph<GraphNode, GraphLink>>> | null>(null)
  const nodeByIdRef = useRef<Record<string, { x: number; y: number }>>({})
  const selectedNodePosRef = useRef<{ x: number; y: number } | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  const dragProfileActiveRef = useRef(false)
  const activeDragNodeIdRef = useRef<string | null>(null)
  const configureForcesRef = useRef<
    (
      graph: ReturnType<ReturnType<typeof ForceGraph<GraphNode, GraphLink>>>,
      nodeCount: number,
      profile: 'baseline' | 'drag'
    ) => void
  >(() => {})
  const graphLiveMagneticDragEnabledRef = useRef(true)
  const nodeCountRef = useRef(1)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const tilesMap = useCanvasStore((s) => s.tiles)
  const graphLinksManual = useCanvasStore((s) => s.graphLinks)
  const graphNodePositions = useCanvasStore((s) => s.graphNodePositions)
  const addTile = useCanvasStore((s) => s.addTile)
  const updateTile = useCanvasStore((s) => s.updateTile)
  const upsertGraphLink = useCanvasStore((s) => s.upsertGraphLink)
  const setGraphNodePosition = useCanvasStore((s) => s.setGraphNodePosition)
  const setGraphNodePositions = useCanvasStore((s) => s.setGraphNodePositions)
  const setCanvasViewMode = useCanvasStore((s) => s.setCanvasViewMode)
  const bringToFront = useCanvasStore((s) => s.bringToFront)
  const setActiveInteractionTile = useCanvasStore((s) => s.setActiveInteractionTile)
  const setPan = useCanvasStore((s) => s.setPan)
  const zoom = useCanvasStore((s) => s.zoom)

  const graphLinksDelegationEnabled = useSettingsStore((s) => s.graphLinksDelegationEnabled)
  const graphLinksDataFlowEnabled = useSettingsStore((s) => s.graphLinksDataFlowEnabled)
  const graphLinksManualEnabled = useSettingsStore((s) => s.graphLinksManualEnabled)
  const graphPhysicsStrength = useSettingsStore((s) => s.graphPhysicsStrength)
  const graphNodeScale = useSettingsStore((s) => s.graphNodeScale)
  const graphAdvancedWorkflowEnabled = useSettingsStore((s) => s.graphAdvancedWorkflowEnabled)
  const graphContextRadius = useSettingsStore((s) => s.graphContextRadius)
  const graphLiveMagneticDragEnabled = useSettingsStore((s) => s.graphLiveMagneticDragEnabled)
  const addToast = useToastStore((s) => s.addToast)

  const configureForces = useCallback((
    graph: ReturnType<ReturnType<typeof ForceGraph<GraphNode, GraphLink>>>,
    nodeCount: number,
    profile: 'baseline' | 'drag'
  ) => {
    const crowdFactor = Math.min(2.2, Math.max(1, Math.sqrt(Math.max(1, nodeCount)) / 2.4))
    const chargeStrengthBase = -140 * graphPhysicsStrength * crowdFactor
    const chargeStrength = profile === 'drag' ? chargeStrengthBase * 0.55 : chargeStrengthBase
    const linkDistanceBase = 130 / Math.max(0.35, graphPhysicsStrength)
    const linkDistance = profile === 'drag' ? linkDistanceBase * 0.86 : linkDistanceBase
    const linkStrengthBase = Math.max(0.06, Math.min(0.28, 0.11 * graphPhysicsStrength))
    const linkStrength = profile === 'drag' ? Math.min(0.6, linkStrengthBase * 1.45) : linkStrengthBase
    const charge = graph.d3Force('charge') as ForceChargeLike | undefined
    const link = graph.d3Force('link') as ForceLinkLike | undefined
    charge?.strength?.(chargeStrength)
    link?.distance?.(linkDistance)
    link?.strength?.(linkStrength)
    const collisionRadiusFactor = profile === 'drag' ? 0.92 : 1
    const collide = forceCollide<GraphNode>()
      .radius((n: GraphNode) => (18 * n.nodeScale + 8) * collisionRadiusFactor)
      .strength(profile === 'drag' ? 0.72 : 0.95)
      .iterations(profile === 'drag' ? 1 : 2) as unknown as ForceCollideLike
    graph.d3Force('collide', collide as unknown)
    graph.d3VelocityDecay(profile === 'drag' ? 0.24 : 0.28)
    graph.d3AlphaDecay(profile === 'drag' ? 0.014 : 0.018)
    graph.d3ReheatSimulation()
  }, [graphPhysicsStrength])

  useEffect(() => {
    configureForcesRef.current = configureForces
  }, [configureForces])

  useEffect(() => {
    graphLiveMagneticDragEnabledRef.current = graphLiveMagneticDragEnabled
  }, [graphLiveMagneticDragEnabled])

  const nodes = useMemo<GraphNode[]>(() => {
    return Array.from(tilesMap.values()).map((tile) => ({
      id: tile.id,
      tileType: tile.type,
      title: tile.title,
      nodeScale: graphNodeScale,
      x: graphNodePositions[tile.id]?.x ?? tile.x + tile.w / 2,
      y: graphNodePositions[tile.id]?.y ?? tile.y + tile.h / 2,
    }))
  }, [graphNodePositions, graphNodeScale, tilesMap])

  const links = useMemo<GraphLink[]>(
    () =>
      deriveGraphLinks({
        tiles: tilesMap,
        manualLinks: graphLinksManual,
        includeDelegation: graphLinksDelegationEnabled,
        includeDataFlow: graphLinksDataFlowEnabled,
        includeManual: graphLinksManualEnabled,
      }) as GraphLink[],
    [
      graphLinksDataFlowEnabled,
      graphLinksDelegationEnabled,
      graphLinksManual,
      graphLinksManualEnabled,
      tilesMap,
    ]
  )

  const selectedTile = useMemo(
    () => (selectedNodeId ? tilesMap.get(selectedNodeId) ?? null : null),
    [selectedNodeId, tilesMap]
  )

  const searchResults = useMemo(() => {
    const q = searchQuery.trim()
    if (!q || !graphAdvancedWorkflowEnabled) return [] as TileData[]
    const scored = Array.from(tilesMap.values())
      .map((tile) => ({
        tile,
        score: simpleScore(q, graphTitleFromTile(tile), tile.type),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((r) => r.tile)
    return scored
  }, [graphAdvancedWorkflowEnabled, searchQuery, tilesMap])

  const getNearbyTileIds = useCallback(
    (sourceId: string, radius: number): string[] => {
      const src = nodeByIdRef.current[sourceId]
      if (!src) return []
      const ids: string[] = []
      for (const [id, pos] of Object.entries(nodeByIdRef.current)) {
        if (distance(src, pos) <= radius) ids.push(id)
      }
      return ids
    },
    []
  )

  const focusGraphNode = useCallback(
    (id: string) => {
      const graph = graphRef.current
      const pos = nodeByIdRef.current[id]
      if (!graph || !pos) return
      setSelectedNodeId(id)
      selectedIdRef.current = id
      selectedNodePosRef.current = pos
      graph.centerAt(pos.x, pos.y, 320)
      graph.zoom(Math.max(0.65, zoom), 240)
    },
    [zoom]
  )

  const spawnAgentWithNearbyContext = useCallback(() => {
    if (!selectedTile) return
    const nearbyIds = getNearbyTileIds(selectedTile.id, graphContextRadius)
    const center = nodeByIdRef.current[selectedTile.id] ?? {
      x: selectedTile.x + selectedTile.w / 2,
      y: selectedTile.y + selectedTile.h / 2,
    }
    const nextX = center.x + 84
    const nextY = center.y + 36
    const agentId = addTile(
      'agent',
      { x: nextX, y: nextY },
      {
        title: `Agent · ${graphTitleFromTile(selectedTile)}`,
        meta: {
          graphContextSourceTileId: selectedTile.id,
          graphContextRadius,
          graphContextTileIds: nearbyIds,
          graphContextCapturedAt: Date.now(),
        },
      }
    )
    updateTile(agentId, { spawnedByTileId: selectedTile.id })
    upsertGraphLink({
      id: `manual:${selectedTile.id}->${agentId}`,
      source: selectedTile.id,
      target: agentId,
      type: 'manual',
      label: 'spawned',
    })
    addToast({
      type: 'info',
      title: 'Agent spawned',
      message: `Attached ${nearbyIds.length} nearby tiles as context metadata.`,
    })
    focusGraphNode(agentId)
  }, [
    addTile,
    addToast,
    focusGraphNode,
    getNearbyTileIds,
    graphContextRadius,
    selectedTile,
    updateTile,
    upsertGraphLink,
  ])

  const openSelectedTile = useCallback(() => {
    if (!selectedTile) return
    setCanvasViewMode('tiles')
    bringToFront(selectedTile.id)
    setActiveInteractionTile(selectedTile.id)
    const host = document.querySelector('[data-testid="infinite-canvas"]') as HTMLElement | null
    const pan = nearestTileCenterPan(selectedTile, useCanvasStore.getState().zoom, host)
    if (pan) setPan(pan)
  }, [bringToFront, selectedTile, setActiveInteractionTile, setCanvasViewMode, setPan])

  const decomposeFromSelected = useCallback(() => {
    if (!selectedTile) return
    const center = nodeByIdRef.current[selectedTile.id] ?? {
      x: selectedTile.x + selectedTile.w / 2,
      y: selectedTile.y + selectedTile.h / 2,
    }
    const labels = ['Clarify scope', 'Implement core', 'Verify output']
    const radius = 170
    const createdIds: string[] = []
    labels.forEach((label, i) => {
      const angle = (Math.PI * 2 * i) / labels.length - Math.PI / 2
      const x = center.x + Math.cos(angle) * radius
      const y = center.y + Math.sin(angle) * radius
      const id = addTile(
        'todo',
        { x, y },
        {
          title: `${graphTitleFromTile(selectedTile)} · ${label}`,
          meta: {
            graphDecomposedFrom: selectedTile.id,
            graphTaskLabel: label,
          },
        }
      )
      createdIds.push(id)
      updateTile(id, { spawnedByTileId: selectedTile.id })
      upsertGraphLink({
        id: `manual:${selectedTile.id}->${id}`,
        source: selectedTile.id,
        target: id,
        type: 'manual',
        label: 'decompose',
      })
    })
    addToast({
      type: 'info',
      title: 'Node decomposed',
      message: `Created ${createdIds.length} child task nodes.`,
    })
  }, [addTile, addToast, selectedTile, updateTile, upsertGraphLink])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const graph = ForceGraph<GraphNode, GraphLink>()(el)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeRelSize(4)
      .nodeCanvasObject((node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
        const selectedPos = selectedNodePosRef.current
        const isOutsideContext =
          graphAdvancedWorkflowEnabled &&
          !!selectedPos &&
          selectedIdRef.current !== node.id &&
          typeof node.x === 'number' &&
          typeof node.y === 'number' &&
          distance({ x: node.x, y: node.y }, selectedPos) > graphContextRadius
        renderGraphNode(node, ctx, scale, {
          hovered: hoveredIdRef.current === node.id,
          selected: selectedIdRef.current === node.id,
          muted: isOutsideContext,
        })
      })
      .linkColor((link: GraphLink) => {
        const base = linkColor(link)
        if (!graphAdvancedWorkflowEnabled || !selectedNodePosRef.current) return base
        const src = nodeByIdRef.current[edgeNodeId(link.source)]
        const tgt = nodeByIdRef.current[edgeNodeId(link.target)]
        if (!src || !tgt) return base
        const near =
          distance(src, selectedNodePosRef.current) <= graphContextRadius ||
          distance(tgt, selectedNodePosRef.current) <= graphContextRadius
        return near ? base : 'rgba(100, 116, 139, 0.18)'
      })
      .linkWidth((link: GraphLink) => (link.type === 'delegation' ? 1.8 : 1.2))
      .linkCurvature((link: GraphLink) => (link.type === 'delegation' ? 0.15 : 0))
      .linkDirectionalArrowLength((link: GraphLink) => (link.type === 'delegation' ? 4 : 0))
      .onNodeHover((node: GraphNode | null) => {
        hoveredIdRef.current = node?.id ?? null
      })
      .onNodeClick((node: GraphNode) => {
        setSelectedNodeId(node.id)
        selectedIdRef.current = node.id
        const pos = nodeByIdRef.current[node.id]
        selectedNodePosRef.current = pos ?? null
      })
      .onNodeDrag((node: GraphNode) => {
        if (typeof node.x === 'number' && typeof node.y === 'number') {
          nodeByIdRef.current[node.id] = { x: node.x, y: node.y }
          if (selectedIdRef.current === node.id) {
            selectedNodePosRef.current = { x: node.x, y: node.y }
          }
        }
        if (!graphLiveMagneticDragEnabledRef.current) return
        if (activeDragNodeIdRef.current !== node.id) {
          activeDragNodeIdRef.current = node.id
        }
        if (!dragProfileActiveRef.current) {
          dragProfileActiveRef.current = true
          configureForcesRef.current(graph, Math.max(1, nodeCountRef.current), 'drag')
        }
      })
      .onNodeDragEnd((node: GraphNode) => {
        activeDragNodeIdRef.current = null
        if (dragProfileActiveRef.current) {
          configureForcesRef.current(graph, Math.max(1, nodeCountRef.current), 'baseline')
          dragProfileActiveRef.current = false
        }
        if (typeof node.x === 'number' && typeof node.y === 'number') {
          setGraphNodePosition(node.id, { x: node.x, y: node.y })
          nodeByIdRef.current[node.id] = { x: node.x, y: node.y }
          if (selectedIdRef.current === node.id) {
            selectedNodePosRef.current = { x: node.x, y: node.y }
          }
        }
      })
      .onEngineStop(() => {
        const data = graph.graphData()
        const positions: Record<string, { x: number; y: number }> = {}
        for (const node of data.nodes) {
          if (typeof node.x !== 'number' || typeof node.y !== 'number') continue
          positions[node.id] = { x: node.x, y: node.y }
        }
        nodeByIdRef.current = positions
        if (selectedIdRef.current) {
          selectedNodePosRef.current = positions[selectedIdRef.current] ?? null
        }
        setGraphNodePositions(positions)
      })
      .onBackgroundClick(() => {
        graph.zoomToFit(420, 88)
      })

    const resize = () => {
      graph.width(el.clientWidth)
      graph.height(el.clientHeight)
    }
    resize()
    graph.zoomToFit(300, 88)
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    graphRef.current = graph
    return () => {
      ro.disconnect()
      graph.pauseAnimation()
      activeDragNodeIdRef.current = null
      dragProfileActiveRef.current = false
      graphRef.current = null
    }
  }, [
    graphAdvancedWorkflowEnabled,
    graphContextRadius,
    setGraphNodePosition,
    setGraphNodePositions,
  ])

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    nodeCountRef.current = Math.max(1, nodes.length)
    graph.graphData({ nodes, links })
    configureForcesRef.current(graph, nodeCountRef.current, 'baseline')
    dragProfileActiveRef.current = false
    activeDragNodeIdRef.current = null
    const positions: Record<string, { x: number; y: number }> = {}
    for (const n of nodes) {
      if (typeof n.x === 'number' && typeof n.y === 'number') {
        positions[n.id] = { x: n.x, y: n.y }
      }
    }
    nodeByIdRef.current = positions
    if (selectedIdRef.current) selectedNodePosRef.current = positions[selectedIdRef.current] ?? null
  }, [graphPhysicsStrength, links, nodes])

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    if (graphLiveMagneticDragEnabled) return
    if (!dragProfileActiveRef.current) return
    configureForces(graph, nodes.length, 'baseline')
    dragProfileActiveRef.current = false
    activeDragNodeIdRef.current = null
  }, [configureForces, graphLiveMagneticDragEnabled, nodes.length])

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    graph.zoom(Math.max(0.35, Math.min(1.25, zoom)))
  }, [zoom])

  return (
    <div ref={containerRef} className="absolute inset-0 z-[1]">
      {graphAdvancedWorkflowEnabled && (
        <div className="pointer-events-none absolute top-2 left-1/2 z-[4] w-[min(700px,calc(100%-1rem))] -translate-x-1/2">
          <div className="pointer-events-auto rounded-lg border border-tile-border/85 bg-black/40 px-2 py-2 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchResults.length > 0) {
                    e.preventDefault()
                    focusGraphNode(searchResults[0].id)
                  }
                  if (e.key === 'Escape') {
                    setSearchQuery('')
                  }
                }}
                placeholder="Search nodes and press Enter to focus"
                className="h-8 min-w-[220px] flex-1 rounded-md border border-tile-border/70 bg-black/35 px-2 text-xs text-gray-100 placeholder:text-gray-500 focus:border-accent-teal/50 focus:outline-none"
              />
              <button
                type="button"
                disabled={!selectedTile}
                onClick={openSelectedTile}
                className="h-8 rounded-md border border-tile-border/75 bg-black/30 px-2 text-[11px] text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-45"
                data-tooltip="Open the selected node as a rich tile view"
              >
                Open tile
              </button>
              <button
                type="button"
                disabled={!selectedTile}
                onClick={decomposeFromSelected}
                className="h-8 rounded-md border border-tile-border/75 bg-black/30 px-2 text-[11px] text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-45"
                data-tooltip="Create child task nodes linked from selected node"
              >
                Decompose
              </button>
              <button
                type="button"
                disabled={!selectedTile}
                onClick={spawnAgentWithNearbyContext}
                className="h-8 rounded-md border border-accent-teal/55 bg-accent-teal/15 px-2 text-[11px] text-accent-teal hover:bg-accent-teal/25 disabled:cursor-not-allowed disabled:opacity-45"
                data-tooltip="Spawn an agent tile with nearby graph context attached"
              >
                Spawn agent w/ context
              </button>
              <div className="ml-auto text-[11px] text-gray-400">
                Radius: <span className="text-gray-200">{graphContextRadius}px</span>
              </div>
            </div>
            {searchQuery.trim() && searchResults.length > 0 && (
              <div className="mt-2 max-h-40 overflow-auto rounded-md border border-tile-border/60 bg-black/35 p-1">
                {searchResults.map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => focusGraphNode(tile.id)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-gray-200 hover:bg-white/8"
                  >
                    <span className="truncate">{graphTitleFromTile(tile)}</span>
                    <span className="ml-2 shrink-0 text-[10px] text-gray-500">{tile.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

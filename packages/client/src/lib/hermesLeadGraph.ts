import type { TileData } from '../store/canvasStore'
import type { FileEntry } from '../store/workspaceStore'

export type HermesLeadNodeKind = 'hermes' | 'agent' | 'tile' | 'folder' | 'file' | 'tool'
export type HermesLeadEdgeKind = 'spawn' | 'contains' | 'focus' | 'tool'

export interface HermesLeadNode {
  id: string
  label: string
  kind: HermesLeadNodeKind
  status?: string
  tileId?: string
  path?: string
}

export interface HermesLeadEdge {
  id: string
  source: string
  target: string
  kind: HermesLeadEdgeKind
}

export interface HermesLeadGraphModel {
  nodes: HermesLeadNode[]
  edges: HermesLeadEdge[]
}

export interface BuildHermesLeadGraphInput {
  tiles: Map<string, TileData>
  files: FileEntry[]
  focusTileId?: string | null
  maxFileNodes?: number
  toolNames?: string[]
  maxToolNodes?: number
}

const HERMES_LEAD_NODE_ID = 'hermes:lead'

function tileNodeKind(type: TileData['type']): HermesLeadNodeKind {
  if (type === 'orchestrator') return 'hermes'
  if (type === 'agent' || type === 'hermes_agent' || type === 'agent_team') return 'agent'
  return 'tile'
}

function walkFileEntries(
  files: FileEntry[],
  maxNodes: number,
  nodes: HermesLeadNode[],
  edges: HermesLeadEdge[]
): void {
  let count = 0
  const stack: Array<{ entry: FileEntry; parentId: string }> = files
    .slice()
    .reverse()
    .map((entry) => ({ entry, parentId: HERMES_LEAD_NODE_ID }))

  while (stack.length > 0 && count < maxNodes) {
    const next = stack.pop()
    if (!next) continue
    const { entry, parentId } = next
    const nodeId = `fs:${entry.path}`
    nodes.push({
      id: nodeId,
      label: entry.name,
      kind: entry.isDirectory ? 'folder' : 'file',
      path: entry.path,
    })
    edges.push({
      id: `contains:${parentId}->${nodeId}`,
      source: parentId,
      target: nodeId,
      kind: 'contains',
    })
    count += 1
    if (entry.children?.length) {
      for (let i = entry.children.length - 1; i >= 0; i -= 1) {
        stack.push({ entry: entry.children[i], parentId: nodeId })
      }
    }
  }
}

function projectToolNodes(
  toolNames: string[],
  maxToolNodes: number,
  nodes: HermesLeadNode[],
  edges: HermesLeadEdge[]
): void {
  const uniq = Array.from(new Set(toolNames.map((t) => t.trim()).filter(Boolean))).slice(0, maxToolNodes)
  for (const tool of uniq) {
    const nodeId = `tool:${tool}`
    nodes.push({
      id: nodeId,
      label: tool,
      kind: 'tool',
      status: 'recent',
    })
    edges.push({
      id: `tool:${HERMES_LEAD_NODE_ID}->${nodeId}`,
      source: HERMES_LEAD_NODE_ID,
      target: nodeId,
      kind: 'tool',
    })
  }
}

export function buildHermesLeadGraphModel(input: BuildHermesLeadGraphInput): HermesLeadGraphModel {
  const maxFileNodes = Math.max(0, input.maxFileNodes ?? 80)
  const maxToolNodes = Math.max(0, input.maxToolNodes ?? 10)
  const nodes: HermesLeadNode[] = [
    {
      id: HERMES_LEAD_NODE_ID,
      label: 'Hermes Lead',
      kind: 'hermes',
      status: 'running',
    },
  ]
  const edges: HermesLeadEdge[] = []

  for (const tile of input.tiles.values()) {
    const nodeId = `tile:${tile.id}`
    nodes.push({
      id: nodeId,
      label: tile.title?.trim() || tile.type.replace(/_/g, ' '),
      kind: tileNodeKind(tile.type),
      status: tile.tileStatus,
      tileId: tile.id,
    })
    const parent = tile.spawnedByTileId ? `tile:${tile.spawnedByTileId}` : HERMES_LEAD_NODE_ID
    edges.push({
      id: `spawn:${parent}->${nodeId}`,
      source: parent,
      target: nodeId,
      kind: 'spawn',
    })
  }

  walkFileEntries(input.files, maxFileNodes, nodes, edges)
  projectToolNodes(input.toolNames ?? [], maxToolNodes, nodes, edges)

  if (input.focusTileId) {
    const focusNode = `tile:${input.focusTileId}`
    if (nodes.some((n) => n.id === focusNode)) {
      edges.push({
        id: `focus:${HERMES_LEAD_NODE_ID}->${focusNode}`,
        source: HERMES_LEAD_NODE_ID,
        target: focusNode,
        kind: 'focus',
      })
    }
  }

  return { nodes, edges }
}

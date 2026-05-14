import type { HermesLeadEdge, HermesLeadNode } from './hermesLeadGraph'

export interface ProjectGraphWithFileDepthLimitInput {
  nodes: HermesLeadNode[]
  edges: HermesLeadEdge[]
  maxFileDepth: number
  collapsedFolderIds?: Set<string>
}

function fileDepth(path: string | undefined): number {
  if (!path) return 0
  return path.split('/').filter(Boolean).length
}

export function projectGraphWithFileDepthLimit(
  input: ProjectGraphWithFileDepthLimitInput
): { nodes: HermesLeadNode[]; edges: HermesLeadEdge[] } {
  const maxDepth = Math.max(1, input.maxFileDepth)
  const visibleIds = new Set<string>()

  for (const node of input.nodes) {
    if (node.kind !== 'file' && node.kind !== 'folder') {
      visibleIds.add(node.id)
      continue
    }
    const depth = fileDepth(node.path)
    if (depth <= maxDepth) visibleIds.add(node.id)
  }

  const collapsed = input.collapsedFolderIds ?? new Set<string>()
  if (collapsed.size > 0) {
    const nodeById = new Map(input.nodes.map((n) => [n.id, n]))
    const childrenByParent = new Map<string, string[]>()
    for (const edge of input.edges) {
      if (edge.kind !== 'contains') continue
      const arr = childrenByParent.get(edge.source)
      if (arr) arr.push(edge.target)
      else childrenByParent.set(edge.source, [edge.target])
    }

    const hiddenDescendants = new Set<string>()
    for (const folderId of collapsed) {
      if (!visibleIds.has(folderId)) continue
      const folder = nodeById.get(folderId)
      if (!folder || folder.kind !== 'folder') continue

      const stack = [...(childrenByParent.get(folderId) ?? [])]
      while (stack.length > 0) {
        const childId = stack.pop()!
        const child = nodeById.get(childId)
        if (!child) continue
        if (child.kind === 'file' || child.kind === 'folder') {
          hiddenDescendants.add(childId)
        }
        const nested = childrenByParent.get(childId)
        if (nested?.length) stack.push(...nested)
      }
    }

    for (const hiddenId of hiddenDescendants) {
      visibleIds.delete(hiddenId)
    }
  }

  const nodes = input.nodes.filter((n) => visibleIds.has(n.id))
  const edges = input.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
  return { nodes, edges }
}

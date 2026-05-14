import type { CanvasGraphLink } from '../store/canvasStore'

type LinkType = CanvasGraphLink['type']

export interface TileLinkLike {
  id: string
  type: string
  spawnedByTileId?: string
  meta?: Record<string, unknown>
}

const DATA_FLOW_META_KEYS = [
  'sourceTileId',
  'targetTileId',
  'inputTileId',
  'outputTileId',
  'dependsOnTileId',
  'dependsOnTileIds',
  'inputTileIds',
  'sourceTileIds',
  'targetTileIds',
  'readsFromTileId',
  'writesToTileId',
] as const

function normalizeIdArray(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
  }
  return []
}

function linkId(type: LinkType, source: string, target: string): string {
  return `${type}:${source}->${target}`
}

function dedupeLinks(links: CanvasGraphLink[]): CanvasGraphLink[] {
  const byId = new Map<string, CanvasGraphLink>()
  for (const link of links) {
    byId.set(link.id, link)
  }
  return Array.from(byId.values())
}

export function deriveDelegationLinks(tilesMap: Map<string, TileLinkLike>): CanvasGraphLink[] {
  const links: CanvasGraphLink[] = []
  for (const tile of tilesMap.values()) {
    const parent =
      tile.spawnedByTileId ??
      (typeof tile.meta?.spawnedByTileId === 'string' ? tile.meta.spawnedByTileId : undefined) ??
      (typeof tile.meta?.parentTileId === 'string' ? tile.meta.parentTileId : undefined)
    if (!parent || parent === tile.id) continue
    if (!tilesMap.has(parent)) continue
    links.push({
      id: linkId('delegation', parent, tile.id),
      source: parent,
      target: tile.id,
      type: 'delegation',
    })
  }
  return links
}

export function deriveDataFlowLinks(tilesMap: Map<string, TileLinkLike>): CanvasGraphLink[] {
  const links: CanvasGraphLink[] = []
  for (const tile of tilesMap.values()) {
    const meta = tile.meta ?? {}
    for (const key of DATA_FLOW_META_KEYS) {
      const raw = meta[key]
      for (const relatedId of normalizeIdArray(raw)) {
        if (!tilesMap.has(relatedId) || relatedId === tile.id) continue
        links.push({
          id: linkId('dataFlow', relatedId, tile.id),
          source: relatedId,
          target: tile.id,
          type: 'dataFlow',
          label: 'data',
        })
      }
    }
  }
  return links
}

export function deriveGraphLinks(opts: {
  tiles: Map<string, TileLinkLike>
  manualLinks?: CanvasGraphLink[]
  includeDelegation?: boolean
  includeDataFlow?: boolean
  includeManual?: boolean
}): CanvasGraphLink[] {
  const {
    tiles,
    manualLinks = [],
    includeDelegation = true,
    includeDataFlow = false,
    includeManual = false,
  } = opts
  const links: CanvasGraphLink[] = []
  if (includeDelegation) links.push(...deriveDelegationLinks(tiles))
  if (includeDataFlow) links.push(...deriveDataFlowLinks(tiles))
  if (includeManual) links.push(...manualLinks.filter((l) => tiles.has(l.source) && tiles.has(l.target)))
  return dedupeLinks(links)
}

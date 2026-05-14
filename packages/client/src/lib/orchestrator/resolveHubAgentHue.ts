import type { TileData } from '../../store/canvasStore'

const AGENT_LINK_HUES = [185, 268, 42, 312, 28, 152, 205, 330]

/** Stable hue for agent tiles (matches hub-link SVG strokes). */
export function agentLinkHueFromTileId(tileId: string): number {
  let h = 0
  for (let i = 0; i < tileId.length; i++) {
    h = (h + tileId.charCodeAt(i) * (i + 1)) % 1009
  }
  return AGENT_LINK_HUES[h % AGENT_LINK_HUES.length]
}

/** Default when session is main orchestrator / implicit bridge (teal family). */
export const DEFAULT_ORCHESTRATOR_HUB_HUE = 174

/**
 * Hue (0–360) for hub links, focus banners, and narrator glow — keyed by orchestrator or agent session tile.
 */
export function resolveHubAgentHue(
  sourceSessionTileId: string | null | undefined,
  tiles: Map<string, TileData>
): number {
  if (!sourceSessionTileId) return DEFAULT_ORCHESTRATOR_HUB_HUE
  const src = tiles.get(sourceSessionTileId)
  if (!src || src.type === 'orchestrator') return DEFAULT_ORCHESTRATOR_HUB_HUE
  if (src.type === 'agent') {
    return agentLinkHueFromTileId(sourceSessionTileId)
  }
  return DEFAULT_ORCHESTRATOR_HUB_HUE
}

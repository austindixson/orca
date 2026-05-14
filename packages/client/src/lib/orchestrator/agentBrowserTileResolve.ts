import type { TileData } from '../../store/canvasStore'

export type ResolveAgentBrowserTileResult =
  | { ok: true; tile: TileData }
  | { ok: false; error: string }

/** Internal: caller maps to user-facing jsonErr text. */
export const AMBIGUOUS_AGENT_BROWSER_TILE = 'AMBIGUOUS_AGENT_BROWSER_TILE'
export const NO_AGENT_BROWSER_TILE = 'NO_AGENT_BROWSER_TILE'

/**
 * Pick the `agent_browser` tile for orchestrator browser_* tools.
 * If `args.tile_id` is set, it must reference an existing agent_browser tile.
 * If omitted and exactly one agent_browser exists, use it; otherwise require an explicit tile_id.
 */
export function resolveAgentBrowserTileForTools(
  tiles: Map<string, TileData>,
  args: Record<string, unknown>
): ResolveAgentBrowserTileResult {
  const raw = args.tile_id
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  const list = [...tiles.values()].filter((t) => t.type === 'agent_browser')

  if (trimmed) {
    const t = tiles.get(trimmed)
    if (!t) {
      return { ok: false, error: `No tile found for tile_id "${trimmed}".` }
    }
    if (t.type !== 'agent_browser') {
      return {
        ok: false,
        error: `tile_id must reference an agent_browser tile (got type "${t.type}").`,
      }
    }
    return { ok: true, tile: t }
  }

  if (list.length === 0) {
    return { ok: false, error: NO_AGENT_BROWSER_TILE }
  }
  if (list.length > 1) {
    return { ok: false, error: AMBIGUOUS_AGENT_BROWSER_TILE }
  }
  return { ok: true, tile: list[0]! }
}

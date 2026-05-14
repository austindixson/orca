/**
 * Tile cost classification for adaptive workspace rebuild.
 * Single source of truth for per-TileType cost + pacing parameters.
 */

import type { TileType } from '../store/canvasStore'

export type TileCostClass = 'light' | 'medium' | 'heavy'

/**
 * At or above this tile count, workspace restore only auto-activates **light** tiles.
 * Medium and heavy (orchestrator, editor, terminal, browser, …) stay as placeholders until clicked.
 * Prevents renderer OOM when hybrid mode would mount dozens of semi-heavy surfaces at once.
 */
export const MEGA_WORKSPACE_TILE_THRESHOLD = 28

/**
 * Cost classification for each tile type.
 * - light: Static UI, no network/process spawn, renders instantly
 * - medium: Some async work (file reads, API calls), but not process-heavy
 * - heavy: Spawns processes, streams, iframes, or heavyweight editors
 */
export const TILE_COST: Record<TileType, TileCostClass> = {
  todo: 'light',
  changelog: 'light',
  reasoning: 'light',
  project_status: 'light',
  openrouter_usage: 'light',
  bug_bounty: 'light',
  toolbox: 'light',
  telemetry: 'light',
  benchmark: 'light',
  agent_group_chat: 'light',

  orchestrator: 'medium',
  agent_team: 'medium',
  research: 'medium',
  github: 'medium',
  diff: 'medium',
  editor: 'medium',
  telegram_onboard: 'medium',
  native_gateway: 'medium',
  hermes_bridge: 'medium',

  terminal: 'heavy',
  browser: 'heavy',
  agent_browser: 'heavy',
  agent: 'heavy',
  hermes_agent: 'heavy',
  remotion: 'heavy',
}

/**
 * Minimum gap (ms) between activating tiles of each cost class.
 * Ensures we yield to the main thread even for bursts of cheap tiles.
 */
export const CLASS_MIN_GAP_MS: Record<TileCostClass, number> = {
  light: 40,
  medium: 150,
  heavy: 350,
}

/**
 * Maximum wait (ms) for a tile's mount-ack before proceeding anyway.
 * Acts as a hard cap so a hung tile doesn't block the queue forever.
 */
export const CLASS_MAX_WAIT_MS: Record<TileCostClass, number> = {
  light: 400,
  medium: 1500,
  heavy: 5000,
}

/**
 * Get the cost class for a tile type.
 * Falls back to 'medium' for unknown types (defensive).
 */
export function getTileCost(type: TileType): TileCostClass {
  return TILE_COST[type] ?? 'medium'
}

/**
 * Sort tile IDs by cost class (light → medium → heavy).
 * Within each class, maintains original order (caller handles viewport/zIndex sort).
 */
export function sortTileIdsByCost(
  tileIds: string[],
  getTileType: (id: string) => TileType | undefined
): string[] {
  const light: string[] = []
  const medium: string[] = []
  const heavy: string[] = []

  for (const id of tileIds) {
    const type = getTileType(id)
    if (!type) {
      medium.push(id)
      continue
    }
    const cost = getTileCost(type)
    if (cost === 'light') light.push(id)
    else if (cost === 'medium') medium.push(id)
    else heavy.push(id)
  }

  return [...light, ...medium, ...heavy]
}

/**
 * Check if a tile type is considered heavy (spawns processes/streams).
 */
export function isHeavyTile(type: TileType): boolean {
  return getTileCost(type) === 'heavy'
}

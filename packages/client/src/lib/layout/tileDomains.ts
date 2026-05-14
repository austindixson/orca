import type { TileType } from '../../store/canvasStore'
import type { WorkspaceContext } from './workspaceContext'

/** Where a tile prefers to sit relative to the anchor. */
export type ZonePreference =
  | 'anchor'
  | 'left'
  | 'right'
  | 'bottom'
  | 'floating-topright'
  | 'dock'
  | 'center-free'

const TILE_ZONE_PREFERENCES: Record<TileType, ZonePreference> = {
  browser: 'anchor',
  agent_browser: 'anchor',
  agent: 'left',
  agent_team: 'left',
  agent_group_chat: 'left',
  editor: 'right',
  diff: 'right',
  github: 'right',
  terminal: 'bottom',
  todo: 'floating-topright',
  changelog: 'floating-topright',
  toolbox: 'floating-topright',
  openrouter_usage: 'floating-topright',
  research: 'floating-topright',
  reasoning: 'floating-topright',
  orchestrator: 'dock',
  benchmark: 'right',
  remotion: 'right',
  project_status: 'floating-topright',
  telemetry: 'floating-topright',
  hermes_bridge: 'floating-topright',
  hermes_agent: 'left',
  telegram_onboard: 'floating-topright',
  native_gateway: 'floating-topright',
  bug_bounty: 'floating-topright',
}

export function getZonePreferenceForTile(type: TileType): ZonePreference {
  return TILE_ZONE_PREFERENCES[type] ?? 'center-free'
}

/**
 * Context can bias the anchor for the first “hero” tile of that type.
 */
export function getZoneForTile(type: TileType, _context: WorkspaceContext): ZonePreference {
  return getZonePreferenceForTile(type)
}

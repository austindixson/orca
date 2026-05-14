/**
 * Per-tile-type RGBA for idle rim glow (see Canvas/Tile.tsx inner chrome).
 * Same hues as header icon accents — use `tileAccentRgb` for text that should match the tile.
 */
export const TILE_GLOW_RGBA: Record<string, readonly [number, number, number, number]> = {
  terminal: [0, 212, 170, 0.22],
  editor: [59, 130, 246, 0.2],
  browser: [168, 85, 247, 0.2],
  github: [56, 189, 248, 0.2],
  diff: [255, 107, 53, 0.2],
  todo: [236, 72, 153, 0.18],
  agent: [0, 212, 170, 0.22],
  agent_team: [0, 212, 170, 0.22],
  agent_group_chat: [34, 211, 238, 0.2],
  orchestrator: [45, 212, 191, 0.12],
  changelog: [0, 212, 170, 0.22],
  benchmark: [251, 191, 36, 0.18],
  remotion: [232, 121, 249, 0.15],
  openrouter_usage: [129, 140, 248, 0.2],
  toolbox: [163, 230, 53, 0.18],
  research: [99, 102, 241, 0.18],
  reasoning: [167, 139, 250, 0.2],
  project_status: [52, 211, 153, 0.2],
  telemetry: [56, 189, 248, 0.2],
  hermes_bridge: [34, 211, 238, 0.2],
  hermes_agent: [45, 212, 191, 0.22],
  telegram_onboard: [255, 107, 74, 0.18],
  native_gateway: [52, 211, 153, 0.2],
  bug_bounty: [251, 191, 36, 0.18],
}

/** RGB accent for a tile type (matches idle glow / tile chrome hue). */
export function tileAccentRgb(tileType: string): readonly [number, number, number] {
  const c = TILE_GLOW_RGBA[tileType] ?? TILE_GLOW_RGBA.terminal
  return [c[0], c[1], c[2]] as const
}

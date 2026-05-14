/**
 * Spawn (or reuse) a terminal tile that runs `hermes gateway` with the API server
 * enabled. Leverages TerminalTile's existing `data.meta.command` auto-run.
 *
 * Intentionally decoupled from React so it can be unit-tested.
 */

export const HERMES_GATEWAY_COMMAND = 'API_SERVER_ENABLED=true hermes gateway'
export const HERMES_GATEWAY_TILE_LABEL = 'hermes gateway'

/** Shell-export prefix so `orca reply` / subprocesses inherit parent orchestrator context. */
export function buildHermesGatewayShellCommand(opts?: {
  parentOrchestratorTileId?: string
  sessionId?: string
}): string {
  const pid = opts?.parentOrchestratorTileId?.trim()
  const sid = opts?.sessionId?.trim()
  if (!pid && !sid) return HERMES_GATEWAY_COMMAND
  const esc = (s: string) => s.replace(/'/g, `'\\''`)
  const parts: string[] = []
  if (pid) parts.push(`export ORCA_PARENT_TILE_ID='${esc(pid)}'`)
  if (sid) parts.push(`export ORCA_PARENT_SESSION_ID='${esc(sid)}'`)
  return `${parts.join('; ')}; ${HERMES_GATEWAY_COMMAND}`
}

type TileStatus = 'idle' | 'working' | 'error' | undefined

type MinimalTileData = {
  id: string
  type: string
  tileStatus?: TileStatus
  meta?: Record<string, unknown>
}

type MinimalCanvasStoreApi = {
  tiles: Map<string, MinimalTileData>
  addTile: (
    type: 'terminal',
    position?: unknown,
    opts?: { title?: string; meta?: Record<string, unknown> }
  ) => string
}

export type SpawnResult =
  | { action: 'spawned'; tileId: string }
  | { action: 'reused'; tileId: string }
  | { action: 'skipped_non_local' }

/** Hostname is 127.0.0.1 / localhost / empty — the only place `hermes gateway` makes sense. */
export function isLocalHermesBaseUrl(raw: string | undefined | null): boolean {
  if (!raw || !String(raw).trim()) return true
  try {
    const h = new URL(String(raw).trim()).hostname
    return (
      h === '127.0.0.1' ||
      h === 'localhost' ||
      h === '0.0.0.0' ||
      h === '::1' ||
      h === '[::1]'
    )
  } catch {
    return false
  }
}

/**
 * Spawn a terminal tile that auto-runs `API_SERVER_ENABLED=true hermes gateway`.
 *
 * Idempotent: if the store already has a terminal tile whose `meta.command`
 * matches `HERMES_GATEWAY_COMMAND`, reuse it instead of spawning a second one.
 */
export function spawnHermesGatewayTerminal(
  store: MinimalCanvasStoreApi,
  opts?: {
    baseUrl?: string
    skipIfNonLocal?: boolean
    parentOrchestratorTileId?: string
    sessionId?: string
  }
): SpawnResult {
  const skipIfNonLocal = opts?.skipIfNonLocal ?? true
  if (skipIfNonLocal && !isLocalHermesBaseUrl(opts?.baseUrl)) {
    return { action: 'skipped_non_local' }
  }

  const command = buildHermesGatewayShellCommand({
    parentOrchestratorTileId: opts?.parentOrchestratorTileId,
    sessionId: opts?.sessionId,
  })

  for (const tile of store.tiles.values()) {
    if (tile.type !== 'terminal') continue
    const cmd = (tile.meta as Record<string, unknown> | undefined)?.command
    if (typeof cmd === 'string' && /\bhermes\s+gateway\b/.test(cmd)) {
      return { action: 'reused', tileId: tile.id }
    }
  }

  const tileId = store.addTile('terminal', undefined, {
    title: HERMES_GATEWAY_TILE_LABEL,
    meta: {
      command,
      label: HERMES_GATEWAY_TILE_LABEL,
    },
  })
  return { action: 'spawned', tileId }
}

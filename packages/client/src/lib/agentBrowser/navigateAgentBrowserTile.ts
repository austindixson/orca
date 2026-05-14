/**
 * Single source of truth for driving agent-browser navigation + canvas meta for an agent_browser tile.
 * Used by orchestrator tools and the AgentBrowserTile UI.
 */

import { useCanvasStore } from '../../store/canvasStore'
import * as tauri from '../tauri'
import {
  AGENT_BROWSER_BASE_TITLE,
  AGENT_BROWSER_ERROR_TITLE,
  buildAgentBrowserErrorSubtitle,
} from './chrome'

export async function navigateAgentBrowserTile(tileId: string, url: string): Promise<{ snapshot: string }> {
  const tile = useCanvasStore.getState().tiles.get(tileId)
  const tileMeta = (tile?.meta ?? {}) as Record<string, unknown>
  const sessionNameRaw = typeof tileMeta.sessionName === 'string' ? tileMeta.sessionName.trim() : ''
  const sessionName = sessionNameRaw || `orca-${tileId.slice(0, 6)}`
  try {
    await tauri.ensureAgentBrowserCliInstalled()
    const session = await tauri.ensureAgentBrowserSession(sessionName)
    await tauri.runAgentBrowser(['open', url], { sessionName })
    const snapshotResult = await tauri.runAgentBrowser(['snapshot', '-i', '--json'], { sessionName })
    let snapshot = ''
    try {
      const parsed = JSON.parse(snapshotResult) as { data?: { snapshot?: string } }
      snapshot = parsed.data?.snapshot ?? snapshotResult
    } catch {
      snapshot = snapshotResult
    }
    const latestTile = useCanvasStore.getState().tiles.get(tileId)
    const latestMeta = (latestTile?.meta ?? {}) as Record<string, unknown>
    useCanvasStore.getState().updateTile(tileId, {
      title: AGENT_BROWSER_BASE_TITLE,
      tileStatus: 'idle',
      meta: {
        ...latestMeta,
        sessionName,
        streamPort: session.port,
        currentUrl: url,
        lastSnapshot: snapshot,
        lastSessionError: undefined,
        subtitle: undefined,
      },
    })
    return { snapshot }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const latestTile = useCanvasStore.getState().tiles.get(tileId)
    const latestMeta = (latestTile?.meta ?? {}) as Record<string, unknown>
    useCanvasStore.getState().updateTile(tileId, {
      title: AGENT_BROWSER_ERROR_TITLE,
      tileStatus: 'error',
      meta: {
        ...latestMeta,
        lastSessionError: msg,
        subtitle: buildAgentBrowserErrorSubtitle(msg),
      },
    })
    throw e
  }
}

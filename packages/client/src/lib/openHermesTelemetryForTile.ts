import { useHermesTelemetryStore } from '../store/hermesTelemetryStore'
import { useWorkspaceStore } from '../store/workspaceStore'

/**
 * Open the Hermes telemetry sidebar scoped to one `hermes_agent` tile (matches `[tile xxxxxxxx]` lines).
 */
export function openHermesTelemetryForTile(tileId: string): void {
  useHermesTelemetryStore.getState().setFocusTileId(tileId)
  useWorkspaceStore.getState().setActivePanel('hermesTelemetry')
  if (useWorkspaceStore.getState().sidebarCollapsed) {
    useWorkspaceStore.getState().expandSidebar()
  }
}

import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'

/**
 * If the user closed a tile the orchestrator had auto-focused (highlight, tool focus, or sticky
 * "last module"), clear those pointers and pan to the orchestrator widget tile. Dynamic-imports
 * `ensureOrchestratorWidgetTile` to avoid a static import cycle with `canvasStore`.
 */
export function refocusOrchestratorIfClosedTileWasActive(removedId: string): void {
  const { autoFocusHighlight, agentTileFocus, lastOrchestratorTileId } =
    useOrchestratorActivityStore.getState()
  const hadHighlight = autoFocusHighlight?.tileId === removedId
  const hadAgent = agentTileFocus?.tileId === removedId
  const hadLast = lastOrchestratorTileId === removedId

  if (!hadHighlight && !hadAgent && !hadLast) {
    return
  }

  useOrchestratorActivityStore.setState((s) => ({
    autoFocusHighlight: hadHighlight ? null : s.autoFocusHighlight,
    agentTileFocus: hadAgent ? null : s.agentTileFocus,
    lastOrchestratorTileId: hadLast ? null : s.lastOrchestratorTileId,
  }))

  queueMicrotask(() => {
    void import('./ensureOrchestratorWidgetTile').then(({ ensureOrchestratorWidgetTile }) => {
      ensureOrchestratorWidgetTile()
    })
  })
}

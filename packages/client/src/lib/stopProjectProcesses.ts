import { useAgentTeamStore } from '../store/agentTeamStore'
import { useCanvasStore } from '../store/canvasStore'
import { useOneShotStore } from '../store/oneShotStore'
import { useOrchestratorActivityStore } from '../store/orchestratorActivityStore'
import { useOrchestratorSessionStore } from '../store/orchestratorSessionStore'

/**
 * Stops orchestrator runs, 1-shot pipeline, and every tile-registered AbortSignal
 * (agent tiles, delegated sub-agents, Hermes chat streams). Terminal PTYs close when
 * tiles unmount; this aborts in-flight LLM/tool work so shutdown is clean.
 *
 * Order: abort leaf tile work first, then orchestrator (so parents do not wait on tools),
 * then tear down 1-shot if it is still active, and finally clear orchestrator "waiting"
 * bookkeeping so the Stop all button accurately reflects idle.
 */
export function stopAllProjectProcesses(): void {
  const team = useAgentTeamStore.getState()
  team.abortAllRegisteredRuns()
  useOrchestratorSessionStore.getState().stop()
  const os = useOneShotStore.getState()
  if (os.running || os.abortController != null) {
    void os.cancel().catch(() => {
      /* discard may no-op */
    })
  }

  // After aborts fire, force-clear any lingering "working" bookkeeping so the HUD,
  // Stop all button, and tile badges do not stay lit forever. These are UI-only
  // signals: real work was already told to cancel above.
  const latestTeam = useAgentTeamStore.getState()
  const stuckWorkingIds: string[] = []
  for (const m of Object.values(latestTeam.membersByTileId)) {
    if (m.status === 'working') stuckWorkingIds.push(m.tileId)
  }
  for (const tileId of stuckWorkingIds) {
    latestTeam.patchMember(tileId, { status: 'idle', currentTask: 'Cancelled' })
    try {
      useCanvasStore.getState().updateTile(tileId, { tileStatus: 'idle' })
    } catch {
      /* tile may have been removed */
    }
  }

  const session = useOrchestratorSessionStore.getState()
  if (session.waitingForSubAgents || session.pendingSubAgentHandoffs.length > 0) {
    useOrchestratorSessionStore.setState({
      waitingForSubAgents: false,
      pendingSubAgentHandoffs: [],
    })
  }
  useOrchestratorActivityStore.getState().resetIdle()
}

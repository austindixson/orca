import { SettingsToggleRow } from './settingsPrimitives'
import { useCanvasBridgeExternalOrchestrator } from '../../hooks/useCanvasBridgeExternalOrchestrator'
import { useSettingsStore } from '../../store/settingsStore'

/**
 * External orchestrator (Hermes bridge) controls — lives under Settings → Agent → Hermes.
 */
export function HermesExternalOrchestratorCard() {
  const hermesOrchestratorMode = useSettingsStore((s) => s.hermesOrchestratorMode)
  const hermesOrchestratorAutoDetect = useSettingsStore((s) => s.hermesOrchestratorAutoDetect)
  const setHermesOrchestratorMode = useSettingsStore((s) => s.setHermesOrchestratorMode)
  const setHermesOrchestratorAutoDetect = useSettingsStore((s) => s.setHermesOrchestratorAutoDetect)

  const { bridge, bridgeErr, detectedHermes, hermesSeenSec, modelsOrchestratorLocked } =
    useCanvasBridgeExternalOrchestrator()

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-amber-100/95">External orchestrator</h3>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-500">
            When an external tool-calling agent runs the show, provider fields under Models can stay
            locked so settings match that setup. Optional: lock automatically when the canvas bridge sees
            Hermes (
            <code className="rounded bg-black/40 px-1 font-mono text-xs text-gray-400">
              X-Orca-External-Agent: hermes
            </code>
            ).
          </p>
        </div>
        {modelsOrchestratorLocked ? (
          <span className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-200">
            Locked
          </span>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        <SettingsToggleRow
          label="External agent is the orchestrator"
          hint="When on, model and API fields under Models are dimmed. Turn off to use Orca’s built-in orchestrator only."
          checked={hermesOrchestratorMode}
          onChange={setHermesOrchestratorMode}
        />
        <SettingsToggleRow
          label="Auto-lock when Hermes is detected on the bridge"
          hint="Locks when the companion server reports a recent Hermes heartbeat on tool runs."
          checked={hermesOrchestratorAutoDetect}
          onChange={setHermesOrchestratorAutoDetect}
        />
      </div>

      <div className="mt-3 rounded-lg border border-tile-border/80 bg-black/25 px-3 py-2 font-mono text-xs text-gray-500">
        {bridgeErr ? (
          <span className="text-amber-200/90">Bridge: {bridgeErr}</span>
        ) : bridge ? (
          <>
            <span className="text-gray-600">uiClients</span> {bridge.uiClients}
            {bridge.tokenRequired ? (
              <>
                {' '}
                · <span className="text-gray-600">token</span> required
              </>
            ) : null}
            {detectedHermes && hermesSeenSec !== null ? (
              <>
                {' '}
                · <span className="text-emerald-400/90">Hermes</span> last seen {hermesSeenSec}s ago
              </>
            ) : (
              <>
                {' '}
                · <span className="text-gray-600">Hermes heartbeat</span> none (send header on execute)
              </>
            )}
          </>
        ) : (
          'Checking bridge…'
        )}
      </div>
    </div>
  )
}

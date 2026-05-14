import { useCallback, useEffect, useState } from 'react'
import { fetchCanvasBridgeStatus, type CanvasBridgeStatus } from '../lib/canvasBridgeApi'
import { useSettingsStore } from '../store/settingsStore'

const BRIDGE_POLL_MS = 8000

/**
 * Polls the canvas bridge for Hermes heartbeat and derives whether Models UI should lock
 * (external orchestrator mode).
 */
export function useCanvasBridgeExternalOrchestrator() {
  const hermesOrchestratorMode = useSettingsStore((s) => s.hermesOrchestratorMode)
  const hermesOrchestratorAutoDetect = useSettingsStore((s) => s.hermesOrchestratorAutoDetect)

  const [bridge, setBridge] = useState<CanvasBridgeStatus | null>(null)
  const [bridgeErr, setBridgeErr] = useState<string | null>(null)

  const refreshBridge = useCallback(async () => {
    try {
      setBridgeErr(null)
      setBridge(await fetchCanvasBridgeStatus())
    } catch (e) {
      setBridgeErr(e instanceof Error ? e.message : String(e))
      setBridge(null)
    }
  }, [])

  useEffect(() => {
    void refreshBridge()
    const id = window.setInterval(() => void refreshBridge(), BRIDGE_POLL_MS)
    return () => window.clearInterval(id)
  }, [refreshBridge])

  const ext = bridge?.externalOrchestrator
  const detectedHermes =
    ext != null && typeof ext === 'object' && String(ext.id).toLowerCase() === 'hermes'
  const hermesSeenSec =
    ext && typeof ext === 'object' && 'lastSeenMs' in ext
      ? Math.max(0, Math.floor((Date.now() - (ext as { lastSeenMs: number }).lastSeenMs) / 1000))
      : null

  const modelsOrchestratorLocked =
    hermesOrchestratorMode || (hermesOrchestratorAutoDetect && detectedHermes)

  return {
    bridge,
    bridgeErr,
    detectedHermes,
    hermesSeenSec,
    modelsOrchestratorLocked,
    refreshBridge,
  }
}

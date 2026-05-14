/**
 * 1-shot pipeline checkpoint: ~/.orca/sessions/<sessionId>/oneshot-state.json
 * Written on phase transitions; cleared on discard/complete. Used for recovery hints after crash.
 */

import type { OneShotPhase } from '../orchestrator/oneShot/oneShotTypes'

type ClarifyPhase = 'idle' | 'generating' | 'waiting'
import * as tauri from '../tauri'
import { getOrcaSessionId } from './orcaSessionId'
import { ensureSessionLayout } from './sessionPersistence'

export interface OneShotPersistedState {
  version: 1
  at: number
  /** True if pipeline was in flight (lost on restart — async work cannot resume). */
  wasRunning: boolean
  phase: OneShotPhase | 'idle'
  ideaPrompt: string
  tempWorkspacePath: string | null
  projectRootPrefix: string
  oneShotUsesDisposableTemp: boolean
  previousRootPath: string | null
  orchestratorTileIdForOneShot: string | null
  clarifyPhase: ClarifyPhase
}

const FILE = (sessionId: string) => `sessions/${sessionId}/oneshot-state.json`

export async function persistOneShotState(
  sessionId: string,
  partial: Omit<OneShotPersistedState, 'version' | 'at'>
): Promise<void> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return

  const body: OneShotPersistedState = {
    version: 1,
    at: Date.now(),
    ...partial,
  }
  if (tauri.isTauri()) {
    await ensureSessionLayout(sessionId)
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('orca_write_file', {
      relative: FILE(sessionId),
      content: JSON.stringify(body, null, 2),
    })
    return
  }
  try {
    localStorage.setItem(`orca.oneshot.${sessionId}`, JSON.stringify(body))
  } catch {
    /* quota */
  }
}

export async function loadOneShotState(sessionId: string): Promise<OneShotPersistedState | null> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return null

  if (tauri.isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const raw = (await invoke<string | null>('orca_read_file', {
        relative: FILE(sessionId),
      })) as string | null
      if (!raw?.trim()) return null
      const v = JSON.parse(raw) as OneShotPersistedState
      return v?.version === 1 ? v : null
    } catch {
      return null
    }
  }
  try {
    const raw = localStorage.getItem(`orca.oneshot.${sessionId}`)
    if (!raw) return null
    const v = JSON.parse(raw) as OneShotPersistedState
    return v?.version === 1 ? v : null
  } catch {
    return null
  }
}

export async function clearOneShotState(sessionId: string = getOrcaSessionId()): Promise<void> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return

  if (tauri.isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('orca_delete_file', { relative: FILE(sessionId) })
    } catch {
      /* missing */
    }
    return
  }
  try {
    localStorage.removeItem(`orca.oneshot.${sessionId}`)
  } catch {
    /* ignore */
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 300

export function persistOneShotStateDebounced(
  sessionId: string,
  partial: Omit<OneShotPersistedState, 'version' | 'at'>
): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void persistOneShotState(sessionId, partial)
  }, DEBOUNCE_MS)
}

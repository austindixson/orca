/**
 * After a workspace opens: project id, central vault layout, optional FS watch.
 */

import * as tauri from '../tauri'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from '../../store/settingsStore'
import { ensureProjectIdentity, readProjectIdentity } from './projectIdentity'
import { bootstrapCentralBrainLayout, getEffectiveCentralVaultPath } from './centralBrainMirror'

export async function runAfterWorkspaceOpen(): Promise<void> {
  if (!tauri.isTauri()) return
  await ensureProjectIdentity()
  const s = useSettingsStore.getState()
  if (s.centralBrainEnabled) {
    await bootstrapCentralBrainLayout()
  }
  if (s.centralBrainEnabled && s.centralBrainReverseWatchEnabled) {
    const id = await readProjectIdentity()
    if (!id) return
    const vr = await getEffectiveCentralVaultPath()
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const label = getCurrentWebviewWindow().label
    await invoke('start_central_brain_watch', {
      windowLabel: label,
      vaultRoot: vr,
      projectId: id.id,
    })
  }
}

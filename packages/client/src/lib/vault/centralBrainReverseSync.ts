/**
 * Apply iCloud-synced central vault edits back into the workspace (Tauri event).
 */

import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import * as tauri from '../tauri'
import { useSettingsStore } from '../../store/settingsStore'
import { readProjectIdentity } from './projectIdentity'
import {
  centralRelToWorkspaceRel,
  getEffectiveCentralVaultPath,
} from './centralBrainMirror'
import { ensureDirForWorkspaceRelativeFile } from './vaultBrainMirror'

export async function attachCentralBrainReverseSync(): Promise<() => void> {
  if (!tauri.isTauri()) return () => () => {}
  const unlisten = await listen<{ vaultRelPaths: string[] }>('central-brain-changed', async (ev) => {
    const paths = ev.payload?.vaultRelPaths ?? []
    if (paths.length === 0) return
    if (!useSettingsStore.getState().centralBrainReverseWatchEnabled) return
    if (!useSettingsStore.getState().centralBrainEnabled) return
    const id = await readProjectIdentity()
    if (!id) return
    const vr = await getEffectiveCentralVaultPath()
    for (const vrel of paths) {
      const wsRel = centralRelToWorkspaceRel(id.id, vrel.replace(/\\/g, '/'))
      if (!wsRel) continue
      let central: string | null = null
      try {
        central = await invoke<string | null>('central_brain_read_file', {
          vaultRoot: vr,
          relPath: vrel.replace(/\\/g, '/'),
        })
      } catch {
        continue
      }
      if (central == null) continue
      let local = ''
      try {
        local = await tauri.readFile(wsRel)
      } catch {
        local = ''
      }
      if (local === central) continue
      try {
        await ensureDirForWorkspaceRelativeFile(wsRel)
        await tauri.writeFile(wsRel, central)
      } catch (e) {
        console.warn('[central-brain] reverse sync failed', wsRel, e)
      }
    }
  })
  return unlisten
}

/**
 * Routes native menubar events (`orca-menu`) to stores and the active Monaco editor.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import * as tauri from './tauri'
import { getActiveEditor, getRegisteredEditors } from './activeEditorRegistry'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { absolutePathToWorkspaceRelative } from './workspacePathUtils'
import { syncRecentMenuFromStorage } from './recentProjects'

export type OrcaMenuPayload = { id: string; arg?: string }

async function saveAllDirtyEditors(): Promise<void> {
  const editors = getRegisteredEditors()
  for (const ed of editors) {
    try {
      if (ed.isDirty()) await ed.save()
    } catch (e) {
      console.warn('[menuBridge] save-all failed for tile', ed.tileId, e)
    }
  }
}

export async function dispatchOrcaMenuPayload(payload: OrcaMenuPayload): Promise<void> {
  const { id, arg } = payload
  const toast = useToastStore.getState()

  switch (id) {
    case 'file.new-text-file': {
      const nid = useCanvasStore.getState().addTile('editor')
      useCanvasStore.getState().updateTile(nid, { title: 'Untitled' })
      return
    }
    case 'file.new-window': {
      await tauri.openNewAppWindow()
      return
    }
    case 'file.open-file': {
      const abs = await tauri.openFileDialog([
        { name: 'Text', extensions: ['txt', 'md', 'ts', 'tsx', 'js', 'jsx', 'json', 'rs', 'py'] },
        { name: 'All files', extensions: ['*'] },
      ])
      if (!abs) return
      const root = useWorkspaceStore.getState().rootPath
      const rel = absolutePathToWorkspaceRelative(abs, root)
      if (rel === null) {
        toast.addToast({
          type: 'warning',
          title: 'Open file',
          message: 'Choose a file inside the current workspace folder, or open that folder first.',
        })
        return
      }
      const name = abs.split(/[/\\]/).pop() ?? 'file'
      const tId = useCanvasStore.getState().addTile('editor')
      useCanvasStore.getState().updateTile(tId, {
        title: name,
        meta: { file: rel, fileVersion: Date.now() },
      })
      return
    }
    case 'file.open-folder': {
      await useWorkspaceStore.getState().openFolder()
      return
    }
    case 'file.open-recent': {
      if (arg && arg.length > 0) {
        await useWorkspaceStore.getState().setRootPath(arg, { orchestratorSessionPolicy: 'follow-workspace' })
      }
      return
    }
    case 'file.save': {
      await getActiveEditor()?.save()
      return
    }
    case 'file.save-as': {
      const ed = getActiveEditor()
      if (!ed) return
      const abs = await tauri.saveFileDialog(null, [
        { name: 'Text', extensions: ['txt', 'md', 'ts', 'tsx', 'js', 'jsx', 'json'] },
        { name: 'All files', extensions: ['*'] },
      ])
      if (!abs) return
      const root = useWorkspaceStore.getState().rootPath
      const rel = absolutePathToWorkspaceRelative(abs, root)
      if (rel === null) {
        toast.addToast({
          type: 'warning',
          title: 'Save As',
          message: 'Save inside the workspace project folder (File → Open Folder…).',
        })
        return
      }
      await ed.saveAs(rel)
      return
    }
    case 'file.save-all': {
      await saveAllDirtyEditors()
      return
    }
    case 'file.revert': {
      await getActiveEditor()?.revert()
      return
    }
    case 'file.toggle-auto-save': {
      const s = useSettingsStore.getState()
      s.setEditorAutoSaveEnabled(!s.editorAutoSaveEnabled)
      const next = useSettingsStore.getState()
      await tauri.syncNativeMenuChecks(next.editorAutoSaveEnabled, next.editorWordWrap === 'on')
      return
    }
    case 'file.close-editor': {
      const t = getActiveEditor()?.tileId
      if (t) useCanvasStore.getState().removeTile(t)
      return
    }
    case 'file.close-folder': {
      await useWorkspaceStore.getState().returnToWelcome()
      return
    }
    case 'edit.find':
      getActiveEditor()?.runMonacoAction('actions.find')
      return
    case 'edit.replace':
      getActiveEditor()?.runMonacoAction('editor.action.startFindReplaceAction')
      return
    case 'edit.find-in-files':
      toast.addToast({
        type: 'info',
        title: 'Find in Files',
        message: 'Panel not wired yet — use Explorer search or your editor.',
      })
      return
    case 'edit.toggle-line-comment':
      getActiveEditor()?.runMonacoAction('editor.action.commentLine')
      return
    case 'edit.toggle-block-comment':
      getActiveEditor()?.runMonacoAction('editor.action.blockComment')
      return
    case 'view.command-palette':
      toast.addToast({ type: 'info', title: 'Command Palette', message: 'Coming soon.' })
      return
    case 'view.toggle-explorer': {
      const w = useWorkspaceStore.getState()
      w.setActivePanel('explorer')
      w.expandSidebar()
      return
    }
    case 'view.new-terminal-tile': {
      useCanvasStore.getState().addTile('terminal')
      return
    }
    case 'view.toggle-word-wrap': {
      const ed = getActiveEditor()
      if (ed) {
        ed.toggleWordWrap()
      } else {
        const s = useSettingsStore.getState()
        const w = s.editorWordWrap === 'on' ? 'off' : 'on'
        s.setEditorWordWrap(w)
        void tauri.syncNativeMenuChecks(s.editorAutoSaveEnabled, w === 'on')
      }
      return
    }
    case 'view.theme.light':
    case 'view.theme.dark':
    case 'view.theme.system':
      toast.addToast({
        type: 'info',
        title: 'Appearance',
        message: 'Theme presets from the menu are not yet wired to the canvas — use Settings → Appearance.',
      })
      return
    default:
      return
  }
}

/** Exposed for unit tests — same routing as the Tauri event listener. */
export async function handleOrcaMenuPayloadForTest(payload: OrcaMenuPayload): Promise<void> {
  await dispatchOrcaMenuPayload(payload)
}

let menuUnlisten: UnlistenFn | null = null
let settingsUnsub: (() => void) | null = null

export function initMenuBridge(): () => void {
  if (!tauri.isTauri()) return () => {}

  void (async () => {
    try {
      const s0 = useSettingsStore.getState()
      await tauri.syncNativeMenuChecks(s0.editorAutoSaveEnabled, s0.editorWordWrap === 'on')
      await syncRecentMenuFromStorage()
      menuUnlisten = await listen<OrcaMenuPayload>('orca-menu', (ev) => {
        void dispatchOrcaMenuPayload(ev.payload)
      })
      let prevAuto = s0.editorAutoSaveEnabled
      let prevWrap = s0.editorWordWrap
      settingsUnsub = useSettingsStore.subscribe((s) => {
        if (s.editorAutoSaveEnabled === prevAuto && s.editorWordWrap === prevWrap) return
        prevAuto = s.editorAutoSaveEnabled
        prevWrap = s.editorWordWrap
        void tauri.syncNativeMenuChecks(s.editorAutoSaveEnabled, s.editorWordWrap === 'on')
      })
    } catch (e) {
      console.warn('[menuBridge] init failed:', e)
    }
  })()

  return () => {
    menuUnlisten?.()
    menuUnlisten = null
    settingsUnsub?.()
    settingsUnsub = null
  }
}

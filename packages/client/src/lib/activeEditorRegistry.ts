/**
 * Tracks the focused editor tile and all mounted editors — used by the native app menu (Save / Save All).
 */

export type ActiveEditorApi = {
  tileId: string
  save: () => Promise<void>
  saveAs: (destRelativePath: string) => Promise<void>
  revert: () => Promise<void>
  runMonacoAction: (actionId: string) => void
  toggleWordWrap: () => void
  isDirty: () => boolean
  getBuffer: () => string
  getFilePath: () => string | null
}

const editors = new Map<string, ActiveEditorApi>()
let active: ActiveEditorApi | null = null

export function registerEditor(api: ActiveEditorApi): void {
  editors.set(api.tileId, api)
}

export function unregisterEditor(tileId: string): void {
  editors.delete(tileId)
  if (active?.tileId === tileId) active = null
}

export function setActiveEditor(api: ActiveEditorApi | null): void {
  active = api
}

export function getActiveEditor(): ActiveEditorApi | null {
  return active
}

export function getRegisteredEditors(): ActiveEditorApi[] {
  return [...editors.values()]
}

export function clearActiveEditorRegistryForTests(): void {
  editors.clear()
  active = null
}

/** Dispatched from menus; KeyboardShortcuts listens to open the modal. */
export const OPEN_KEYBOARD_SHORTCUTS_EVENT = 'agent-canvas:open-keyboard-shortcuts'
export const REFRESH_CHANGELOG_EVENT = 'agent-canvas:refresh-changelog'
export const REFRESH_RESEARCH_EVENT = 'agent-canvas:refresh-research'

export type ChangelogRefreshReason =
  | 'orchestrator-module-switch'
  | 'orchestrator-task-complete'
  | 'agent-task-complete'
  | 'file-written'

export interface RefreshChangelogDetail {
  reason: ChangelogRefreshReason
  sourceTileId?: string
}

export function openKeyboardShortcutsModal(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_KEYBOARD_SHORTCUTS_EVENT))
}

export function emitRefreshChangelog(detail: RefreshChangelogDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(REFRESH_CHANGELOG_EVENT, { detail }))
}

export function emitRefreshResearch(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(REFRESH_RESEARCH_EVENT))
}

import * as tauri from './tauri'

const STORAGE_KEY = 'agent-canvas-recent-projects'
const MAX = 12

/** Push current recents to the native **File → Open Recent** submenu (no-op in browser). */
export async function syncRecentMenuFromStorage(): Promise<void> {
  const projects = getRecentProjects()
  const paths = projects.map((p) => p.path)
  await tauri.rebuildRecentSubmenu(paths)
}

export interface RecentProject {
  path: string
  name: string
  openedAt: number
}

export function getRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (p): p is RecentProject =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as RecentProject).path === 'string' &&
          typeof (p as RecentProject).name === 'string' &&
          typeof (p as RecentProject).openedAt === 'number'
      )
      .sort((a, b) => b.openedAt - a.openedAt)
  } catch {
    return []
  }
}

export function addRecentProject(path: string, name: string): void {
  const trimmedPath = path.trim()
  const trimmedName = name.trim() || trimmedPath.split(/[/\\]/).pop() || 'Project'
  if (!trimmedPath) return
  const prev = getRecentProjects().filter((p) => p.path !== trimmedPath)
  const next: RecentProject[] = [
    { path: trimmedPath, name: trimmedName, openedAt: Date.now() },
    ...prev,
  ].slice(0, MAX)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota */
  }
  void syncRecentMenuFromStorage().catch(() => {})
}

export function removeRecentProject(path: string): void {
  const next = getRecentProjects().filter((p) => p.path !== path)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  void syncRecentMenuFromStorage().catch(() => {})
}

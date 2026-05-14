/**
 * File-backed todo list (sidebar + Todo tile).
 *
 * - **Open project folder:** tasks live in `<workspace>/.orca/tasks.json` (updated on every change, debounced).
 * - **No folder / welcome:** falls back to `~/.orca/tasks/<key>.json` (Tauri) or `localStorage` (browser).
 *
 * Opening the same repo again reloads `.orca/tasks.json` so the orchestrator and user can continue.
 */

import type { TodoTask } from '../../store/todoStore'
import * as tauri from '../tauri'
import { getOrcaSessionId } from './orcaSessionId'

const RELATIVE_TASKS = (storageKey: string) => `tasks/${storageKey}.json`

/** Canonical task list inside the project root (checked into git if desired). */
export const WORKSPACE_TASKS_RELATIVE = '.orca/tasks.json'

let persistTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 500

/** FNV-1a 32-bit — stable short id from absolute workspace path (filename-safe hex). */
function hashWorkspacePath(normalized: string): string {
  let h = 2166136261
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Hash segment for a real workspace root (same normalization as task keys, without the `ws-` prefix).
 * Returns null for welcome / no-folder placeholder paths so session keys stay per-window only.
 */
export function workspaceStorageHash(rootPath: string): string | null {
  const trimmed = rootPath.trim()
  if (!trimmed || trimmed === '.') return null
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized.length === 0) return null
  return hashWorkspacePath(normalized)
}

/**
 * Storage key for the task list. Real workspace roots get a per-folder key; placeholder / no folder
 * falls back to the per-window session id (legacy behavior).
 */
export function getTasksPersistenceKey(rootPath: string): string {
  const sid = getOrcaSessionId()
  const trimmed = rootPath.trim()
  if (!trimmed || trimmed === '.') {
    return sid
  }
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized.length === 0) return sid
  return `ws-${hashWorkspacePath(normalized)}`
}

async function withRetries<T>(fn: () => Promise<T>, max = 30): Promise<T> {
  let delay = 5
  let lastErr: unknown
  for (let i = 0; i < max; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(100, Math.ceil(delay * 1.35))
  }
  if (lastErr) throw lastErr
  throw new Error('withRetries: exhausted')
}

async function persistTasksToOrcaHome(storageKey: string, body: string): Promise<void> {
  if (tauri.isTauri()) {
    await withRetries(async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('orca_mkdir_p', { relative: 'tasks' })
      await invoke('orca_write_file', { relative: RELATIVE_TASKS(storageKey), content: body })
    })
    return
  }
  try {
    localStorage.setItem(`orca.tasks.${storageKey}`, body)
  } catch {
    /* quota */
  }
}

async function persistTasksToWorkspaceRoot(body: string): Promise<void> {
  await withRetries(async () => {
    await tauri.createDirectory('.orca')
    await tauri.writeFile(WORKSPACE_TASKS_RELATIVE, body)
  })
}

/**
 * Persist the current todo list for `rootPath`. Uses `.orca/tasks.json` when a real workspace folder
 * is open; otherwise ~/.orca or localStorage (session key).
 */
export async function persistTasks(rootPath: string, tasks: TodoTask[]): Promise<void> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return

  const body = JSON.stringify(tasks, null, 2)

  if (workspaceStorageHash(rootPath) != null) {
    try {
      await persistTasksToWorkspaceRoot(body)
    } catch {
      const key = getTasksPersistenceKey(rootPath)
      await persistTasksToOrcaHome(key, body)
    }
    return
  }

  const key = getTasksPersistenceKey(rootPath)
  await persistTasksToOrcaHome(key, body)
}

export function cancelTasksPersistDebounce(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
}

/**
 * Cancel pending debounced writes, persist the current in-memory tasks for the **previous** workspace,
 * then clear todos in memory so the next workspace load cannot inherit the wrong list.
 */
export async function flushTasksForWorkspaceAndClearPending(prevRootPath: string): Promise<void> {
  cancelTasksPersistDebounce()
  const { useTodoStore } = await import('../../store/todoStore')
  await persistTasks(prevRootPath, useTodoStore.getState().tasks)
  useTodoStore.getState().replaceTasks([])
}

export function persistTasksDebounced(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void (async () => {
      const { useWorkspaceStore } = await import('../../store/workspaceStore')
      const { useTodoStore } = await import('../../store/todoStore')
      await persistTasks(useWorkspaceStore.getState().rootPath, useTodoStore.getState().tasks)
    })()
  }, DEBOUNCE_MS)
}

/** Read from ~/.orca/tasks/<key>.json or localStorage (session / legacy per-workspace hash). */
export async function loadTasks(storageKey: string): Promise<TodoTask[]> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return []

  if (tauri.isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const raw = (await invoke<string | null>('orca_read_file', {
        relative: RELATIVE_TASKS(storageKey),
      })) as string | null
      if (!raw?.trim()) return []
      const parsed = JSON.parse(raw) as TodoTask[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  try {
    const raw = localStorage.getItem(`orca.tasks.${storageKey}`)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TodoTask[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Load tasks for the current workspace folder (or session fallback when no folder is set). */
export async function loadTasksForWorkspace(rootPath: string): Promise<TodoTask[]> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return []

  if (workspaceStorageHash(rootPath) != null) {
    try {
      const raw = await tauri.readFile(WORKSPACE_TASKS_RELATIVE).catch(() => '')
      if (raw?.trim()) {
        const parsed = JSON.parse(raw) as TodoTask[]
        if (Array.isArray(parsed)) return parsed
      }
    } catch {
      /* missing or invalid file */
    }

    const key = getTasksPersistenceKey(rootPath)
    const legacy = await loadTasks(key)
    if (legacy.length > 0) {
      void persistTasks(rootPath, legacy)
    }
    return legacy
  }

  return loadTasks(getTasksPersistenceKey(rootPath))
}

/** Subscribe to todo changes and debounce-persist (call once from App mount). */
export async function subscribeTodoPersistence(): Promise<() => void> {
  const { useTodoStore } = await import('../../store/todoStore')
  let first = true
  return useTodoStore.subscribe(() => {
    if (first) {
      first = false
      return
    }
    persistTasksDebounced()
  })
}

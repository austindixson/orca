/**
 * Rate limits + grouping for orchestrator-driven tool tasks (todo lane noise).
 */

import type { TodoTask } from '../store/todoStore'

const WINDOW_MS = 5000
const MAX_PER_WINDOW = 10

let windowStart = 0
let countInWindow = 0

function normalizeKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 120)
}

export interface BurstAddResult {
  action: 'add_new' | 'merge' | 'drop_rate_limit'
  /** When merge, patch this task id */
  mergeTaskId?: string
  /** Updated burst count for merged row */
  burstCount?: number
}

export function evaluateOrchestratorToolTask(
  text: string,
  existingTasks: TodoTask[]
): BurstAddResult {
  const now = Date.now()
  if (now - windowStart > WINDOW_MS) {
    windowStart = now
    countInWindow = 0
  }
  if (countInWindow >= MAX_PER_WINDOW) {
    return { action: 'drop_rate_limit' }
  }
  countInWindow += 1

  const key = normalizeKey(text)
  const match = existingTasks.find(
    (t) =>
      t.source === 'orchestrator' &&
      t.burstGroupKey === key &&
      (t.status === 'pending' || t.status === 'in_progress')
  )
  if (match) {
    return {
      action: 'merge',
      mergeTaskId: match.id,
      burstCount: (match.burstCount ?? 1) + 1,
    }
  }
  return { action: 'add_new' }
}

export function formatBurstTaskText(base: string, count: number): string {
  if (count <= 1) return base
  return `${base} (${count} similar)`
}

/** Persist burst window to ~/.orca for continuity (optional). */
export async function persistBurstState(): Promise<void> {
  const { useSettingsStore } = await import('../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return
  const payload = JSON.stringify({ windowStart, countInWindow, at: Date.now() })
  if (typeof window === 'undefined') return
  try {
    const { isTauri } = await import('./tauri')
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('orca_write_file', {
        relative: 'burst-state.json',
        content: payload,
      })
    } else {
      localStorage.setItem('orca.burst-state', payload)
    }
  } catch {
    /* ignore */
  }
}

export async function loadBurstState(): Promise<void> {
  try {
    const { isTauri } = await import('./tauri')
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      const raw = (await invoke<string | null>('orca_read_file', {
        relative: 'burst-state.json',
      })) as string | null
      if (raw) {
        const p = JSON.parse(raw) as { windowStart?: number; countInWindow?: number }
        if (typeof p.windowStart === 'number') windowStart = p.windowStart
        if (typeof p.countInWindow === 'number') countInWindow = p.countInWindow
      }
    } else {
      const raw = localStorage.getItem('orca.burst-state')
      if (raw) {
        const p = JSON.parse(raw) as { windowStart?: number; countInWindow?: number }
        if (typeof p.windowStart === 'number') windowStart = p.windowStart
        if (typeof p.countInWindow === 'number') countInWindow = p.countInWindow
      }
    }
  } catch {
    /* ignore */
  }
}

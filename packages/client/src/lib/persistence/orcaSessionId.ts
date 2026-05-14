import { nanoid } from 'nanoid'

/**
 * Legacy: single key shared by all windows (tasks / session leaked across Tauri webviews).
 * Migrated once into per-window keys or browser sessionStorage.
 */
const LEGACY_STORAGE_KEY = 'orca.orchestratorSessionId'

function getWindowLabel(): string {
  if (typeof window === 'undefined') return 'default'
  const label = (window as unknown as { __AC_WINDOW_LABEL__?: string }).__AC_WINDOW_LABEL__
  return label && label.trim().length > 0 ? label.trim() : 'browser'
}

function tauriScopedKey(label: string): string {
  return `orca.orchestratorSessionId.${label}`
}

/**
 * Per-window session id for ~/.orca/sessions/, tasks, terminals, etc.
 *
 * - **Tauri**: `localStorage` keyed by webview label (`main`, `project-<timestamp>`, …) so each window
 *   has its own session. One-time migration from {@link LEGACY_STORAGE_KEY} for the primary window.
 * - **Browser**: `sessionStorage` so each tab is isolated; reload keeps the same id in that tab.
 */
export function getOrcaSessionId(): string {
  if (typeof window === 'undefined') return 'default'
  try {
    const label = getWindowLabel()

    if (label === 'browser') {
      let id = sessionStorage.getItem(LEGACY_STORAGE_KEY)
      if (!id) {
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacy) {
          id = legacy
          try {
            localStorage.removeItem(LEGACY_STORAGE_KEY)
          } catch {
            /* ignore */
          }
        } else {
          id = nanoid(16)
        }
        sessionStorage.setItem(LEGACY_STORAGE_KEY, id)
      }
      return id
    }

    const key = tauriScopedKey(label)
    let id = localStorage.getItem(key)
    if (!id) {
      if (label === 'main') {
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacy) {
          id = legacy
          try {
            localStorage.removeItem(LEGACY_STORAGE_KEY)
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (!id) {
      id = nanoid(16)
    }
    localStorage.setItem(key, id)
    return id
  } catch {
    return 'default'
  }
}

export function setOrcaSessionIdForTesting(id: string): void {
  if (typeof window === 'undefined') return
  if (!id.trim()) return
  try {
    const label = getWindowLabel()
    if (label === 'browser') {
      sessionStorage.setItem(LEGACY_STORAGE_KEY, id.trim())
    } else {
      localStorage.setItem(tauriScopedKey(label), id.trim())
    }
  } catch {
    /* ignore */
  }
}

/** Switch persisted session id (e.g. resume incomplete session from ~/.orca/). Applies to this window only. */
export function setOrcaSessionId(id: string): void {
  if (typeof window === 'undefined') return
  if (!id.trim()) return
  setOrcaSessionIdForTesting(id.trim())
}

/**
 * Generate and persist a brand-new session id for this window/tab.
 * Use when opening a fresh project context (non-resume path).
 */
export function resetOrcaSessionId(): string {
  const id = nanoid(16)
  setOrcaSessionId(id)
  return id
}

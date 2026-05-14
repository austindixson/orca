/**
 * Last N vault mirror write attempts for Settings diagnostics (no PII beyond relative paths).
 */

import { create } from 'zustand'
import { isCanvasPersistenceHydrating } from '../lib/canvasStatePersistence'
import { useToastStore } from './toastStore'

export const VAULT_MIRROR_DIAG_MAX = 20

export type VaultMirrorDiagnosticEntry = {
  ts: number
  scope: string
  relPath: string
  ok: boolean
  errorMessage?: string
}

type VaultMirrorDiagnosticsState = {
  entries: VaultMirrorDiagnosticEntry[]
  lastSuccessAtMs: number | null
  lastSuccessRelPath: string | null
  recordAttempt: (entry: Omit<VaultMirrorDiagnosticEntry, 'ts'> & { ts?: number }) => void
  clear: () => void
}

export const useVaultMirrorDiagnosticsStore = create<VaultMirrorDiagnosticsState>((set) => ({
  entries: [],
  lastSuccessAtMs: null,
  lastSuccessRelPath: null,

  recordAttempt: (entry) => {
    const ts = entry.ts ?? Date.now()
    const row: VaultMirrorDiagnosticEntry = {
      ts,
      scope: entry.scope,
      relPath: entry.relPath,
      ok: entry.ok,
      errorMessage: entry.errorMessage,
    }
    set((s) => {
      const next = [row, ...s.entries].slice(0, VAULT_MIRROR_DIAG_MAX)
      return {
        entries: next,
        lastSuccessAtMs: entry.ok ? ts : s.lastSuccessAtMs,
        lastSuccessRelPath: entry.ok ? entry.relPath : s.lastSuccessRelPath,
      }
    })
  },

  clear: () =>
    set({
      entries: [],
      lastSuccessAtMs: null,
      lastSuccessRelPath: null,
    }),
}))

let failureToastShownThisSession = false

/**
 * Record a failed mirror attempt; log + one-shot toast per app session.
 */
export function reportVaultMirrorFailure(scope: string, relPath: string, err: unknown): void {
  const errorMessage = err instanceof Error ? err.message : String(err)
  useVaultMirrorDiagnosticsStore.getState().recordAttempt({
    scope,
    relPath,
    ok: false,
    errorMessage,
  })
  if (isCanvasPersistenceHydrating()) {
    return
  }
  console.warn('[vault-mirror]', scope, relPath, errorMessage)
  if (!failureToastShownThisSession) {
    failureToastShownThisSession = true
    useToastStore.getState().addToast({
      type: 'error',
      title: 'Vault mirror failed',
      message: `${scope}: ${errorMessage.slice(0, 200)}`,
    })
  }
}

export function recordVaultMirrorSuccess(scope: string, relPath: string): void {
  useVaultMirrorDiagnosticsStore.getState().recordAttempt({
    scope,
    relPath,
    ok: true,
  })
}

/** Reset session toast flag (tests). */
export function resetVaultMirrorFailureToastSessionFlag(): void {
  failureToastShownThisSession = false
}

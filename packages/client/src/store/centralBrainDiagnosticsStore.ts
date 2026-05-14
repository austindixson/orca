/**
 * Last N central-brain dual-write attempts (Settings diagnostics).
 */

import { create } from 'zustand'
import { isCanvasPersistenceHydrating } from '../lib/canvasStatePersistence'
import { useToastStore } from './toastStore'

export const CENTRAL_BRAIN_DIAG_MAX = 20

export type CentralBrainDiagnosticEntry = {
  ts: number
  relPath: string
  ok: boolean
  errorMessage?: string
}

type CentralBrainDiagnosticsState = {
  entries: CentralBrainDiagnosticEntry[]
  lastSuccessAtMs: number | null
  lastSuccessRelPath: string | null
  recordAttempt: (entry: Omit<CentralBrainDiagnosticEntry, 'ts'> & { ts?: number }) => void
  clear: () => void
}

export const useCentralBrainDiagnosticsStore = create<CentralBrainDiagnosticsState>((set) => ({
  entries: [],
  lastSuccessAtMs: null,
  lastSuccessRelPath: null,

  recordAttempt: (entry) => {
    const ts = entry.ts ?? Date.now()
    const row: CentralBrainDiagnosticEntry = {
      ts,
      relPath: entry.relPath,
      ok: entry.ok,
      errorMessage: entry.errorMessage,
    }
    set((s) => {
      const next = [row, ...s.entries].slice(0, CENTRAL_BRAIN_DIAG_MAX)
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

export function reportCentralBrainFailure(relPath: string, err: unknown): void {
  const errorMessage = err instanceof Error ? err.message : String(err)
  useCentralBrainDiagnosticsStore.getState().recordAttempt({
    relPath,
    ok: false,
    errorMessage,
  })
  if (isCanvasPersistenceHydrating()) {
    return
  }
  console.warn('[central-brain]', relPath, errorMessage)
  if (!failureToastShownThisSession) {
    failureToastShownThisSession = true
    useToastStore.getState().addToast({
      type: 'error',
      title: 'Central brain write failed',
      message: errorMessage.slice(0, 200),
    })
  }
}

export function recordCentralBrainSuccess(relPath: string): void {
  useCentralBrainDiagnosticsStore.getState().recordAttempt({
    relPath,
    ok: true,
  })
}

/** Reset session toast flag (tests). */
export function resetCentralBrainFailureToastSessionFlag(): void {
  failureToastShownThisSession = false
}

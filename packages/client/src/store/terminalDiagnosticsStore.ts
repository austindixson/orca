import { create } from 'zustand'
import { nanoid } from 'nanoid'

export type TerminalDiagnosticCategory = 'hermes_gateway' | 'generic'
export type TerminalDiagnosticSeverity = 'warning' | 'error' | 'fatal'
export type TerminalDiagnosticKind =
  | 'connect_timeout'
  | 'process_exit_nonzero'
  | 'dependency_missing'
  | 'command_not_found'
  | 'package_resolve'
  | 'websocket_disconnect'
  | 'pty_spawn_failed'
  | 'generic'
export type TerminalDiagnosticRecoverability = 'retryable' | 'user_action_required' | 'unknown'

export interface TerminalDiagnosticEntry {
  id: string
  tileId: string
  tileTitle: string
  severity: TerminalDiagnosticSeverity
  kind: TerminalDiagnosticKind
  category: TerminalDiagnosticCategory
  recoverability: TerminalDiagnosticRecoverability
  /** Short headline for tools / list_modules */
  summary: string
  /** Optional remediation (Hermes) */
  remediation?: string
  rawText?: string
  exitCode?: number | null
  signal?: number | null
  /**
   * Hermes stderr indicated the HTTP API accepts requests with no API_SERVER_KEY (typical local dev).
   * Orchestrator should clear Orca key with configure_hermes_api api_key "" if needed — do not invent a key.
   */
  hermes_local_dev_no_auth?: boolean
  ts: number
}

const MAX_ENTRIES = 80

interface TerminalDiagnosticsState {
  entries: TerminalDiagnosticEntry[]
  recordDiagnostic: (e: {
    tileId: string
    tileTitle: string
    severity: TerminalDiagnosticSeverity
    kind: TerminalDiagnosticKind
    summary: string
    recoverability?: TerminalDiagnosticRecoverability
    category?: TerminalDiagnosticCategory
    remediation?: string
    rawText?: string
    exitCode?: number | null
    signal?: number | null
    hermes_local_dev_no_auth?: boolean
  }) => void
  recordWarning: (e: {
    tileId: string
    tileTitle: string
    category: TerminalDiagnosticCategory
    summary: string
    remediation?: string
    hermes_local_dev_no_auth?: boolean
  }) => void
  /** Last N entries for tiles still on the canvas (by id set). */
  snapshotForTileIds: (ids: Set<string>) => TerminalDiagnosticEntry[]
  latestForTile: (tileId: string) => TerminalDiagnosticEntry | null
  clearForTile: (tileId: string) => void
}

export const useTerminalDiagnosticsStore = create<TerminalDiagnosticsState>((set, get) => ({
  entries: [],

  recordDiagnostic: ({
    tileId,
    tileTitle,
    severity,
    kind,
    summary,
    recoverability,
    category,
    remediation,
    rawText,
    exitCode,
    signal,
    hermes_local_dev_no_auth,
  }) => {
    const entry: TerminalDiagnosticEntry = {
      id: nanoid(10),
      tileId,
      tileTitle,
      severity,
      kind,
      category: category ?? 'generic',
      recoverability: recoverability ?? 'unknown',
      summary: summary.slice(0, 500),
      remediation: remediation?.slice(0, 1200),
      rawText: rawText?.slice(0, 2000),
      ...(typeof exitCode === 'number' || exitCode === null ? { exitCode } : {}),
      ...(typeof signal === 'number' || signal === null ? { signal } : {}),
      ...(hermes_local_dev_no_auth === true ? { hermes_local_dev_no_auth: true } : {}),
      ts: Date.now(),
    }
    set((s) => {
      const withoutDup = s.entries.filter(
        (x) =>
          !(
            x.tileId === tileId &&
            x.summary === entry.summary &&
            x.kind === entry.kind &&
            x.severity === entry.severity &&
            x.exitCode === entry.exitCode &&
            x.signal === entry.signal
          )
      )
      return { entries: [...withoutDup, entry].slice(-MAX_ENTRIES) }
    })
  },

  recordWarning: ({ tileId, tileTitle, category, summary, remediation, hermes_local_dev_no_auth }) => {
    get().recordDiagnostic({
      tileId,
      tileTitle,
      severity: 'warning',
      kind: 'generic',
      category,
      recoverability: hermes_local_dev_no_auth ? 'user_action_required' : 'unknown',
      summary,
      remediation,
      hermes_local_dev_no_auth,
    })
  },

  snapshotForTileIds: (ids) => get().entries.filter((e) => ids.has(e.tileId)).slice(-40),

  latestForTile: (tileId) => {
    const matches = get().entries.filter((e) => e.tileId === tileId)
    return matches.length > 0 ? matches[matches.length - 1] ?? null : null
  },

  clearForTile: (tileId) => set((s) => ({ entries: s.entries.filter((e) => e.tileId !== tileId) })),
}))
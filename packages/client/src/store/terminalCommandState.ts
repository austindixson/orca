import { create } from 'zustand'

export type TerminalCommandRecord = {
  commandId: string
  cmd: string
  argv?: string[]
  startedAt: number
  endedAt: number
  exitCode: number
  durationMs: number
  outputTail: string
  errorSignature: string | null
}

export type TerminalActiveCommand = {
  commandId: string
  cmd: string
  argv?: string[]
  startedAt: number
  /** Lines collected while the command runs (error-shaped), for aggregation */
  errorBuffer: string
}

type TileCommandState = {
  active: TerminalActiveCommand | null
  lastCommand: TerminalCommandRecord | null
  history: TerminalCommandRecord[]
}

const HISTORY_LEN = 10

type State = {
  byTileId: Record<string, TileCommandState | undefined>
  startCommand: (tileId: string, ac: Omit<TerminalActiveCommand, 'errorBuffer'>) => void
  appendActiveErrorBuffer: (tileId: string, chunk: string) => void
  completeCommand: (
    tileId: string,
    commandId: string,
    partial: Omit<TerminalCommandRecord, 'commandId' | 'cmd' | 'argv' | 'startedAt'> & {
      cmd?: string
      argv?: string[]
      startedAt?: number
    }
  ) => void
  /** PTY died — force-close active command */
  abortActiveForPtyExit: (tileId: string, exitCode: number) => void
  getTileSnapshot: (tileId: string) => TileCommandState | undefined
  waitUntilCommandCompletes: (
    tileId: string,
    timeoutMs: number,
    signal?: AbortSignal
  ) => Promise<{ timedOut: boolean; record: TerminalCommandRecord | null; active: TerminalActiveCommand | null }>
}

function emptyTile(): TileCommandState {
  return { active: null, lastCommand: null, history: [] }
}

export const useTerminalCommandState = create<State>((set, get) => ({
  byTileId: {},

  getTileSnapshot: (tileId) => get().byTileId[tileId],

  startCommand: (tileId, ac) => {
    set((s) => {
      const cur = s.byTileId[tileId] ?? emptyTile()
      return {
        byTileId: {
          ...s.byTileId,
          [tileId]: {
            ...cur,
            active: { ...ac, errorBuffer: '' },
          },
        },
      }
    })
  },

  appendActiveErrorBuffer: (tileId, chunk) => {
    set((s) => {
      const cur = s.byTileId[tileId]
      const active = cur?.active
      if (!active) return s
      const nextBuf = (active.errorBuffer + chunk).slice(-24_000)
      return {
        byTileId: {
          ...s.byTileId,
          [tileId]: {
            ...(cur ?? emptyTile()),
            active: { ...active, errorBuffer: nextBuf },
          },
        },
      }
    })
  },

  completeCommand: (tileId, commandId, partial) => {
    set((s) => {
      const cur = s.byTileId[tileId] ?? emptyTile()
      const active = cur.active
      if (!active || active.commandId !== commandId) {
        return s
      }
      const rec: TerminalCommandRecord = {
        commandId,
        cmd: partial.cmd ?? active.cmd,
        argv: partial.argv ?? active.argv,
        startedAt: partial.startedAt ?? active.startedAt,
        endedAt: partial.endedAt,
        exitCode: partial.exitCode,
        durationMs: partial.durationMs,
        outputTail: partial.outputTail,
        errorSignature: partial.errorSignature,
      }
      const history = [rec, ...cur.history].slice(0, HISTORY_LEN)
      return {
        byTileId: {
          ...s.byTileId,
          [tileId]: {
            active: null,
            lastCommand: rec,
            history,
          },
        },
      }
    })
  },

  abortActiveForPtyExit: (tileId, exitCode) => {
    set((s) => {
      const cur = s.byTileId[tileId]
      const active = cur?.active
      if (!active) return s
      const now = Date.now()
      const rec: TerminalCommandRecord = {
        commandId: active.commandId,
        cmd: active.cmd,
        argv: active.argv,
        startedAt: active.startedAt,
        endedAt: now,
        exitCode,
        durationMs: Math.max(0, now - active.startedAt),
        outputTail: active.errorBuffer || '(pty session ended)',
        errorSignature: exitCode !== 0 ? `pty_exit:${exitCode}` : null,
      }
      const history = [rec, ...(cur?.history ?? [])].slice(0, HISTORY_LEN)
      return {
        byTileId: {
          ...s.byTileId,
          [tileId]: {
            active: null,
            lastCommand: rec,
            history,
          },
        },
      }
    })
  },

  waitUntilCommandCompletes: (tileId, timeoutMs, signal) =>
    new Promise((resolve) => {
      const deadline = Date.now() + Math.max(100, timeoutMs)
      const tick = () => {
        if (signal?.aborted) {
          const snap = get().getTileSnapshot(tileId)
          resolve({
            timedOut: true,
            record: snap?.lastCommand ?? null,
            active: snap?.active ?? null,
          })
          return
        }
        const snap = get().getTileSnapshot(tileId)
        if (!snap?.active) {
          resolve({
            timedOut: false,
            record: snap?.lastCommand ?? null,
            active: null,
          })
          return
        }
        if (Date.now() >= deadline) {
          resolve({
            timedOut: true,
            record: snap?.lastCommand ?? null,
            active: snap.active,
          })
          return
        }
        window.setTimeout(tick, 120)
      }
      tick()
    }),
}))

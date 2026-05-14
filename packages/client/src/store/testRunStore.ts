import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { finalizeTestRun, parseTestOutputLine, applySummaryLine } from '../lib/testRunParser'

export interface TestRun {
  id: string
  title: string
  commandRaw: string
  startedAt: number
  endedAt?: number
  exitCode?: number
  rawLogLines: string[]
  pass: string[]
  fail: string[]
  details: Record<string, unknown>
}

const MAX_LINES = 10_000

interface TestRunState {
  runs: TestRun[]
  activeRunByTerminal: Record<string, string>
  appendLine: (terminalTileId: string, line: string) => void
  startRun: (terminalTileId: string, commandHint: string) => string
  endRun: (terminalTileId: string, exitCode?: number) => void
  clearRuns: () => void
}

export const useTestRunStore = create<TestRunState>((set, get) => ({
  runs: [],
  activeRunByTerminal: {},

  startRun: (terminalTileId, commandHint) => {
    const id = nanoid()
    const run: TestRun = {
      id,
      title: commandHint || 'Test run',
      commandRaw: commandHint,
      startedAt: Date.now(),
      rawLogLines: [],
      pass: [],
      fail: [],
      details: {},
    }
    set((s) => ({
      runs: [run, ...s.runs].slice(0, 50),
      activeRunByTerminal: { ...s.activeRunByTerminal, [terminalTileId]: id },
    }))
    return id
  },

  appendLine: (terminalTileId, line) => {
    const { activeRunByTerminal, runs } = get()
    const rid = activeRunByTerminal[terminalTileId]
    if (!rid) return
    set({
      runs: runs.map((r) => {
        if (r.id !== rid) return r
        const nextLines = [...r.rawLogLines, line]
        const rawLogLines = nextLines.length > MAX_LINES ? nextLines.slice(-MAX_LINES) : nextLines
        const updated: TestRun = { ...r, rawLogLines }
        parseTestOutputLine(line, updated)
        applySummaryLine(line, updated)
        return updated
      }),
    })
  },

  endRun: (terminalTileId, exitCode) => {
    const { activeRunByTerminal, runs } = get()
    const rid = activeRunByTerminal[terminalTileId]
    if (!rid) return
    set({
      runs: runs.map((r) => {
        if (r.id !== rid) return r
        finalizeTestRun(r, exitCode)
        return {
          ...r,
          endedAt: Date.now(),
          exitCode,
        }
      }),
      activeRunByTerminal: Object.fromEntries(
        Object.entries(activeRunByTerminal).filter(([k]) => k !== terminalTileId)
      ),
    })
  },

  clearRuns: () => set({ runs: [], activeRunByTerminal: {} }),
}))

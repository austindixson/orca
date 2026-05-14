import { useTestRunStore } from '../store/testRunStore'

const stripAnsi = (s: string): string => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')

/** True when the user/orchestrator likely started a test runner. */
export function commandLooksLikeTest(cmd: string): boolean {
  const c = cmd.trim().toLowerCase()
  if (!c) return false
  return (
    /\b(npm|pnpm|yarn|npx)\s+(run\s+)?test\b/.test(c) ||
    /\b(npm|pnpm|yarn)\s+run\s+[\w-]*test[\w-]*\b/.test(c) ||
    /\bvitest\b/.test(c) ||
    /\bjest\b/.test(c) ||
    /\bnode\s+[^&]*--test\b/.test(c) ||
    /\b(cargo\s+test|pytest|go\s+test)\b/.test(c)
  )
}

/** First lines of output from common test runners (user-typed commands). */
export function outputSuggestsTestRunner(line: string): boolean {
  const t = stripAnsi(line)
  return (
    /\bvitest\b/i.test(t) ||
    /\bjest\b/i.test(t) ||
    /^RUN\s+v?\d/i.test(t) ||
    /^# (tests|subtests|pass|fail)\b/i.test(t) ||
    />\s*(npm|pnpm|yarn|npx)\s+test\b/i.test(t)
  )
}

/**
 * Split PTY chunks into lines; keep incomplete tail in `lineBufRef`.
 * For each complete line, forwards to testRunStore when a run is active or starts one heuristically.
 */
export function ingestTestRunTerminalChunk(
  terminalTileId: string,
  chunk: string,
  lineBufRef: { current: string }
): void {
  const merged = lineBufRef.current + chunk
  const parts = merged.split('\n')
  lineBufRef.current = parts.pop() ?? ''
  const store = useTestRunStore.getState()

  for (const line of parts) {
    const active = store.activeRunByTerminal[terminalTileId]
    if (!active) {
      if (outputSuggestsTestRunner(line)) {
        store.startRun(terminalTileId, stripAnsi(line).slice(0, 120))
      } else {
        continue
      }
    }
    store.appendLine(terminalTileId, line)
  }
}

export function flushTestRunLineBuffer(terminalTileId: string, lineBufRef: { current: string }): void {
  const rest = lineBufRef.current
  lineBufRef.current = ''
  if (!rest) return
  const store = useTestRunStore.getState()
  if (store.activeRunByTerminal[terminalTileId]) {
    store.appendLine(terminalTileId, rest)
  }
}

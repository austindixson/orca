/**
 * Incremental parser for OSC-133 command markers and __ORCA_EXIT__ footers on PTY output.
 */

import { useTerminalCommandState } from '../../store/terminalCommandState'
import { terminalErrorSignature } from '../telemetry/tapTerminalOutput'
import { stripAnsiForTelemetry } from './terminalOutputSignals'
import { finalizeOrcaTerminalCommandEffects } from './orcaTerminalCommandFinalize'

const MAX_BUF = 96_000

export type PendingOrcaCommand = {
  commandId: string
  userCommand: string
  argv?: string[]
  registeredAt: number
}

const pendingQueues = new Map<string, PendingOrcaCommand[]>()
const tileBuffers = new Map<string, string>()

const RE_OSC_D = /\x1b\]133;D;(-?\d+)(?:\x07|\x1b\\)/
const RE_OSC_C = /\x1b\]133;C(?:\x07|\x1b\\)/g
const RE_LINE_EXIT = /__ORCA_EXIT__:(-?\d+):(\d+)/

function popQueueHead(tileId: string): PendingOrcaCommand | undefined {
  const q = pendingQueues.get(tileId)
  if (!q || q.length === 0) return undefined
  const head = q.shift()
  if (q.length === 0) pendingQueues.delete(tileId)
  else pendingQueues.set(tileId, q)
  return head
}

/**
 * Call immediately before writing a wrapped orchestrator command to the PTY.
 */
export function registerOrcaCommand(tileId: string, pending: PendingOrcaCommand): void {
  const q = pendingQueues.get(tileId) ?? []
  q.push(pending)
  pendingQueues.set(tileId, q)
  useTerminalCommandState.getState().startCommand(tileId, {
    commandId: pending.commandId,
    cmd: pending.userCommand,
    argv: pending.argv,
    startedAt: pending.registeredAt,
  })
}

function extractTailBetweenCAndD(buf: string, cutEnd: number): string {
  const segment = buf.slice(0, cutEnd)
  let lastC = -1
  RE_OSC_C.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_OSC_C.exec(segment)) !== null) {
    lastC = m.index + m[0].length
  }
  const raw = lastC >= 0 ? segment.slice(lastC) : segment
  return stripAnsiForTelemetry(raw)
    .replace(/\x1b\]133;D;[-?\d]+(?:\x07|\x1b\\)/g, '')
    .replace(/__ORCA_EXIT__:[-?\d]+:\d+/g, '')
    .trim()
}

/**
 * Feed raw PTY bytes for one tile (same chunks as xterm receives).
 */
export function feedTerminalCommandTracker(tileId: string, chunk: string): void {
  if (!chunk) return
  let buf = (tileBuffers.get(tileId) ?? '') + chunk
  if (buf.length > MAX_BUF) {
    buf = buf.slice(-MAX_BUF)
  }
  tileBuffers.set(tileId, buf)

  while (true) {
    const progressed = tryCompleteOne(tileId)
    if (!progressed) break
  }
}

function tryCompleteOne(tileId: string): boolean {
  const buf = tileBuffers.get(tileId) ?? ''
  if (!buf) return false

  const dMatch = buf.match(RE_OSC_D)
  let exitCode: number | null = null
  let cutEnd = -1

  if (dMatch && dMatch.index !== undefined) {
    exitCode = Number(dMatch[1])
    cutEnd = dMatch.index + dMatch[0].length
  } else {
    const lineMatch = buf.match(RE_LINE_EXIT)
    if (lineMatch && lineMatch.index !== undefined) {
      exitCode = Number(lineMatch[1])
      cutEnd = lineMatch.index + lineMatch[0].length
    }
  }

  if (exitCode === null || cutEnd < 0) return false

  const pending = popQueueHead(tileId)
  const rest = buf.slice(cutEnd)
  tileBuffers.set(tileId, rest)

  if (!pending) {
    // Spurious match (user shell) — advance buffer and keep scanning.
    return rest.length < buf.length
  }

  const tail = extractTailBetweenCAndD(buf, cutEnd)
  const tailMax = 12_000
  const outputTail = tail.length > tailMax ? `${tail.slice(-tailMax)}\n…` : tail

  const now = Date.now()
  const errSig =
    exitCode !== 0
      ? terminalErrorSignature(outputTail.split('\n').find((l) => l.trim()) ?? outputTail)
      : null

  useTerminalCommandState.getState().completeCommand(tileId, pending.commandId, {
    endedAt: now,
    exitCode,
    durationMs: Math.max(0, now - pending.registeredAt),
    outputTail,
    errorSignature: errSig,
    cmd: pending.userCommand,
    argv: pending.argv,
    startedAt: pending.registeredAt,
  })

  const snap = useTerminalCommandState.getState().getTileSnapshot(tileId)
  if (snap?.lastCommand) {
    finalizeOrcaTerminalCommandEffects(tileId, snap.lastCommand)
  }

  return true
}

/** When the whole PTY session exits, fail any in-flight Orca commands. */
export function notifyTerminalCommandTrackerPtyExit(tileId: string, exitCode: number): void {
  tileBuffers.delete(tileId)
  pendingQueues.delete(tileId)
  useTerminalCommandState.getState().abortActiveForPtyExit(tileId, exitCode === 0 ? 0 : exitCode || 129)
}

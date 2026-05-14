/**
 * Throttled terminal output tap for unified telemetry (ANSI-stripped, error-shaped line detection).
 *
 * Also routes error-shaped lines into the **bug bounty board** via
 * {@link routeTerminalErrorToBounty}, so the hunter pool can triage them
 * automatically (dedup'd by signature + tile within a rolling window — see
 * bugBountyStore). Routing is a best-effort side-effect: telemetry is the
 * source of truth for the dev dashboard.
 */

import { stripAnsi } from '../terminal/terminalOutputSignals'
import { recordTelemetry } from '../../store/unifiedTelemetryStore'
import {
  useBugBountyStore,
  type BountySeverity,
} from '../../store/bugBountyStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useTerminalCommandState } from '../../store/terminalCommandState'
import type {
  TerminalDiagnosticKind,
  TerminalDiagnosticRecoverability,
  TerminalDiagnosticSeverity,
} from '../../store/terminalDiagnosticsStore'

const THROTTLE_MS = 100

/** Classify severity so criticals get priority in the hunter queue. */
export function classifyTerminalSeverity(line: string): BountySeverity {
  const lc = line.toLowerCase()
  if (/(fatal|panic|segfault|sigsegv|core dumped|uncaught|unhandled)/.test(lc)) {
    return 'critical'
  }
  if (/(error|failed|exit\s*\(?\s*[1-9])/.test(lc)) return 'high'
  if (/(warn|deprecated|timeout|retry)/.test(lc)) return 'medium'
  return 'low'
}

/**
 * Normalize a noisy line into a dedupe signature — strips timestamps, paths,
 * numeric ids, colors, and quoted strings so repeat errors collapse.
 */
export function terminalErrorSignature(line: string): string {
  return line
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.\-+z]+/g, '<ts>')
    .replace(/\d{1,2}:\d{2}:\d{2}(?:\.\d+)?/g, '<time>')
    .replace(/(?:\/[\w.\-]+)+/g, '<path>')
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/:\d+(?::\d+)?\b/g, ':<n>')
    .replace(/\b\d{3,}\b/g, '<n>')
    .replace(/"[^"]{0,120}"/g, '"<str>"')
    .replace(/'[^']{0,120}'/g, "'<str>'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function shortTitleForTerminalError(line: string): string {
  const stripped = line
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const t = stripped.length > 0 ? stripped : line.trim()
  return t.length > 96 ? `${t.slice(0, 93)}…` : t
}

export interface TerminalFailureDiagnostic {
  severity: TerminalDiagnosticSeverity
  kind: TerminalDiagnosticKind
  recoverability: TerminalDiagnosticRecoverability
  summary: string
}

export function classifyTerminalFailure(line: string): TerminalFailureDiagnostic | null {
  const normalized = stripAnsi(line).replace(/\r/g, '').trim()
  if (!normalized) return null
  const lc = normalized.toLowerCase()

  if (/(panic:|fatal error:|segfault|sigsegv|core dumped|internal compiler error)/.test(lc)) {
    return {
      severity: 'fatal',
      kind: 'generic',
      recoverability: 'unknown',
      summary: shortTitleForTerminalError(normalized),
    }
  }

  if (
    /terminal connection timed out|socket open timed out|pty_connect_timeout|websocket_open_timeout/.test(lc)
  ) {
    return {
      severity: 'error',
      kind: 'connect_timeout',
      recoverability: 'retryable',
      summary: shortTitleForTerminalError(normalized),
    }
  }

  if (/pty spawn failed|failed to create pty|failed to connect/.test(lc)) {
    return {
      severity: 'error',
      kind: 'pty_spawn_failed',
      recoverability: 'retryable',
      summary: shortTitleForTerminalError(normalized),
    }
  }

  if (/\bcommand not found\b|is not recognized as an internal or external command/.test(lc)) {
    return {
      severity: 'error',
      kind: 'command_not_found',
      recoverability: 'user_action_required',
      summary: shortTitleForTerminalError(normalized),
    }
  }

  if (
    /\beresolve\b|\bcould not resolve dependency\b|\bunable to resolve dependency tree\b|\bnpm error code e404\b|\b404 not found - get https?:\/\/registry\.npmjs\.org/.test(
      lc
    )
  ) {
    return {
      severity: 'error',
      kind: 'package_resolve',
      recoverability: 'user_action_required',
      summary: shortTitleForTerminalError(normalized),
    }
  }

  if (
    /\bcannot find package\b|\bcannot find module\b|\bmodule not found\b|\berr_module_not_found\b/.test(lc)
  ) {
    return {
      severity: 'error',
      kind: 'dependency_missing',
      recoverability: 'user_action_required',
      summary: shortTitleForTerminalError(normalized),
    }
  }

  if (/\b(no such file or directory|permission denied|eacces|eperm|enoent|error\b|failed to\b)/.test(lc)) {
    return {
      severity: 'error',
      kind: 'generic',
      recoverability: 'unknown',
      summary: shortTitleForTerminalError(normalized),
    }
  }

  return null
}

/**
 * Push an error-shaped terminal line onto the bounty board. Safe no-op when
 * the feature flag is off or we're running outside the window (tests).
 */
export function routeTerminalCommandFailureToBounty(
  tileId: string,
  payload: {
    commandId: string
    exitCode: number
    outputTail: string
    errorSignature: string | null
  }
): void {
  if (typeof window === 'undefined') return
  let enabled = true
  try {
    enabled = useSettingsStore.getState().orcaBugBountyLaneEnabled !== false
  } catch {
    /* default on */
  }
  if (!enabled) return

  const tail = payload.outputTail.trim()
  const headline =
    tail
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && classifyTerminalFailure(l)) ??
    tail.split('\n')[0] ??
    `exit ${payload.exitCode}`

  const severity = classifyTerminalSeverity(headline)
  const signature = payload.errorSignature
    ? `terminal:${payload.errorSignature}`
    : `terminal:${terminalErrorSignature(headline)}`

  try {
    useBugBountyStore.getState().addBounty({
      title: `Terminal · exit ${payload.exitCode}: ${shortTitleForTerminalError(headline)}`,
      summary:
        tail.length > 900
          ? `${tail.slice(0, 900)}…\n\n(command ${payload.commandId})`
          : `${tail}\n\n(command ${payload.commandId})`,
      severity,
      sourceKind: 'terminal',
      sourceTileId: tileId,
      sourceSignature: signature,
      samplePayload: tail.length > 1200 ? `${tail.slice(0, 1200)}…` : tail,
    })
  } catch {
    /* swallow */
  }
}

function routeTerminalErrorToBounty(tileId: string, line: string): void {
  if (typeof window === 'undefined') return
  let enabled = true
  try {
    enabled = useSettingsStore.getState().orcaBugBountyLaneEnabled !== false
  } catch {
    // If settings haven't rehydrated yet, default to enabled — errors must not
    // be swallowed during first paint.
  }
  if (!enabled) return

  const severity = classifyTerminalSeverity(line)
  const signature = `terminal:${terminalErrorSignature(line)}`
  try {
    useBugBountyStore.getState().addBounty({
      title: `Terminal · ${shortTitleForTerminalError(line)}`,
      summary: line.length > 600 ? `${line.slice(0, 600)}…` : line,
      severity,
      sourceKind: 'terminal',
      sourceTileId: tileId,
      sourceSignature: signature,
      samplePayload: line.length > 1200 ? `${line.slice(0, 1200)}…` : line,
    })
  } catch {
    // Swallow — routing must never crash terminal rendering.
  }
}

type Bucket = {
  buf: string
  timer: ReturnType<typeof setTimeout> | null
  /** Spinner / sub-4-char control noise flushes coalesced into one summary line. */
  suppressedNoiseFlushes: number
}

const buckets = new Map<string, Bucket>()

/** Braille block spinner glyphs only (ora/cli-spinners) — drop from telemetry flood. */
function isSpinnerOnlyChunk(plain: string): boolean {
  const t = plain.replace(/\r/g, '')
  if (!t.trim()) return true
  return /^[\u2800-\u28FF\s]+$/.test(t)
}

/** Braille spinners, bracketed-paste residue, or tiny control-only writes — drop from telemetry flood. */
function shouldSuppressNoisePlain(plain: string): boolean {
  const t = plain.replace(/\r/g, '')
  if (!t.trim()) return true
  if (isSpinnerOnlyChunk(t)) return true
  const trimmed = t.trim()
  if (trimmed.length < 4 && !/[a-zA-Z0-9]/.test(trimmed)) return true
  return false
}

function flushTile(tileId: string, raw: string): void {
  const plain = stripAnsi(raw).replace(/\r/g, '')
  if (!plain.trim()) return

  const b = buckets.get(tileId)
  if (shouldSuppressNoisePlain(plain)) {
    if (b) b.suppressedNoiseFlushes += 1
    return
  }

  if (b && b.suppressedNoiseFlushes > 0) {
    const n = b.suppressedNoiseFlushes
    b.suppressedNoiseFlushes = 0
    recordTelemetry({
      category: 'output',
      source: 'terminal',
      tileId,
      title: 'Terminal output',
      text: `(coalesced ${n} spinner/control noise chunk${n === 1 ? '' : 's'})`,
      payloadJson: JSON.stringify({ coalescedNoiseFlushes: n }),
    })
  }

  recordTelemetry({
    category: 'output',
    source: 'terminal',
    tileId,
    title: 'Terminal output',
    text: plain.length > 8000 ? `${plain.slice(0, 8000)}…` : plain,
    payloadJson: JSON.stringify({ chunkChars: plain.length }),
  })

  let skipLineBounty = false
  try {
    skipLineBounty = Boolean(useTerminalCommandState.getState().getTileSnapshot(tileId)?.active)
  } catch {
    skipLineBounty = false
  }

  for (const line of plain.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (classifyTerminalFailure(t) && !skipLineBounty) {
      routeTerminalErrorToBounty(tileId, t)
    }
  }
}

/**
 * Call for every chunk written to the terminal emulator for this tile.
 * Coalesces writes per tile within {@link THROTTLE_MS}.
 */
export function tapTerminalOutput(tileId: string, chunk: string): void {
  if (!chunk) return
  let b = buckets.get(tileId)
  if (!b) {
    b = { buf: '', timer: null, suppressedNoiseFlushes: 0 }
    buckets.set(tileId, b)
  }
  b.buf += chunk
  if (b.timer) return
  b.timer = setTimeout(() => {
    b!.timer = null
    const payload = b!.buf
    b!.buf = ''
    flushTile(tileId, payload)
  }, THROTTLE_MS)
}

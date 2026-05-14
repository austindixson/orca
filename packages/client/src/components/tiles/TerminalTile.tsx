import { useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react'
import { nanoid } from 'nanoid'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { useCanvasStore, type TileStatus } from '../../store/canvasStore'
import { useToastStore } from '../../store/toastStore'
import { useTodoStore } from '../../store/todoStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import * as tauri from '../../lib/tauri'
import { appendTerminalOutput } from '../../lib/persistence/terminalPersistence'
import { useTestRunStore } from '../../store/testRunStore'
import {
  commandLooksLikeTest,
  flushTestRunLineBuffer,
  ingestTestRunTerminalChunk,
} from '../../lib/testRunCapture'
import { validateBashForMode } from '../../lib/harness/bashValidation'
import { applySafetyMode, scanShellCommandForDanger } from '../../lib/orchestrator/orchestratorSafetyGuard'
import { useSettingsStore } from '../../store/settingsStore'
import { useTerminalDiagnosticsStore } from '../../store/terminalDiagnosticsStore'
import {
  chunkLooksLikeWarning,
  stripAnsi,
  summarizeHermesGatewayWarnings,
} from '../../lib/terminal/terminalOutputSignals'
import {
  classifyTerminalFailure,
  tapTerminalOutput,
  type TerminalFailureDiagnostic,
} from '../../lib/telemetry/tapTerminalOutput'
import { wrapOrcaShellCommand } from '../../lib/terminal/wrapShellCommand'
import { normalizeNonInteractiveShellInput } from '../../lib/terminal/nonInteractiveCommands'
import {
  feedTerminalCommandTracker,
  notifyTerminalCommandTrackerPtyExit,
  registerOrcaCommand,
} from '../../lib/terminal/terminalCommandTracker'
import { terminalMetaCommandShouldBlockDuplicate } from '../../lib/orchestrator/terminalCommandDuplicateGuard'
import { useTerminalCommandState } from '../../store/terminalCommandState'
import { useTileMountAck } from '../../hooks/useTileMountAck'
import { getWebSocketUrl } from '../../api/config'
import {
  reportTerminalConnectOk,
  reportTerminalConnectStart,
  reportTerminalConnectTimeout,
} from '../../lib/telemetry/terminalConnectTelemetry'
import { recordTelemetry } from '../../store/unifiedTelemetryStore'
import type {
  TerminalDiagnosticKind,
  TerminalDiagnosticSeverity,
} from '../../store/terminalDiagnosticsStore'

const CONNECT_TIMEOUT_MS = 15000
const MAX_CONNECT_ATTEMPTS = 4
const LISTENER_SETUP_TIMEOUT_MS = 15000
/** Rust runs PTY creation on a blocking thread; under load IPC can still exceed a short deadline. */
const PTY_CREATE_TIMEOUT_MS = 25000
/** Successful runs: remove the terminal tile after this delay so the canvas stays tidy. */
const TERMINAL_DONE_AUTO_CLOSE_MS = 10_000

function reconnectDelayMs(): number {
  return 350 + Math.floor(Math.random() * 450)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label}_timeout_${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function debugTerminalLog(
  hypothesisId: string,
  message: string,
  data: Record<string, unknown>
): void {
  fetch('http://127.0.0.1:7696/ingest/d871edbc-ff39-4d74-96b8-887cea450cfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '98326f' },
    body: JSON.stringify({
      sessionId: '98326f',
      runId: 'terminal-connect-investigation',
      hypothesisId,
      location: 'packages/client/src/components/tiles/TerminalTile.tsx',
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}

/**
 * Rust/tracing-style summaries often include `0 failed` (zero failures). Our keyword list
 * matches `failed` and would falsely mark the tile as errored when a TUI prints startup stats.
 */
function lineIsBenignZeroFailedStats(line: string): boolean {
  const t = line.trim().toLowerCase()
  if (!/\b0\s+failed\b/.test(t)) return false
  return /\b(skills|registered|bundled|skipped|categories|across|passed)\b/.test(t)
}

/**
 * Heredoc openers and bare PS2 continuation prompts often contain words that
 * look like errors (e.g. "failed" in sample text) but are not command failures.
 */
function lineIsHeredocDelimiterOrShellContinuationNoise(line: string): boolean {
  const t = line.trim()
  if (/^>\s*$/.test(t)) return true
  if (/\s<<[-]?\s*['"]?[A-Za-z0-9_]+['"]?\s*$/.test(line)) return true
  return false
}

/**
 * Benign patterns that should NOT be treated as errors.
 * These are typically success messages or informational output.
 */
const BENIGN_PATTERNS = [
  /\b0\s+failed\b/,
  /\bpassed\b/,
  /\bsuccess\b/,
  /\bundone\b/,
  /\bskipped\b/i,
  /\bup to date\b/i,
  /\balready up to date\b/i,
  /\bnothing to commit\b/i,
  /\bwarning:\s+.*\s+is\s+deprecated\b/i, // Deprecation warnings are common
]

/**
 * ERROR patterns - These indicate actual failures that need attention.
 * Organized by source for maintainability.
 */
const ERROR_PATTERNS = {
  // JavaScript/TypeScript errors
  jsError: [
    /\b(Syn taxError|TypeError|ReferenceError|RangeError|URIError)\b/i,
    /\bCannot find module\b/i,
    /\bUnexpected token\b/i,
    /\bUnexpected end of input\b/i,
  ],

  // Node.js errors
  nodeError: [
    /\bERR_[A-Z_]+\b/, // ERR_UNKNOWN_EXTENSION, ERR_MODULE_NOT_FOUND, etc.
    /\bELIFECYCLE\b/, // npm script failed
  ],

  // Rust/Cargo errors
  rustError: [
    /\berror\[E\d+\]/, // error[E0382], error[E0277], etc.
    /\bpanic\b/i,
    /\binternal compiler error\b/i,
  ],

  // Python errors
  pythonError: [
    /\bTraceback\b/i,
    /\bException\b/i,
    /\b(ModuleNotFoundError|ImportError|IndentationError|KeyError|ValueError|AttributeError)\b/i,
  ],

  // Go errors
  goError: [
    /\bpanic:\s/i,
    /\bfatal error:\s/i,
  ],

  // Package manager errors
  packageManagerError: [
    /\bnpm\s+(ERR!|error)\b/i,
    /\bpnpm\s+ERR/i,
    /\byarn\s+error\b/i,
    /\bcould not determine executable\b/i,
    /\bcommand not found\b/i,
  ],

  // Git errors
  gitError: [
    /\bfatal:\s/i,
    /\berror:\s/i,
    /\bCONFLICT\b/i,
    /\bdetached HEAD\b/i,
  ],

  // Docker errors
  dockerError: [
    /\bError:\s+Cannot connect to\b/i,
    /\bcontainer.*not found\b/i,
    /\bimage.*not found\b/i,
  ],

  // System/Shell errors
  systemError: [
    /\bno such file or directory\b/i,
    /\bpermission denied\b/i,
    /\bEACCES\b|\bEPERM\b/i,
    /\bETIMEDOUT\b|\bECONNREFUSED\b/i,
    /\baddress already in use\b/i,
    /\beaddrinuse\b/i,
    /\benoent\b/i,
    /\boserror\b/i,
    /\bunterminated string\b/i,
    /\bunexpected end of file\b/i,
  ],

  // General error indicators
  generalError: [
    /\bunhandled\s+(exception|error|rejection)\b/i,
    /\bfailed to\s/i,
    // Intentionally omit bare /\bfailed\b/ — it fires on test runners / retries / stderr
    // from successful re-runs; npm ERR!, exit codes, and "failed to" still match.
  ],
}

// Flatten all error patterns into a single regex for performance
const ALL_ERROR_PATTERNS = new RegExp(
  Object.values(ERROR_PATTERNS).flat().map(p => p.source).join('|'),
  'i'
)

/**
 * Check if a line matches any benign pattern (success messages, etc.)
 */
function lineIsBenign(line: string): boolean {
  const trimmed = line.trim()
  for (const pattern of BENIGN_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }
  return false
}

const chunkLooksLikeError = (chunk: string): boolean => {
  const text = stripAnsi(chunk)
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return false

  for (const line of lines) {
    // Skip benign lines
    if (
      lineIsBenign(line) ||
      lineIsBenignZeroFailedStats(line) ||
      lineIsHeredocDelimiterOrShellContinuationNoise(line)
    ) {
      continue
    }
    // Check for error patterns
    if (ALL_ERROR_PATTERNS.test(line)) return true
  }
  return false
}

const extractTerminalErrorText = (chunk: string): string => {
  const lines = stripAnsi(chunk)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return ''

  // Filter out benign lines and lines without errors
  const matching = lines.filter(
    (line) =>
      !lineIsBenign(line) &&
      !lineIsBenignZeroFailedStats(line) &&
      !lineIsHeredocDelimiterOrShellContinuationNoise(line) &&
      ALL_ERROR_PATTERNS.test(line)
  )

  // If no error lines found, return all lines (fallback)
  const picked = matching.length > 0 ? matching : lines
  return picked.join('\n').slice(0, 1200)
}

function chunkLooksLikePrompt(
  chunk: string,
  lineBufferRef: MutableRefObject<string>
): boolean {
  const text = stripAnsi(chunk).replace(/\r/g, '')
  const merged = lineBufferRef.current + text
  const lines = merged.split('\n')
  lineBufferRef.current = lines.pop() ?? ''
  const latest = (lines.length > 0 ? lines[lines.length - 1] : lineBufferRef.current).trimEnd()
  return /[%$#>]\s*$/.test(latest)
}

export function TerminalTile({ data }: TileComponentProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const sessionIdRef = useRef<string>(data.id)
  /** True only after Rust `create_pty_session` succeeds — avoids resize/write before the PTY exists. */
  const ptySessionReadyRef = useRef(false)
  const outputUnlistenRef = useRef<(() => void) | null>(null)
  const exitUnlistenRef = useRef<(() => void) | null>(null)
  const connectionVersionRef = useRef(0)
  const connectTimeoutRef = useRef<number | null>(null)
  /** Backend PTY id for the in-flight connect attempt (used to close on timeout). */
  const pendingPtyBackendIdRef = useRef<string | null>(null)
  const tileMetaRef = useRef(data.meta)
  const lastExecutedCommandRef = useRef<string | null>(null)
  const pendingMetaCommandRef = useRef<string | null>(null)
  const pendingMetaCommandRetriesRef = useRef(0)
  const lineBufferRef = useRef('')
  const testLineBufRef = useRef('')
  const suppressNextWsCloseDiagnosticRef = useRef(false)
  const lastReportedErrorRef = useRef<string>('')
  const lastReportedAtRef = useRef(0)
  const lastClipboardActivitySigRef = useRef<string>('')
  const lastClipboardActivityAtRef = useRef(0)
  const lastReportedWarningRef = useRef<string>('')
  const lastReportedWarningAtRef = useRef(0)
  const tileStatusRef = useRef<TileStatus>(data.tileStatus ?? 'idle')
  const connectTauriPtyRef = useRef<(attemptNumber?: number) => void | Promise<void>>(() => {})
  const connectWebSocketRef = useRef<(attemptNumber?: number) => void>(() => {})
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const useTauri = tauri.isTauri()
  const updateTile = useCanvasStore((s) => s.updateTile)
  const addToast = useToastStore((s) => s.addToast)
  const ackMount = useTileMountAck(data.id)

  tileMetaRef.current = data.meta

  const writeTermAndTap = useCallback(
    (chunk: string, fromPty = false) => {
      termRef.current?.write(chunk)
      if (fromPty) {
        feedTerminalCommandTracker(data.id, chunk)
      }
      tapTerminalOutput(data.id, chunk)
    },
    [data.id]
  )

  const updateTerminalMeta = useCallback(
    (patch: Record<string, unknown>) => {
      updateTile(data.id, {
        meta: {
          ...(tileMetaRef.current ?? {}),
          ...patch,
        },
      })
    },
    [data.id, updateTile]
  )

  const setTerminalStatus = useCallback(
    (next: TileStatus) => {
      if (tileStatusRef.current === next) return
      // Errors take precedence over warnings
      if (next === 'warning' && tileStatusRef.current === 'error') return
      tileStatusRef.current = next
      updateTile(data.id, { tileStatus: next })
    },
    [data.id, updateTile]
  )

  const setTerminalConnectionState = useCallback(
    (state: 'connecting' | 'connected' | 'disconnected', patch?: Record<string, unknown>) => {
      updateTerminalMeta({
        terminalConnectionState: state,
        terminalConnectionStateAt: Date.now(),
        ...(patch ?? {}),
      })
    },
    [updateTerminalMeta]
  )

  const emitTerminalDiagnostic = useCallback(
    ({
      severity,
      kind,
      summary,
      recoverability,
      remediation,
      rawText,
      exitCode,
      signal,
      category,
      hermes_local_dev_no_auth,
    }: TerminalFailureDiagnostic & {
      remediation?: string
      rawText?: string
      exitCode?: number | null
      signal?: number | null
      category?: 'hermes_gateway' | 'generic'
      hermes_local_dev_no_auth?: boolean
    }) => {
      useTerminalDiagnosticsStore.getState().recordDiagnostic({
        tileId: data.id,
        tileTitle: data.title,
        severity,
        kind,
        summary,
        recoverability,
        remediation,
        rawText,
        exitCode,
        signal,
        category,
        hermes_local_dev_no_auth,
      })
      const ts = Date.now()
      updateTerminalMeta({
        lastTerminalDiagnostic: {
          severity,
          kind,
          summary,
          recoverability,
          ts,
          ...(typeof exitCode === 'number' || exitCode === null ? { exitCode } : {}),
          ...(typeof signal === 'number' || signal === null ? { signal } : {}),
        },
      })
      recordTelemetry({
        category: severity === 'warning' ? 'log' : 'error',
        source: 'terminal',
        level: severity === 'warning' ? 'warn' : 'error',
        tileId: data.id,
        title: `Terminal diagnostic (${kind})`,
        text: rawText?.slice(0, 4000) || summary,
        payloadJson: JSON.stringify({
          terminalDiagnostic: {
            severity,
            kind,
            summary,
            recoverability,
            ...(typeof exitCode === 'number' || exitCode === null ? { exitCode } : {}),
            ...(typeof signal === 'number' || signal === null ? { signal } : {}),
          },
        }),
      })
    },
    [data.id, data.title, updateTerminalMeta]
  )

  const emitTerminalFailureFromText = useCallback(
    (text: string, kindOverride?: TerminalDiagnosticKind, severityOverride?: TerminalDiagnosticSeverity) => {
      const diagnostic =
        classifyTerminalFailure(text) ??
        ({
          severity: severityOverride ?? 'error',
          kind: kindOverride ?? 'generic',
          recoverability: 'unknown',
          summary: text.split('\n')[0]?.trim().slice(0, 500) || 'Terminal error',
        } satisfies TerminalFailureDiagnostic)
      emitTerminalDiagnostic({
        ...diagnostic,
        ...(kindOverride ? { kind: kindOverride } : {}),
        ...(severityOverride ? { severity: severityOverride } : {}),
        rawText: text,
      })
    },
    [emitTerminalDiagnostic]
  )

  const maybeSyncBrowserPreviewUrlFromTerminalOutput = useCallback(
    (chunk: string) => {
      const text = stripAnsi(chunk)
      const localMatch = text.match(/Local:\s*(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+))/i)
      if (!localMatch) return
      const actualUrl = localMatch[1]
      const actualPort = localMatch[2]
      const command = lastExecutedCommandRef.current ?? ''
      const requestedPortMatch =
        command.match(/(?:^|\s)(?:-l|-p|--port)\s+(\d+)\b/) ??
        command.match(/\bPORT\s*=\s*(\d+)\b/) ??
        command.match(/\b(?:localhost|127\.0\.0\.1):(\d+)\b/) ??
        command.match(/\bhttp\.server\s+(\d+)\b/)
      const requestedPort = requestedPortMatch?.[1] ?? null
      updateTile(data.id, {
        meta: {
          ...(tileMetaRef.current ?? {}),
          lastServeLocalUrl: actualUrl,
          lastServeDetectedAt: Date.now(),
          lastServeRequestedPort: requestedPort,
        },
      })

      // Guardrail: only rewrite browser URLs when this terminal command explicitly
      // targeted a port. Without this, unrelated terminal output (e.g. Orca's own
      // dev client "Local: http://localhost:5173") can hijack arbitrary browser tiles.
      if (!requestedPort) return

      const tiles = useCanvasStore.getState().tiles
      for (const [id, t] of tiles) {
        if (t.type !== 'browser') continue
        const currentUrl = typeof t.meta?.url === 'string' ? String(t.meta.url).trim() : ''
        const parsedCurrentUrl = (() => {
          try {
            return new URL(currentUrl)
          } catch {
            return null
          }
        })()
        if (!parsedCurrentUrl) continue
        const currentHost = parsedCurrentUrl.hostname
          .toLowerCase()
          .replace(/\.$/, '')
          .replace(/^\[(.*)\]$/, '$1')
        const isLoopbackHost =
          currentHost === 'localhost' || currentHost === '127.0.0.1' || currentHost === '::1'
        if (!isLoopbackHost) continue
        const currentPort =
          parsedCurrentUrl.port || (parsedCurrentUrl.protocol === 'https:' ? '443' : '80')
        if (currentPort === actualPort) continue
        if (currentPort !== requestedPort) continue
        updateTile(id, {
          meta: {
            ...(t.meta ?? {}),
            url: actualUrl,
          },
        })
        useOrchestratorActivityStore
          .getState()
          .appendActivityLine(
            `[Terminal] Server bound ${actualUrl}; synced browser tile "${t.title}" from localhost:${currentPort || 'unknown'}.`
          )
      }
    },
    [updateTile]
  )

  // Execute command from meta when orchestrator sets it
  const executeMetaCommand = useCallback(
    (command: string) => {
      if (!command) return
      const argvRaw = tileMetaRef.current?.command_argv
      const argvInput =
        Array.isArray(argvRaw) && argvRaw.every((x) => typeof x === 'string')
          ? (argvRaw as string[])
          : undefined
      const normalized = normalizeNonInteractiveShellInput({ command, argv: argvInput })
      const effectiveCommand = normalized.command
      const effectiveArgv = normalized.argv
      if (!effectiveCommand || effectiveCommand === lastExecutedCommandRef.current) return

      const settings = useSettingsStore.getState()
      const bashCheck = validateBashForMode(
        effectiveCommand,
        settings.harnessTerminalReadOnlyBash ? 'read_only' : 'read_write'
      )
      if (!bashCheck.allow) {
        addToast({
          type: 'warning',
          title: 'Terminal command blocked',
          message: bashCheck.reason ?? 'Not allowed in current bash mode',
        })
        writeTermAndTap(
          `\r\n\x1b[33m[Orca: blocked — ${bashCheck.reason ?? 'read-only bash'}]\x1b[0m\r\n`
        )
        return
      }

      const scan = scanShellCommandForDanger(
        effectiveArgv && effectiveArgv.length > 0 ? effectiveArgv.join(' ') : effectiveCommand
      )
      const safety = applySafetyMode(settings.harnessSafetyMode, scan)
      if (!safety.allow) {
        addToast({
          type: 'warning',
          title: 'Terminal command blocked',
          message: safety.message ?? 'Harness safety',
        })
        writeTermAndTap(`\r\n\x1b[33m[Orca: blocked — ${safety.message ?? 'harness safety'}]\x1b[0m\r\n`)
        return
      }

      if (commandLooksLikeTest(effectiveCommand)) {
        useTestRunStore.getState().startRun(data.id, effectiveCommand)
      }

      const dup = terminalMetaCommandShouldBlockDuplicate(data.id, effectiveCommand)
      if (dup.block) {
        addToast({
          type: 'warning',
          title: 'Command not re-run',
          message: dup.message ?? 'Duplicate failed command',
        })
        writeTermAndTap(
          `\r\n\x1b[33m[Orca: ${dup.message ?? 'duplicate failed command'}]\x1b[0m\r\n`
        )
        setTerminalStatus('warning')
        return
      }

      const wrapped = wrapOrcaShellCommand({
        command: effectiveCommand,
        ...(effectiveArgv ? { argv: effectiveArgv } : {}),
      })
      const commandId = nanoid()
      registerOrcaCommand(data.id, {
        commandId,
        userCommand: effectiveCommand,
        argv: effectiveArgv,
        registeredAt: Date.now(),
      })

      const cmdWithNewline = wrapped.endsWith('\n') ? wrapped : `${wrapped}\n`
      setTerminalStatus('working')

      if (useTauri) {
        if (ptySessionReadyRef.current) {
          lastExecutedCommandRef.current = effectiveCommand
          pendingMetaCommandRef.current = null
          pendingMetaCommandRetriesRef.current = 0
          tauri.writeToPty(sessionIdRef.current, cmdWithNewline).catch(console.error)
        } else {
          pendingMetaCommandRef.current = effectiveCommand
          pendingMetaCommandRetriesRef.current += 1
          if (pendingMetaCommandRetriesRef.current <= 40) {
            window.setTimeout(() => executeMetaCommand(effectiveCommand), 120)
          } else {
            pendingMetaCommandRef.current = null
            pendingMetaCommandRetriesRef.current = 0
            writeTermAndTap('\r\n\x1b[31m[Orca: terminal PTY never became ready to run command]\x1b[0m\r\n')
            setTerminalStatus('error')
          }
        }
      } else if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        lastExecutedCommandRef.current = effectiveCommand
        pendingMetaCommandRef.current = null
        pendingMetaCommandRetriesRef.current = 0
        wsRef.current.send(
          JSON.stringify({
            type: 'pty:write',
            payload: { sessionId: sessionIdRef.current, data: cmdWithNewline },
          })
        )
      }
    },
    [addToast, data.id, setTerminalStatus, useTauri, writeTermAndTap]
  )

  const handleDetectedTerminalError = useCallback(
    (chunk: string) => {
      const errorText = extractTerminalErrorText(chunk)
      if (!errorText) return

      if (useTerminalCommandState.getState().getTileSnapshot(data.id)?.active) {
        useTerminalCommandState.getState().appendActiveErrorBuffer(data.id, `${errorText}\n`)
        setTerminalStatus('error')
        return
      }

      emitTerminalFailureFromText(errorText)
      const sig = errorText.toLowerCase().slice(0, 220)
      const now = Date.now()
      if (sig === lastReportedErrorRef.current && now - lastReportedAtRef.current < 15000) {
        return
      }
      lastReportedErrorRef.current = sig
      lastReportedAtRef.current = now

      const firstLine = errorText.split('\n')[0] ?? 'Terminal error'
      useTodoStore
        .getState()
        .addTask(`Debug terminal error (${data.title}): ${firstLine}`, 'orchestrator', 'pending')

      useOrchestratorActivityStore
        .getState()
        .appendActivityLine(`[Terminal] Error detected in "${data.title}". Added debugging task and continuing.`)

      const copy = async () => {
        try {
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(errorText)
            const nowClip = Date.now()
            const dupClip =
              sig === lastClipboardActivitySigRef.current &&
              nowClip - lastClipboardActivityAtRef.current < 20_000
            if (!dupClip) {
              lastClipboardActivitySigRef.current = sig
              lastClipboardActivityAtRef.current = nowClip
              useOrchestratorActivityStore
                .getState()
                .appendActivityLine('[Terminal] Copied detected error text to clipboard.')
            }
            addToast({
              type: 'info',
              title: 'Terminal error captured',
              message: 'Copied error text and added a debugging task.',
            })
            return
          }
        } catch {
          // fall through to non-fatal warning
        }
        const nowClip = Date.now()
        const dupWarn =
          sig === lastClipboardActivitySigRef.current && nowClip - lastClipboardActivityAtRef.current < 20_000
        if (!dupWarn) {
          lastClipboardActivitySigRef.current = sig
          lastClipboardActivityAtRef.current = nowClip
          useOrchestratorActivityStore
            .getState()
            .appendActivityLine('[Terminal] Could not copy to clipboard automatically; debugging task was still added.')
        }
        addToast({
          type: 'warning',
          title: 'Terminal error captured',
          message: 'Added debugging task, but clipboard copy failed.',
        })
      }

      void copy()
    },
    [addToast, data.id, data.title, emitTerminalFailureFromText]
  )

  const handleDetectedTerminalWarning = useCallback(
    (chunk: string) => {
      if (!chunkLooksLikeWarning(chunk)) return
      const lines = stripAnsi(chunk)
        .replace(/\r/g, '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      const sig = lines.join('|').slice(0, 160).toLowerCase()
      const now = Date.now()
      if (sig === lastReportedWarningRef.current && now - lastReportedWarningAtRef.current < 15000) {
        return
      }
      lastReportedWarningRef.current = sig
      lastReportedWarningAtRef.current = now

      const hermes = summarizeHermesGatewayWarnings(chunk)
      const summary =
        hermes?.lines[0] ?? lines.find((l) => chunkLooksLikeWarning(l)) ?? lines[0] ?? 'Terminal warning'
      const category = hermes ? 'hermes_gateway' : 'generic'
      const remediation = hermes?.remediation

      useTerminalDiagnosticsStore.getState().recordWarning({
        tileId: data.id,
        tileTitle: data.title,
        category,
        summary: summary.slice(0, 500),
        remediation,
        hermes_local_dev_no_auth: hermes?.localDevNoApiKey === true,
      })

      const activity = remediation
        ? `[Terminal warning] "${data.title}": ${summary} — ${remediation}`
        : `[Terminal warning] "${data.title}": ${summary}`
      useOrchestratorActivityStore.getState().appendActivityLine(activity)
      updateTerminalMeta({
        lastTerminalDiagnostic: {
          severity: 'warning',
          kind: 'generic',
          summary: summary.slice(0, 500),
          recoverability: hermes?.localDevNoApiKey ? 'user_action_required' : 'unknown',
          ts: Date.now(),
        },
      })
    },
    [data.id, data.title, updateTerminalMeta]
  )

  const connectTauriPty = useCallback(
    async (attemptNumber = 1) => {
      const connectionVersion = ++connectionVersionRef.current
      const backendSessionId = `${data.id}-${nanoid(8)}`
      const tileEntries = [...useCanvasStore.getState().tiles.values()]
      const terminalTiles = tileEntries.filter((t) => t.type === 'terminal')
      const terminalErrorTiles = terminalTiles.filter((t) => t.tileStatus === 'error')
      const terminalConnectingTiles = terminalTiles.filter(
        (t) => t.meta?.terminalConnectionState === 'connecting'
      )
      const terminalDisconnectedTiles = terminalTiles.filter(
        (t) => t.meta?.terminalConnectionState === 'disconnected'
      )
      const pendingDebugTerminalTasks = useTodoStore
        .getState()
        .tasks.filter((task) => /^Debug terminal error \(/i.test(task.text) && task.status !== 'completed').length
      // #region agent log
      debugTerminalLog('H2', 'connectTauriPty:start', {
        tileId: data.id,
        attemptNumber,
        connectionVersion,
        backendSessionId,
        terminalTileCount: terminalTiles.length,
        terminalErrorTileCount: terminalErrorTiles.length,
        terminalConnectingTileCount: terminalConnectingTiles.length,
        terminalDisconnectedTileCount: terminalDisconnectedTiles.length,
        pendingDebugTerminalTasks,
      })
      // #endregion
      pendingPtyBackendIdRef.current = backendSessionId
      ptySessionReadyRef.current = false
      setConnecting(true)
      setConnected(false)
      setTerminalConnectionState('connecting', {
        sessionId: backendSessionId,
      })
      termRef.current?.clear()
      if (connectTimeoutRef.current != null) {
        window.clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }

      const connectStartedAt = Date.now()
      reportTerminalConnectStart(data.id, 'tauri_pty', attemptNumber)

      connectTimeoutRef.current = window.setTimeout(() => {
        if (connectionVersion !== connectionVersionRef.current) return
        void (async () => {
          const sid = pendingPtyBackendIdRef.current ?? backendSessionId
          outputUnlistenRef.current?.()
          exitUnlistenRef.current?.()
          outputUnlistenRef.current = null
          exitUnlistenRef.current = null
          ptySessionReadyRef.current = false
          await tauri.closePtySession(sid).catch(() => {})
          pendingPtyBackendIdRef.current = null
          if (connectTimeoutRef.current != null) {
            window.clearTimeout(connectTimeoutRef.current)
            connectTimeoutRef.current = null
          }
          setConnecting(false)
          setConnected(false)

          const finalFail = attemptNumber >= MAX_CONNECT_ATTEMPTS
          // #region agent log
          debugTerminalLog('H2', 'connectTauriPty:timeout', {
            tileId: data.id,
            attemptNumber,
            connectionVersion,
            currentConnectionVersion: connectionVersionRef.current,
            finalFail,
          })
          // #endregion
          reportTerminalConnectTimeout(data.id, 'tauri_pty', 'pty_connect_timeout', attemptNumber, finalFail)
          if (!finalFail) {
            writeTermAndTap(
              `\r\n\x1b[33m[Terminal] Connection timed out — retry ${attemptNumber + 1}/${MAX_CONNECT_ATTEMPTS}…\x1b[0m\r\n`
            )
            await new Promise((r) => setTimeout(r, reconnectDelayMs()))
            if (connectionVersion !== connectionVersionRef.current) return
            void connectTauriPty(attemptNumber + 1)
            return
          }
          writeTermAndTap('\r\n\x1b[31m[Terminal connection timed out]\x1b[0m\r\n')
          emitTerminalDiagnostic({
            severity: 'error',
            kind: 'connect_timeout',
            recoverability: finalFail ? 'user_action_required' : 'retryable',
            summary: finalFail
              ? 'Terminal connection timed out after retries'
              : 'Terminal connection attempt timed out',
            rawText: '[Terminal connection timed out]',
          })
          setTerminalConnectionState('disconnected', {
            lastTerminalExitCode: null,
            lastTerminalExitSignal: null,
          })
          setTerminalStatus('error')
        })()
      }, CONNECT_TIMEOUT_MS)

      try {
        outputUnlistenRef.current?.()
        exitUnlistenRef.current?.()
        sessionIdRef.current = backendSessionId
        updateTile(data.id, {
          meta: { ...tileMetaRef.current, sessionId: backendSessionId },
        })

        // #region agent log
        debugTerminalLog('H6', 'connectTauriPty:before_onPtyOutput', {
          tileId: data.id,
          attemptNumber,
          connectionVersion,
          backendSessionId,
        })
        // #endregion
        const outputUnlisten = await withTimeout(
          tauri.onPtyOutput(backendSessionId, (output) => {
          if (connectionVersion !== connectionVersionRef.current) return
          appendTerminalOutput(backendSessionId, output)
          ingestTestRunTerminalChunk(data.id, output, testLineBufRef)
          writeTermAndTap(output, true)
          maybeSyncBrowserPreviewUrlFromTerminalOutput(output)
          if (chunkLooksLikeError(output)) {
            setTerminalStatus('error')
            handleDetectedTerminalError(output)
          } else if (chunkLooksLikeWarning(output)) {
            if (tileStatusRef.current !== 'error') {
              setTerminalStatus('warning')
            }
            handleDetectedTerminalWarning(output)
          } else if (tileStatusRef.current === 'working' && chunkLooksLikePrompt(output, lineBufferRef)) {
            setTerminalStatus('done')
          }
          }),
          LISTENER_SETUP_TIMEOUT_MS,
          'onPtyOutput_listen'
        )
        // #region agent log
        debugTerminalLog('H6', 'connectTauriPty:after_onPtyOutput', {
          tileId: data.id,
          attemptNumber,
          connectionVersion,
          backendSessionId,
        })
        // #endregion

        // #region agent log
        debugTerminalLog('H7', 'connectTauriPty:before_onPtyExit', {
          tileId: data.id,
          attemptNumber,
          connectionVersion,
          backendSessionId,
        })
        // #endregion
        const exitUnlisten = await withTimeout(
          tauri.onPtyExit(backendSessionId, (exitCode) => {
          if (connectionVersion !== connectionVersionRef.current) return
          flushTestRunLineBuffer(data.id, testLineBufRef)
          useTestRunStore.getState().endRun(data.id, exitCode == null ? undefined : exitCode)
          setConnecting(false)
          setConnected(false)
          notifyTerminalCommandTrackerPtyExit(data.id, typeof exitCode === 'number' ? exitCode : 129)
        // #region agent log
        debugTerminalLog('H5', 'connectTauriPty:onPtyExit', {
          tileId: data.id,
          exitCode,
          connectionVersion,
          currentConnectionVersion: connectionVersionRef.current,
        })
        // #endregion
        const exitLabel =
          typeof exitCode === 'number' ? `[Process exited with code ${exitCode}]` : '[Process exited]'
        writeTermAndTap(`\r\n\x1b[90m${exitLabel}\x1b[0m\r\n`)
          const ok = exitCode === 0
        setTerminalConnectionState('disconnected', {
          lastTerminalExitCode: exitCode ?? null,
          lastTerminalExitSignal: null,
        })
        if (!ok) {
          emitTerminalDiagnostic({
            severity: 'error',
            kind: 'process_exit_nonzero',
            recoverability: 'unknown',
            summary:
              typeof exitCode === 'number'
                ? `Process exited with code ${exitCode}`
                : 'Process exited without a success code',
            rawText: exitLabel,
            exitCode: exitCode ?? null,
            signal: null,
          })
        }
        setTerminalStatus(ok ? 'done' : 'error')
          }),
          LISTENER_SETUP_TIMEOUT_MS,
          'onPtyExit_listen'
        )
        // #region agent log
        debugTerminalLog('H7', 'connectTauriPty:after_onPtyExit', {
          tileId: data.id,
          attemptNumber,
          connectionVersion,
          backendSessionId,
        })
        // #endregion

        if (connectionVersion !== connectionVersionRef.current) {
          outputUnlisten()
          exitUnlisten()
          return
        }

        outputUnlistenRef.current = outputUnlisten
        exitUnlistenRef.current = exitUnlisten

        // #region agent log
        debugTerminalLog('H9', 'connectTauriPty:before_createPtySession', {
          tileId: data.id,
          attemptNumber,
          connectionVersion,
          backendSessionId,
        })
        // #endregion
        await withTimeout(
          tauri.createPtySession(backendSessionId),
          PTY_CREATE_TIMEOUT_MS,
          'createPtySession_invoke'
        )
        // #region agent log
        debugTerminalLog('H9', 'connectTauriPty:after_createPtySession', {
          tileId: data.id,
          attemptNumber,
          connectionVersion,
          backendSessionId,
        })
        // #endregion
        // #region agent log
        debugTerminalLog('H4', 'connectTauriPty:createPtySession_ok', {
          tileId: data.id,
          attemptNumber,
          connectionVersion,
          backendSessionId,
        })
        // #endregion
        ptySessionReadyRef.current = true

        if (connectionVersion !== connectionVersionRef.current) {
          ptySessionReadyRef.current = false
          outputUnlisten()
          exitUnlisten()
          await tauri.closePtySession(backendSessionId).catch(() => {})
          return
        }

        setConnected(true)
        setConnecting(false)
        setTerminalConnectionState('connected', {
          sessionId: backendSessionId,
        })
        setTerminalStatus('idle')
        pendingPtyBackendIdRef.current = null
        if (connectTimeoutRef.current != null) {
          window.clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        reportTerminalConnectOk(data.id, 'tauri_pty', attemptNumber, Date.now() - connectStartedAt)
      } catch (error) {
        const listenerSetupTimedOut =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string' &&
          /(onPty(Output|Exit)_listen_timeout_)/.test(String((error as { message?: unknown }).message))
        const ptyCreateTimedOut =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string' &&
          /createPtySession_invoke_timeout_/.test(String((error as { message?: unknown }).message))
        const finalFail = attemptNumber >= MAX_CONNECT_ATTEMPTS
        // #region agent log
        debugTerminalLog('H8', 'connectTauriPty:catch', {
          tileId: data.id,
          attemptNumber,
          connectionVersion,
          backendSessionId,
          error: String(error),
          listenerSetupTimedOut,
          ptyCreateTimedOut,
          finalFail,
          terminalErrorTileCount: [...useCanvasStore.getState().tiles.values()].filter(
            (t) => t.type === 'terminal' && t.tileStatus === 'error'
          ).length,
          pendingDebugTerminalTasks: useTodoStore
            .getState()
            .tasks.filter((task) => /^Debug terminal error \(/i.test(task.text) && task.status !== 'completed').length,
        })
        // #endregion
        // #region agent log
        debugTerminalLog('H4', 'connectTauriPty:createPtySession_error', {
          tileId: data.id,
          attemptNumber,
          connectionVersion,
          backendSessionId,
          error: String(error),
        })
        // #endregion
        ptySessionReadyRef.current = false
        pendingPtyBackendIdRef.current = null
        if (connectionVersion !== connectionVersionRef.current) return
        if (connectTimeoutRef.current != null) {
          window.clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        setConnecting(false)
        setConnected(false)
        if ((listenerSetupTimedOut || ptyCreateTimedOut) && !finalFail) {
          writeTermAndTap(
            `\r\n\x1b[33m[Terminal] ${listenerSetupTimedOut ? 'Listener setup' : 'PTY creation'} timed out — retry ${attemptNumber + 1}/${MAX_CONNECT_ATTEMPTS}…\x1b[0m\r\n`
          )
          void (async () => {
            await new Promise((r) => setTimeout(r, reconnectDelayMs()))
            if (connectionVersion !== connectionVersionRef.current) return
            void connectTauriPty(attemptNumber + 1)
          })()
          return
        }
        console.error('Failed to create PTY session:', String(error))
        writeTermAndTap(`\r\n\x1b[31m[Failed to connect: ${error}]\x1b[0m\r\n`)
        emitTerminalDiagnostic({
          severity: 'error',
          kind: 'pty_spawn_failed',
          recoverability: 'retryable',
          summary: 'Failed to create PTY session',
          rawText: String(error),
        })
        setTerminalConnectionState('disconnected')
        setTerminalStatus('error')
      }
    },
    [
      data.id,
      emitTerminalDiagnostic,
      handleDetectedTerminalError,
      handleDetectedTerminalWarning,
      maybeSyncBrowserPreviewUrlFromTerminalOutput,
      setTerminalStatus,
      setTerminalConnectionState,
      updateTile,
      writeTermAndTap,
    ]
  )

  const connectWebSocket = useCallback(
    (attemptNumber = 1) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setConnected(true)
        setConnecting(false)
        return
      }
      if (wsRef.current?.readyState === WebSocket.CONNECTING) return

      const connectionVersion = ++connectionVersionRef.current
      const connectStartedAt = Date.now()
      setConnecting(true)
      setTerminalConnectionState('connecting')
      reportTerminalConnectStart(data.id, 'websocket', attemptNumber)
      if (connectTimeoutRef.current != null) {
        window.clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }
      connectTimeoutRef.current = window.setTimeout(() => {
        if (connectionVersion !== connectionVersionRef.current) return
        void (async () => {
          if (wsRef.current) {
            try {
              wsRef.current.close()
            } catch {
              /* */
            }
            wsRef.current = null
          }
          if (connectTimeoutRef.current != null) {
            window.clearTimeout(connectTimeoutRef.current)
            connectTimeoutRef.current = null
          }
          setConnecting(false)
          setConnected(false)
          const finalFail = attemptNumber >= MAX_CONNECT_ATTEMPTS
          reportTerminalConnectTimeout(
            data.id,
            'websocket',
            'websocket_open_timeout',
            attemptNumber,
            finalFail
          )
          if (!finalFail) {
            writeTermAndTap(
              `\r\n\x1b[33m[Terminal] Socket open timed out — retry ${attemptNumber + 1}/${MAX_CONNECT_ATTEMPTS}…\x1b[0m\r\n`
            )
            await new Promise((r) => setTimeout(r, reconnectDelayMs()))
            if (connectionVersion !== connectionVersionRef.current) return
            connectWebSocket(attemptNumber + 1)
            return
          }
          writeTermAndTap('\r\n\x1b[31m[Terminal connection timed out]\x1b[0m\r\n')
          emitTerminalDiagnostic({
            severity: 'error',
            kind: 'connect_timeout',
            recoverability: finalFail ? 'user_action_required' : 'retryable',
            summary: finalFail
              ? 'Terminal socket open timed out after retries'
              : 'Terminal socket open attempt timed out',
            rawText: '[Terminal connection timed out]',
          })
          setTerminalConnectionState('disconnected')
          setTerminalStatus('error')
        })()
      }, CONNECT_TIMEOUT_MS)
      const wsUrl = getWebSocketUrl()
      let ws: WebSocket
      try {
        ws = new WebSocket(wsUrl)
      } catch (error) {
        setConnecting(false)
        setConnected(false)
        writeTermAndTap(`\r\n\x1b[31m[Failed to open socket: ${error}]\x1b[0m\r\n`)
        emitTerminalDiagnostic({
          severity: 'error',
          kind: 'generic',
          recoverability: 'retryable',
          summary: 'Failed to open terminal socket',
          rawText: String(error),
        })
        setTerminalConnectionState('disconnected')
        setTerminalStatus('error')
        if (connectTimeoutRef.current != null) {
          window.clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        if (connectionVersion !== connectionVersionRef.current) return
        setConnected(true)
        setConnecting(false)
        setTerminalConnectionState('connected')
        setTerminalStatus('idle')
        if (connectTimeoutRef.current != null) {
          window.clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        reportTerminalConnectOk(data.id, 'websocket', attemptNumber, Date.now() - connectStartedAt)

        const term = termRef.current
        if (term) {
          ws.send(
            JSON.stringify({
              type: 'pty:spawn',
              payload: { cols: term.cols, rows: term.rows },
            })
          )
        }
      }

      ws.onmessage = (event) => {
        if (connectionVersion !== connectionVersionRef.current) return
        try {
          const msg = JSON.parse(event.data)

          if (msg.type === 'pty:spawned') {
            sessionIdRef.current = msg.payload.sessionId
            setTerminalConnectionState('connected', {
              sessionId: msg.payload.sessionId,
            })
            ackMount()
          } else if (msg.type === 'error') {
            const message =
              typeof msg.payload?.message === 'string'
                ? msg.payload.message
                : 'Terminal socket error'
            const spawnFailed = /pty spawn failed/i.test(message)
            setConnecting(false)
            setConnected(false)
            writeTermAndTap(`\r\n\x1b[31m[Terminal error: ${message}]\x1b[0m\r\n`)
            emitTerminalFailureFromText(message, spawnFailed ? 'pty_spawn_failed' : 'generic')
            setTerminalConnectionState('disconnected')
            setTerminalStatus('error')
            if (connectTimeoutRef.current != null) {
              window.clearTimeout(connectTimeoutRef.current)
              connectTimeoutRef.current = null
            }
            const finalFail = attemptNumber >= MAX_CONNECT_ATTEMPTS
            if (spawnFailed) {
              reportTerminalConnectTimeout(
                data.id,
                'websocket',
                'pty_spawn_failed',
                attemptNumber,
                finalFail
              )
            }
            if (spawnFailed && !finalFail) {
              suppressNextWsCloseDiagnosticRef.current = true
              try {
                ws.close()
              } catch {
                /* noop */
              }
              if (wsRef.current === ws) {
                wsRef.current = null
              }
              writeTermAndTap(
                `\r\n\x1b[33m[Terminal] Spawn failed — retry ${attemptNumber + 1}/${MAX_CONNECT_ATTEMPTS}…\x1b[0m\r\n`
              )
              window.setTimeout(() => {
                if (connectionVersion !== connectionVersionRef.current) return
                connectWebSocket(attemptNumber + 1)
              }, reconnectDelayMs())
            }
          } else if (msg.type === 'pty:data') {
            if (msg.payload.sessionId === sessionIdRef.current) {
              const chunk = String(msg.payload.data ?? '')
              appendTerminalOutput(sessionIdRef.current, chunk)
              ingestTestRunTerminalChunk(data.id, chunk, testLineBufRef)
              writeTermAndTap(chunk, true)
              maybeSyncBrowserPreviewUrlFromTerminalOutput(chunk)
              if (chunkLooksLikeError(chunk)) {
                setTerminalStatus('error')
                handleDetectedTerminalError(chunk)
              } else if (chunkLooksLikeWarning(chunk)) {
                if (tileStatusRef.current !== 'error') {
                  setTerminalStatus('warning')
                }
                handleDetectedTerminalWarning(chunk)
              } else if (
                tileStatusRef.current === 'working' &&
                chunkLooksLikePrompt(chunk, lineBufferRef)
              ) {
                setTerminalStatus('done')
              }
            }
          } else if (msg.type === 'pty:exit') {
            flushTestRunLineBuffer(data.id, testLineBufRef)
            notifyTerminalCommandTrackerPtyExit(
              data.id,
              Number.isFinite(Number(msg.payload?.exitCode)) ? Number(msg.payload?.exitCode) : 129
            )
            const code = Number(msg.payload?.exitCode)
            const signal =
              typeof msg.payload?.signal === 'number' && Number.isFinite(msg.payload.signal)
                ? Number(msg.payload.signal)
                : null
            useTestRunStore.getState().endRun(data.id, Number.isFinite(code) ? code : undefined)
            const ok = Number.isFinite(code) && code === 0
            const exitLabel =
              Number.isFinite(code) && code !== 0
                ? `[Process exited with code ${code}]`
                : signal != null
                  ? `[Process exited with signal ${signal}]`
                  : '[Process exited]'
            writeTermAndTap(`\r\n\x1b[90m${exitLabel}\x1b[0m\r\n`)
            setTerminalConnectionState('disconnected', {
              lastTerminalExitCode: Number.isFinite(code) ? code : null,
              lastTerminalExitSignal: signal,
            })
            if (!ok) {
              emitTerminalDiagnostic({
                severity: 'error',
                kind: 'process_exit_nonzero',
                recoverability: 'unknown',
                summary:
                  Number.isFinite(code) && code !== 0
                    ? `Process exited with code ${code}`
                    : signal != null
                      ? `Process exited with signal ${signal}`
                      : 'Process exited without a success code',
                rawText: exitLabel,
                exitCode: Number.isFinite(code) ? code : null,
                signal,
              })
            }
            setTerminalStatus(ok ? 'done' : 'error')
          }
        } catch (e) {
          console.error('Failed to parse WS message:', e)
        }
      }

      ws.onclose = (event) => {
        if (connectionVersion !== connectionVersionRef.current) return
        if (suppressNextWsCloseDiagnosticRef.current) {
          suppressNextWsCloseDiagnosticRef.current = false
          return
        }
        flushTestRunLineBuffer(data.id, testLineBufRef)
        useTestRunStore.getState().endRun(data.id)
        setConnected(false)
        setConnecting(false)
        const clean = event.wasClean || event.code === 1000
        const closeLabel = clean
          ? `[Disconnected cleanly${event.code ? ` (code ${event.code})` : ''}]`
          : `[Disconnected${event.code ? ` (code ${event.code})` : ''}]`
        writeTermAndTap(
          `\r\n${clean ? '\x1b[33m' : '\x1b[31m'}${closeLabel}\x1b[0m\r\n`
        )
        emitTerminalDiagnostic({
          severity: clean ? 'warning' : 'error',
          kind: 'websocket_disconnect',
          recoverability: 'retryable',
          summary: clean ? 'Terminal socket disconnected cleanly' : 'Terminal socket disconnected unexpectedly',
          rawText: closeLabel,
        })
        setTerminalConnectionState('disconnected')
        setTerminalStatus(clean ? 'warning' : 'error')
        if (connectTimeoutRef.current != null) {
          window.clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
      }

      ws.onerror = () => {
        if (connectionVersion !== connectionVersionRef.current) return
        setConnected(false)
        setConnecting(false)
        emitTerminalDiagnostic({
          severity: 'error',
          kind: 'generic',
          recoverability: 'retryable',
          summary: 'Terminal socket error',
          rawText: 'Terminal socket error',
        })
        setTerminalConnectionState('disconnected')
        setTerminalStatus('error')
        if (connectTimeoutRef.current != null) {
          window.clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
      }
    },
    [
      ackMount,
      data.id,
      emitTerminalDiagnostic,
      emitTerminalFailureFromText,
      handleDetectedTerminalError,
      handleDetectedTerminalWarning,
      setTerminalStatus,
      setTerminalConnectionState,
      updateTile,
      writeTermAndTap,
    ]
  )

  useEffect(() => {
    connectTauriPtyRef.current = connectTauriPty
  }, [connectTauriPty])

  useEffect(() => {
    connectWebSocketRef.current = connectWebSocket
  }, [connectWebSocket])

  const connect = useCallback(() => {
    // #region agent log
    debugTerminalLog('H1', 'connect:invoked', {
      tileId: data.id,
      useTauri,
      hasTerminalRef: Boolean(terminalRef.current),
      hasTermInstance: Boolean(termRef.current),
      connectionVersion: connectionVersionRef.current,
    })
    // #endregion
    if (useTauri) {
      void connectTauriPtyRef.current(1)
    } else {
      connectWebSocketRef.current(1)
    }
  }, [useTauri])

  useEffect(() => {
    if (!terminalRef.current || termRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0d0d12',
        foreground: '#e0e0e0',
        cursor: '#00d4aa',
        cursorAccent: '#0d0d12',
        selectionBackground: '#2a4a5a',
        black: '#0d0d12',
        red: '#ff6b6b',
        green: '#00d4aa',
        yellow: '#fbbf24',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#22d3ee',
        white: '#e0e0e0',
        brightBlack: '#4a4a5a',
        brightRed: '#ff8585',
        brightGreen: '#00f5c4',
        brightYellow: '#fcd34d',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      /** Keep exact cell rows for TUIs; extra line height can cause overlap/artifacts. */
      lineHeight: 1,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(terminalRef.current)
    
    setTimeout(() => fitAddon.fit(), 0)

    termRef.current = term
    fitAddonRef.current = fitAddon

    term.onData((inputData) => {
      if (inputData.includes('\r') || inputData.includes('\n')) {
        setTerminalStatus('working')
      }
      if (useTauri) {
        if (!ptySessionReadyRef.current) return
        // Send to Tauri PTY
        tauri.writeToPty(sessionIdRef.current, inputData).catch(console.error)
      } else if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        // Send via WebSocket
        wsRef.current.send(JSON.stringify({
          type: 'pty:write',
          payload: { sessionId: sessionIdRef.current, data: inputData }
        }))
      }
    })

    // Defer connect so React Strict Mode's mount→unmount→remount does not start a PTY on the
    // throwaway mount (cleanup would race async listen/create and strand "Connecting…" / Tauri callbacks).
    const deferredConnectTimer = window.setTimeout(() => {
      connect()
    }, 0)

    return () => {
      // #region agent log
      debugTerminalLog('H3', 'terminalEffect:cleanup', {
        tileId: data.id,
        connectionVersionBefore: connectionVersionRef.current,
        sessionId: sessionIdRef.current,
      })
      // #endregion
      window.clearTimeout(deferredConnectTimer)
      connectionVersionRef.current += 1
      flushTestRunLineBuffer(data.id, testLineBufRef)
      useTestRunStore.getState().endRun(data.id)
      if (connectTimeoutRef.current != null) {
        window.clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }

      // Cleanup Tauri PTY
      if (useTauri) {
        ptySessionReadyRef.current = false
        outputUnlistenRef.current?.()
        outputUnlistenRef.current = null
        exitUnlistenRef.current?.()
        exitUnlistenRef.current = null
        tauri.closePtySession(sessionIdRef.current).catch(console.error)
      }
      
      // Cleanup WebSocket
      if (wsRef.current) {
        // Only send kill message if WebSocket is open
        if (wsRef.current.readyState === WebSocket.OPEN && sessionIdRef.current) {
          try {
            wsRef.current.send(JSON.stringify({
              type: 'pty:kill',
              payload: { sessionId: sessionIdRef.current }
            }))
          } catch (e) {
            // Ignore send errors during cleanup
          }
        }
        wsRef.current.close()
      }
      
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [connect, data.id, setTerminalStatus, useTauri])

  // Watch for meta.command changes from orchestrator and execute
  useEffect(() => {
    const cmd = data.meta?.command as string | undefined
    if (connected && cmd) {
      // Small delay to ensure PTY is ready after connection
      const timer = setTimeout(() => executeMetaCommand(cmd), 150)
      return () => clearTimeout(timer)
    }
  }, [connected, data.meta?.command, executeMetaCommand])

  /** Auto-dismiss terminal tiles after a successful command (prompt / exit 0). */
  useEffect(() => {
    if (useSettingsStore.getState().picassoMode) return
    if (data.tileStatus !== 'done') return
    const timer = window.setTimeout(() => {
      useCanvasStore.getState().removeTile(data.id)
    }, TERMINAL_DONE_AUTO_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [data.id, data.tileStatus])

  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && termRef.current) {
        fitAddonRef.current.fit()
        
        const cols = termRef.current.cols
        const rows = termRef.current.rows
        
        if (useTauri) {
          if (!ptySessionReadyRef.current) return
          // Resize via Tauri PTY
          tauri.resizePty(sessionIdRef.current, cols, rows).catch(console.error)
        } else if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
          // Resize via WebSocket
          wsRef.current.send(JSON.stringify({
            type: 'pty:resize',
            payload: { sessionId: sessionIdRef.current, cols, rows }
          }))
        }
      }
    }

    const observer = new ResizeObserver(handleResize)
    if (terminalRef.current) {
      observer.observe(terminalRef.current)
    }

    return () => observer.disconnect()
  }, [useTauri])

  const handleReconnect = async () => {
    if (connectTimeoutRef.current != null) {
      window.clearTimeout(connectTimeoutRef.current)
      connectTimeoutRef.current = null
    }
    if (useTauri) {
      ptySessionReadyRef.current = false
      // Close existing PTY session
      connectionVersionRef.current += 1
      outputUnlistenRef.current?.()
      outputUnlistenRef.current = null
      exitUnlistenRef.current?.()
      exitUnlistenRef.current = null
      await tauri.closePtySession(sessionIdRef.current).catch(() => {})
      void connectTauriPty(1)
    } else {
      connectionVersionRef.current += 1
      if (wsRef.current) {
        wsRef.current.close()
      }
      connectWebSocket(1)
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-canvas-bg">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-tile-border">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            connecting ? 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.85)]' :
            connected ? 'bg-accent-teal' :
            tileStatusRef.current === 'warning' ? 'bg-orange-400' :
            'bg-red-500'
          }`} />
          <span className="text-gray-500">
            {connecting ? 'Connecting...' :
             connected ? 'Connected' :
             tileStatusRef.current === 'warning' ? 'Warnings detected' :
             'Disconnected'}
          </span>
        </div>
        {!connected && !connecting && (
          <button
            onClick={handleReconnect}
            className="text-accent-teal hover:text-white transition-colors"
          >
            Reconnect
          </button>
        )}
      </div>
      
      {/* Terminal */}
      <div ref={terminalRef} className="flex-1 overflow-hidden" />
    </div>
  )
}

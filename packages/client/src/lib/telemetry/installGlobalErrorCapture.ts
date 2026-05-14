/**
 * Global JS error capture + unified store bridges (Hermes / orchestrator / reasoning).
 * Call once at app boot before React root.
 */

import { recordTelemetry } from '../../store/unifiedTelemetryStore'
import { getTelemetryIngestContext } from '../devTelemetryIngest'
import { useHermesTelemetryStore } from '../../store/hermesTelemetryStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { useReasoningTraceStore } from '../../store/reasoningTraceStore'

let installed = false
let bridgesInstalled = false

type WindowTelemetryDecision = {
  category: 'error' | 'log'
  level: 'error' | 'warn'
  title: string
  text: string
  suppressDefault?: boolean
  payloadExtras?: Record<string, unknown>
}

function categoryForReasoningKind(kind: 'trace' | 'reasoning' | 'content'): 'trace' | 'reasoning' {
  if (kind === 'trace') return 'trace'
  if (kind === 'reasoning') return 'reasoning'
  return 'reasoning'
}

export function installGlobalErrorCapture(): void {
  if (typeof window === 'undefined' || installed) return
  installed = true

  let inShim = false

  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)

  console.error = (...args: unknown[]) => {
    origError(...args)
    if (inShim) return
    inShim = true
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ')
      recordTelemetry({
        category: 'error',
        source: 'console',
        level: 'error',
        title: 'console.error',
        text: text.length > 16_000 ? `${text.slice(0, 16_000)}…` : text,
      })
    } finally {
      inShim = false
    }
  }

  console.warn = (...args: unknown[]) => {
    origWarn(...args)
    if (inShim) return
    inShim = true
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ')
      recordTelemetry({
        category: 'log',
        source: 'console',
        level: 'warn',
        title: 'console.warn',
        text: text.length > 16_000 ? `${text.slice(0, 16_000)}…` : text,
      })
    } finally {
      inShim = false
    }
  }

  window.addEventListener('error', (ev) => {
    const decision = classifyWindowErrorTelemetry(ev)
    const ctx = getTelemetryIngestContext()
    recordTelemetry({
      category: decision.category,
      source: 'window',
      level: decision.level,
      title: decision.title,
      text: decision.text,
      payloadJson: JSON.stringify({
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        telemetryCorrelationId: ctx.correlationId,
        telemetrySessionId: ctx.sessionId,
        telemetryRunId: ctx.runId,
        ...decision.payloadExtras,
      }),
    })
  })

  window.addEventListener('unhandledrejection', (ev) => {
    const decision = classifyUnhandledRejectionTelemetry(ev.reason)
    if (!decision) {
      ev.preventDefault()
      return
    }
    if (decision.suppressDefault) ev.preventDefault()
    const ctx = getTelemetryIngestContext()
    recordTelemetry({
      category: decision.category,
      source: 'window',
      level: decision.level,
      title: decision.title,
      text: decision.text,
      payloadJson: JSON.stringify({
        telemetryCorrelationId: ctx.correlationId,
        telemetrySessionId: ctx.sessionId,
        telemetryRunId: ctx.runId,
        ...decision.payloadExtras,
      }),
    })
  })
}

export function classifyWindowErrorTelemetry(ev: ErrorEvent): WindowTelemetryDecision {
  const msg = ev.message || 'Error'
  const where = ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : ''
  const stack = ev.error && String((ev.error as Error).stack)
  if (isLikelyGenericCrossOriginScriptError(ev)) {
    return {
      category: 'log',
      level: 'warn',
      title: 'window.error (generic script noise)',
      text: 'Suppressed generic cross-origin script error.',
      payloadExtras: {
        originalMessage: msg,
        suppressedAsNoise: true,
        noiseKind: 'generic_cross_origin_script_error',
      },
    }
  }
  return {
    category: 'error',
    level: 'error',
    title: 'window.error',
    text: [msg, stack, where].filter(Boolean).join('\n'),
  }
}

export function classifyUnhandledRejectionTelemetry(reason: unknown): WindowTelemetryDecision | null {
  const textRaw =
    reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : safeStringify(reason)
  const text = textRaw.length > 32_000 ? `${textRaw.slice(0, 32_000)}…` : textRaw
  if (isBenignPluginHttpAbort(reason, text)) {
    return null
  }
  if (isLikelyBenignMonacoCancellation(reason, text)) {
    return {
      category: 'log',
      level: 'warn',
      title: 'unhandledrejection (monaco cancellation noise)',
      text: 'Suppressed Monaco cancellation/disposal rejection.',
      suppressDefault: true,
      payloadExtras: {
        originalText: text,
        suppressedAsNoise: true,
        noiseKind: 'monaco_cancellation',
      },
    }
  }
  return {
    category: 'error',
    level: 'error',
    title: 'unhandledrejection',
    text,
  }
}

/**
 * Tauri's `@tauri-apps/plugin-http` fetches back Response objects whose body is
 * backed by a Rust `Resource` keyed by a numeric rid. When the fetch signal
 * aborts (timeout, rate-limit retry dispose, user Stop) the rid is freed, but
 * the plugin may have an in-flight read against it that then rejects with
 * `"The resource id <N> is invalid."`. These rejections never carry a stack we
 * can act on and the surrounding retry/abort paths already handle the logical
 * error — treat them as benign noise.
 */
function isBenignPluginHttpAbort(reason: unknown, text: string): boolean {
  if (typeof text === 'string' && /^The resource id \d+ is invalid\.?$/.test(text.trim())) {
    return true
  }
  if (reason && typeof reason === 'object') {
    const msg = (reason as { message?: unknown }).message
    if (typeof msg === 'string' && /^The resource id \d+ is invalid\.?$/.test(msg.trim())) {
      return true
    }
  }
  return false
}

function isLikelyBenignMonacoCancellation(reason: unknown, text: string): boolean {
  const lc = text.toLowerCase()
  const hasCanceledMessage =
    lc === 'canceled' ||
    lc.startsWith('canceled\n') ||
    lc.includes('\ncancel@') ||
    lc.includes(' cancel@')
  const monacoMarkers = [
    'monaco-editor',
    '@monaco-editor/react',
    'setmodel@',
    'setdiffmodel@',
    'dispose@',
    'clear@',
  ]
  const hasMonacoMarker = monacoMarkers.some((marker) => lc.includes(marker))
  if (hasCanceledMessage && hasMonacoMarker) return true
  if (reason && typeof reason === 'object') {
    const msg = (reason as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim().toLowerCase() === 'canceled' && hasMonacoMarker) {
      return true
    }
  }
  return false
}

function isLikelyGenericCrossOriginScriptError(ev: ErrorEvent): boolean {
  return (
    (ev.message || '').trim() === 'Script error.' &&
    !ev.filename &&
    Number(ev.lineno || 0) === 0 &&
    Number(ev.colno || 0) === 0
  )
}

function safeStringify(v: unknown): string {
  try {
    if (typeof v === 'string') return v
    const json = JSON.stringify(v)
    return typeof json === 'string' ? json : String(v)
  } catch {
    return String(v)
  }
}

/** Subscribe to Hermes / orchestrator / reasoning stores — idempotent. */
export function installUnifiedTelemetryBridges(): void {
  if (bridgesInstalled) return
  bridgesInstalled = true

  let prevHermesLen = useHermesTelemetryStore.getState().lines.length
  useHermesTelemetryStore.subscribe((state) => {
    const lines = state.lines
    if (lines.length < prevHermesLen) {
      prevHermesLen = 0
    }
    if (lines.length >= prevHermesLen) {
      for (let i = prevHermesLen; i < lines.length; i++) {
        const line = lines[i]!
        recordTelemetry({
          category: 'output',
          source: 'hermes',
          title: 'Hermes SSE',
          text: line.length > 16_000 ? `${line.slice(0, 16_000)}…` : line,
        })
      }
    }
    prevHermesLen = lines.length
  })

  let prevActivityLen = useOrchestratorActivityStore.getState().activityFeed.length
  useOrchestratorActivityStore.subscribe((state) => {
    const feed = state.activityFeed
    if (feed.length < prevActivityLen) {
      prevActivityLen = 0
    }
    if (feed.length >= prevActivityLen) {
      for (let i = prevActivityLen; i < feed.length; i++) {
        const line = feed[i]!
        recordTelemetry({
          category: 'output',
          source: 'orchestrator',
          title: 'Orchestrator activity',
          text: line.length > 16_000 ? `${line.slice(0, 16_000)}…` : line,
        })
      }
    }
    prevActivityLen = feed.length
  })

  const prevReasoningIds = new Set<string>(
    useReasoningTraceStore.getState().entries.map((e) => e.id)
  )
  useReasoningTraceStore.subscribe((state) => {
    const entries = state.entries
    if (entries.length === 0) {
      prevReasoningIds.clear()
      return
    }
    for (const e of entries) {
      if (prevReasoningIds.has(e.id)) continue
      prevReasoningIds.add(e.id)
      const cat = categoryForReasoningKind(e.kind)
      recordTelemetry({
        category: cat,
        source: 'orchestrator',
        title: e.kind === 'content' ? 'Assistant output' : `Reasoning (${e.kind})`,
        text: e.text.length > 32_000 ? `${e.text.slice(0, 32_000)}…` : e.text,
        payloadJson: JSON.stringify({ entryId: e.id, kind: e.kind, ts: e.ts }),
      })
    }
  })
}

export function installUnifiedTelemetry(): void {
  installGlobalErrorCapture()
  installUnifiedTelemetryBridges()
}

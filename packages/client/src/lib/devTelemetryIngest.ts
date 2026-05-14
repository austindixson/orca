/**
 * Optional: ship orchestrator activity lines to the dev telemetry server for the dashboard.
 * Disable with VITE_DEV_TELEMETRY_INGEST=false
 */

import { nanoid } from 'nanoid'
import { getTelemetryToken, ingestTelemetryEvents } from './devTelemetryApi'
import { useReasoningTraceStore } from '../store/reasoningTraceStore'

/** Node tests (no Vite) have no `import.meta.env`; treat as enabled unless explicitly false in Vite. */
const DISABLE = import.meta.env?.VITE_DEV_TELEMETRY_INGEST === 'false'

let runSessionId: string | null = null
/** Harness / trace stem (e.g. orch-3) — correlates with `.agent-canvas/harness/traces/orch-3.jsonl`. */
let runTelemetryId: string | null = null
/** Per-orchestrator-run correlation for window errors and unified telemetry joins. */
let runCorrelationId: string | null = null
let queue: Array<Record<string, unknown>> = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

const REASONING_FIELD_CAP = 200_000

let reasoningDebounce: ReturnType<typeof setTimeout> | null = null
let lastReasoningFingerprint = ''

type TelemetryLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Structured orchestrator/canvas events (examples):
 * `orchestrator_llm_pending`, `orchestrator_http_retry`,
 * `orchestrator_llm_stall_detected` | `orchestrator_llm_stall_retry` |
 * `orchestrator_llm_stall_recovered` | `orchestrator_llm_stall_exhausted`,
 * `canvas_safe_mode_enter` | `canvas_safe_mode_recover`.
 */
export interface OrchestratorStructuredEventInput {
  kind: string
  source?: string
  level?: TelemetryLevel
  provider?: string
  model?: string
  /** Override ingest session (e.g. tile-scoped events); defaults to active orchestrator telemetry session. */
  sessionId?: string
  /** Override run id; defaults to active harness run id. */
  runId?: string
  payload?: Record<string, unknown>
}

export function setTelemetryRunSession(id: string | null) {
  if (runSessionId !== id) {
    lastReasoningFingerprint = ''
    runCorrelationId = id ? nanoid(12) : null
  }
  runSessionId = id
}

/** Stable id for the current orchestrator generation (not the per-export nanoid session suffix). */
export function setTelemetryRunId(id: string | null) {
  runTelemetryId = id
}

export function getTelemetryIngestContext(): {
  sessionId?: string
  runId?: string
  correlationId?: string
} {
  return {
    sessionId: runSessionId ?? undefined,
    runId: runTelemetryId ?? undefined,
    correlationId: runCorrelationId ?? undefined,
  }
}

function capField(s: string): string {
  if (s.length <= REASONING_FIELD_CAP) return s
  return `${s.slice(0, REASONING_FIELD_CAP)}… [truncated]`
}

/**
 * Pushes one structured row: harness **trace** lines, model **reasoning** stream, and assistant stream (**thinking** = token deltas / content).
 * Call before flushing so a run teardown includes the final snapshot.
 */
export function enqueueReasoningTelemetrySnapshot() {
  if (DISABLE) return
  const { entries } = useReasoningTraceStore.getState()
  if (entries.length === 0) return

  let trace = ''
  let reasoning = ''
  let thinking = ''
  for (const e of entries) {
    if (e.kind === 'trace') trace += (trace ? '\n' : '') + e.text
    else if (e.kind === 'reasoning') reasoning += e.text
    else thinking += e.text
  }

  const fingerprint = `${entries.length}:${trace.length}:${reasoning.length}:${thinking.length}`
  if (fingerprint === lastReasoningFingerprint) return
  lastReasoningFingerprint = fingerprint

  queue.push({
    kind: 'orchestrator_trace',
    source: 'orchestrator_ui',
    sessionId: runSessionId ?? undefined,
    runId: runTelemetryId ?? undefined,
    payload: {
      trace: capField(trace.trim()),
      reasoning: capField(reasoning),
      thinking: capField(thinking),
      entryCount: entries.length,
      telemetryCorrelationId: runCorrelationId ?? undefined,
    },
  })
  scheduleFlush()
}

function scheduleFlush() {
  if (DISABLE) return
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushQueue()
  }, 400)
}

async function flushQueue() {
  while (queue.length > 0) {
    const batch = queue.splice(0, 80)
    try {
      await ingestTelemetryEvents(batch, getTelemetryToken())
    } catch {
      /* keep UX quiet; dashboard shows connection state */
    }
  }
}

export function ingestOrchestratorActivityLine(line: string) {
  if (DISABLE) return
  const trimmed = line.trim()
  if (!trimmed) return
  queue.push({
    kind: 'log',
    source: 'orchestrator_ui',
    sessionId: runSessionId ?? undefined,
    runId: runTelemetryId ?? undefined,
    payload: {
      line: trimmed.length > 16_000 ? `${trimmed.slice(0, 16_000)}…` : trimmed,
      telemetryCorrelationId: runCorrelationId ?? undefined,
    },
  })
  scheduleFlush()
}

export function ingestOrchestratorStructuredEvent(input: OrchestratorStructuredEventInput) {
  if (DISABLE) return
  const rawPayload = input.payload as unknown
  const payload = Array.isArray(rawPayload)
    ? { _arrayPayload: rawPayload }
    : rawPayload && typeof rawPayload === 'object'
      ? (rawPayload as Record<string, unknown>)
      : { _value: rawPayload ?? null }
  const mergedPayload =
    runCorrelationId && payload.telemetryCorrelationId === undefined
      ? { ...payload, telemetryCorrelationId: runCorrelationId }
      : payload
  queue.push({
    kind: input.kind || 'custom',
    source: input.source || 'orchestrator_ui',
    level: input.level,
    provider: input.provider,
    model: input.model,
    sessionId: input.sessionId ?? runSessionId ?? undefined,
    runId: input.runId ?? runTelemetryId ?? undefined,
    payload: mergedPayload,
  })
  scheduleFlush()
}

export function flushTelemetryIngestNow() {
  if (DISABLE) return
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  enqueueReasoningTelemetrySnapshot()
  void flushQueue()
}

if (typeof window !== 'undefined' && !DISABLE) {
  useReasoningTraceStore.subscribe(() => {
    if (reasoningDebounce) clearTimeout(reasoningDebounce)
    reasoningDebounce = setTimeout(() => {
      reasoningDebounce = null
      enqueueReasoningTelemetrySnapshot()
    }, 2000)
  })
}

/**
 * Dev dashboard telemetry — structured events from Orca Coder (orchestrator, tools, LLM, etc.).
 * Designed for local troubleshooting (e.g. Grok hangs) and model comparison.
 */

export type DevTelemetryLevel = 'debug' | 'info' | 'warn' | 'error'

/** High-level category for filtering in the future UI. */
export type DevTelemetryKind =
  | 'log'
  | 'tool_call'
  | 'tool_result'
  | 'llm_request'
  | 'llm_response'
  | 'llm_meta'
  | 'reasoning'
  | 'session'
  | 'error'
  | 'custom'

export interface DevTelemetryEventInput {
  /** Client-generated id (optional); server assigns if missing. */
  id?: string
  /** ISO 8601 timestamp (optional); server assigns if missing. */
  ts?: string
  /** Correlates one orchestrator run / agent tile session. */
  sessionId?: string
  /** Optional sub-id (e.g. single LLM round). */
  runId?: string
  /** e.g. orchestrator, subagent, chat_completion */
  source?: string
  kind: DevTelemetryKind | string
  level?: DevTelemetryLevel
  /** Provider id when relevant: openrouter, zai, grok, … */
  provider?: string
  model?: string
  /** Arbitrary structured payload (tool args preview, response snippet, timing, …). */
  payload?: Record<string, unknown>
}

export interface DevTelemetryEvent {
  id: string
  ts: string
  kind: string
  sessionId?: string
  runId?: string
  source?: string
  level?: DevTelemetryLevel
  provider?: string
  model?: string
  payload: Record<string, unknown>
}

export interface DevTelemetryQuery {
  limit?: number
  /** Only events with ts >= since (ISO string). */
  since?: string
  /** Only events with ts <= until (ISO string). */
  until?: string
  sessionId?: string
  kind?: string
  source?: string
  provider?: string
  level?: DevTelemetryLevel
}

export interface DevTelemetrySessionSummary {
  sessionId: string
  firstTs: string
  lastTs: string
  eventCount: number
  lastKind?: string
  lastSource?: string
}

/**
 * Unified client-side telemetry ring buffer (errors, traces, output, logs).
 * Mirrors each row to {@link ingestOrchestratorStructuredEvent} when dev telemetry ingest is enabled.
 */

import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { getTelemetryIngestContext, ingestOrchestratorStructuredEvent } from '../lib/devTelemetryIngest'

export const UNIFIED_TELEMETRY_MAX = 10_000

export type TelemetryCategory = 'error' | 'trace' | 'reasoning' | 'output' | 'log'
export type TelemetrySource =
  | 'window'
  | 'console'
  | 'tile'
  | 'terminal'
  | 'hermes'
  | 'orchestrator'
  | 'agent'

export type TelemetryLevel = 'debug' | 'info' | 'warn' | 'error'

export interface TelemetryRecord {
  id: string
  tsMs: number
  category: TelemetryCategory
  source: TelemetrySource
  level?: TelemetryLevel
  tileId?: string
  sessionId?: string
  provider?: string
  model?: string
  title?: string
  /** Short, CSV-safe summary */
  text: string
  /** Optional full dump (JSON string), CSV-safe when escaped */
  payloadJson?: string
}

export type TelemetryRecordInput = Omit<TelemetryRecord, 'id' | 'tsMs'> & {
  id?: string
  tsMs?: number
}

interface UnifiedTelemetryState {
  records: TelemetryRecord[]
  clear: () => void
}

export const useUnifiedTelemetryStore = create<UnifiedTelemetryState>(() => ({
  records: [],
  clear: () => {
    useUnifiedTelemetryStore.setState({ records: [] })
  },
}))

/**
 * Append one record to the ring buffer and mirror to dev telemetry server (structured event).
 */
export function recordTelemetry(input: TelemetryRecordInput): TelemetryRecord {
  const id = input.id ?? nanoid()
  const tsMs = input.tsMs ?? Date.now()
  const rec: TelemetryRecord = {
    id,
    tsMs,
    category: input.category,
    source: input.source,
    level: input.level,
    tileId: input.tileId,
    sessionId: input.sessionId,
    provider: input.provider,
    model: input.model,
    title: input.title,
    text: input.text,
    payloadJson: input.payloadJson,
  }

  useUnifiedTelemetryStore.setState((s) => ({
    records: [...s.records.slice(-(UNIFIED_TELEMETRY_MAX - 1)), rec],
  }))

  try {
    const ctx = getTelemetryIngestContext()
    const payload: Record<string, unknown> = {
      text: rec.text,
    }
    if (rec.title) payload.title = rec.title
    if (rec.tileId) payload.tileId = rec.tileId
    if (rec.sessionId) payload.sessionId = rec.sessionId
    if (rec.provider) payload.provider = rec.provider
    if (rec.model) payload.model = rec.model
    if (rec.payloadJson) payload.payloadJson = rec.payloadJson
    if (ctx.correlationId) payload.telemetryCorrelationId = ctx.correlationId
    if (ctx.runId) payload.telemetryRunId = ctx.runId
    if (ctx.sessionId) payload.telemetrySessionId = ctx.sessionId

    ingestOrchestratorStructuredEvent({
      kind: rec.category,
      source: rec.source,
      level: rec.level,
      provider: rec.provider,
      model: rec.model,
      sessionId: rec.sessionId ?? ctx.sessionId,
      runId: ctx.runId,
      payload,
    })
  } catch {
    /* never break UX */
  }

  return rec
}

export function getUnifiedTelemetryRecords(): TelemetryRecord[] {
  return useUnifiedTelemetryStore.getState().records
}

export function clearUnifiedTelemetry(): void {
  useUnifiedTelemetryStore.getState().clear()
}

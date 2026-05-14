/**
 * Debounced multi-tile terminal connect failure reporting for dev telemetry.
 * Collapses bursts (many tiles timing out in the same wall-clock window) into one row.
 */

import { ingestOrchestratorStructuredEvent } from '../devTelemetryIngest'

const BURST_FLUSH_MS = 95

type BurstState = {
  transport: string
  reason: string
  tileIds: Set<string>
  maxAttempt: number
  finalFailure: boolean
  timer: ReturnType<typeof setTimeout> | null
}

let burst: BurstState | null = null

function flushBurst() {
  if (!burst) return
  const { transport, reason, tileIds, maxAttempt, finalFailure } = burst
  burst.timer = null
  burst = null
  const ids = [...tileIds]
  ingestOrchestratorStructuredEvent({
    kind: finalFailure ? 'terminal_connect_timeout_burst' : 'terminal_connect_retry_wave',
    source: 'terminal',
    level: finalFailure ? 'warn' : 'info',
    payload: {
      transport,
      reason,
      tileCount: ids.length,
      tileIds: ids.slice(0, 48),
      maxAttempt,
      burstWindowMs: BURST_FLUSH_MS,
    },
  })
}

/**
 * Schedule a collapsed telemetry row when multiple terminal tiles fail around the same time.
 */
export function scheduleTerminalConnectBurst(
  tileId: string,
  transport: 'tauri_pty' | 'websocket',
  reason: string,
  attempt: number,
  finalFailure: boolean
): void {
  if (!burst || burst.transport !== transport || burst.reason !== reason) {
    if (burst?.timer) clearTimeout(burst.timer)
    burst = {
      transport,
      reason,
      tileIds: new Set(),
      maxAttempt: attempt,
      finalFailure,
      timer: null,
    }
  } else if (burst.timer) {
    clearTimeout(burst.timer)
    burst.timer = null
  }
  burst.tileIds.add(tileId)
  burst.maxAttempt = Math.max(burst.maxAttempt, attempt)
  burst.finalFailure = burst.finalFailure || finalFailure
  if (burst.timer) clearTimeout(burst.timer)
  burst.timer = setTimeout(flushBurst, BURST_FLUSH_MS)
}

export function reportTerminalConnectStart(
  tileId: string,
  transport: 'tauri_pty' | 'websocket',
  attempt: number
): void {
  ingestOrchestratorStructuredEvent({
    kind: 'terminal_connect_start',
    source: 'terminal',
    level: 'debug',
    payload: { tileId, transport, attempt },
  })
}

export function reportTerminalConnectOk(
  tileId: string,
  transport: 'tauri_pty' | 'websocket',
  attempt: number,
  connectMs: number
): void {
  ingestOrchestratorStructuredEvent({
    kind: 'terminal_connect_ok',
    source: 'terminal',
    level: 'debug',
    payload: { tileId, transport, attempt, connectMs },
  })
}

export function reportTerminalConnectTimeout(
  tileId: string,
  transport: 'tauri_pty' | 'websocket',
  reason: string,
  attempt: number,
  finalFailure: boolean
): void {
  ingestOrchestratorStructuredEvent({
    kind: finalFailure ? 'terminal_connect_timeout' : 'terminal_connect_attempt_timeout',
    source: 'terminal',
    level: finalFailure ? 'error' : 'warn',
    payload: { tileId, transport, reason, attempt, finalFailure },
  })
  if (finalFailure) {
    scheduleTerminalConnectBurst(tileId, transport, reason, attempt, true)
  }
}

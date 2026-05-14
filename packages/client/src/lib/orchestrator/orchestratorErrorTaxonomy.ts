/**
 * Central classification for orchestrator / HTTP / model errors — recovery hints for loop-phases
 * and user-facing copy (complements retry logic in chatCompletion.ts).
 */

export type OrchestratorErrorKind =
  | 'rate_limit'
  | 'server_overload'
  | 'transient_network'
  | 'context_overflow'
  | 'auth'
  | 'permission'
  | 'bad_request'
  | 'timeout'
  | 'cancelled'
  | 'unknown'

export interface ClassifiedError {
  kind: OrchestratorErrorKind
  /** User or log line — short. */
  hint: string
  /** Whether caller should try compaction before retry (400 context / token limit). */
  suggestCompaction?: boolean
  /**
   * One bounded retry after our chat timeout (DOMException TimeoutError) — compaction + same round.
   * Distinct from user Stop (AbortError).
   */
  suggestStallRetry?: boolean
  /** Whether the HTTP layer may retry (already handled in chatCompletion for many cases). */
  retryableTransport?: boolean
}

const OVERFLOW_RE =
  /context|too\s*long|maximum\s*context|token\s*limit|max[_\s]?tokens|reduce\s*the\s*length/i

export function classifyOrchestratorError(err: unknown, httpStatus?: number): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  if (err instanceof DOMException && err.name === 'AbortError') {
    return { kind: 'cancelled', hint: 'Request cancelled.', retryableTransport: false }
  }
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return {
      kind: 'timeout',
      hint: msg,
      retryableTransport: false,
      suggestStallRetry: true,
    }
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      kind: 'auth',
      hint: 'Check API key / provider access in Settings.',
      retryableTransport: false,
    }
  }
  if (httpStatus === 429) {
    return {
      kind: 'rate_limit',
      hint: 'Rate limited — wait or upgrade quota.',
      retryableTransport: true,
    }
  }
  if (httpStatus === 400 && OVERFLOW_RE.test(lower)) {
    return {
      kind: 'context_overflow',
      hint: 'Context too large — conversation was compacted; retry or shorten the task.',
      suggestCompaction: true,
      retryableTransport: false,
    }
  }
  if (httpStatus === 400) {
    return { kind: 'bad_request', hint: msg.slice(0, 200), retryableTransport: false }
  }
  if (httpStatus === 408 || httpStatus === 502 || httpStatus === 503 || httpStatus === 529) {
    return {
      kind: 'server_overload',
      hint: 'Transient server error — retries may succeed.',
      retryableTransport: true,
    }
  }

  if (/network|fetch|econnrefused|failed to fetch|load failed/i.test(msg)) {
    return {
      kind: 'transient_network',
      hint: 'Network error — check connection.',
      retryableTransport: true,
    }
  }
  if (OVERFLOW_RE.test(lower)) {
    return {
      kind: 'context_overflow',
      hint: 'Model reported context limit — try a smaller prompt or rely on compaction.',
      suggestCompaction: true,
      retryableTransport: false,
    }
  }

  return { kind: 'unknown', hint: msg.slice(0, 280), retryableTransport: false }
}

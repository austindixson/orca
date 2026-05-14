import {
  useSettingsStore,
  zaiConcurrentChatLimitForTier,
  ZAI_HISTORICAL_SAFE_QUEUE_GAP_MS,
} from '../../store/settingsStore'
import { abortableSleep, throwIfAborted } from './abortable'

/**
 * Z.AI rate limits are primarily **concurrent in-flight requests** (see BigModel / Z.AI docs), not RPM.
 * Serializing every `chat/completions` call was overly conservative and added huge wall-clock delay.
 *
 * We allow up to `zaiConcurrentChatLimitForTier(zaiPlanTier)` concurrent Z.AI HTTP calls app-wide
 * (orchestrator + sub-agents share one key). Waiters honor `AbortSignal` (Stop).
 */
let activeCount = 0
const pending: Array<() => void> = []
let lastStartMs = 0
let totalRequests = 0
let totalQueuedRequests = 0
let totalQueueWaitMs = 0
let rateLimit429Count = 0
let rateLimit1302Count = 0
let rateLimit1305Count = 0

function getMaxConcurrent(): number {
  try {
    return zaiConcurrentChatLimitForTier(useSettingsStore.getState().zaiPlanTier)
  } catch {
    return 4
  }
}

function getMinGapMs(): number {
  try {
    return useSettingsStore.getState().zaiQueueMinGapMs ?? ZAI_HISTORICAL_SAFE_QUEUE_GAP_MS
  } catch {
    return ZAI_HISTORICAL_SAFE_QUEUE_GAP_MS
  }
}

export function noteZaiRateLimit(status: number, zhipuCode?: string | null): void {
  if (status === 429) rateLimit429Count++
  if (zhipuCode === '1302') rateLimit1302Count++
  if (zhipuCode === '1305') rateLimit1305Count++
}

export function getZaiQueueStats(): {
  activeCount: number
  pendingCount: number
  maxConcurrent: number
  minGapMs: number
  totalRequests: number
  totalQueuedRequests: number
  avgQueueWaitMs: number
  rateLimit429Count: number
  rateLimit1302Count: number
  rateLimit1305Count: number
} {
  const avgQueueWaitMs = totalQueuedRequests > 0 ? totalQueueWaitMs / totalQueuedRequests : 0
  return {
    activeCount,
    pendingCount: pending.length,
    maxConcurrent: getMaxConcurrent(),
    minGapMs: getMinGapMs(),
    totalRequests,
    totalQueuedRequests,
    avgQueueWaitMs,
    rateLimit429Count,
    rateLimit1302Count,
    rateLimit1305Count,
  }
}

async function acquireSlot(signal: AbortSignal | undefined): Promise<void> {
  const queuedAt = Date.now()
  let waitedInQueue = false
  for (;;) {
    throwIfAborted(signal)
    const max = getMaxConcurrent()
    if (activeCount < max) {
      const minGap = getMinGapMs()
      const elapsed = Date.now() - lastStartMs
      if (minGap > 0 && elapsed < minGap) {
        waitedInQueue = true
        await abortableSleep(minGap - elapsed, signal)
        continue
      }
      activeCount++
      lastStartMs = Date.now()
      totalRequests++
      if (waitedInQueue) {
        totalQueuedRequests++
        totalQueueWaitMs += Math.max(0, Date.now() - queuedAt)
      }
      return
    }
    waitedInQueue = true
    await new Promise<void>((resolve, reject) => {
      const run = () => {
        if (signal) signal.removeEventListener('abort', onAbort)
        resolve()
      }
      function onAbort() {
        const idx = pending.indexOf(run)
        if (idx >= 0) pending.splice(idx, 1)
        reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      pending.push(run)
      if (signal) {
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }
}

function releaseSlot(): void {
  activeCount = Math.max(0, activeCount - 1)
  const next = pending.shift()
  if (next) next()
}

/**
 * Runs `fn` with bounded concurrency for Z.AI chat/completions, or rejects on `signal` abort.
 */
export function runZaiChatCompletionQueued<T>(
  signal: AbortSignal | undefined,
  fn: () => Promise<T>
): Promise<T> {
  return (async () => {
    await acquireSlot(signal)
    try {
      throwIfAborted(signal)
      return await fn()
    } finally {
      releaseSlot()
    }
  })()
}

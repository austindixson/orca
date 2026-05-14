/**
 * API Response Mappers
 * Transforms API responses into UI state interfaces
 * Provides type-safe conversion and validation
 */

import type { CanvasBridgeStatus, OrcaGatewayStatus } from './canvasBridgeApi'
import type { ChatCompletionResponse, ChatCompletionUsage } from './orchestrator/types'
import type { OpenRouterUsageEvent, OpenRouterCreditsSnapshot } from '../store/openRouterUsageStore'
import type { ResearchEntry, ResearchEntryStatus } from '../store/researchSessionStore'
import type { OrchestratorActivityPayload } from './orchestrator/runOrchestrator'

// ============================================================================
// Canvas Bridge Mappers
// ============================================================================

export interface CanvasBridgeUIState {
  isConnected: boolean
  uiClientsCount: number
  isTokenRequired: boolean
  externalAgent: {
    id: string | null
    lastSeenMs: number | null
    isActive: boolean
  } | null
}

export function mapCanvasBridgeStatusToUI(status: CanvasBridgeStatus): CanvasBridgeUIState {
  return {
    isConnected: true,
    uiClientsCount: status.uiClients,
    isTokenRequired: status.tokenRequired,
    externalAgent: status.externalOrchestrator
      ? {
          id: status.externalOrchestrator.id,
          lastSeenMs: status.externalOrchestrator.lastSeenMs,
          isActive: Date.now() - status.externalOrchestrator.lastSeenMs < 30000, // Active if seen within 30s
        }
      : null,
  }
}

export interface OrcaGatewayUIState {
  isTelegramRunning: boolean
  uiClientsCount: number
}

export function mapOrcaGatewayStatusToUI(status: OrcaGatewayStatus): OrcaGatewayUIState {
  return {
    isTelegramRunning: status.telegram.running,
    uiClientsCount: status.uiClients,
  }
}

// ============================================================================
// OpenRouter Usage Mappers
// ============================================================================

export interface UsageStatsUIState {
  totalRequests: number
  totalTokens: number
  totalCostUsd: number
  byModel: Array<{
    model: string
    requests: number
    tokens: number
    costUsd: number
  }>
  timeframe: {
    start: number
    end: number
  }
}

export function mapOpenRouterUsageToUI(events: OpenRouterUsageEvent[]): UsageStatsUIState {
  if (events.length === 0) {
    return {
      totalRequests: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      byModel: [],
      timeframe: { start: Date.now(), end: Date.now() },
    }
  }

  const modelMap = new Map<
    string,
    { model: string; requests: number; tokens: number; costUsd: number }
  >()

  let totalRequests = 0
  let totalTokens = 0
  let totalCost = 0
  let startTs = events[0].ts
  let endTs = events[events.length - 1].ts

  for (const event of events) {
    totalRequests++
    totalTokens += event.totalTokens
    totalCost += event.costUsd ?? 0

    const existing = modelMap.get(event.modelApiName)
    if (existing) {
      existing.requests++
      existing.tokens += event.totalTokens
      existing.costUsd += event.costUsd ?? 0
    } else {
      modelMap.set(event.modelApiName, {
        model: event.modelLabel,
        requests: 1,
        tokens: event.totalTokens,
        costUsd: event.costUsd ?? 0,
      })
    }

    if (event.ts < startTs) startTs = event.ts
    if (event.ts > endTs) endTs = event.ts
  }

  return {
    totalRequests,
    totalTokens,
    totalCostUsd: totalCost,
    byModel: Array.from(modelMap.values()).sort((a, b) => b.tokens - a.tokens),
    timeframe: { start: startTs, end: endTs },
  }
}

export interface CreditsUIState {
  usageUsd: number | null
  limitUsd: number | null
  remainingUsd: number | null
  percentageUsed: number | null
  isFreeTier: boolean
  label: string | null
  lastFetched: number | null
  error: string | null
}

export function mapCreditsSnapshotToUI(credits: OpenRouterCreditsSnapshot | null): CreditsUIState {
  if (!credits) {
    return {
      usageUsd: null,
      limitUsd: null,
      remainingUsd: null,
      percentageUsed: null,
      isFreeTier: false,
      label: null,
      lastFetched: null,
      error: null,
    }
  }

  const percentageUsed =
    credits.limitUsd != null && credits.limitUsd > 0
      ? ((credits.usageUsd ?? 0) / credits.limitUsd) * 100
      : null

  return {
    usageUsd: credits.usageUsd ?? null,
    limitUsd: credits.limitUsd ?? null,
    remainingUsd: credits.remainingUsd ?? null,
    percentageUsed,
    isFreeTier: credits.isFreeTier ?? false,
    label: credits.label ?? null,
    lastFetched: credits.fetchedAt,
    error: credits.error ?? null,
  }
}

// ============================================================================
// Research Session Mappers
// ============================================================================

export interface ResearchUIEntry {
  id: string
  kind: 'web_search' | 'mcp_context7' | 'mcp_generic' | 'url_fetch'
  status: ResearchEntryStatus
  query: string
  ok: boolean
  error: string | null
  abstract: string | null
  source: string | null
  related: string[]
  provider: string | null
  snippets: Array<{ title: string; body: string; url?: string }>
  timestamp: number
}

export function mapResearchEntryToUI(entry: ResearchEntry): ResearchUIEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    status: entry.status ?? 'done',
    query: entry.query,
    ok: entry.ok,
    error: entry.error ?? null,
    abstract: entry.abstract ?? null,
    source: entry.source ?? null,
    related: entry.related ?? [],
    provider: entry.provider ?? null,
    snippets: entry.snippets ?? [],
    timestamp: entry.ts,
  }
}

export function mapResearchEntriesToUI(entries: ResearchEntry[]): ResearchUIEntry[] {
  return entries.map(mapResearchEntryToUI).sort((a, b) => b.timestamp - a.timestamp)
}

// ============================================================================
// Orchestrator Activity Mappers
// ============================================================================

export interface ActivityVerbUIState {
  verb: string
  iteration: number
  startTimeMs: number | null
  elapsedMs: number
  isActive: boolean
}

export function mapActivityPayloadToVerb(payload: OrchestratorActivityPayload): ActivityVerbUIState {
  const isActive = payload.kind !== 'prepare'
  const startTimeMs = isActive ? Date.now() : null
  const iteration =
    payload.kind === 'prepare' ? 0 : payload.iteration

  return {
    verb: getActivityVerb(payload),
    iteration,
    startTimeMs,
    elapsedMs: 0,
    isActive,
  }
}

function getActivityVerb(payload: OrchestratorActivityPayload): string {
  switch (payload.kind) {
    case 'prepare':
      return 'Preparing…'
    case 'llm_pending':
      return `Thinking… (iteration ${payload.iteration})`
    case 'llm':
      return `Iteration ${payload.iteration}`
    case 'tools_pending': {
      const s = Math.round(payload.elapsedMs / 1000)
      const prog = payload.total > 0 ? `${payload.completed}/${payload.total}` : ''
      return `Tools ${prog}${payload.currentTool ? ` · ${payload.currentTool}` : ''}${s > 0 ? ` · ${s}s` : ''}`
    }
    case 'tools':
      return `Running: ${payload.toolNames.join(', ')}`
    default:
      return 'Ready'
  }
}

// ============================================================================
// Chat Completion Mappers
// ============================================================================

export interface ChatCompletionUIState {
  id: string | null
  model: string | null
  content: string | null
  toolCalls: Array<{ id: string; name: string; arguments: string }> | null
  finishReason: string | null
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costUsd: number | null
  } | null
  hasError: boolean
  errorMessage: string | null
}

export function mapChatCompletionToUI(response: ChatCompletionResponse): ChatCompletionUIState {
  const choice = response.choices[0]
  const message = choice?.message

  return {
    id: response.id ?? null,
    model: response.model ?? null,
    content: message?.content ?? null,
    toolCalls:
      message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })) ?? null,
    finishReason: choice?.finish_reason ?? null,
    usage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens ?? 0,
          completionTokens: response.usage.completion_tokens ?? 0,
          totalTokens: response.usage.total_tokens ?? 0,
          costUsd: (response.usage as ChatCompletionUsage & { cost?: number }).cost ?? null,
        }
      : null,
    hasError: false,
    errorMessage: null,
  }
}

export function mapChatCompletionError(error: Error): ChatCompletionUIState {
  return {
    id: null,
    model: null,
    content: null,
    toolCalls: null,
    finishReason: 'error',
    usage: null,
    hasError: true,
    errorMessage: error.message,
  }
}

// ============================================================================
// Type Guards and Validators
// ============================================================================

export function isCanvasBridgeStatus(data: unknown): data is CanvasBridgeStatus {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj.uiClients === 'number' &&
    typeof obj.tokenRequired === 'boolean' &&
    (obj.externalOrchestrator === null ||
      (typeof obj.externalOrchestrator === 'object' &&
        typeof (obj.externalOrchestrator as Record<string, unknown>).id === 'string'))
  )
}

export function isOrcaGatewayStatus(data: unknown): data is OrcaGatewayStatus {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj.uiClients === 'number' &&
    typeof obj.telegram === 'object' &&
    typeof (obj.telegram as Record<string, unknown>).running === 'boolean'
  )
}

export function isOpenRouterCreditsSnapshot(data: unknown): data is OpenRouterCreditsSnapshot {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return typeof obj.fetchedAt === 'number'
}

export function isResearchEntry(data: unknown): data is ResearchEntry {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.ts === 'number' &&
    typeof obj.ok === 'boolean' &&
    typeof obj.query === 'string'
  )
}

// ============================================================================
// Utility Functions
// ============================================================================

export function formatCurrencyUSD(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(cents)
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString()
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`
  return `${(tokens / 1_000_000).toFixed(2)}M`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = ((ms % 60000) / 1000).toFixed(0)
  return `${minutes}m ${seconds}s`
}

export function getHealthStatus(
  lastSeenMs: number | null,
  thresholdMs: number = 30000
): 'healthy' | 'degraded' | 'offline' {
  if (lastSeenMs === null) return 'offline'
  const age = Date.now() - lastSeenMs
  if (age < thresholdMs) return 'healthy'
  if (age < thresholdMs * 3) return 'degraded'
  return 'offline'
}

/**
 * Common API types and interfaces
 */

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  data: T
  status: number
  headers: Headers
}

/**
 * API error with status and details
 */
export interface ApiError extends Error {
  status?: number
  details?: Record<string, unknown>
  url?: string
}

/**
 * Canvas bridge status
 */
export interface CanvasBridgeStatus {
  uiClients: number
  tokenRequired: boolean
  externalOrchestrator?: { id: string; lastSeenMs: number } | null
}

/**
 * Health check response
 */
export interface HealthStatus {
  status?: string
  timestamp?: string
}

/**
 * Dev telemetry event
 */
export interface DevTelemetryEvent {
  id: string
  ts: string
  kind: string
  sessionId?: string
  runId?: string
  source?: string
  level?: 'debug' | 'info' | 'warn' | 'error'
  provider?: string
  model?: string
  payload: Record<string, unknown>
}

/**
 * Dev telemetry session summary
 */
export interface DevTelemetrySessionSummary {
  sessionId: string
  firstTs: string
  lastTs: string
  eventCount: number
  lastKind?: string
  lastSource?: string
}

/**
 * Dev telemetry stats
 */
export interface DevTelemetryStats {
  totalEvents: number
  sessions: number
  firstEventTs?: string
  lastEventTs?: string
}

/**
 * Dev telemetry events response
 */
export interface DevTelemetryEventsResponse {
  events: DevTelemetryEvent[]
  stats?: DevTelemetryStats
}

/**
 * Dev telemetry sessions response
 */
export interface DevTelemetrySessionsResponse {
  sessions: DevTelemetrySessionSummary[]
}

/**
 * Dev telemetry ingest result
 */
export interface DevTelemetryIngestResult {
  ok: boolean
  count?: number
  ids?: string[]
}

/**
 * Canvas tool manifest
 */
export interface CanvasToolManifest {
  name: string
  version: string
  description: string
  tools: Array<{
    type: string
    function: {
      name: string
      description: string
      parameters: {
        type: string
        properties: Record<string, unknown>
        required: string[]
      }
    }
  }>
}

/**
 * Canvas module (tile)
 */
export interface CanvasModule {
  id: string
  type: string
  title: string
  x: number
  y: number
  w?: number
  h?: number
  zIndex?: number
  meta?: Record<string, unknown>
}

/**
 * Canvas modules list response
 */
export interface CanvasModulesListResponse {
  modules: CanvasModule[]
}

/**
 * Canvas execute tool request
 */
export interface CanvasExecuteRequest {
  tool: string
  arguments?: unknown
}

/**
 * Canvas execute tool response
 */
export interface CanvasExecuteResponse {
  ok: boolean
  result?: string
  error?: string
}

/**
 * File operations
 */
export interface FileEntry {
  name: string
  isDirectory: boolean
  path: string
}

export interface DirectoryListResponse {
  files: FileEntry[]
  path: string
}

export interface FileReadResponse {
  content: string
  path: string
}

export interface FileWriteResponse {
  success: boolean
  path: string
}

export interface FileDeleteResponse {
  success: boolean
  path: string
}

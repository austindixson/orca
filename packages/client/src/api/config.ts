/**
 * API Configuration Service
 * Manages base URLs, authentication, and environment-specific settings
 */

export interface ApiConfig {
  /** Canvas bridge base URL (default: http://127.0.0.1:3001) */
  canvasBridgeUrl: string
  /** Dev telemetry API base URL (default: http://127.0.0.1:3002) */
  telemetryUrl: string
  /** WebSocket URL for canvas bridge */
  wsUrl: string
  /** Authentication token for canvas bridge (optional) */
  canvasBridgeToken?: string
  /** Authentication token for telemetry (optional) */
  telemetryToken?: string
  /** Enable/disable debug logging */
  debugMode: boolean
  /** Request timeout in milliseconds */
  requestTimeout: number
  /** Max retries for failed requests */
  maxRetries: number
}

const DEFAULT_CONFIG: ApiConfig = {
  canvasBridgeUrl: getDefaultCanvasBridgeUrl(),
  telemetryUrl: getDefaultTelemetryUrl(),
  wsUrl: getDefaultWsUrl(),
  debugMode: false,
  requestTimeout: 30000,
  maxRetries: 3,
}

let currentConfig: ApiConfig = { ...DEFAULT_CONFIG }

function getDefaultCanvasBridgeUrl(): string {
  if (import.meta.env.DEV) return ''
  return 'http://127.0.0.1:3001'
}

function getDefaultTelemetryUrl(): string {
  try {
    const custom = sessionStorage.getItem('devTelemetry.apiRoot')?.trim()
    if (custom) return custom.replace(/\/$/, '')
  } catch {
    /* private mode */
  }
  const env = import.meta.env.VITE_DEV_TELEMETRY_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  if (import.meta.env.DEV) return ''
  return 'http://127.0.0.1:3002'
}

function getDefaultWsUrl(): string {
  const env = import.meta.env.VITE_CANVAS_BRIDGE_WS as string | undefined
  if (env) return env
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return 'ws://127.0.0.1:3001/ws'
  }
  if (typeof window === 'undefined') return 'ws://127.0.0.1:3001/ws'
  const host = window.location.hostname
  const port = 3001
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${host}:${port}/ws`
}

/**
 * Update API configuration
 * Merges with existing config
 */
export function updateApiConfig(partial: Partial<ApiConfig> = {}): void {
  currentConfig = { ...currentConfig, ...partial }
  if (partial.canvasBridgeToken) {
    sessionStorage.setItem('devTelemetry.token', partial.canvasBridgeToken)
  }
  if (partial.telemetryToken) {
    sessionStorage.setItem('devTelemetry.token', partial.telemetryToken)
  }
  debugLog('API config updated:', currentConfig)
}

/**
 * Get current API configuration
 */
export function getApiConfig(): Readonly<ApiConfig> {
  return { ...currentConfig }
}

/**
 * Get canvas bridge HTTP origin
 */
export function getCanvasBridgeOrigin(): string {
  return currentConfig.canvasBridgeUrl
}

/**
 * Get telemetry API origin
 */
export function getTelemetryOrigin(): string {
  return currentConfig.telemetryUrl
}

/**
 * Get WebSocket URL
 */
export function getWebSocketUrl(): string {
  return currentConfig.wsUrl
}

/**
 * Get auth headers for canvas bridge requests
 */
export function getCanvasBridgeAuthHeaders(): Record<string, string> {
  const token = currentConfig.canvasBridgeToken?.trim()
  if (token) return { Authorization: `Bearer ${token}` }
  return {}
}

/**
 * Get auth headers for telemetry requests
 */
export function getTelemetryAuthHeaders(): Record<string, string> {
  const token = currentConfig.telemetryToken?.trim()
  if (token) return { Authorization: `Bearer ${token}` }
  return {}
}

/**
 * Debug logging (only when debugMode is enabled)
 */
function debugLog(...args: unknown[]): void {
  if (currentConfig.debugMode) {
    console.log('[Orca API]', ...args)
  }
}

/**
 * Reset configuration to defaults
 */
export function resetApiConfig(): void {
  currentConfig = {
    canvasBridgeUrl: getDefaultCanvasBridgeUrl(),
    telemetryUrl: getDefaultTelemetryUrl(),
    wsUrl: getDefaultWsUrl(),
    debugMode: false,
    requestTimeout: 30000,
    maxRetries: 3,
  }
  debugLog('API config reset to defaults')
}

/**
 * Export config for testing
 */
export const _internal = {
  getDefaultCanvasBridgeUrl,
  getDefaultTelemetryUrl,
  getDefaultWsUrl,
}

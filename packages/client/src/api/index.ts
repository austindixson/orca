/**
 * Main API SDK entry point
 * Exports all API services and configuration
 */

import { createApiClient, type ApiClient } from './apiClient'
import { updateApiConfig, type ApiConfig } from './config'

export * from './apiClient'
export * from './config'
export * from './canvasService'
export * from './telemetryService'
export * from './types'

/**
 * Initialize API SDK with custom configuration
 */
export function initializeApiSdk(config?: Partial<ApiConfig>): ApiClient {
  updateApiConfig(config)
  return createApiClient()
}

/**
 * Get the default singleton API client
 */
export function getApiClient(): ApiClient {
  // Return existing or create new instance
  if (!(globalThis as any).__ORCA_API_CLIENT__) {
    ;(globalThis as any).__ORCA_API_CLIENT__ = createApiClient()
  }
  return (globalThis as any).__ORCA_API_CLIENT__ as ApiClient
}

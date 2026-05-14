/**
 * API SDK Initialization
 * Initializes the API SDK when the app starts
 */

import { useEffect } from 'react'
import { getApiClient } from './index'
import { updateApiConfig } from './config'

/**
 * Hook to initialize API SDK on app mount
 * Call this from your App.tsx or main entry point
 */
export function useApiSdkInit(options?: {
  /** Custom canvas bridge token */
  canvasBridgeToken?: string
  /** Custom telemetry token */
  telemetryToken?: string
  /** Enable debug logging */
  debugMode?: boolean
  /** Custom request timeout in ms */
  requestTimeout?: number
}) {
  useEffect(() => {
    // Update config with any custom options
    if (options) {
      updateApiConfig({
        canvasBridgeToken: options.canvasBridgeToken,
        telemetryToken: options.telemetryToken,
        debugMode: options.debugMode,
        requestTimeout: options.requestTimeout,
      })
    }

    // Initialize the API client (creates singleton if needed)
    const client = getApiClient()
    console.log('[Orca API] SDK initialized', {
      baseUrl: client['baseUrl'],
      hasConfig: !!options,
    })

    // Clean up function if needed
    return () => {
      console.log('[Orca API] SDK cleanup')
    }
  }, [
    options?.canvasBridgeToken,
    options?.telemetryToken,
    options?.debugMode,
    options?.requestTimeout,
  ])
}

/**
 * Initialize API SDK without React (for SSR or Node.js environments)
 */
export function initApiSdk(options?: {
  canvasBridgeToken?: string
  telemetryToken?: string
  debugMode?: boolean
  requestTimeout?: number
}): void {
  if (options) {
    updateApiConfig(options)
  }

  const client = getApiClient()
  console.log('[Orca API] SDK initialized (non-React)', {
    baseUrl: client['baseUrl'],
    hasConfig: !!options,
  })
}

/**
 * Export a React-ready provider component for context-based injection
 * This is useful if you want to make the API client available via React Context
 */
export function ApiProvider({ children }: { children: React.ReactNode }) {
  useApiSdkInit()

  return <>{children}</>
}

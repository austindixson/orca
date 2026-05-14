/**
 * Core API Client
 * Provides HTTP client with retry logic, timeout handling, and error management
 */

import { getApiConfig, getCanvasBridgeOrigin, getTelemetryOrigin } from './config'
import type { ApiError, ApiResponse } from './types'

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  body?: unknown
  timeout?: number
  retries?: number
  signal?: AbortSignal
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly includeAuth: boolean

  constructor(baseUrl: string, includeAuth = true) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.includeAuth = includeAuth
  }

  /**
   * Make an HTTP request with retry logic
   */
  async request<T>(
    path: string,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      headers = {},
      body,
      timeout = getApiConfig().requestTimeout,
      retries = getApiConfig().maxRetries,
      signal,
    } = options

    let lastError: Error | null = null
    let attempt = 0

    while (attempt <= retries) {
      attempt++
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)
        const combinedSignal = signal ? this.combineSignals(controller.signal, signal) : controller.signal

        const requestHeaders = this.buildHeaders(headers)
        const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`

        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: combinedSignal,
        })

        clearTimeout(timeoutId)

        // Handle non-OK responses
        if (!response.ok) {
          await this.handleErrorResponse(response)
        }

        const data = await response.json()
        return { data, status: response.status, headers: response.headers }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Don't retry on abort or non-retryable errors
        if (this.isNonRetryableError(lastError)) {
          throw lastError
        }

        // Wait before retry (exponential backoff)
        if (attempt <= retries) {
          await this.backoff(attempt)
        }
      }
    }

    throw lastError || new Error('Request failed after retries')
  }

  /**
   * GET request helper
   */
  async get<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'GET' })
  }

  /**
   * POST request helper
   */
  async post<T>(path: string, body: unknown, options?: Omit<ApiRequestOptions, 'method'>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'POST', body })
  }

  /**
   * PUT request helper
   */
  async put<T>(path: string, body: unknown, options?: Omit<ApiRequestOptions, 'method'>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'PUT', body })
  }

  /**
   * DELETE request helper
   */
  async delete<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'DELETE' })
  }

  /**
   * Build request headers including auth if configured
   */
  private buildHeaders(additional: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...additional,
    }

    if (this.includeAuth) {
      // Add auth headers from config based on which service this client targets
      if (this.baseUrl.includes('3002') || this.baseUrl.includes('telemetry')) {
        Object.assign(headers, this.getTelemetryAuthHeaders())
      } else {
        Object.assign(headers, this.getCanvasBridgeAuthHeaders())
      }
    }

    return headers
  }

  private getCanvasBridgeAuthHeaders(): Record<string, string> {
    const token = getApiConfig().canvasBridgeToken?.trim()
    if (token) return { Authorization: `Bearer ${token}` }
    return {}
  }

  private getTelemetryAuthHeaders(): Record<string, string> {
    const token = getApiConfig().telemetryToken?.trim()
    if (token) return { Authorization: `Bearer ${token}` }
    return {}
  }

  /**
   * Handle HTTP error responses
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage = `HTTP ${response.status}`
    let errorDetails: Record<string, unknown> = {}

    try {
      const body = await response.json()
      if (body.error) {
        errorMessage = body.error
      }
      errorDetails = body
    } catch {
      // Ignore JSON parse errors
    }

    const error: ApiError = new Error(errorMessage) as ApiError
    error.status = response.status
    error.details = errorDetails
    error.url = response.url
    throw error
  }

  /**
   * Check if error should not be retried
   */
  private isNonRetryableError(error: Error): boolean {
    // Don't retry on abort or client errors (4xx)
    const apiError = error as ApiError
    if (apiError.status && apiError.status >= 400 && apiError.status < 500) {
      return apiError.status !== 408 && apiError.status !== 429
    }
    if (error.name === 'AbortError') {
      return true
    }
    return false
  }

  /**
   * Exponential backoff with jitter
   */
  private async backoff(attempt: number): Promise<void> {
    const baseDelay = 1000 // 1 second
    const maxDelay = 10000 // 10 seconds
    const exponentialDelay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay)
    const jitter = Math.random() * 200 // 0-200ms jitter
    await new Promise((resolve) => setTimeout(resolve, exponentialDelay + jitter))
  }

  /**
   * Combine multiple abort signals
   */
  private combineSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController()
    let aborted = false

    const onAbort = () => {
      if (!aborted) {
        aborted = true
        controller.abort()
      }
    }

    signals.forEach((signal) => {
      if (signal.aborted) {
        onAbort()
      } else {
        signal.addEventListener('abort', onAbort)
      }
    })

    return controller.signal
  }
}

/**
 * Create a canvas bridge API client
 */
export function createCanvasBridgeClient(): ApiClient {
  return new ApiClient(getCanvasBridgeOrigin())
}

/**
 * Create a telemetry API client
 */
export function createTelemetryClient(): ApiClient {
  return new ApiClient(getTelemetryOrigin())
}

/**
 * Create a custom API client with base URL
 */
export function createApiClient(baseUrl = ''): ApiClient {
  const effectiveUrl = baseUrl || getCanvasBridgeOrigin()
  return new ApiClient(effectiveUrl, true)
}

/**
 * Dev Telemetry API Service
 * Provides methods to interact with the dev telemetry endpoints
 */

import { createTelemetryClient } from './apiClient'
import type {
  DevTelemetryEventsResponse,
  DevTelemetryIngestResult,
  DevTelemetrySessionsResponse,
  DevTelemetryStats,
} from './types'

export interface TelemetryEventQuery {
  limit?: number
  since?: string
  until?: string
  sessionId?: string
  kind?: string
  source?: string
  provider?: string
  level?: 'debug' | 'info' | 'warn' | 'error'
}

export interface TelemetryExportQuery {
  since?: string
  until?: string
  sessionId?: string
}

export class TelemetryService {
  private client = createTelemetryClient()

  /**
   * Get telemetry health and stats
   */
  async getHealth(): Promise<{ ok: boolean; stats?: DevTelemetryStats }> {
    const { data } = await this.client.get<{ ok: boolean; stats?: DevTelemetryStats }>(
      '/api/dev/telemetry/health'
    )
    return data
  }

  /**
   * Fetch telemetry events with optional filters
   */
  async getEvents(query: TelemetryEventQuery = {}): Promise<DevTelemetryEventsResponse> {
    const params = new URLSearchParams()
    if (query.limit != null) params.set('limit', String(query.limit))
    if (query.since) params.set('since', query.since)
    if (query.until) params.set('until', query.until)
    if (query.sessionId) params.set('sessionId', query.sessionId)
    if (query.kind) params.set('kind', query.kind)
    if (query.source) params.set('source', query.source)
    if (query.provider) params.set('provider', query.provider)
    if (query.level) params.set('level', query.level)

    const queryString = params.toString()
    const { data } = await this.client.get<DevTelemetryEventsResponse>(
      `/api/dev/telemetry/events${queryString ? `?${queryString}` : ''}`
    )
    return data
  }

  /**
   * Get all telemetry sessions
   */
  async getSessions(): Promise<DevTelemetrySessionsResponse> {
    const { data } = await this.client.get<DevTelemetrySessionsResponse>(
      '/api/dev/telemetry/sessions'
    )
    return data
  }

  /**
   * Get telemetry statistics
   */
  async getStats(): Promise<DevTelemetryStats> {
    const { data } = await this.client.get<DevTelemetryStats>('/api/dev/telemetry/stats')
    return data
  }

  /**
   * Ingest telemetry events
   */
  async ingestEvents(events: Array<Record<string, unknown>>): Promise<DevTelemetryIngestResult> {
    const { data } = await this.client.post<DevTelemetryIngestResult>(
      '/api/dev/telemetry/events',
      { events }
    )
    return data
  }

  /**
   * Clear all telemetry events
   */
  async clearEvents(): Promise<void> {
    await this.client.delete('/api/dev/telemetry/events')
  }

  /**
   * Export telemetry as CSV
   */
  async exportCsv(query: TelemetryExportQuery = {}): Promise<Blob> {
    const params = new URLSearchParams()
    if (query.since) params.set('since', query.since)
    if (query.until) params.set('until', query.until)
    if (query.sessionId) params.set('sessionId', query.sessionId)

    const queryString = params.toString()
    const url = `/api/dev/telemetry/export.csv${queryString ? `?${queryString}` : ''}`

    const response = await fetch(`${this.client['baseUrl']}${url}`, {
      headers: this.client['buildHeaders']?.({}) || {},
    })

    if (!response.ok) {
      throw new Error(`Export CSV failed: ${response.status}`)
    }

    return response.blob()
  }

  /**
   * Export telemetry as ZIP (one CSV per session)
   */
  async exportZipBySession(query: TelemetryExportQuery = {}): Promise<Blob> {
    const params = new URLSearchParams()
    if (query.since) params.set('since', query.since)
    if (query.until) params.set('until', query.until)
    if (query.sessionId) params.set('sessionId', query.sessionId)

    const queryString = params.toString()
    const url = `/api/dev/telemetry/export/by-session.zip${queryString ? `?${queryString}` : ''}`

    const response = await fetch(`${this.client['baseUrl']}${url}`, {
      headers: this.client['buildHeaders']?.({}) || {},
    })

    if (!response.ok) {
      throw new Error(`Export ZIP failed: ${response.status}`)
    }

    return response.blob()
  }

  /**
   * Create a Server-Sent Events stream for live telemetry
   */
  createEventStream(): EventSource {
    const baseUrl = this.client['baseUrl'] || ''
    const token = this.client['getTelemetryAuthHeaders']?.()?.Authorization?.replace('Bearer ', '')

    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    return new EventSource(`${baseUrl}/api/dev/telemetry/stream${query}`)
  }

  /**
   * Check if telemetry service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.getHealth()
      return true
    } catch {
      return false
    }
  }
}

/**
 * Singleton telemetry service instance
 */
let telemetryServiceInstance: TelemetryService | null = null

export function getTelemetryService(): TelemetryService {
  if (!telemetryServiceInstance) {
    telemetryServiceInstance = new TelemetryService()
  }
  return telemetryServiceInstance
}

/**
 * Create a new telemetry service instance (useful for testing)
 */
export function createTelemetryService(): TelemetryService {
  return new TelemetryService()
}

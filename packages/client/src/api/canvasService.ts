/**
 * Canvas Bridge API Service
 * Provides methods to interact with the canvas bridge endpoints
 */

import { createCanvasBridgeClient } from './apiClient'
import type {
  CanvasBridgeStatus,
  CanvasExecuteRequest,
  CanvasExecuteResponse,
  CanvasModulesListResponse,
  CanvasToolManifest,
  DirectoryListResponse,
  FileDeleteResponse,
  FileReadResponse,
  FileWriteResponse,
  HealthStatus,
} from './types'

export class CanvasService {
  private client = createCanvasBridgeClient()

  /**
   * Get canvas bridge status
   */
  async getBridgeStatus(): Promise<CanvasBridgeStatus> {
    const { data } = await this.client.get<CanvasBridgeStatus>('/api/canvas/bridge-status')
    return data
  }

  /**
   * Get health status
   */
  async getHealth(): Promise<HealthStatus> {
    const { data } = await this.client.get<HealthStatus>('/api/health')
    return data
  }

  /**
   * Get tool manifest
   */
  async getToolManifest(): Promise<CanvasToolManifest> {
    const { data } = await this.client.get<CanvasToolManifest>('/api/canvas/tools')
    return data
  }

  /**
   * Execute a canvas tool
   */
  async executeTool(request: CanvasExecuteRequest): Promise<CanvasExecuteResponse> {
    const { data } = await this.client.post<CanvasExecuteResponse>('/api/canvas/execute', request)
    return data
  }

  /**
   * List directory contents
   */
  async listDirectory(path: string): Promise<DirectoryListResponse> {
    // The client appends params; here we use query param directly
    const response = await fetch(
      `${this.client['baseUrl']}/api/files?path=${encodeURIComponent(path)}`,
      {
        headers: this.client['buildHeaders']?.({}) || {},
      }
    )
    if (!response.ok) throw new Error(`listDirectory ${response.status}`)
    return response.json()
  }

  /**
   * Read a file
   */
  async readFile(path: string): Promise<FileReadResponse> {
    const response = await fetch(
      `${this.client['baseUrl']}/api/file?path=${encodeURIComponent(path)}`,
      {
        headers: this.client['buildHeaders']?.({}) || {},
      }
    )
    if (!response.ok) throw new Error(`readFile ${response.status}`)
    return response.json()
  }

  /**
   * Write a file
   */
  async writeFile(path: string, content: string): Promise<FileWriteResponse> {
    const { data } = await this.client.post<FileWriteResponse>('/api/file', { path, content })
    return data
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<FileDeleteResponse> {
    const response = await fetch(
      `${this.client['baseUrl']}/api/file?path=${encodeURIComponent(path)}`,
      {
        method: 'DELETE',
        headers: this.client['buildHeaders']?.({}) || {},
      }
    )
    if (!response.ok) throw new Error(`deleteFile ${response.status}`)
    return response.json()
  }

  /**
   * List all canvas modules (tiles)
   */
  async listModules(): Promise<CanvasModulesListResponse> {
    // This endpoint doesn't exist yet - it's handled via WebSocket
    // This is a placeholder for future HTTP implementation
    throw new Error('listModules is only available via WebSocket')
  }

  /**
   * Check if the canvas bridge is available
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
 * Singleton canvas service instance
 */
let canvasServiceInstance: CanvasService | null = null

export function getCanvasService(): CanvasService {
  if (!canvasServiceInstance) {
    canvasServiceInstance = new CanvasService()
  }
  return canvasServiceInstance
}

/**
 * Create a new canvas service instance (useful for testing)
 */
export function createCanvasService(): CanvasService {
  return new CanvasService()
}

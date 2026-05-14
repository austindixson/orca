/**
 * Global API State Management
 * Central store for API client state, loading, errors, and caching
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ApiEndpoint =
  | 'canvas_bridge'
  | 'dev_telemetry'
  | 'orca_gateway'
  | 'openrouter'
  | 'hermes'
  | 'research'

export type ApiStatus = 'idle' | 'pending' | 'success' | 'error'

export interface ApiRequestState {
  status: ApiStatus
  isLoading: boolean
  error: string | null
  lastFetched: number | null
  data: unknown
}

export interface ApiCacheEntry {
  data: unknown
  timestamp: number
  ttl: number // Time-to-live in milliseconds
}

interface ApiState {
  // Request states by endpoint
  requests: Map<string, ApiRequestState>
  
  // Cache storage
  cache: Map<string, ApiCacheEntry>
  
  // Global loading state
  globalLoading: boolean
  
  // Set request state
  setRequestState: (endpoint: string, state: Partial<ApiRequestState>) => void
  
  // Clear request state
  clearRequestState: (endpoint: string) => void
  
  // Set cache entry
  setCache: (key: string, data: unknown, ttl?: number) => void
  
  // Get cache entry
  getCache: (key: string) => unknown | null
  
  // Clear expired cache entries
  clearExpiredCache: () => void
  
  // Clear all cache
  clearAllCache: () => void
  
  // Set global loading
  setGlobalLoading: (loading: boolean) => void
}

const DEFAULT_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function isCacheExpired(entry: ApiCacheEntry): boolean {
  return Date.now() - entry.timestamp > entry.ttl
}

export const useApiStore = create<ApiState>()(
  persist(
    (set, get) => ({
      requests: new Map(),
      cache: new Map(),
      globalLoading: false,
      
      setRequestState: (endpoint, partial) => {
        set((store) => {
          const requests = new Map(store.requests)
          const existing = requests.get(endpoint) || {
            status: 'idle' as ApiStatus,
            isLoading: false,
            error: null,
            lastFetched: null,
            data: null,
          }
          requests.set(endpoint, { ...existing, ...partial })
          return { requests }
        })
      },
      
      clearRequestState: (endpoint) => {
        set((state) => {
          const requests = new Map(state.requests)
          requests.delete(endpoint)
          return { requests }
        })
      },
      
      setCache: (key, data, ttl = DEFAULT_CACHE_TTL) => {
        set((state) => {
          const cache = new Map(state.cache)
          cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl,
          })
          return { cache }
        })
      },
      
      getCache: (key) => {
        const entry = get().cache.get(key)
        if (!entry) return null
        if (isCacheExpired(entry)) {
          set((state) => {
            const cache = new Map(state.cache)
            cache.delete(key)
            return { cache }
          })
          return null
        }
        return entry.data
      },
      
      clearExpiredCache: () => {
        set((state) => {
          const cache = new Map(state.cache)
          for (const [key, entry] of cache.entries()) {
            if (isCacheExpired(entry)) {
              cache.delete(key)
            }
          }
          return { cache }
        })
      },
      
      clearAllCache: () => set({ cache: new Map() }),
      
      setGlobalLoading: (loading) => set({ globalLoading: loading }),
    }),
    {
      name: 'agent-canvas-api-store',
      partialize: (state) => ({
        cache: Array.from(state.cache.entries()),
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const entries = state.cache as unknown as [string, ApiCacheEntry][]
          state.cache = new Map(entries)
        }
      },
    }
  )
)

// Selectors
export const selectRequestState = (endpoint: string) => (state: ApiState) =>
  state.requests.get(endpoint)

export const selectIsLoading = (endpoint: string) => (state: ApiState) =>
  state.requests.get(endpoint)?.isLoading ?? false

export const selectError = (endpoint: string) => (state: ApiState) =>
  state.requests.get(endpoint)?.error ?? null

export const selectData = (endpoint: string) => (state: ApiState) =>
  state.requests.get(endpoint)?.data ?? null

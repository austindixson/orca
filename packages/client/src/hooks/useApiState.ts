/**
 * Custom hooks for API state management
 * Provides data fetching, mutations, and caching utilities
 */

import { useCallback, useEffect, useRef } from 'react'
import { useApiStore, type ApiRequestState } from '../store/apiStore'
import { useToastStore } from '../store/toastStore'

export interface UseApiOptions {
  enabled?: boolean
  cacheKey?: string
  cacheTTL?: number
  onSuccess?: (data: unknown) => void
  onError?: (error: string) => void
  retry?: number
  retryDelay?: number
}

export interface UseMutationOptions<TData = unknown, _TVariables = unknown> {
  onSuccess?: (data: TData) => void
  onError?: (error: string) => void
  onSettled?: () => void
  invalidateCache?: string[]
}

/**
 * Hook for fetching data from an API endpoint
 * Handles loading states, errors, caching, and retries
 */
export function useApiFetch<TData = unknown>(
  endpoint: string,
  fetchFn: () => Promise<TData>,
  options: UseApiOptions = {}
) {
  const {
    enabled = true,
    cacheKey,
    cacheTTL,
    onSuccess,
    onError,
    retry = 0,
    retryDelay = 1000,
  } = options

  const { setRequestState, clearRequestState, getCache, setCache } = useApiStore()
  const { addToast } = useToastStore()
  const retryCount = useRef(0)
  const mounted = useRef(true)

  const requestState = useApiStore(
    useCallback((state) => state.requests.get(endpoint) as ApiRequestState | undefined, [endpoint])
  )

  const execute = useCallback(async () => {
    if (!enabled) return

    // Check cache first
    if (cacheKey) {
      const cached = getCache(cacheKey)
      if (cached) {
        setRequestState(endpoint, {
          status: 'success',
          isLoading: false,
          data: cached,
          lastFetched: Date.now(),
        })
        onSuccess?.(cached as TData)
        return
      }
    }

    setRequestState(endpoint, {
      status: 'pending',
      isLoading: true,
      error: null,
    })

    try {
      const data = await fetchFn()
      
      if (!mounted.current) return

      // Cache the result
      if (cacheKey) {
        setCache(cacheKey, data, cacheTTL)
      }

      setRequestState(endpoint, {
        status: 'success',
        isLoading: false,
        data,
        lastFetched: Date.now(),
        error: null,
      })

      onSuccess?.(data)
      retryCount.current = 0
    } catch (error) {
      if (!mounted.current) return

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Retry logic
      if (retryCount.current < retry) {
        retryCount.current++
        setTimeout(() => {
          if (mounted.current) execute()
        }, retryDelay * retryCount.current)
        return
      }

      setRequestState(endpoint, {
        status: 'error',
        isLoading: false,
        error: errorMessage,
      })

      onError?.(errorMessage)
      addToast({
        type: 'error',
        title: 'API Error',
        message: `Failed to fetch from ${endpoint}: ${errorMessage}`,
      })
      retryCount.current = 0
    }
  }, [
    enabled,
    endpoint,
    cacheKey,
    cacheTTL,
    retry,
    retryDelay,
    fetchFn,
    setRequestState,
    getCache,
    setCache,
    onSuccess,
    onError,
    addToast,
  ])

  useEffect(() => {
    mounted.current = true
    execute()

    return () => {
      mounted.current = false
    }
  }, [execute])

  const refetch = useCallback(() => {
    retryCount.current = 0
    execute()
  }, [execute])

  const reset = useCallback(() => {
    clearRequestState(endpoint)
  }, [clearRequestState, endpoint])

  return {
    data: requestState?.data as TData | null,
    isLoading: requestState?.isLoading ?? false,
    error: requestState?.error ?? null,
    status: requestState?.status ?? 'idle',
    refetch,
    reset,
  }
}

/**
 * Hook for performing mutations (POST, PUT, DELETE, etc.)
 * Handles loading states, errors, and cache invalidation
 */
export function useApiMutation<TData = unknown, TVariables = unknown>(
  endpoint: string,
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: UseMutationOptions<TData, TVariables> = {}
) {
  const { onSuccess, onError, onSettled, invalidateCache = [] } = options
  const { setRequestState, clearRequestState, clearAllCache } = useApiStore()
  const { addToast } = useToastStore()
  const mounted = useRef(true)

  const mutate = useCallback(
    async (variables: TVariables) => {
      setRequestState(endpoint, {
        status: 'pending',
        isLoading: true,
        error: null,
      })

      try {
        const data = await mutationFn(variables)
        
        if (!mounted.current) return

        // Invalidate specified cache keys
        if (invalidateCache.length > 0) {
          clearAllCache()
        }

        setRequestState(endpoint, {
          status: 'success',
          isLoading: false,
          data,
          lastFetched: Date.now(),
          error: null,
        })

        onSuccess?.(data)
        addToast({
          type: 'success',
          title: 'Success',
          message: `Operation completed successfully`,
        })
      } catch (error) {
        if (!mounted.current) return

        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        setRequestState(endpoint, {
          status: 'error',
          isLoading: false,
          error: errorMessage,
        })

        onError?.(errorMessage)
        addToast({
          type: 'error',
          title: 'Mutation Error',
          message: `Failed to mutate ${endpoint}: ${errorMessage}`,
        })
      } finally {
        onSettled?.()
      }
    },
    [endpoint, mutationFn, onSuccess, onError, onSettled, invalidateCache, setRequestState, clearAllCache, addToast]
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const reset = useCallback(() => {
    clearRequestState(endpoint)
  }, [clearRequestState, endpoint])

  return {
    mutate,
    isLoading: useApiStore((state) => state.requests.get(endpoint)?.isLoading ?? false),
    error: useApiStore((state) => state.requests.get(endpoint)?.error ?? null),
    reset,
  }
}

/**
 * Hook for debouncing API calls
 * Prevents rapid successive calls to the same endpoint
 */
export function useDebounceApi<TData = unknown>(
  endpoint: string,
  fetchFn: () => Promise<TData>,
  delay: number = 500
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const { data, isLoading, error, status, refetch, reset } = useApiFetch(
    endpoint,
    fetchFn,
    { enabled: false } // Disable auto-fetch
  )

  const debouncedRefetch = useCallback(
    (...args: Parameters<typeof refetch>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        refetch(...args)
      }, delay)
    },
    [refetch, delay]
  )

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return {
    data,
    isLoading,
    error,
    status,
    refetch: debouncedRefetch,
    reset,
  }
}

/**
 * Hook for polling an endpoint at regular intervals
 */
export function useApiPoll<TData = unknown>(
  endpoint: string,
  fetchFn: () => Promise<TData>,
  interval: number = 5000,
  options: UseApiOptions = {}
) {
  const { refetch } = useApiFetch(endpoint, fetchFn, options)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (options.enabled === false) return

    // Initial fetch
    refetch()

    // Set up polling
    intervalRef.current = setInterval(() => {
      refetch()
    }, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [endpoint, interval, options.enabled, refetch])

  return useApiFetch(endpoint, fetchFn, { ...options, enabled: false })
}

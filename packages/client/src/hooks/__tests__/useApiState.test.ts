/**
 * Unit tests for useApiState hooks
 */

import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useApiStore } from '../../store/apiStore'
import { useApiFetch, useApiMutation } from '../useApiState'

describe('useApiFetch', () => {
  beforeEach(() => {
    // Reset store before each test
    useApiStore.getState().clearAllCache()
    useApiStore.getState().requests.clear()
    vi.clearAllMocks()
  })

  it('should fetch data successfully', async () => {
    const mockData = { id: 1, name: 'Test' }
    const fetchFn = vi.fn().mockResolvedValue(mockData)

    const { result } = renderHook(() =>
      useApiFetch('test-endpoint', fetchFn)
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual(mockData)
    expect(result.current.error).toBeNull()
    expect(result.current.status).toBe('success')
  })

  it('should handle loading state', () => {
    const fetchFn = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({}), 100))
    )

    const { result } = renderHook(() =>
      useApiFetch('test-endpoint', fetchFn)
    )

    expect(result.current.isLoading).toBe(true)
  })

  it('should handle errors', async () => {
    const errorMessage = 'Network error'
    const fetchFn = vi.fn().mockRejectedValue(new Error(errorMessage))

    const { result } = renderHook(() =>
      useApiFetch('test-endpoint', fetchFn)
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe(errorMessage)
    expect(result.current.status).toBe('error')
  })

  it('should cache results when cacheKey is provided', async () => {
    const mockData = { cached: true }
    const fetchFn = vi.fn().mockResolvedValue(mockData)

    const { result, rerender } = renderHook(() =>
      useApiFetch('test-endpoint', fetchFn, { cacheKey: 'test-cache' })
    )

    await waitFor(() => expect(result.current.data).toEqual(mockData))
    expect(fetchFn).toHaveBeenCalledTimes(1)

    // Re-render should use cache
    rerender()
    await waitFor(() => expect(result.current.data).toEqual(mockData))
    expect(fetchFn).toHaveBeenCalledTimes(1) // Not called again
  })

  it('should retry on failure', async () => {
    const mockData = { success: true }
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValue(mockData)

    const { result } = renderHook(() =>
      useApiFetch('test-endpoint', fetchFn, { retry: 2, retryDelay: 10 })
    )

    await waitFor(() => expect(result.current.data).toEqual(mockData))
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('should not fetch when disabled', async () => {
    const fetchFn = vi.fn().mockResolvedValue({})

    renderHook(() =>
      useApiFetch('test-endpoint', fetchFn, { enabled: false })
    )

    await waitFor(() => expect(fetchFn).not.toHaveBeenCalled())
  })

  it('should call onSuccess callback', async () => {
    const mockData = { success: true }
    const fetchFn = vi.fn().mockResolvedValue(mockData)
    const onSuccess = vi.fn()

    renderHook(() =>
      useApiFetch('test-endpoint', fetchFn, { onSuccess })
    )

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(mockData))
  })

  it('should call onError callback', async () => {
    const errorMessage = 'Test error'
    const fetchFn = vi.fn().mockRejectedValue(new Error(errorMessage))
    const onError = vi.fn()

    renderHook(() =>
      useApiFetch('test-endpoint', fetchFn, { onError })
    )

    await waitFor(() => expect(onError).toHaveBeenCalledWith(errorMessage))
  })

  it('should reset state', async () => {
    const fetchFn = vi.fn().mockResolvedValue({})

    const { result } = renderHook(() =>
      useApiFetch('test-endpoint', fetchFn)
    )

    await waitFor(() => expect(result.current.data).not.toBeNull())

    act(() => {
      result.current.reset()
    })

    expect(result.current.data).toBeNull()
    expect(result.current.status).toBe('idle')
  })

  it('should refetch data', async () => {
    const mockData1 = { version: 1 }
    const mockData2 = { version: 2 }
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(mockData1)
      .mockResolvedValueOnce(mockData2)

    const { result } = renderHook(() =>
      useApiFetch('test-endpoint', fetchFn)
    )

    await waitFor(() => expect(result.current.data).toEqual(mockData1))

    act(() => {
      result.current.refetch()
    })

    await waitFor(() => expect(result.current.data).toEqual(mockData2))
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('useApiMutation', () => {
  beforeEach(() => {
    useApiStore.getState().clearAllCache()
    useApiStore.getState().requests.clear()
    vi.clearAllMocks()
  })

  it('should mutate successfully', async () => {
    const mockData = { created: true }
    const mutationFn = vi.fn().mockResolvedValue(mockData)

    const { result } = renderHook(() =>
      useApiMutation('test-mutation', mutationFn)
    )

    await act(async () => {
      await result.current.mutate({ input: 'test' })
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(mutationFn).toHaveBeenCalledWith({ input: 'test' })
  })

  it('should handle loading state', async () => {
    let resolveFn: () => void
    const mutationFn = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFn = () => resolve({ success: true })
        })
    )

    const { result } = renderHook(() =>
      useApiMutation('test-mutation', mutationFn)
    )

    act(() => {
      result.current.mutate({})
    })

    expect(result.current.isLoading).toBe(true)

    // Resolve the promise
    await act(async () => {
      if (resolveFn) resolveFn()
    })
  })

  it('should handle errors', async () => {
    const errorMessage = 'Mutation failed'
    const mutationFn = vi.fn().mockRejectedValue(new Error(errorMessage))

    const { result } = renderHook(() =>
      useApiMutation('test-mutation', mutationFn)
    )

    await act(async () => {
      await result.current.mutate({})
    })

    expect(result.current.error).toBe(errorMessage)
    expect(result.current.isLoading).toBe(false)
  })

  it('should call onSuccess callback', async () => {
    const mockData = { success: true }
    const mutationFn = vi.fn().mockResolvedValue(mockData)
    const onSuccess = vi.fn()

    const { result } = renderHook(() =>
      useApiMutation('test-mutation', mutationFn, { onSuccess })
    )

    await act(async () => {
      await result.current.mutate({})
    })

    expect(onSuccess).toHaveBeenCalledWith(mockData)
  })

  it('should call onError callback', async () => {
    const errorMessage = 'Error'
    const mutationFn = vi.fn().mockRejectedValue(new Error(errorMessage))
    const onError = vi.fn()

    const { result } = renderHook(() =>
      useApiMutation('test-mutation', mutationFn, { onError })
    )

    await act(async () => {
      await result.current.mutate({})
    })

    expect(onError).toHaveBeenCalledWith(errorMessage)
  })

  it('should invalidate cache', async () => {
    const mutationFn = vi.fn().mockResolvedValue({})

    // Set up some cache
    useApiStore.getState().setCache('key1', { data: 1 })
    useApiStore.getState().setCache('key2', { data: 2 })

    const { result } = renderHook(() =>
      useApiMutation('test-mutation', mutationFn, {
        invalidateCache: ['key1', 'key2'],
      })
    )

    await act(async () => {
      await result.current.mutate({})
    })

    // Cache should be cleared
    expect(useApiStore.getState().getCache('key1')).toBeNull()
    expect(useApiStore.getState().getCache('key2')).toBeNull()
  })

  it('should reset state', async () => {
    const mutationFn = vi.fn().mockResolvedValue({})

    const { result } = renderHook(() =>
      useApiMutation('test-mutation', mutationFn)
    )

    await act(async () => {
      await result.current.mutate({})
    })

    expect(result.current.error).toBeNull()

    act(() => {
      result.current.reset()
    })

    // Should clear request state
    const requestState = useApiStore.getState().requests.get('test-mutation')
    expect(requestState).toBeUndefined()
  })
})

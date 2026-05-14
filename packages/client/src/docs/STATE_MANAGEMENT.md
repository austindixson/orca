# State Management Setup

This document describes the state management architecture, hooks, and API response mapping utilities for the Orca Coder client application.

## Architecture Overview

The state management system is built on three main layers:

1. **Global State Store** (`apiStore.ts`) - Centralized API state with caching
2. **Custom Hooks** (`useApiState.ts`) - Data fetching, mutations, and reactivity
3. **API Mappers** (`apiMappers.ts`) - Type-safe response transformation

## 1. Global State Store (`apiStore.ts`)

### Features

- **Request State Tracking**: Track loading, errors, and success states per endpoint
- **Response Caching**: Time-to-live (TTL) based caching with automatic expiration
- **Persistence**: Cache persists across sessions using Zustand's persist middleware
- **Global Loading State**: Track overall API activity

### Core Types

```typescript
type ApiStatus = 'idle' | 'pending' | 'success' | 'error'

interface ApiRequestState {
  status: ApiStatus
  isLoading: boolean
  error: string | null
  lastFetched: number | null
  data: unknown
}

interface ApiCacheEntry {
  data: unknown
  timestamp: number
  ttl: number // milliseconds
}
```

### Store Actions

- `setRequestState(endpoint, state)` - Update request state for an endpoint
- `clearRequestState(endpoint)` - Reset request state
- `setCache(key, data, ttl?)` - Cache response data
- `getCache(key)` - Retrieve cached data (auto-expires)
- `clearExpiredCache()` - Remove all expired cache entries
- `clearAllCache()` - Wipe entire cache
- `setGlobalLoading(loading)` - Set global loading state

### Selectors

```typescript
selectRequestState(endpoint) // Get full request state
selectIsLoading(endpoint)    // Get loading boolean
selectError(endpoint)        // Get error message
selectData(endpoint)         // Get response data
```

## 2. Custom Hooks (`useApiState.ts`)

### `useApiFetch<TData>(endpoint, fetchFn, options)`

Primary hook for data fetching with automatic state management.

**Parameters:**
- `endpoint` - Unique identifier for the request
- `fetchFn` - Async function that returns data
- `options` - Configuration object:
  - `enabled?: boolean` - Enable/disable automatic fetching
  - `cacheKey?: string` - Cache the response under this key
  - `cacheTTL?: number` - Cache duration in milliseconds (default: 5min)
  - `onSuccess?: (data) => void` - Callback on successful fetch
  - `onError?: (error) => void` - Callback on error
  - `retry?: number` - Number of retry attempts (default: 0)
  - `retryDelay?: number` - Delay between retries in ms (default: 1000)

**Returns:**
```typescript
{
  data: TData | null
  isLoading: boolean
  error: string | null
  status: ApiStatus
  refetch: () => void
  reset: () => void
}
```

**Usage Example:**
```typescript
const { data, isLoading, error, refetch } = useApiFetch(
  'canvas_bridge_status',
  () => fetchCanvasBridgeStatus(),
  {
    cacheKey: 'bridge-status',
    cacheTTL: 30000,
    enabled: true,
  }
)
```

### `useApiMutation<TData, TVariables>(endpoint, mutationFn, options)`

Hook for performing mutations (POST, PUT, DELETE, etc.).

**Parameters:**
- `endpoint` - Unique identifier for the mutation
- `mutationFn` - Async function accepting variables
- `options` - Configuration object:
  - `onSuccess?: (data) => void` - Callback on success
  - `onError?: (error) => void` - Callback on error
  - `onSettled?: () => void` - Callback after completion (success or error)
  - `invalidateCache?: string[]` - Cache keys to clear after mutation

**Returns:**
```typescript
{
  mutate: (variables: TVariables) => Promise<void>
  isLoading: boolean
  error: string | null
  reset: () => void
}
```

**Usage Example:**
```typescript
const { mutate, isLoading, error } = useApiMutation(
  'start_telegram_gateway',
  (body) => startOrcaNativeTelegramGateway(body),
  {
    onSuccess: (result) => console.log('Started', result),
    invalidateCache: ['gateway-status'],
  }
)

// Call mutation
await mutate({ token: '...', allowedUserIds: [123456] })
```

### `useDebounceApi<TData>(endpoint, fetchFn, delay)`

Debounced version of `useApiFetch` to prevent rapid successive calls.

**Parameters:**
- `endpoint` - Unique identifier
- `fetchFn` - Async fetch function
- `delay` - Debounce delay in ms (default: 500)

**Returns:** Same as `useApiFetch`, but `refetch` is debounced

**Usage Example:**
```typescript
const { refetch, data } = useDebounceApi(
  'search',
  () => searchFiles(query),
  300
)

// Rapid calls are debounced
refetch() // called 3 times quickly → only last one executes
```

### `useApiPoll<TData>(endpoint, fetchFn, interval, options)`

Polls an endpoint at regular intervals.

**Parameters:**
- `endpoint` - Unique identifier
- `fetchFn` - Async fetch function
- `interval` - Poll interval in ms (default: 5000)
- `options` - Same as `useApiFetch` options

**Returns:** Same as `useApiFetch`

**Usage Example:**
```typescript
useApiPoll(
  'telemetry_snapshot',
  () => fetchDevTelemetrySnapshot(30),
  5000, // Poll every 5 seconds
  { enabled: isMonitoring }
)
```

## 3. API Mappers (`apiMappers.ts`)

Transform API responses into UI-friendly state interfaces with type safety.

### Canvas Bridge Mappers

```typescript
// Input: CanvasBridgeStatus
export interface CanvasBridgeUIState {
  isConnected: boolean
  uiClientsCount: number
  isTokenRequired: boolean
  externalAgent: { id: string | null; lastSeenMs: number | null; isActive: boolean } | null
}

mapCanvasBridgeStatusToUI(status: CanvasBridgeStatus): CanvasBridgeUIState
mapOrcaGatewayStatusToUI(status: OrcaGatewayStatus): OrcaGatewayUIState
```

### OpenRouter Usage Mappers

```typescript
// Input: OpenRouterUsageEvent[]
export interface UsageStatsUIState {
  totalRequests: number
  totalTokens: number
  totalCostUsd: number
  byModel: Array<{ model: string; requests: number; tokens: number; costUsd: number }>
  timeframe: { start: number; end: number }
}

mapOpenRouterUsageToUI(events: OpenRouterUsageEvent[]): UsageStatsUIState

// Input: OpenRouterCreditsSnapshot | null
export interface CreditsUIState {
  usageUsd: number | null
  limitUsd: number | null
  remainingUsd: number | null
  percentageUsed: number | null
  isFreeTier: boolean
  label: string | null
  lastFetched: number | null
  error: string | null
}

mapCreditsSnapshotToUI(credits: OpenRouterCreditsSnapshot | null): CreditsUIState
```

### Research Session Mappers

```typescript
// Input: ResearchEntry[]
export interface ResearchUIEntry {
  id: string
  kind: 'web_search' | 'mcp_context7' | 'mcp_generic' | 'url_fetch'
  status: ResearchEntryStatus
  query: string
  ok: boolean
  error: string | null
  abstract: string | null
  source: string | null
  related: string[]
  provider: string | null
  snippets: Array<{ title: string; body: string; url?: string }>
  timestamp: number
}

mapResearchEntryToUI(entry: ResearchEntry): ResearchUIEntry
mapResearchEntriesToUI(entries: ResearchEntry[]): ResearchUIEntry[]
```

### Orchestrator Activity Mappers

```typescript
// Input: OrchestratorActivityPayload
export interface ActivityVerbUIState {
  verb: string
  iteration: number
  startTimeMs: number | null
  elapsedMs: number
  isActive: boolean
}

mapActivityPayloadToVerb(payload: OrchestratorActivityPayload): ActivityVerbUIState
```

### Chat Completion Mappers

```typescript
// Input: ChatCompletionResponse
export interface ChatCompletionUIState {
  id: string | null
  model: string | null
  content: string | null
  toolCalls: Array<{ id: string; name: string; arguments: string }> | null
  finishReason: string | null
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costUsd: number | null
  } | null
  hasError: boolean
  errorMessage: string | null
}

mapChatCompletionToUI(response: ChatCompletionResponse): ChatCompletionUIState
mapChatCompletionError(error: Error): ChatCompletionUIState
```

### Type Guards

Validate unknown data structures safely:

```typescript
isCanvasBridgeStatus(data: unknown): data is CanvasBridgeStatus
isOrcaGatewayStatus(data: unknown): data is OrcaGatewayStatus
isOpenRouterCreditsSnapshot(data: unknown): data is OpenRouterCreditsSnapshot
isResearchEntry(data: unknown): data is ResearchEntry
```

### Utility Functions

```typescript
formatCurrencyUSD(cents: number): string           // e.g. "$0.0123"
formatTokens(tokens: number): string               // e.g. "1.5K", "2.3M"
formatDuration(ms: number): string                  // e.g. "2.3s", "5m 30s"
getHealthStatus(lastSeenMs, thresholdMs): 'healthy' | 'degraded' | 'offline'
```

## Integration with Existing Stores

The new state management system integrates with existing Zustand stores:

### `canvasStore.ts`
- Canvas tile state, pan/zoom, layout
- No changes required - works in parallel

### `settingsStore.ts`
- Provider configurations, API keys, theme
- Credential resolution via `llmCredentials.ts`
- Maps to UI state via `apiMappers.ts`

### `orchestratorSessionStore.ts`
- Orchestrator runs, conversation history
- Activity tracking via `orchestratorActivityStore.ts`
- Research data via `researchSessionStore.ts`

### `openRouterUsageStore.ts`
- OpenRouter usage events and credits
- Mapped to UI state via `mapOpenRouterUsageToUI`

### `workspaceStore.ts`
- File tree, recent projects
- No changes required

## Best Practices

### 1. Use Descriptive Endpoint Names

```typescript
// Good
useApiFetch('canvas_bridge_status', ...)
useApiMutation('start_telegram_gateway', ...)

// Avoid
useApiFetch('api1', ...)
useApiMutation('mutation2', ...)
```

### 2. Cache Strategically

```typescript
// Cache long-lived data
useApiFetch('usage_events', fetchUsage, {
  cacheKey: 'openrouter-usage',
  cacheTTL: 60 * 1000, // 1 minute
})

// Don't cache real-time data
useApiFetch('telemetry', fetchTelemetry, {
  cacheKey: undefined, // No caching
})
```

### 3. Invalidate Cache on Mutations

```typescript
useApiMutation('update_settings', updateSettings, {
  onSuccess: () => {
    // Invalidate related caches
    apiStore.getState().clearAllCache()
  },
})
```

### 4. Handle Loading States Gracefully

```typescript
const { data, isLoading, error } = useApiFetch(...)

if (isLoading) return <LoadingSpinner />
if (error) return <ErrorBanner message={error} />
if (!data) return <EmptyState />
return <DataView data={data} />
```

### 5. Type-Safe API Mappers

Always use the provided mappers for type safety:

```typescript
// Good
const uiState = mapCanvasBridgeStatusToUI(apiResponse)
// uiState is properly typed

// Avoid
const uiState = apiResponse as CanvasBridgeUIState
// Runtime type errors possible
```

## Testing Strategy

### Unit Tests

Test mappers with various input scenarios:

```typescript
describe('mapCanvasBridgeStatusToUI', () => {
  it('handles connected state', () => {
    const input = { uiClients: 2, tokenRequired: false, ... }
    const result = mapCanvasBridgeStatusToUI(input)
    expect(result.isConnected).toBe(true)
  })
})
```

### Integration Tests

Test hooks with mock fetch functions:

```typescript
describe('useApiFetch', () => {
  it('fetches data and caches result', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockData)
    const { result } = renderHook(() => useApiFetch('test', fetchFn))
    
    await waitFor(() => expect(result.current.data).toEqual(mockData))
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
```

## Migration Guide

### From Existing API Calls

**Before:**
```typescript
const [data, setData] = useState(null)
const [loading, setLoading] = useState(false)

useEffect(() => {
  setLoading(true)
  fetchCanvasBridgeStatus()
    .then(setData)
    .finally(() => setLoading(false))
}, [])
```

**After:**
```typescript
const { data, isLoading, error } = useApiFetch(
  'canvas_bridge_status',
  fetchCanvasBridgeStatus
)
```

### Benefits of Migration

- Automatic loading/error state
- Built-in caching
- Retry logic
- Automatic cache invalidation
- Consistent error handling with toasts
- Type-safe with TypeScript

## Performance Considerations

### Cache Size

The cache persists to localStorage. Monitor usage:

```typescript
// Check cache size in dev
useEffect(() => {
  const state = useApiStore.getState()
  console.log('Cache entries:', state.cache.size)
}, [])
```

### Debouncing

Use `useDebounceApi` for user-triggered searches:

```typescript
const { data, refetch } = useDebounceApi(
  'file_search',
  () => searchFiles(query),
  300
)
```

### Polling

Use `useApiPoll` sparingly and only when real-time updates are essential:

```typescript
useApiPoll(
  'telemetry',
  fetchTelemetry,
  5000,
  { enabled: isMonitoringMode }
)
```

## Troubleshooting

### Cache Not Clearing

```typescript
// Force clear all caches
useApiStore.getState().clearAllCache()

// Or clear specific endpoint state
useApiStore.getState().clearRequestState('my-endpoint')
```

### Stale Data

```typescript
// Disable cache temporarily
useApiFetch('endpoint', fetchFn, {
  cacheKey: undefined,
})
```

### Loading State Stuck

```typescript
// Reset endpoint state
const { reset } = useApiFetch(...)
reset()
```

## Future Enhancements

Potential improvements to consider:

1. **Request Deduplication** - Prevent duplicate in-flight requests
2. **Optimistic Updates** - Update UI before server response
3. **Request Cancellation** - Abort pending requests on unmount
4. **Cache Versioning** - Invalidate cache on schema changes
5. **Request Batching** - Group multiple requests
6. **Offline Support** - Queue requests when offline

## Related Files

- `packages/client/src/store/apiStore.ts` - Global state store
- `packages/client/src/hooks/useApiState.ts` - Custom hooks
- `packages/client/src/lib/apiMappers.ts` - API response mappers
- `packages/client/src/store/canvasStore.ts` - Canvas state
- `packages/client/src/store/settingsStore.ts` - Settings state
- `packages/client/src/store/orchestratorSessionStore.ts` - Orchestrator state
- `packages/client/src/store/openRouterUsageStore.ts` - Usage tracking
- `packages/client/src/lib/canvasBridgeApi.ts` - API client functions
- `packages/client/src/lib/llmCredentials.ts` - Credential resolution
- `packages/client/src/lib/devTelemetryIngest.ts` - Telemetry ingestion

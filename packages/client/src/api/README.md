# Orca API SDK

The API SDK provides a clean, type-safe interface for communicating with the Orca Coder backend services.

## Overview

The SDK consists of three main services:

1. **Canvas Service** (`canvasService.ts`) - Interact with the canvas bridge (tools, files, modules)
2. **Telemetry Service** (`telemetryService.ts`) - Manage dev telemetry events and exports
3. **API Client** (`apiClient.ts`) - Core HTTP client with retry logic and error handling

## Installation

The SDK is automatically available in the client package. No additional installation required.

## Quick Start

### Initialize the SDK

```tsx
import { useApiSdkInit } from './api/init'

function App() {
  // Initialize API SDK on app mount
  useApiSdkInit({
    debugMode: import.meta.env.DEV,
  })

  return <div>Your App</div>
}
```

### Use the Services

```tsx
import { getCanvasService } from './api/canvasService'
import { getTelemetryService } from './api/telemetryService'

// Get service instances
const canvasService = getCanvasService()
const telemetryService = getTelemetryService()

// Check health
const health = await canvasService.getHealth()
console.log('Canvas bridge status:', health)

// Get telemetry events
const events = await telemetryService.getEvents({ limit: 50 })
console.log('Recent events:', events.events)
```

## Canvas Service

The canvas service provides methods to interact with the canvas bridge API.

### Health & Status

```typescript
import { getCanvasService } from './api/canvasService'

const canvas = getCanvasService()

// Check if canvas bridge is available
const isAvailable = await canvas.isAvailable()

// Get health status
const health = await canvas.getHealth()

// Get bridge status (includes connected UI clients, external orchestrator info)
const status = await canvas.getBridgeStatus()

// Get tool manifest (available tools and their schemas)
const manifest = await canvas.getToolManifest()
```

### File Operations

```typescript
// List directory contents
const files = await canvas.listDirectory('.')
console.log('Root files:', files.files)

// Read a file
const content = await canvas.readFile('README.md')
console.log('File content:', content.content)

// Write a file
await canvas.writeFile('new-file.txt', 'Hello, World!')

// Delete a file
await canvas.deleteFile('old-file.txt')
```

### Tool Execution

```typescript
// Execute a canvas tool
const result = await canvas.executeTool({
  tool: 'list_directory',
  arguments: { path: 'src' }
})
```

## Telemetry Service

The telemetry service manages dev telemetry events and exports.

### Health & Stats

```typescript
import { getTelemetryService } from './api/telemetryService'

const telemetry = getTelemetryService()

// Check if telemetry service is available
const isAvailable = await telemetry.isAvailable()

// Get health and stats
const health = await telemetry.getHealth()
console.log('Telemetry stats:', health.stats)

// Get statistics
const stats = await telemetry.getStats()
console.log('Total events:', stats.totalEvents)
```

### Event Queries

```typescript
// Get recent events
const events = await telemetry.getEvents({ limit: 100 })

// Get events for a specific session
const sessionEvents = await telemetry.getEvents({
  sessionId: 'my-session-id',
  since: '2024-01-01T00:00:00Z',
  until: '2024-01-31T23:59:59Z',
})

// Filter by level
const errors = await telemetry.getEvents({
  level: 'error',
  limit: 50,
})

// Filter by source
const orchestratorEvents = await telemetry.getEvents({
  source: 'orchestrator',
  limit: 100,
})
```

### Event Ingestion

```typescript
// Ingest telemetry events
const result = await telemetry.ingestEvents([
  {
    kind: 'model_request',
    level: 'info',
    provider: 'openrouter',
    model: 'gpt-4',
    payload: { prompt: 'Hello' }
  }
])

console.log('Ingested events:', result.count)
```

### Exports

```typescript
// Export as CSV
const csvBlob = await telemetry.exportCsv({
  since: '2024-01-01T00:00:00Z',
  until: '2024-01-31T23:59:59Z',
})

// Download in browser
const url = URL.createObjectURL(csvBlob)
const a = document.createElement('a')
a.href = url
a.download = 'telemetry.csv'
a.click()

// Export as ZIP (one CSV per session)
const zipBlob = await telemetry.exportZipBySession({
  since: '2024-01-01T00:00:00Z',
})

// Download in browser
const url = URL.createObjectURL(zipBlob)
const a = document.createElement('a')
a.href = url
a.download = 'telemetry.zip'
a.click()
```

### Real-time Streaming

```typescript
// Create event stream for live telemetry
const eventSource = telemetry.createEventStream()

eventSource.addEventListener('message', (e) => {
  const data = JSON.parse(e.data)
  console.log('Live event:', data)
})

// Close stream when done
eventSource.close()
```

## Configuration

The SDK uses environment-specific configuration but can be customized.

### Default Configuration

```typescript
// Development
canvasBridgeUrl: ''  // Vite proxy
telemetryUrl: ''     // Vite proxy
wsUrl: 'ws://localhost:3001/ws'

// Production
canvasBridgeUrl: 'http://127.0.0.1:3001'
telemetryUrl: 'http://127.0.0.1:3002'
wsUrl: 'ws://127.0.0.1:3001/ws'
```

### Custom Configuration

```typescript
import { updateApiConfig } from './api/config'

// Update configuration
updateApiConfig({
  canvasBridgeUrl: 'https://my-custom-server.com',
  telemetryUrl: 'https://my-telemetry-server.com',
  canvasBridgeToken: 'my-auth-token',
  telemetryToken: 'my-telemetry-token',
  debugMode: true,
  requestTimeout: 60000,
  maxRetries: 5,
})
```

### Environment Variables

The SDK respects these environment variables:

- `VITE_DEV_TELEMETRY_URL` - Custom telemetry API URL
- `VITE_CANVAS_BRIDGE_WS` - Custom WebSocket URL
- `VITE_CANVAS_BRIDGE_TOKEN` - Canvas bridge auth token
- `VITE_DEV_TELEMETRY_TOKEN` - Telemetry auth token

## Error Handling

All API calls throw errors on failure. Errors include status code and details:

```typescript
import { getCanvasService } from './api/canvasService'

try {
  await canvasService.readFile('nonexistent.txt')
} catch (error) {
  const apiError = error as ApiError
  console.error('Error:', apiError.message)
  console.error('Status:', apiError.status)
  console.error('Details:', apiError.details)
  console.error('URL:', apiError.url)
}
```

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

- Default max retries: 3
- Backoff delay: 1s, 2s, 4s (with jitter)
- Non-retryable errors: 4xx (except 408, 429), AbortError

Customize retry behavior:

```typescript
import { updateApiConfig } from './api/config'

updateApiConfig({
  maxRetries: 5,  // Increase retry count
  requestTimeout: 60000,  // Longer timeout (60s)
})
```

## TypeScript Types

All services are fully typed. Import types as needed:

```typescript
import type {
  DevTelemetryEvent,
  CanvasBridgeStatus,
  CanvasModule,
  FileEntry,
  ApiResponse,
  ApiError
} from './api/types'
```

## Testing

The SDK is testable with mock implementations:

```typescript
import { createCanvasService } from './api/canvasService'

// Create isolated instance for testing
const mockCanvasService = createCanvasService()

// Or use dependency injection
function myComponent(canvasService = getCanvasService()) {
  // ...
}
```

## Migration from Legacy Code

If you have legacy code using `canvasBridgeApi.ts` or `devTelemetryApi.ts`, here's how to migrate:

### Before (canvasBridgeApi.ts)

```typescript
import { fetchCanvasBridgeStatus } from './lib/canvasBridgeApi'

const status = await fetchCanvasBridgeStatus()
```

### After (API SDK)

```typescript
import { getCanvasService } from './api/canvasService'

const canvas = getCanvasService()
const status = await canvas.getBridgeStatus()
```

### Before (devTelemetryApi.ts)

```typescript
import { fetchTelemetryEvents } from './lib/devTelemetryApi'

const { events } = await fetchTelemetryEvents({ limit: 50 })
```

### After (API SDK)

```typescript
import { getTelemetryService } from './api/telemetryService'

const telemetry = getTelemetryService()
const { events } = await telemetry.getEvents({ limit: 50 })
```

## Browser Compatibility

- Modern browsers with ES2019+ support
- Fetch API support required
- WebSocket support required (for real-time features)
- Server-Sent Events support required (for event streaming)

## License

MIT (same as the rest of the Orca Coder project)

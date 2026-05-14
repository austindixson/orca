import type { Provider } from '../../store/settingsStore'

/**
 * Some OpenRouter models (budget Grok) stall or time out when the API sends
 * `parallel_tool_calls: true` and the model returns multiple large tool results in one turn.
 * Disabling parallel tool calls for those models keeps behavior unchanged for other providers/models.
 */
export function shouldUseParallelToolCallsInApi(provider: Provider, model: string): boolean {
  if (provider !== 'openrouter') return true
  const m = model.toLowerCase()
  if (m.includes('grok-code-fast')) return false
  if (m.includes('grok-3-mini')) return false
  return true
}

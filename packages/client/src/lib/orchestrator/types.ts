import type { Provider } from '../../store/settingsStore'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type UserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type UserMessageContent = string | UserContentPart[]

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: UserMessageContent }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: ToolCall[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatCompletionChoice {
  message: {
    role: string
    content: string | null
    tool_calls?: ToolCall[]
  }
  finish_reason?: string
}

export interface ChatCompletionUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** OpenRouter: generation cost in USD */
  cost?: number
  total_cost?: number
}

export interface ChatCompletionResponse {
  id?: string
  model?: string
  choices: ChatCompletionChoice[]
  usage?: ChatCompletionUsage
}

/** Providers that use OpenAI-style /v1/chat/completions + tools (Hermes / Pi-style loops). */
export const ORCHESTRATOR_TOOL_PROVIDERS: Provider[] = [
  'openai',
  'openaiCodex',
  'openrouter',
  'anthropic',
  'google',
  'zai',
  'ollama',
  'llamacpp',
  'mistral',
  'azureOpenai',
  'githubCopilot',
  'googleVertex',
  'bedrock',
  'hermes',
]

export function providerSupportsOrchestratorTools(p: Provider): boolean {
  return ORCHESTRATOR_TOOL_PROVIDERS.includes(p)
}

export interface OrchestratorModelContext {
  provider: Provider
  model: string
  apiKey: string | undefined
  baseUrl: string | undefined
  /** Shown in the system prompt and activity log so the session uses the user-selected model explicitly. */
  modelDisplayLabel?: string
  /**
   * Optional legacy **agent** tile id for on-canvas tool logging. The main orchestrator UI is the bottom bar;
   * omit this so no agent module is required. File tools still open **Editor** / **Diff** tiles as usual.
   */
  orchestratorTileId?: string | null
}

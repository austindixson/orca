/**
 * AWS Bedrock Claude models via `invoke_model` + Anthropic Messages JSON (Orca Tauri command).
 */

import type { Message, ToolUnion } from '@anthropic-ai/sdk/resources/messages/messages'
import type { ChatCompletionResponse, ChatMessage } from './types'
import {
  anthropicMessageToChatCompletion,
  openAiMessagesToAnthropic,
  openAiToolsToAnthropic,
} from './anthropicChat'

const DEFAULT_MAX_TOKENS = 16_384

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function bedrockChatCompletionWithTools(
  region: string,
  modelId: string,
  messages: ChatMessage[],
  tools: unknown[],
  signal: AbortSignal | undefined,
  _requestTimeoutMs: number
): Promise<ChatCompletionResponse> {
  if (!isTauri()) {
    throw new Error('Bedrock requires the Orca desktop app (Tauri).')
  }
  const { system, anthropicMessages } = openAiMessagesToAnthropic(messages)
  const anthropicTools: ToolUnion[] = openAiToolsToAnthropic(tools)

  const body: Record<string, unknown> = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: DEFAULT_MAX_TOKENS,
    system: system || undefined,
    messages: anthropicMessages,
    temperature: 0.3,
    ...(anthropicTools.length > 0
      ? {
          tools: anthropicTools,
          tool_choice: { type: 'auto' },
        }
      : {}),
  }

  const { invoke } = await import('@tauri-apps/api/core')
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const raw = await invoke<string>('bedrock_invoke_model', {
    region,
    modelId,
    bodyJson: JSON.stringify(body),
  })
  const parsed = JSON.parse(raw) as Message
  return anthropicMessageToChatCompletion(parsed)
}

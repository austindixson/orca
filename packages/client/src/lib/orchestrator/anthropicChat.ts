import Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  TextBlockParam,
  Tool,
  ToolResultBlockParam,
  ToolUnion,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages'
import type { ChatCompletionResponse, ChatMessage, ToolCall, UserMessageContent } from './types'

const DEFAULT_MAX_TOKENS = 16_384

function parseToolInput(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const v = JSON.parse(raw) as unknown
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function userContentToBlocks(content: UserMessageContent): ContentBlockParam[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  const blocks: ContentBlockParam[] = []
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text })
    } else if (part.type === 'image_url') {
      const url = part.image_url.url
      const dataMatch = /^data:([^;]+);base64,(.+)$/i.exec(url)
      if (dataMatch) {
        const media = (dataMatch[1] || 'image/png').toLowerCase()
        const media_type =
          media === 'image/jpeg' || media === 'image/png' || media === 'image/gif' || media === 'image/webp'
            ? (media as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')
            : 'image/png'
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type, data: dataMatch[2] },
        })
      } else {
        blocks.push({
          type: 'image',
          source: { type: 'url', url },
        })
      }
    }
  }
  return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }]
}

/**
 * OpenAI-style tools → Anthropic Messages `tools` array.
 */
export function openAiToolsToAnthropic(tools: unknown[]): ToolUnion[] {
  const out: ToolUnion[] = []
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue
    const o = t as Record<string, unknown>
    const fn = o.function
    if (!fn || typeof fn !== 'object') continue
    const f = fn as Record<string, unknown>
    const name = typeof f.name === 'string' ? f.name.trim() : ''
    if (!name) continue
    const description = typeof f.description === 'string' ? f.description : undefined
    const parameters = f.parameters
    let input_schema: Record<string, unknown>
    if (parameters && typeof parameters === 'object' && parameters !== null) {
      input_schema = { ...(parameters as Record<string, unknown>) }
      if (input_schema.type === undefined) input_schema.type = 'object'
    } else {
      input_schema = { type: 'object', properties: {} }
    }
    out.push({
      name,
      description,
      input_schema: input_schema as Tool['input_schema'],
    })
  }
  return out
}

/**
 * Split system vs conversation; map OpenAI chat messages → Anthropic `messages` + `system`.
 */
export function openAiMessagesToAnthropic(messages: ChatMessage[]): {
  system: string
  anthropicMessages: MessageParam[]
} {
  const systemParts: string[] = []
  const out: MessageParam[] = []
  let i = 0

  while (i < messages.length) {
    const m = messages[i]
    if (m.role === 'system') {
      systemParts.push(m.content)
      i++
      continue
    }

    if (m.role === 'user') {
      out.push({ role: 'user', content: userContentToBlocks(m.content) })
      i++
      continue
    }

    if (m.role === 'assistant') {
      const blocks: (TextBlockParam | ToolUseBlockParam)[] = []
      if (typeof m.content === 'string' && m.content.trim()) {
        blocks.push({ type: 'text', text: m.content })
      }
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: parseToolInput(tc.function.arguments),
          })
        }
      }
      if (blocks.length === 0) {
        blocks.push({ type: 'text', text: '' })
      }
      out.push({ role: 'assistant', content: blocks })
      i++

      const toolResults: ToolResultBlockParam[] = []
      while (i < messages.length && messages[i].role === 'tool') {
        const tm = messages[i] as { role: 'tool'; tool_call_id: string; content: string }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tm.tool_call_id,
          content: tm.content,
        })
        i++
      }
      if (toolResults.length > 0) {
        out.push({ role: 'user', content: toolResults })
      }
      continue
    }

    if (m.role === 'tool') {
      const tm = m as { role: 'tool'; tool_call_id: string; content: string }
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: tm.tool_call_id, content: tm.content }],
      })
      i++
      continue
    }

    i++
  }

  return {
    system: systemParts.join('\n\n').trim(),
    anthropicMessages: out,
  }
}

function mapStopReason(reason: Message['stop_reason']): string | undefined {
  if (reason === null || reason === undefined) return undefined
  if (reason === 'tool_use') return 'tool_calls'
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop'
  return reason
}

export function anthropicMessageToChatCompletion(msg: Message): ChatCompletionResponse {
  const toolCalls: ToolCall[] = []
  const textParts: string[] = []
  for (const block of msg.content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      })
    }
  }
  const joined = textParts.join('')
  const content = joined.trim() ? joined : null

  return {
    id: msg.id,
    model: msg.model,
    choices: [
      {
        message: {
          role: 'assistant',
          content,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: mapStopReason(msg.stop_reason),
      },
    ],
    usage: msg.usage
      ? {
          prompt_tokens: msg.usage.input_tokens,
          completion_tokens: msg.usage.output_tokens,
          total_tokens: (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0),
        }
      : undefined,
  }
}

function createAnthropicClient(apiKey: string, baseUrl: string | undefined): Anthropic {
  const trimmed = baseUrl?.trim()
  return new Anthropic({
    apiKey,
    baseURL: trimmed ? trimmed.replace(/\/$/, '') : undefined,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
  })
}

export async function anthropicChatCompletionWithTools(
  model: string,
  apiKey: string,
  baseUrlFromSettings: string | undefined,
  messages: ChatMessage[],
  tools: ToolUnion[],
  signal: AbortSignal | undefined,
  requestTimeoutMs: number
): Promise<ChatCompletionResponse> {
  const { system, anthropicMessages } = openAiMessagesToAnthropic(messages)
  const client = createAnthropicClient(apiKey, baseUrlFromSettings)

  const body: MessageCreateParamsNonStreaming = {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    system: system || undefined,
    messages: anthropicMessages,
    temperature: 0.3,
    ...(tools.length > 0
      ? {
          tools,
          tool_choice: { type: 'auto' },
        }
      : {}),
  }

  const msg = await client.messages.create(body, {
    signal,
    timeout: requestTimeoutMs,
  })
  return anthropicMessageToChatCompletion(msg)
}

export async function anthropicStreamChatCompletionText(
  model: string,
  apiKey: string,
  baseUrlFromSettings: string | undefined,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  onDelta: (accumulated: string) => void,
  requestTimeoutMs: number
): Promise<string> {
  const { system, anthropicMessages } = openAiMessagesToAnthropic(messages)
  const client = createAnthropicClient(apiKey, baseUrlFromSettings)

  const stream = client.messages.stream(
    {
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: system || undefined,
      messages: anthropicMessages,
      temperature: 0.3,
    },
    { signal, timeout: requestTimeoutMs }
  )

  let accumulated = ''
  stream.on('text', (delta) => {
    accumulated += delta
    onDelta(accumulated)
  })

  await stream.finalText()
  if (!accumulated.trim()) {
    throw new Error('Planning stream returned empty assistant content')
  }
  return accumulated
}

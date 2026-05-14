/**
 * OpenAI Responses API (`/v1/responses`) — request/response adapters to Orca’s `ChatCompletionResponse`.
 * Reference: Pi `openai-responses-shared.ts` (payload semantics); OpenAI API reference for Responses.
 */

import type { ChatCompletionResponse, ChatMessage, ToolCall } from './types'

/** Build Responses API `input` from chat messages (minimal text + tool parity). */
export function chatMessagesToResponsesInput(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: [{ type: 'input_text', text: m.content }] })
      continue
    }
    if (m.role === 'user') {
      const c =
        typeof m.content === 'string'
          ? m.content
          : JSON.stringify(m.content)
      out.push({ role: 'user', content: [{ type: 'input_text', text: c }] })
      continue
    }
    if (m.role === 'assistant') {
      const text =
        m.content != null && typeof m.content === 'string' ? m.content : ''
      const contentParts: unknown[] = []
      if (text.trim()) {
        contentParts.push({ type: 'output_text', text })
      } else if (m.tool_calls?.length) {
        // Assistant `content` may only include output_text (etc.), not function_call — use empty text when the turn was tool-only.
        contentParts.push({ type: 'output_text', text: '' })
      }
      if (contentParts.length > 0) {
        out.push({ role: 'assistant', content: contentParts })
      }
      // Function calls are top-level input items, not message content blocks (OpenAI Codex / Responses API).
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          out.push({
            type: 'function_call',
            name: tc.function.name,
            arguments: tc.function.arguments,
            call_id: tc.id,
          })
        }
      }
      continue
    }
    if (m.role === 'tool') {
      out.push({
        type: 'function_call_output',
        call_id: m.tool_call_id,
        output: m.content,
      })
    }
  }
  return out
}

function openAiStyleToolsToResponses(tools: unknown[]): unknown[] {
  const list: unknown[] = []
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue
    const o = t as Record<string, unknown>
    if (o.type === 'function' && o.function && typeof o.function === 'object') {
      const fn = o.function as Record<string, unknown>
      list.push({
        type: 'function',
        name: String(fn.name ?? ''),
        description: fn.description,
        parameters: fn.parameters,
      })
    }
  }
  return list
}

export function buildResponsesRequestBody(params: {
  model: string
  messages: ChatMessage[]
  tools: unknown[]
  temperature?: number
}): Record<string, unknown> {
  const input = chatMessagesToResponsesInput(params.messages)
  const body: Record<string, unknown> = {
    model: params.model,
    input,
    stream: false,
  }
  if (params.temperature !== undefined) body.temperature = params.temperature
  if (params.tools.length > 0) {
    body.tools = openAiStyleToolsToResponses(params.tools)
    body.tool_choice = 'auto'
  }
  return body
}

/**
 * Best-effort map Responses API JSON to chat/completions-shaped `ChatCompletionResponse`.
 */
export function responsesApiJsonToChatCompletion(raw: unknown): ChatCompletionResponse {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const output = obj.output
  let text = ''
  const toolCalls: ToolCall[] = []
  const completedToolCallIds = new Set<string>()

  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      const typ = String(it.type ?? '')
      if (typ !== 'function_call_output') continue
      const callIdRaw = it.call_id
      if (typeof callIdRaw === 'string' && callIdRaw.trim()) {
        completedToolCallIds.add(callIdRaw.trim())
      }
    }

    for (const item of output) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      const typ = String(it.type ?? '')
      if (typ === 'message') {
        const content = it.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== 'object') continue
            const b = block as Record<string, unknown>
            if (b.type === 'output_text' && typeof b.text === 'string') text += b.text
            if (b.type === 'text' && typeof b.text === 'string') text += b.text
          }
        }
      }
      if (typ === 'function_call' || it.name) {
        const id = String(it.call_id ?? it.id ?? `call_${toolCalls.length}`)
        const callId = id.trim()
        if (callId && completedToolCallIds.has(callId)) continue
        const name = String(it.name ?? '')
        const args = typeof it.arguments === 'string' ? it.arguments : JSON.stringify(it.arguments ?? {})
        if (name) {
          toolCalls.push({
            id,
            type: 'function',
            function: { name, arguments: args },
          })
        }
      }
    }
  }
  const usage = obj.usage && typeof obj.usage === 'object' ? (obj.usage as Record<string, unknown>) : undefined
  const inTok = typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined
  const outTok = typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined

  return {
    id: typeof obj.id === 'string' ? obj.id : undefined,
    model: typeof obj.model === 'string' ? obj.model : undefined,
    choices: [
      {
        message: {
          role: 'assistant',
          content: text || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
      },
    ],
    usage:
      inTok !== undefined || outTok !== undefined
        ? {
            prompt_tokens: inTok,
            completion_tokens: outTok,
            total_tokens:
              inTok !== undefined && outTok !== undefined ? inTok + outTok : undefined,
          }
        : undefined,
  }
}

export function responsesEndpointForOpenAiBase(root: string): string {
  const r = root.replace(/\/$/, '')
  if (/\/v1$/i.test(r)) return `${r}/responses`
  return `${r}/v1/responses`
}

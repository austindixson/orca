import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildResponsesRequestBody,
  chatMessagesToResponsesInput,
  responsesApiJsonToChatCompletion,
  responsesEndpointForOpenAiBase,
} from './openaiResponsesAdapter'
import {
  accumulateOpenAiCodexStreamText,
  buildOpenAiCodexResponsesBody,
  chatMessagesToCodexInput,
  extractOpenAiCodexDeltaText,
  pickCodexStreamCompletionResult,
} from './chatCompletion'
import type { ChatMessage } from './types'

describe('openaiResponsesAdapter', () => {
  it('chatMessagesToResponsesInput puts function_call items at input top level, not inside assistant content', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: 'Calling tool',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
    ]
    const input = chatMessagesToResponsesInput(messages) as Record<string, unknown>[]
    const asst = input.find((x) => x && (x as { role?: string }).role === 'assistant') as {
      role: string
      content: { type: string }[]
    }
    assert.ok(asst?.content?.every((p) => p.type === 'output_text'))
    const fc = input.filter((x) => x && (x as { type?: string }).type === 'function_call')
    assert.equal(fc.length, 1)
    assert.equal((fc[0] as { name: string }).name, 'read_file')
  })

  it('buildResponsesRequestBody includes model, input, and tools', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ]
    const body = buildResponsesRequestBody({
      model: 'gpt-4.1',
      messages,
      tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }],
      temperature: 0.3,
    })
    assert.equal(body.model, 'gpt-4.1')
    assert.equal(body.stream, false)
    assert.equal(body.temperature, 0.3)
    assert.ok(Array.isArray(body.input))
    assert.equal(body.tool_choice, 'auto')
    assert.ok(Array.isArray(body.tools))
  })

  it('responsesApiJsonToChatCompletion maps text message output', () => {
    const raw = {
      id: 'resp_1',
      model: 'gpt-4.1',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello' }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    }
    const cc = responsesApiJsonToChatCompletion(raw)
    assert.equal(cc.choices?.[0]?.message?.content, 'Hello')
    assert.equal(cc.choices?.[0]?.finish_reason, 'stop')
    assert.equal(cc.usage?.prompt_tokens, 10)
    assert.equal(cc.usage?.completion_tokens, 5)
  })

  it('pickCodexStreamCompletionResult returns tool_calls when assistant text is empty', () => {
    const raw = {
      output: [
        {
          type: 'function_call',
          call_id: 'call_abc',
          name: 'read_file',
          arguments: '{"path":"a.ts"}',
        },
      ],
    }
    const cc = pickCodexStreamCompletionResult({
      latestResponseObj: raw,
      accumulated: '',
      bestWithTools: null,
    })
    const tc = cc.choices?.[0]?.message?.tool_calls
    assert.ok(tc && tc.length === 1)
    assert.equal(tc![0].function.name, 'read_file')
    assert.equal(cc.choices?.[0]?.finish_reason, 'tool_calls')
  })

  it('pickCodexStreamCompletionResult falls back to bestWithTools when the last SSE object has no tool output', () => {
    const best = responsesApiJsonToChatCompletion({
      output: [
        {
          type: 'function_call',
          call_id: 'call_keep',
          name: 'list_directory',
          arguments: '{"path":"."}',
        },
      ],
    })
    const lastEvent = { type: 'response.completed', output: [] as unknown[] }
    const cc = pickCodexStreamCompletionResult({
      latestResponseObj: lastEvent,
      accumulated: '',
      bestWithTools: best,
    })
    assert.equal(cc.choices?.[0]?.message?.tool_calls?.[0]?.function?.name, 'list_directory')
    assert.equal(cc.choices?.[0]?.finish_reason, 'tool_calls')
  })

  it('responsesApiJsonToChatCompletion maps function_call items', () => {
    const raw = {
      output: [
        {
          type: 'function_call',
          call_id: 'call_abc',
          name: 'read_file',
          arguments: '{"path":"a.ts"}',
        },
      ],
    }
    const cc = responsesApiJsonToChatCompletion(raw)
    const tc = cc.choices?.[0]?.message?.tool_calls
    assert.ok(tc && tc.length === 1)
    assert.equal(tc![0].function.name, 'read_file')
    assert.equal(tc![0].id, 'call_abc')
    assert.equal(cc.choices?.[0]?.finish_reason, 'tool_calls')
  })

  it('responsesApiJsonToChatCompletion does not replay completed tool calls from response.completed snapshots', () => {
    const raw = {
      output: [
        {
          type: 'function_call',
          call_id: 'call_old_1',
          name: 'search_files',
          arguments: '{"pattern":"orca*"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_old_1',
          output: '{"total_count": 20}',
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Done — waiting for approval.' }],
        },
      ],
    }
    const cc = responsesApiJsonToChatCompletion(raw)
    assert.equal(cc.choices?.[0]?.message?.content, 'Done — waiting for approval.')
    assert.equal(cc.choices?.[0]?.finish_reason, 'stop')
    assert.equal(cc.choices?.[0]?.message?.tool_calls, undefined)
  })

  it('responsesEndpointForOpenAiBase appends /v1/responses', () => {
    assert.equal(responsesEndpointForOpenAiBase('https://api.openai.com/v1'), 'https://api.openai.com/v1/responses')
    assert.equal(
      responsesEndpointForOpenAiBase('https://example.com'),
      'https://example.com/v1/responses'
    )
  })

  it('chatMessagesToCodexInput keeps prior tool rounds as text-only transcript items', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Continue.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'spawn_sub_agent', arguments: '{"task":"investigate"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"tile_id":"abc"}' },
    ]
    const input = chatMessagesToCodexInput(messages) as Array<Record<string, unknown>>
    assert.equal(input.some((item) => item.type === 'function_call'), false)
    assert.equal(input.some((item) => item.type === 'function_call_output'), false)
    const assistantTurn = input.find((item) => item.role === 'assistant')
    assert.ok(assistantTurn)
    const assistantContent = (assistantTurn?.content ?? []) as Array<Record<string, unknown>>
    assert.equal(assistantContent.every((part) => part.type === 'output_text'), true)
    const toolTurn = input.find(
      (item) =>
        item.role === 'user' &&
        Array.isArray(item.content) &&
        String((item.content as Array<Record<string, unknown>>)[0]?.text ?? '').includes('[Tool result for call_1]')
    )
    assert.ok(toolTurn)
  })

  it('accumulateOpenAiCodexStreamText does not duplicate text on output_item.done snapshot', () => {
    // Regression: an earlier version appended the full-message snapshot in
    // `response.output_item.done` onto the already-accumulated `output_text.delta`
    // stream, producing logs like "Hi! How can I help?Hi! How can I help?".
    const full = 'Hi! How can I help?'
    const parts = ['Hi', '!', ' How', ' can', ' I', ' help', '?']
    const events: unknown[] = [
      { type: 'response.created' },
      { type: 'response.in_progress' },
      { type: 'response.output_item.added' },
      { type: 'response.content_part.added' },
      ...parts.map((text) => ({ type: 'response.output_text.delta', delta: { text } })),
      { type: 'response.output_text.done', text: full },
      { type: 'response.content_part.done' },
      {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: full }],
        },
      },
      // `store: false` puts the final shape under `response`, with an empty
      // top-level `output: []` array — must not clobber `accumulated`.
      { type: 'response.completed', response: { output: [] } },
    ]
    assert.equal(accumulateOpenAiCodexStreamText(events), full)
  })

  it('extractOpenAiCodexDeltaText returns the full text for output_item.done, not a delta', () => {
    const snapshot = extractOpenAiCodexDeltaText({
      type: 'response.output_item.done',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hey. What should I work on?' }],
      },
    })
    assert.equal(snapshot, 'Hey. What should I work on?')
  })

  it('buildOpenAiCodexResponsesBody avoids unsupported function_call input items', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Continue.' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"README.md"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'README contents' },
    ]
    const body = buildOpenAiCodexResponsesBody('gpt-5.2', messages, [{ type: 'function', function: { name: 'read_file' } }], 'sess', true)
    const input = (body.input ?? []) as Array<Record<string, unknown>>
    assert.equal(input.some((item) => item.type === 'function_call'), false)
    assert.equal(input.some((item) => item.type === 'function_call_output'), false)
    assert.equal(body.stream, true)
  })
})

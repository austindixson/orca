import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatCompletionAssistantNativeEmpty } from './chatCompletion'
import type { ChatCompletionResponse } from './types'

function choice(
  content: string,
  toolCalls?: ChatCompletionResponse['choices'][number]['message']['tool_calls']
): ChatCompletionResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
          ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: 'stop',
      },
    ],
  } as ChatCompletionResponse
}

test('chatCompletionAssistantNativeEmpty is true when no tools and blank text', () => {
  assert.equal(chatCompletionAssistantNativeEmpty(choice('  \n')), true)
})

test('chatCompletionAssistantNativeEmpty is false when tool_calls present', () => {
  const res = choice('', [
    {
      id: '1',
      type: 'function',
      function: { name: 'read_file', arguments: '{}' },
    },
  ])
  assert.equal(chatCompletionAssistantNativeEmpty(res), false)
})

test('chatCompletionAssistantNativeEmpty is false with non-empty stripped text', () => {
  assert.equal(chatCompletionAssistantNativeEmpty(choice('Hello')), false)
})

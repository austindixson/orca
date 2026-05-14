/**
 * Completion adapters — map **non–Chat Completions** provider responses into Orca’s
 * `ChatCompletionResponse` shape (always includes a `choices` array with at least one entry).
 *
 * The OpenAI **`/v1/chat/completions`** path does not need a mapper: the HTTP body is already
 * that shape (when the provider honors the contract).
 *
 * | Source | Adapter | Module |
 * |--------|---------|--------|
 * | OpenAI **Responses** API (`/v1/responses`) | `responsesApiJsonToChatCompletion` | `./openaiResponsesAdapter` |
 * | **Anthropic** Messages API (SDK) | `anthropicMessageToChatCompletion` | `./anthropicChat` |
 *
 * Bedrock and Hermes paths use their own helpers; streaming/planning code may call
 * `responsesApiJsonToChatCompletion` on parsed JSON where applicable.
 */

export { responsesApiJsonToChatCompletion } from './openaiResponsesAdapter'
export { anthropicMessageToChatCompletion } from './anthropicChat'

# Orchestrator completion adapters

Orca’s orchestrator expects an OpenAI-style **`ChatCompletionResponse`**: an object with a **`choices`** array whose first element carries the assistant **`message`** (and optional **`tool_calls`**).

## When no adapter is needed

Calls to **`/v1/chat/completions`** (and compatible proxies such as OpenRouter) should return JSON that already matches that shape. The client parses the body and passes it to `runOrchestrator`, which reads `choices[0]`.

If the server returns HTTP **200** with **`{ "error": ... }`** and no `choices`, that is handled in **`chatCompletionBodyGuards.ts`** so you get an explicit provider-error message instead of a generic “missing choices” failure later.

## When adapters are required

These APIs **do not** use the Chat Completions JSON shape. Orca maps their **real** model output into `ChatCompletionResponse`:

| API | Build `choices` from | Implementation |
|-----|----------------------|----------------|
| **OpenAI Responses API** (`/v1/responses`) | `output` items (messages, `function_call`, etc.) | [`packages/client/src/lib/orchestrator/openaiResponsesAdapter.ts`](../packages/client/src/lib/orchestrator/openaiResponsesAdapter.ts) — `responsesApiJsonToChatCompletion` |
| **Anthropic Messages** | `Message` content blocks (`text`, `tool_use`) | [`packages/client/src/lib/orchestrator/anthropicChat.ts`](../packages/client/src/lib/orchestrator/anthropicChat.ts) — `anthropicMessageToChatCompletion` |

Discoverability exports: [`packages/client/src/lib/orchestrator/completionAdapters.ts`](../packages/client/src/lib/orchestrator/completionAdapters.ts).

This mapping is **not** inventing assistant text: it copies the provider’s structured reply into the single shape the rest of the pipeline (`pickAssistantChoiceOrThrow`, tool execution, etc.) already understands.

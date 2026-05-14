/**
 * Reference: [Pi Mono `packages/ai/src/providers`](https://github.com/badlogic/pi-mono/tree/main/packages/ai/src/providers)
 * and [`register-builtins.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/providers/register-builtins.ts).
 *
 * Orca’s built-in orchestrator maps each Pi streaming `api` id to an Orca `Provider` plus an internal
 * transport (how HTTP/SDK is performed). See `PI_BUILTIN_STREAMING_PARITY` below.
 */

import { type Provider, tauriCredentialKeyForProvider } from '../store/settingsStore'

/** Re-export for `llmCredentials` / Tauri invoke. */
export const providerToTauriCredentialId = tauriCredentialKeyForProvider

/** How Orca fulfills a Pi-style provider (internal — not persisted). */
export type OrcaLlmTransport =
  | 'anthropic-sdk'
  | 'openai-chat'
  | 'openai-responses'
  | 'mistral-chat'
  | 'azure-openai-chat'
  | 'azure-openai-responses'
  | 'github-copilot-chat'
  | 'google-gemini-openai'
  | 'google-vertex-openai'
  | 'bedrock-converse'
  | 'ollama-chat'
  | 'llamacpp-chat'
  | 'openrouter-chat'
  | 'zai-chat'

/** Pi `registerBuiltInApiProviders()` — `api` field on streaming providers. */
export const PI_BUILTIN_STREAMING_API_IDS = [
  'anthropic-messages',
  'openai-completions',
  'mistral-conversations',
  'openai-responses',
  'azure-openai-responses',
  'openai-codex-responses',
  'google-generative-ai',
  'google-gemini-cli',
  'google-vertex',
  'bedrock-converse-stream',
] as const

export type PiBuiltinStreamingApiId = (typeof PI_BUILTIN_STREAMING_API_IDS)[number]

/**
 * Parity map: Pi `api` id → Orca `Provider` + transport used by the built-in orchestrator.
 * `openai-codex-responses` maps to Orca’s dedicated `openaiCodex` transport hitting the ChatGPT Codex backend.
 */
export const PI_BUILTIN_STREAMING_PARITY: Record<
  PiBuiltinStreamingApiId,
  { orcaProvider: Provider; transport: OrcaLlmTransport; notes?: string }
> = {
  'anthropic-messages': { orcaProvider: 'anthropic', transport: 'anthropic-sdk' },
  'openai-completions': { orcaProvider: 'openai', transport: 'openai-chat' },
  'mistral-conversations': { orcaProvider: 'mistral', transport: 'mistral-chat' },
  'openai-responses': { orcaProvider: 'openai', transport: 'openai-responses' },
  'azure-openai-responses': { orcaProvider: 'azureOpenai', transport: 'azure-openai-responses' },
  'openai-codex-responses': {
    orcaProvider: 'openaiCodex',
    transport: 'openai-responses',
    notes: 'Codex OAuth token via Pi auth routed to the ChatGPT Codex backend.',
  },
  'google-generative-ai': { orcaProvider: 'google', transport: 'google-gemini-openai' },
  'google-gemini-cli': {
    orcaProvider: 'google',
    transport: 'google-gemini-openai',
    notes: 'Gemini CLI OAuth populates auth; HTTP uses Gemini OpenAI-compatible surface.',
  },
  'google-vertex': { orcaProvider: 'googleVertex', transport: 'google-vertex-openai' },
  'bedrock-converse-stream': { orcaProvider: 'bedrock', transport: 'bedrock-converse' },
}

/**
 * Pi [`utils/oauth/index.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/oauth/index.ts)
 * built-in OAuth provider ids.
 */
export const PI_OAUTH_PROVIDER_IDS = [
  'anthropic',
  'github-copilot',
  'google-gemini-cli',
  'google-antigravity',
  'openai-codex',
] as const

export type PiOauthProviderId = (typeof PI_OAUTH_PROVIDER_IDS)[number]

/**
 * Top-level keys Orca’s Tauri layer reads in `~/.pi/agent/auth.json` (see `src-tauri/src/pi_oauth.rs`).
 * Pi also stores `openai` (API key) and `google` (API key) alongside OAuth entries.
 */
export const PI_AUTH_JSON_TOP_LEVEL_KEYS = [
  'anthropic',
  'openai',
  'openai-codex',
  'github-copilot',
  'google',
  'google-gemini-cli',
  'google-antigravity',
] as const

/** Pi `env-api-keys.ts` env var for `google` when not using OAuth-only flows. */
export const PI_GOOGLE_ENV_PRIMARY = 'GEMINI_API_KEY' as const

/** Pi coding-agent doc: subscription OAuth via interactive `/login` (Claude, Codex, Copilot, Google). */
export const PI_DOCS_URL_OAUTH_SUBSCRIPTIONS =
  'https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#subscriptions' as const

/** Pi doc section for Google Gemini CLI & Antigravity (Google account OAuth). */
export const PI_DOCS_URL_GOOGLE_OAUTH =
  'https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#google-providers' as const

/** Pi extension docs: custom `oauth` on `registerProvider` (enterprise / SSO patterns). */
export const PI_DOCS_URL_CUSTOM_PROVIDER_OAUTH =
  'https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md#oauth-support' as const

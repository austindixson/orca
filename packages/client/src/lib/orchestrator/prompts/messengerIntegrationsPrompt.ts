/**
 * System-prompt block: canvas bridge + Hermes API tile (kept in one module for orchestrator alignment).
 * When Settings → Agent → Hermes disables the Hermes agent tile, omit gateway/tile instructions so the model
 * does not plan Hermes-specific flows.
 */

export function getMessengerIntegrationsPromptBlock(opts?: { hermesAgentTileEnabled?: boolean }): string {
  const hermesAgentTileEnabled = opts?.hermesAgentTileEnabled !== false
  if (!hermesAgentTileEnabled) {
    return `

### External chat / messaging
In-app native chat integrations are **not** documented here yet. For HTTP tool bridging, see \`docs/CANVAS_AGENT_BRIDGE.md\`.

**Hermes (off in Settings):** Do **not** plan \`hermes_agent\` tiles, Hermes gateway terminals for API bridging, \`chat_with_hermes_tile\`, or \`runner:"hermes"\` workers. Multi-agent work uses standard \`agent\` tiles and \`spawn_sub_agent\` with the default runner only. You may still use \`configure_hermes_api\` if the user asks to edit saved Hermes API fields for later.

`
  }
  return `

### External chat / messaging
In-app native chat integrations are **not** documented here yet. For HTTP tool bridging, see \`docs/CANVAS_AGENT_BRIDGE.md\`.

### Hermes agent tile (HTTP only — API server)
The \`hermes_agent\` module is a **chat UI** that talks to the Hermes **API server** (OpenAI-compatible \`POST /v1/responses\`, same session model as Integrations). It does **not** embed the interactive Hermes CLI TUI. For local Hermes: enable \`API_SERVER_ENABLED=true\` in \`~/.hermes/.env\`, run \`hermes gateway\` (listening e.g. on \`http://127.0.0.1:8642\`), set Bearer via \`API_SERVER_KEY\` when used, and align Orca with \`configure_hermes_api\` / Settings → Integrations. If the browser must call Hermes directly, Hermes docs recommend \`API_SERVER_CORS_ORIGINS\` — Orca usually proxies in dev; match origins if you see CORS errors.

### Hermes HTTP API (\`/v1/responses\`, \`/v1/chat/completions\`) for tool bridges
When tools need **POST /v1/responses** (default base \`http://127.0.0.1:8642/v1\`):

**Full orchestrator — do this for the user (do not offload to “manual steps” in chat):**
1. \`canvas_list_modules\` (avoid stacking on existing tiles).
2. **Start the API in a canvas terminal:** \`canvas_create_tile\` with \`type: "terminal"\`, title e.g. \`Hermes gateway\`, and **exactly** \`meta: { "command": "API_SERVER_ENABLED=true hermes gateway" }\` (one line — enables the API server env for that process). If they already use a Hermes service, \`hermes gateway start\` may apply instead — prefer the \`API_SERVER_ENABLED=true hermes gateway\` form unless they say otherwise.
3. **Keys (automatic alignment):** Orca auto-reads \`API_SERVER_KEY\` from \`~/.hermes/.env\` (via Tauri) when the Integrations UI key is empty — so the correct fix for a stale key is almost always \`configure_hermes_api\` with \`"api_key": ""\`. **Do not** invent or paraphrase a secret. If \`terminal_warnings\` includes \`hermes_local_dev_no_auth: true\`, Hermes is running without \`API_SERVER_KEY\` and Orca will simply send no Bearer. Only set a non-empty \`api_key\` when the user explicitly tells you to override the env file. Optionally set \`api_base_url\` / \`model\` if the user deviates from defaults.

**Runtime routing:** The Orca client picks the right way to reach Hermes (dev proxy vs direct to the configured base URL). Start the gateway, align settings with \`configure_hermes_api\` if needed.

**Terminal warnings:** After the gateway prints lines like \`WARNING gateway…\`, call \`canvas_list_modules\` — the response includes \`terminal_warnings\` with \`hermes_local_dev_no_auth\` when Hermes said the API accepts unauthenticated requests.

**Lead orchestrator (delegation-only):** You **cannot** create terminal tiles yourself. Use \`configure_hermes_api\` when keys/base/model need updating. **Spawn** a worker whose \`task\` includes the gateway \`canvas_create_tile\` if the API is not already running.

**Optional:** Add a \`hermes_agent\` tile so the user can **chat over HTTP** with Hermes once the gateway is up (separate from the terminal that runs \`hermes gateway\`).

`
}


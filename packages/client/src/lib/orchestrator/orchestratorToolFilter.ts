import { ORCHESTRATOR_TOOLS_OPENAI } from './toolDefinitions'

/**
 * Main (lead) orchestrator when **delegation-only** mode is on: coordinate the canvas and
 * assign work via `spawn_sub_agent` only — no direct file or execution tools.
 */
export const LEAD_ORCHESTRATOR_TOOL_ALLOWLIST: readonly string[] = [
  'canvas_create_tile',
  'canvas_list_modules',
  'canvas_update_tile',
  'configure_hermes_api',
  'diagnose_hermes_setup',
  'list_merge_review_tickets',
  'open_workspace',
  'read_terminal_output',
  'get_last_terminal_command',
  'wait_for_terminal_command',
  'session_search',
  'recall_session_history',
  'memory',
  'spawn_sub_agent',
  'chat_with_hermes_tile',
]

export function filterOrchestratorToolsByAllowlist(
  allowlist: string[] | null | undefined
): typeof ORCHESTRATOR_TOOLS_OPENAI {
  // null/undefined = no restriction (all tools)
  if (allowlist == null) return ORCHESTRATOR_TOOLS_OPENAI
  // empty array = no tools allowed (e.g. trivial runs)
  if (allowlist.length === 0) return []
  const set = new Set(allowlist)
  return ORCHESTRATOR_TOOLS_OPENAI.filter((t) => set.has(t.function.name))
}

/**
 * When `showHermesAgentTile` is false (Settings → Agent → Hermes), the orchestrator must not
 * offer `chat_with_hermes_tile` or `hermes_agent` in `canvas_create_tile` — matches manual add-tile menus.
 */
export function filterOrchestratorToolsForHermesAgentTileSetting(
  tools: typeof ORCHESTRATOR_TOOLS_OPENAI,
  showHermesAgentTile: boolean
): typeof ORCHESTRATOR_TOOLS_OPENAI {
  if (showHermesAgentTile) return tools
  const withoutChat = tools.filter((t) => t.function.name !== 'chat_with_hermes_tile')
  return withoutChat.map((t) => {
    if (t.function.name !== 'canvas_create_tile') return t
    const clone = structuredClone(t) as (typeof ORCHESTRATOR_TOOLS_OPENAI)[number]
    const params = clone.function.parameters as {
      properties?: { type?: { enum?: string[] } }
    }
    const en = params.properties?.type?.enum
    if (Array.isArray(en)) {
      params.properties!.type!.enum = en.filter((x) => x !== 'hermes_agent')
    }
    return clone
  }) as typeof ORCHESTRATOR_TOOLS_OPENAI
}

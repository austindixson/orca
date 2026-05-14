/**
 * Headless orchestrator: OpenAI-compatible chat + canvas tools via HTTP,
 * with local execution for workspace file tools when canvas:invoke arrives on WS.
 */

import OpenAI from 'openai'
import type { HarnessConfig } from './config.js'

const UI_ONLY_TOOLS = new Set([
  'canvas_list_modules',
  'canvas_create_tile',
  'canvas_update_tile',
  'read_terminal_output',
  'open_workspace',
  'create_project_skill',
  'record_benchmark_session',
  'spawn_sub_agent',
  'web_search',
])

export async function runGatewayTurn(
  cfg: HarnessConfig,
  userText: string,
  executeCanvasInvoke: (tool: string, args: unknown) => Promise<string>
): Promise<string> {
  if (!cfg.openAiApiKey) {
    return 'Orca headless: set OPENAI_API_KEY or OPENROUTER_API_KEY (or [llm] in ~/.orca/config.toml).'
  }

  const client = new OpenAI({
    apiKey: cfg.openAiApiKey,
    baseURL: cfg.openAiBaseUrl,
  })

  const toolsRes = await fetch(`${cfg.baseUrl}/api/canvas/tools`, {
    headers: authHeaders(cfg),
  })
  if (!toolsRes.ok) {
    return `Failed to load tools: HTTP ${toolsRes.status}`
  }
  const manifest = (await toolsRes.json()) as { tools?: unknown[] }
  const tools = (manifest.tools ?? []) as OpenAI.Chat.Completions.ChatCompletionTool[]

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        'You are the Orca Coder orchestrator running headless (no desktop UI). ' +
        'For canvas/tile tools, reply that the user should open the Orca app. ' +
        'Prefer read_file, write_file, list_directory, delete_file for workspace work.',
    },
    { role: 'user', content: userText },
  ]

  const maxIter = 12
  for (let i = 0; i < maxIter; i++) {
    const completion = await client.chat.completions.create({
      model: cfg.model,
      messages,
      tools,
      tool_choice: 'auto',
    })

    const choice = completion.choices[0]
    const msg = choice?.message
    if (!msg) return 'No assistant message from model.'

    if (!msg.tool_calls?.length) {
      return msg.content?.trim() || '(empty reply)'
    }

    messages.push(msg)

    for (const tc of msg.tool_calls) {
      if (tc.type !== 'function') continue
      const name = tc.function.name
      let args: unknown = {}
      try {
        args = JSON.parse(tc.function.arguments || '{}')
      } catch {
        args = {}
      }

      if (UI_ONLY_TOOLS.has(name)) {
        const text = JSON.stringify({
          ok: false,
          error:
            'This tool requires the Orca desktop UI (canvas/tiles). Open Orca on this machine, or use file/workspace tools only.',
        })
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: text,
        })
        continue
      }

      const result = await executeCanvasInvoke(name, args)
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }
  }

  return 'Orca headless: max tool iterations reached.'
}

function authHeaders(cfg: HarnessConfig): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (cfg.bridgeToken) {
    h.Authorization = `Bearer ${cfg.bridgeToken}`
  }
  return h
}

/** Called from WebSocket `canvas:invoke` — must NOT POST /api/canvas/execute (would recurse). */
export async function executeCanvasInvokeLocal(
  cfg: HarnessConfig,
  tool: string,
  args: unknown
): Promise<string> {
  const a = args as Record<string, unknown>

  if (tool === 'read_file' && typeof a.path === 'string') {
    const r = await fetch(
      `${cfg.baseUrl}/api/file?path=${encodeURIComponent(a.path)}`,
      { headers: authHeaders(cfg) }
    )
    const j = await r.json().catch(() => ({}))
    return JSON.stringify(j)
  }
  if (tool === 'write_file' && typeof a.path === 'string' && typeof a.content === 'string') {
    const r = await fetch(`${cfg.baseUrl}/api/file`, {
      method: 'POST',
      headers: { ...authHeaders(cfg), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: a.path, content: a.content }),
    })
    const j = await r.json().catch(() => ({}))
    return JSON.stringify(j)
  }
  if (tool === 'delete_file' && typeof a.path === 'string') {
    const r = await fetch(
      `${cfg.baseUrl}/api/file?path=${encodeURIComponent(a.path)}`,
      { method: 'DELETE', headers: authHeaders(cfg) }
    )
    const j = await r.json().catch(() => ({}))
    return JSON.stringify(j)
  }
  if (tool === 'list_directory') {
    const p = typeof a.path === 'string' ? a.path : '.'
    const r = await fetch(
      `${cfg.baseUrl}/api/files?path=${encodeURIComponent(p)}`,
      { headers: authHeaders(cfg) }
    )
    const j = await r.json().catch(() => ({}))
    return JSON.stringify(j)
  }

  return JSON.stringify({
    ok: false,
    error:
      'This tool needs the Orca desktop UI (canvas). Open Orca on this machine, or use read_file / write_file / list_directory.',
  })
}

/** LLM loop: file tools via Rust HTTP; other tools via POST /api/canvas/execute (broadcasts `canvas:invoke` to this harness). */
export async function executeToolHttp(
  cfg: HarnessConfig,
  tool: string,
  args: unknown
): Promise<string> {
  if (
    tool === 'read_file' ||
    tool === 'write_file' ||
    tool === 'delete_file' ||
    tool === 'list_directory'
  ) {
    return executeCanvasInvokeLocal(cfg, tool, args)
  }

  const r = await fetch(`${cfg.baseUrl}/api/canvas/execute`, {
    method: 'POST',
    headers: { ...authHeaders(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, arguments: args }),
  })
  const j = (await r.json().catch(() => ({}))) as {
    ok?: boolean
    result?: string
    error?: unknown
  }
  if (!r.ok || j.ok === false) {
    return JSON.stringify({ ok: false, error: j.error ?? j })
  }
  if (typeof j.result === 'string') return j.result
  return JSON.stringify(j)
}

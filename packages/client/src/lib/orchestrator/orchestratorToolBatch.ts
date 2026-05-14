import { nanoid } from 'nanoid'
import { filterToolResultForContext } from '../tauri'
import type { ToolCall } from './types'
import { throwIfAborted } from './abortable'
import { executeOrchestratorTool, type OrchestratorToolContext } from './executeTools'
import { useToolboxSessionStore } from '../../store/toolboxSessionStore'
import { useResearchSessionStore } from '../../store/researchSessionStore'
import { ensureToolboxTile } from './ensureToolboxTile'
import { recordResearchFromAssistantToolResult } from './researchAssistantToolHook'
import { emitRefreshResearch } from '../uiEvents'
import { concurrencyClassForTool, MAX_PARALLEL_READ_TOOLS } from '../harness/toolConcurrency'

/**
 * Cap tool JSON returned to the model. Browser dev skips Rust `skinnytools_filter`; huge
 * `list_directory` payloads can stall budget models (e.g. Grok Code Fast on OpenRouter).
 */
const MAX_TOOL_RESULT_CHARS = 14_000

function truncateToolResultForLlm(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content
  const over = content.length - MAX_TOOL_RESULT_CHARS + 100
  const head = content.slice(0, MAX_TOOL_RESULT_CHARS - 100)
  return `${head}\n\n… [truncated ${over} chars for model context — narrow list_directory path or use read_file]`
}

function argsPreview(raw: string): string {
  return raw.length > 120 ? raw.slice(0, 120) + '…' : raw
}

function truncateSnippet(text: string, max = 96): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function parseArgsObject(rawArgs: string): Record<string, unknown> {
  try {
    if (!rawArgs) return {}
    const parsed = JSON.parse(rawArgs)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function formatPathArg(args: Record<string, unknown>): string | null {
  const path = typeof args.path === 'string' ? args.path.trim() : ''
  if (!path) return null
  return `path=${truncateSnippet(path, 88)}`
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms'
  if (ms >= 900) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

export function formatToolTraceStartLine(name: string, rawArgs: string): string {
  const args = parseArgsObject(rawArgs)

  if (name === 'read_file') {
    const details: string[] = []
    const path = formatPathArg(args)
    if (path) details.push(path)
    if (typeof args.offset === 'number') details.push(`offset=${args.offset}`)
    if (typeof args.limit === 'number') details.push(`limit=${args.limit}`)
    return details.length > 0 ? `→ ${name} ${details.join(' ')}` : `→ ${name}`
  }

  if (name === 'search_files') {
    const details: string[] = []
    if (typeof args.target === 'string' && args.target.trim()) details.push(`target=${args.target.trim()}`)
    if (typeof args.pattern === 'string' && args.pattern.trim()) {
      details.push(`pattern=${truncateSnippet(args.pattern, 72)}`)
    }
    const path = formatPathArg(args)
    if (path) details.push(path)
    if (typeof args.file_glob === 'string' && args.file_glob.trim()) {
      details.push(`glob=${truncateSnippet(args.file_glob, 36)}`)
    }
    return details.length > 0 ? `→ ${name} ${details.join(' ')}` : `→ ${name}`
  }

  if (name === 'list_directory') {
    const path = formatPathArg(args)
    return path ? `→ ${name} ${path}` : `→ ${name}`
  }

  if (name === 'run_shell_command' || name === 'terminal') {
    const cmd = typeof args.command === 'string' ? args.command.trim() : ''
    if (cmd) return `→ ${name} $ ${truncateSnippet(cmd, 110)}`
    return `→ ${name}`
  }

  if (name === 'plan') {
    const todos = Array.isArray(args.todos) ? args.todos : []
    const action = typeof args.action === 'string' ? args.action.trim() : 'update'
    if (todos.length > 0) return `→ plan ${action} ${todos.length} task(s)`
    return `→ plan ${action}`
  }

  return `→ ${name}(${argsPreview(rawArgs)})`
}

export function formatToolTraceEndLine(name: string, ok: boolean, elapsedMs: number): string {
  return `← ${name} ${ok ? 'ok' : 'error'} ${formatDurationMs(elapsedMs)}`
}

function parseWebSearchQuery(rawArgs: string): string {
  try {
    const args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
    return String(args.query ?? '').trim()
  } catch {
    return ''
  }
}

const RESULT_PREVIEW_MAX = 360

function summarizeForToolbox(content: string): string {
  const t = content.trim()
  if (t.length <= RESULT_PREVIEW_MAX) return t
  return `${t.slice(0, RESULT_PREVIEW_MAX)}…`
}

/** Best-effort: orchestrator tools return JSON `{ ok: boolean }` on success. */
function parseToolOkForToolbox(content: string): boolean {
  try {
    const j = JSON.parse(content) as { ok?: boolean }
    return j.ok === true
  } catch {
    return false
  }
}

function recordToolboxAfterTool(name: string, rawArgs: string, filteredContent: string): void {
  const ok = parseToolOkForToolbox(filteredContent)
  useToolboxSessionStore.getState().appendToolEvent({
    tool: name,
    argsPreview: argsPreview(rawArgs),
    ok,
    resultPreview: summarizeForToolbox(filteredContent),
  })

  if (name !== 'create_project_skill' || !ok) return
  try {
    const result = JSON.parse(filteredContent) as {
      ok?: boolean
      paths?: string[]
      skill_slug?: string
      slash_command?: string
    }
    if (!Array.isArray(result.paths) || result.paths.length === 0) return
    let ap: Record<string, unknown> = {}
    try {
      ap = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
    } catch {
      /* ignore */
    }
    const slug = String(result.skill_slug ?? ap.skill_slug ?? '').trim() || 'skill'
    const title =
      String(ap.title ?? '')
        .trim()
        .slice(0, 120) ||
      slug
        .split(/[-._]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    const description = String(ap.description ?? '').trim().slice(0, 500)
    const slash =
      typeof result.slash_command === 'string' && result.slash_command
        ? result.slash_command
        : `/${slug}`
    useToolboxSessionStore.getState().appendSkillArtifact({
      skillSlug: slug,
      title,
      description,
      paths: result.paths,
      slashCommand: slash.startsWith('/') ? slash : `/${slash}`,
    })
    ensureToolboxTile()
  } catch {
    /* ignore */
  }
}

function normalizeFsPath(p: string): string {
  const t = p.replace(/\\/g, '/').trim()
  if (!t || t === '.') return '.'
  return t.replace(/\/+$/, '') || '.'
}

/** True when paths are equal or one is a strict ancestor (directory boundary). */
function pathsOverlap(a: string, b: string): boolean {
  const na = normalizeFsPath(a)
  const nb = normalizeFsPath(b)
  if (na === nb) return true
  if (na === '.' || nb === '.') return true
  return na.startsWith(nb + '/') || nb.startsWith(na + '/')
}

type ParsedTool =
  | { kind: 'path_op'; path: string; writes: boolean }
  | { kind: 'open_workspace' }
  | { kind: 'canvas_update'; tileId: string }
  | { kind: 'parallel_safe' }
  | { kind: 'exclusive_tool' }
  | { kind: 'unknown' }

function parseToolForParallelism(tc: ToolCall): ParsedTool | null {
  let args: Record<string, unknown>
  try {
    args = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {}
  } catch {
    return null
  }
  const name = tc.function.name
  switch (name) {
    case 'read_file':
      return { kind: 'path_op', path: String(args.path ?? ''), writes: false }
    case 'list_directory':
      return { kind: 'path_op', path: String(args.path ?? '.'), writes: false }
    case 'web_search':
      return { kind: 'parallel_safe' }
    case 'write_file':
    case 'delete_file':
      return { kind: 'path_op', path: String(args.path ?? ''), writes: true }
    case 'open_workspace':
      return { kind: 'open_workspace' }
    case 'canvas_update_tile':
      return { kind: 'canvas_update', tileId: String(args.tile_id ?? '') }
    default: {
      const cls = concurrencyClassForTool(name)
      if (cls === 'readonly') return { kind: 'parallel_safe' }
      if (cls === 'exclusive') return { kind: 'exclusive_tool' }
      return { kind: 'unknown' }
    }
  }
}

/**
 * Hermes-style `_should_parallelize_tool_batch`: run tools concurrently only when there are no
 * overlapping filesystem writes, workspace switches, or duplicate tile updates.
 */
export function shouldParallelizeToolBatch(toolCalls: ToolCall[]): boolean {
  if (toolCalls.length <= 1) return true

  const parsed: ParsedTool[] = []
  for (const tc of toolCalls) {
    const p = parseToolForParallelism(tc)
    if (p === null) return false
    parsed.push(p)
  }

  if (parsed.some((p) => p.kind === 'unknown')) return false

  const exclusiveIndices = parsed
    .map((p, i) => (p.kind === 'exclusive_tool' ? i : -1))
    .filter((i) => i >= 0)
  if (exclusiveIndices.length > 0) {
    const exclusiveNames = new Set(exclusiveIndices.map((i) => toolCalls[i]!.function.name))
    if (exclusiveNames.size > 1) return false
    const nonExclusiveCount = toolCalls.length - exclusiveIndices.length
    if (nonExclusiveCount > 0) return false
  }

  const openWs = parsed.filter((p) => p.kind === 'open_workspace').length
  if (openWs > 0 && toolCalls.length > 1) return false

  const pathOps = parsed.filter((p): p is ParsedTool & { kind: 'path_op' } => p.kind === 'path_op')
  for (let i = 0; i < pathOps.length; i++) {
    for (let j = i + 1; j < pathOps.length; j++) {
      const a = pathOps[i]
      const b = pathOps[j]
      if (pathsOverlap(a.path, b.path) && (a.writes || b.writes)) return false
    }
  }

  const tileIds = parsed
    .filter((p): p is ParsedTool & { kind: 'canvas_update' } => p.kind === 'canvas_update')
    .map((p) => p.tileId)
  const unique = new Set(tileIds)
  if (tileIds.length !== unique.size) return false

  return true
}

async function mapInChunks<T>(
  items: ToolCall[],
  chunkSize: number,
  fn: (tc: ToolCall) => Promise<T>
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)
    out.push(...(await Promise.all(chunk.map((tc) => fn(tc)))))
  }
  return out
}

/**
 * Hermes-style tool dispatch: one model turn may emit **multiple** tool_calls.
 * Independent tools (e.g. several `read_file`s) run in parallel to reduce wall-clock time.
 * Results are returned in **the same order as `tool_calls`** for the OpenAI message format.
 *
 * @see https://github.com/NousResearch/Hermes-Agent — `model_tools.py` / `handle_function_call` patterns.
 */
export async function executeAssistantToolCalls(
  toolCalls: ToolCall[],
  context: OrchestratorToolContext,
  options: {
    parallel?: boolean
    onLog?: (line: string) => void
    /** When false, skip FS overlap checks (ablation / stress). Default true. */
    respectParallelBatchRules?: boolean
    /**
     * Meta-Harness–style diagnostic hook: raw args + pre-LLM-truncation result (for bounded disk JSONL).
     * Caller should redact; do not use for UI streams.
     */
    onDiagnosticToolTrace?: (info: {
      tool: string
      argsRaw: string
      resultRaw: string
    }) => void
    /** Orchestrator Stop — honored between tool calls in a batch. */
    signal?: AbortSignal
    /** Live batch progress for the orchestrator HUD during long tool rounds. */
    onToolProgress?: (info: {
      completed: number
      total: number
      currentTool?: string
    }) => void
  }
): Promise<Array<{ tool_call_id: string; content: string }>> {
  if (toolCalls.length === 0) return []
  throwIfAborted(options.signal)

  /** Pre-create Research tile rows so the UI can show queued → active → done per `web_search`. */
  const webSearchEntryByCallId = new Map<string, string>()
  let tsCursor = Date.now()
  for (const tc of toolCalls) {
    if (tc.function.name !== 'web_search') continue
    const q = parseWebSearchQuery(tc.function.arguments ?? '{}')
    const id = nanoid()
    webSearchEntryByCallId.set(tc.id, id)
    useResearchSessionStore.getState().appendEntry({
      id,
      kind: 'web_search',
      query: q || '(empty query)',
      ok: false,
      status: 'queued',
      ts: tsCursor++,
      runGeneration: context.runGeneration,
      subAgentTileId: context.subAgentTileId,
    })
  }
  if (webSearchEntryByCallId.size > 0) {
    emitRefreshResearch()
  }

  const parallel = options.parallel !== false
  const respectRules = options.respectParallelBatchRules !== false
  const batchParallel =
    parallel && (respectRules ? shouldParallelizeToolBatch(toolCalls) : true)

  const progress = { completed: 0 }
  const total = toolCalls.length

  const runOneInner = async (tc: ToolCall): Promise<{ tool_call_id: string; content: string }> => {
    throwIfAborted(options.signal)
    const name = tc.function.name
    const args = tc.function.arguments ?? '{}'
    const researchId = name === 'web_search' ? webSearchEntryByCallId.get(tc.id) : undefined
    if (researchId) {
      useResearchSessionStore.getState().patchEntry(researchId, { status: 'active' })
      emitRefreshResearch()
    }
    const startedAt = Date.now()
    options.onLog?.(formatToolTraceStartLine(name, args))
    try {
      const raw = await executeOrchestratorTool(name, args, {
        ...context,
        webSearchResearchEntryId: researchId ?? null,
        signal: options.signal,
        onLog: options.onLog,
      })
      let content = await filterToolResultForContext(raw)
      const rawForTrace = content
      content = truncateToolResultForLlm(content)
      recordToolboxAfterTool(name, args, content)
      recordResearchFromAssistantToolResult(name, args, content, context)
      options.onDiagnosticToolTrace?.({ tool: name, argsRaw: args, resultRaw: rawForTrace })
      options.onLog?.(formatToolTraceEndLine(name, true, Date.now() - startedAt))
      return { tool_call_id: tc.id, content }
    } catch (error) {
      options.onLog?.(formatToolTraceEndLine(name, false, Date.now() - startedAt))
      throw error
    }
  }

  const runOne = async (tc: ToolCall): Promise<{ tool_call_id: string; content: string }> => {
    options.onToolProgress?.({
      completed: progress.completed,
      total,
      currentTool: tc.function.name,
    })
    try {
      const r = await runOneInner(tc)
      progress.completed++
      options.onToolProgress?.({ completed: progress.completed, total, currentTool: undefined })
      return r
    } catch (e) {
      options.onToolProgress?.({ completed: progress.completed, total, currentTool: undefined })
      throw e
    }
  }

  if (!batchParallel || toolCalls.length === 1) {
    if (parallel && toolCalls.length > 1 && !batchParallel) {
      options.onLog?.(`⋯ Sequential tool batch (${toolCalls.length} calls — overlapping paths or shared resources)`)
    }
    const out: Array<{ tool_call_id: string; content: string }> = []
    for (const tc of toolCalls) {
      throwIfAborted(options.signal)
      out.push(await runOne(tc))
    }
    return out
  }

  options.onLog?.(
    `⋯ Parallel tool batch (${toolCalls.length} calls, ≤${MAX_PARALLEL_READ_TOOLS} concurrent)`
  )
  return mapInChunks(toolCalls, MAX_PARALLEL_READ_TOOLS, runOne)
}

/**
 * Status verbs aligned with [claw-code](https://github.com/ultraworkers/claw-code)
 * `rusty-claude-cli`: tool call summaries (`format_tool_call_start`), and
 * {@link CLAW_SPINNER_FRAMES} (see `render.rs` `Spinner`).
 * Generic “thinking” lines use {@link shimmerThinkingPhrase} over {@link SHIMMER_GERUND_COUNT} gerunds.
 */

import { SHIMMER_GERUNDS, SHIMMER_GERUND_COUNT } from './shimmerGerunds'

/** Default HUD line while the orchestrator is running but no tool line has bumped the verb yet. */
export const DEFAULT_PLANNING_VERB = 'Planning next steps…'

/** Shown in the focus banner when the same stable verb has been shown for {@link FALLBACK_LONG_WAIT_MS}. */
export const FALLBACK_LONG_WAIT_VERB = 'This is taking longer than expected…'

export const FALLBACK_LONG_WAIT_MS = 15_000

/**
 * Strip elapsed-time suffixes like ` · 12s` so the long-wait timer does not reset every second
 * during {@link glitterVerbForLlmPending}-style updates.
 */
export function verbStabilityKeyForFocusBanner(verb: string): string {
  // Match ` · 12s` / ` · 12s · …` suffixes from glitterVerbForLlmPending (U+00B7 middle dot).
  return verb.replace(/\s\u00B7\s\d+s[\s\S]*$/, '').trim()
}

function emitDebugLog(
  runId: string,
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  fetch('http://127.0.0.1:7696/ingest/d871edbc-ff39-4d74-96b8-887cea450cfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'eaa681' },
    body: JSON.stringify({
      sessionId: 'eaa681',
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Deterministic gerund + ellipsis (pool from user-provided Orca list).
 * Same seed always yields the same phrase for stable HUD during a phase.
 */
export function shimmerThinkingPhrase(seed: string): string {
  const idx = hashString(seed) % SHIMMER_GERUND_COUNT
  const g = SHIMMER_GERUNDS[idx] ?? 'Thinking'
  return `${g}…`
}

/** Matches `Spinner::FRAMES` in claw-code `render.rs`. */
export const CLAW_SPINNER_FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
] as const

let pendingPhraseIterationState = -1
let pendingPhraseBase = ''

let clarifyPhraseRotation = -1
let clarifyPhraseBase = ''

function truncate(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function basename(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const parts = norm.split('/')
  return parts[parts.length - 1] || norm
}

/** Normalize tool ids across Anthropic / OpenAI / internal names. */
export function normalizeOrchestratorToolName(name: string): string {
  const n = name.trim().toLowerCase().replace(/-/g, '_')
  const map: Record<string, string> = {
    read: 'read_file',
    write: 'write_file',
    edit: 'edit_file',
    glob: 'glob_file_search',
    grep: 'grep',
  }
  return map[n] ?? n
}

function tryParseJsonObjectFromLine(line: string): Record<string, unknown> | null {
  const i = line.indexOf('{')
  if (i === -1) return null
  const tail = line.slice(i)
  try {
    return JSON.parse(tail) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractPathFromJson(parsed: Record<string, unknown>): string | null {
  const raw =
    parsed.file_path ?? parsed.filePath ?? parsed.path ?? parsed.file ?? parsed.target_file
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    const p = o.file_path ?? o.filePath ?? o.path
    if (typeof p === 'string' && p.trim()) return p.trim()
  }
  return null
}

export function extractToolPathFromOrchestratorLine(line: string): string | null {
  const parsed = tryParseJsonObjectFromLine(line)
  if (parsed) {
    const p = extractPathFromJson(parsed)
    if (p) return p
  }
  const m =
    line.match(/["']file_path["']\s*:\s*["']([^"']+)["']/) ??
    line.match(/["']filePath["']\s*:\s*["']([^"']+)["']/) ??
    line.match(/["']path["']\s*:\s*["']([^"']+)["']/)
  return m?.[1]?.trim() ?? null
}

function extractBashCommand(parsed: Record<string, unknown> | null, line: string): string | null {
  if (parsed) {
    const c = parsed.command
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  const m = line.match(/["']command["']\s*:\s*["']((?:[^"\\]|\\.)*)["']/)
  return m?.[1]?.replace(/\\n/g, '\n').trim() ?? null
}

function extractGrepGlobPattern(parsed: Record<string, unknown> | null, line: string): string {
  if (parsed) {
    const pat = parsed.pattern ?? parsed.glob_pattern ?? parsed.glob
    if (typeof pat === 'string' && pat.trim()) return pat.trim()
  }
  const m = line.match(/["']pattern["']\s*:\s*["']((?:[^"\\]|\\.)*)["']/)
  return m?.[1] ?? '?'
}

function extractGrepGlobScope(parsed: Record<string, unknown> | null, line: string): string {
  if (parsed) {
    const sc = parsed.path ?? parsed.target_directory
    if (typeof sc === 'string' && sc.trim()) return sc.trim()
  }
  const m = line.match(/["']path["']\s*:\s*["']([^"']+)["']/)
  return m?.[1]?.trim() ?? '.'
}

function extractWebQuery(parsed: Record<string, unknown> | null, line: string): string {
  if (parsed) {
    const q = parsed.query
    if (typeof q === 'string' && q.trim()) return q.trim()
  }
  const m = line.match(/["']query["']\s*:\s*["']((?:[^"\\]|\\.)*)["']/)
  return m?.[1]?.trim() || '?'
}

const TOOL_LABEL: Record<string, string> = {
  read_file: 'read',
  write_file: 'write',
  delete_file: 'delete',
  list_directory: 'list',
  open_workspace: 'workspace',
  canvas_list_modules: 'canvas',
  canvas_create_tile: 'canvas',
  canvas_update_tile: 'canvas',
  run_shell_command: 'shell',
}

function prettyToolLabel(name: string): string {
  return TOOL_LABEL[name] ?? name.replace(/_/g, ' ')
}

/**
 * Tool invocation line shown while a tool runs — mirrors `format_tool_call_start` in claw-code `main.rs`.
 */
export function glitterVerbForToolInvocation(name: string, toolLine?: string | null): string {
  const line = toolLine ?? ''
  const parsed = tryParseJsonObjectFromLine(line)
  const n = normalizeOrchestratorToolName(name)

  if (n === 'bash' || n === 'shell' || n === 'run_shell_command') {
    const cmd = extractBashCommand(parsed, line)
    return cmd ? `$ ${truncate(cmd, 140)}` : '$ shell'
  }
  if (n === 'read_file' || n === 'read') {
    const path = extractToolPathFromOrchestratorLine(line) ?? (parsed ? extractPathFromJson(parsed) : null)
    if (!path) {
      // #region agent log
      emitDebugLog('trace-path-resolution', 'H2', 'orchestratorShimmerVerbs.ts:197', 'Path missing for read tool line', {
        tool: n,
        linePreview: line.slice(0, 180),
      })
      // #endregion
    }
    return path ? `Reading ${path}…` : 'Reading…'
  }
  if (n === 'write_file' || n === 'write') {
    const path = extractToolPathFromOrchestratorLine(line) ?? (parsed ? extractPathFromJson(parsed) : null)
    if (!path) {
      // #region agent log
      emitDebugLog('trace-path-resolution', 'H2', 'orchestratorShimmerVerbs.ts:209', 'Path missing for write tool line', {
        tool: n,
        linePreview: line.slice(0, 180),
      })
      // #endregion
    }
    if (!path) return 'Writing…'
    const content = parsed?.content
    const lines =
      typeof content === 'string' ? content.split('\n').length : Number(parsed?.line_count) || 0
    return lines > 0
      ? `Writing ${path} (${lines} lines)`
      : `Writing ${path}`
  }
  if (n === 'edit_file' || n === 'edit' || n === 'str_replace' || n === 'search_replace') {
    const path = extractToolPathFromOrchestratorLine(line) ?? (parsed ? extractPathFromJson(parsed) : null)
    if (!path) {
      // #region agent log
      emitDebugLog('trace-path-resolution', 'H2', 'orchestratorShimmerVerbs.ts:225', 'Path missing for edit tool line', {
        tool: n,
        linePreview: line.slice(0, 180),
      })
      // #endregion
    }
    return path ? `Editing ${path}` : 'Editing…'
  }
  if (n === 'glob_file_search' || n === 'glob' || n === 'file_search') {
    const pattern = extractGrepGlobPattern(parsed, line)
    const scope = extractGrepGlobScope(parsed, line)
    return `Glob ${pattern} · ${scope}`
  }
  if (n === 'grep' || n === 'grep_search' || n === 'codebase_search') {
    const pattern = extractGrepGlobPattern(parsed, line)
    const scope = extractGrepGlobScope(parsed, line)
    return `Grep ${pattern} · ${scope}`
  }
  if (n === 'web_search' || n === 'websearch') {
    const q = extractWebQuery(parsed, line)
    return `Web search: ${q}`
  }

  const label = prettyToolLabel(n)
  return `Tool: ${label}`
}

/** Short “done” style line after tool return — checkmark like claw `format_tool_result`. */
export function glitterVerbForToolComplete(name: string, toolLine?: string | null): string {
  const line = toolLine ?? ''
  const n = normalizeOrchestratorToolName(name)
  if (n === 'bash' || n === 'shell' || n === 'run_shell_command') {
    const parsed = tryParseJsonObjectFromLine(line)
    const cmd = extractBashCommand(parsed, line)
    const short = cmd ? truncate(cmd, 48) : prettyToolLabel(n)
    return `Done · ${short}`
  }
  const path = extractToolPathFromOrchestratorLine(line)
  const short = path ? basename(path) : prettyToolLabel(n)
  return `Done · ${short}`
}

export function glitterVerbForTools(names: string[]): string {
  const uniq = [...new Set(names)].map(normalizeOrchestratorToolName).filter(Boolean).sort()
  if (uniq.length === 0) return shimmerThinkingPhrase('tools:empty')
  if (uniq.length === 1) return `Tools: ${uniq[0]}`
  return `Tools: ${uniq.join(', ')}`
}

/** Elapsed + optional per-tool progress while a batch executes (after the model returned tool_calls). */
export function glitterVerbForToolsPending(
  toolNames: string[],
  elapsedMs: number,
  completed: number,
  total: number,
  currentTool?: string
): string {
  const base = glitterVerbForTools(toolNames)
  const s = Math.max(0, Math.floor(elapsedMs / 1000))
  const prog =
    total > 0 ? ` · ${completed}/${total}` : ''
  const cur =
    currentTool && currentTool.trim()
      ? ` · ${normalizeOrchestratorToolName(currentTool)}`
      : ''
  if (s <= 0) return `${base}${prog}${cur}`
  return `${base}${prog}${cur} · ${s}s`
}

function getOrSetPendingPhrase(iteration: number): string {
  if (iteration !== pendingPhraseIterationState) {
    pendingPhraseIterationState = iteration
    pendingPhraseBase = shimmerThinkingPhrase(`llm_pending:${iteration}`)
  }
  return pendingPhraseBase
}

export function glitterVerbForLlmPending(elapsedMs: number, iteration: number = 1): string {
  const base = getOrSetPendingPhrase(iteration)
  const s = Math.max(0, Math.floor(elapsedMs / 1000))
  if (s <= 0) return base
  if (s < 45) return `${base} · ${s}s`
  return `${base} · ${s}s · tool rounds can be slow`
}

export function glitterVerbForLlm(iteration: number): string {
  return shimmerThinkingPhrase(`llm:${iteration}`)
}

export function glitterVerbForPrepare(): string {
  return shimmerThinkingPhrase('prepare')
}

export function glitterVerbForRunStart(): string {
  return shimmerThinkingPhrase('run_start')
}

export function glitterVerbForAgentSpawn(_tileId: string): string {
  return 'Spawning agent…'
}

export function resetGlitterVerbSession(): void {
  pendingPhraseIterationState = -1
  pendingPhraseBase = ''
}

export function resetOneShotClarifyGlitterSession(): void {
  clarifyPhraseRotation = -1
  clarifyPhraseBase = ''
}

export function glitterVerbForOneShotClarifyPending(elapsedMs: number): string {
  const rot = Math.floor(elapsedMs / 5000)
  if (rot !== clarifyPhraseRotation) {
    clarifyPhraseRotation = rot
    clarifyPhraseBase = shimmerThinkingPhrase(`oneshot_clarify:${rot}`)
  }
  const s = Math.max(0, Math.floor(elapsedMs / 1000))
  if (s <= 0) return `1-shot · ${clarifyPhraseBase}`
  return `1-shot · ${clarifyPhraseBase} · ${s}s`
}

/**
 * Map activity trace lines to a short verb (claw-style tool lines, else thinking / phase stub).
 */
export function shimmerVerbFromTraceLine(line: string): string {
  const t = line.trimStart()
  const start = t.match(/^→\s*([A-Za-z0-9_:-]+)(\s*)(.*)$/)
  if (start) {
    const tool = start[1] ?? ''
    const rest = (start[3] ?? '').trim()
    const synthetic = rest ? `→ ${tool} ${rest}` : `→ ${tool}`
    return glitterVerbForToolInvocation(tool, synthetic)
  }
  const done = t.match(/^←\s*([A-Za-z0-9_:-]+)/)
  if (done && done[1]) {
    return glitterVerbForToolComplete(done[1], t)
  }
  if (
    t.startsWith('[Phase') ||
    t.startsWith('[Plan') ||
    t.startsWith('[Planning') ||
    t.startsWith('[Execution') ||
    t.startsWith('[Routing')
  ) {
    return truncate(t.replace(/\s+/g, ' '), 76)
  }
  return shimmerThinkingPhrase(`trace:fallback:${line.slice(0, 64)}`)
}

/**
 * @param seed - `trace:${line}` from activity feed, or legacy keys (returns a gerund phrase).
 */
export function nextGlitterPhrase(seed: string): string {
  if (seed.startsWith('trace:')) {
    return shimmerVerbFromTraceLine(seed.slice('trace:'.length))
  }
  const traceIdx = seed.indexOf(':trace:')
  if (seed.startsWith('agent:') && traceIdx !== -1) {
    return shimmerVerbFromTraceLine(seed.slice(traceIdx + ':trace:'.length))
  }
  return shimmerThinkingPhrase(seed)
}

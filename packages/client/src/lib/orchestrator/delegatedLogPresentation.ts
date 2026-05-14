/**
 * Presentation helpers for delegated sub-agent tiles: collapse noisy heartbeat
 * lines and derive compact trace chips from free-form log lines.
 */

const STILL_WAITING_RE = /still waiting/i

function extractStillWaitingSec(line: string): number | null {
  const m = line.trim().match(/^\[(\d+)s\]/)
  return m ? parseInt(m[1], 10) : null
}

/**
 * Collapse consecutive "Still waiting" nudges (30s polling from the orchestrator)
 * into a single summary line; keeps chronological order of other lines.
 */
export function collapseStillWaitingRuns(lines: string[]): string[] {
  const out: string[] = []
  let hb: string[] = []

  const flush = () => {
    if (hb.length === 0) return
    if (hb.length === 1) {
      out.push(hb[0]!)
    } else {
      const last = hb[hb.length - 1]!
      const sec = extractStillWaitingSec(last)
      out.push(
        `… ${hb.length}× still-waiting nudges (latest ${sec != null ? `[${sec}s]` : '—'}) — open full trace below for every line`
      )
    }
    hb = []
  }

  for (const line of lines) {
    const t = line.trim()
    if (t && STILL_WAITING_RE.test(t)) {
      hb.push(line)
    } else {
      flush()
      out.push(line)
    }
  }
  flush()
  return out
}

/** Normalize log tail entries to display lines (split embedded newlines). */
export function flattenLogTail(logTail: string[]): string[] {
  return logTail.flatMap((chunk) => String(chunk).split('\n'))
}

export type DelegatedTraceChipKind = 'call' | 'result' | 'info'

export type DelegatedTraceChipState = 'queued' | 'running' | 'success' | 'error'
export type DelegatedTraceChipCategory = 'file' | 'search' | 'edit' | 'exec' | 'network' | 'plan' | 'info' | 'other'

export type DelegatedTraceChip = {
  id: string
  kind: DelegatedTraceChipKind
  /** Short label for the chip */
  name: string
  /** Optional tool icon (emoji/symbol) for Hermes-style chips. */
  icon?: string
  /** Optional path/query/target snippet shown after the tool name. */
  target?: string
  /** Optional elapsed duration label (e.g. `1.1s`, `240ms`). */
  duration?: string
  /** Optional UI state for in-canvas trace bubbles. */
  state?: DelegatedTraceChipState
  /** Optional category token for in-canvas trace styling. */
  category?: DelegatedTraceChipCategory
}

const TOOL_ICONS: Record<string, string> = {
  read_file: '📖',
  read: '📖',
  search_files: '🔎',
  grep: '🔎',
  rg: '🔎',
  patch: '🔧',
  write_file: '✍️',
  terminal: '⚕',
  run_shell_command: '⚕',
  execute_code: '🐍',
  browser_navigate: '🌐',
  browser_click: '🖱️',
}

function toolIcon(name: string, kind: DelegatedTraceChipKind): string {
  const n = name.toLowerCase()
  return TOOL_ICONS[n] ?? (kind === 'result' ? '✓' : kind === 'call' ? '⚕' : '◆')
}

function truncateMiddle(text: string, max = 42): string {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) * 0.52)
  const tail = Math.floor((max - 1) * 0.48)
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

function compactPath(pathLike: string, max = 42): string {
  if (pathLike.length <= max) return pathLike
  const normalized = pathLike.replace(/\\+/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  const leaf = parts.length > 0 ? parts[parts.length - 1]! : normalized
  if (leaf.length + 2 >= max) return `…/${leaf.slice(-(max - 2))}`
  const head = normalized.slice(0, Math.max(1, max - leaf.length - 2))
  return `${head}…/${leaf}`
}

function extractTargetSnippet(trimmed: string): string | undefined {
  const jsonPath = trimmed.match(/"path"\s*:\s*"([^"]+)"/i)?.[1]
  if (jsonPath) return compactPath(jsonPath)

  const keyPath = trimmed.match(/\bpath=([^\s"',}]+)/i)?.[1]
  if (keyPath) return compactPath(keyPath)

  const absPath = trimmed.match(/(?:^|\s)(~?\/[\w./\-]+|\/[\w./\-]+)(?:\s|$)/)?.[1]
  if (absPath) return compactPath(absPath)

  const toolArgs = trimmed.match(/^→\s*[a-z_][a-z0-9_]*\s+(.+)$/i)?.[1]
  if (toolArgs) {
    const clean = toolArgs.replace(/\s+(\d+(?:\.\d+)?(?:ms|s))\s*$/i, '').trim()
    if (clean) return truncateMiddle(clean)
  }

  return undefined
}

function extractDuration(trimmed: string): string | undefined {
  const named = trimmed.match(/\b(?:duration|elapsed|time)=\s*(\d+(?:\.\d+)?\s*(?:ms|s))\b/i)?.[1]
  if (named) return named.replace(/\s+/g, '')

  const paren = trimmed.match(/\((\d+(?:\.\d+)?\s*(?:ms|s))\)/i)?.[1]
  if (paren) return paren.replace(/\s+/g, '')

  const tail = trimmed.match(/\b(\d+(?:\.\d+)?\s*(?:ms|s))\s*$/i)?.[1]
  if (tail) return tail.replace(/\s+/g, '')

  return undefined
}

function inferCategory(name: string, kind: DelegatedTraceChipKind): DelegatedTraceChipCategory {
  if (kind === 'info') return 'info'
  const n = name.toLowerCase()
  if (/read|open|file|cat/.test(n)) return 'file'
  if (/search|grep|rg|find/.test(n)) return 'search'
  if (/patch|write|edit|rename|delete/.test(n)) return 'edit'
  if (/terminal|shell|npm|pnpm|yarn|python|node/.test(n)) return 'exec'
  if (/browser|http|fetch|curl|request|api/.test(n)) return 'network'
  if (/plan|todo|track|routing|decomposition|phase/.test(n)) return 'plan'
  return 'other'
}

function inferResultState(trimmed: string): DelegatedTraceChipState {
  return /\berror\b|\bfail(?:ed|ure)?\b|\bdenied\b|\bexception\b|\btimeout\b/i.test(trimmed)
    ? 'error'
    : 'success'
}

export function formatTraceChipLabel(chip: DelegatedTraceChip): string {
  const parts = [chip.icon ?? (chip.kind === 'result' ? '✓' : chip.kind === 'call' ? '⚕' : '◆'), chip.name]
  if (chip.target) parts.push(chip.target)
  if (chip.duration) parts.push(chip.duration)
  return parts.filter(Boolean).join(' ')
}

/**
 * Derive a compact chip from a log line — tool arrows, time-prefixed tool names,
 * and high-signal bracket banners ([Track], [Planning], …). Heartbeats skipped.
 */
export function extractDelegatedTraceChip(raw: string, index: number): DelegatedTraceChip | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (STILL_WAITING_RE.test(trimmed)) return null

  const toolEvent = trimmed.match(/\btool\.(call|result)\b.*?name=([^\s"',}]+)/i)
  if (toolEvent) {
    const kind = toolEvent[1].toLowerCase() === 'result' ? 'result' : 'call'
    const name = toolEvent[2].slice(0, 36)
    return {
      id: `${index}-${kind}-${name}`,
      kind,
      name,
      icon: toolIcon(name, kind),
      target: extractTargetSnippet(trimmed),
      duration: extractDuration(trimmed),
      state: kind === 'call' ? 'running' : inferResultState(trimmed),
      category: inferCategory(name, kind),
    }
  }

  const invoke = trimmed.match(/^→\s*([a-z_][a-z0-9_]*)/i)
  if (invoke) {
    const name = invoke[1].slice(0, 36)
    return {
      id: `${index}-call-${name}`,
      kind: 'call',
      name,
      icon: toolIcon(name, 'call'),
      target: extractTargetSnippet(trimmed),
      duration: extractDuration(trimmed),
      state: 'running',
      category: inferCategory(name, 'call'),
    }
  }
  const complete = trimmed.match(/^←\s*([a-z_][a-z0-9_]*)/i)
  if (complete) {
    const name = complete[1].slice(0, 36)
    return {
      id: `${index}-res-${name}`,
      kind: 'result',
      name,
      icon: toolIcon(name, 'result'),
      target: extractTargetSnippet(trimmed),
      duration: extractDuration(trimmed),
      state: inferResultState(trimmed),
      category: inferCategory(name, 'result'),
    }
  }
  const timestamped = trimmed.match(/^\d{1,2}:\d{2}:\d{2}\s+([a-z_][a-z0-9_]*)/i)
  if (timestamped) {
    const name = timestamped[1].slice(0, 36)
    return {
      id: `${index}-ts-${name}`,
      kind: 'call',
      name,
      icon: toolIcon(name, 'call'),
      target: extractTargetSnippet(trimmed),
      duration: extractDuration(trimmed),
      state: 'running',
      category: inferCategory(name, 'call'),
    }
  }

  const bracket = trimmed.match(/^\[([^\]]{1,40})\]\s*(.*)$/)
  if (bracket) {
    const tag = bracket[1].trim()
    const rest = bracket[2].trim()
    if (
      /^(Track|Planning|Routing|Execution|Phase|Orchestrator|Skills|Research|Plan|Budget|Decomposition|Worktree|HTTP|Rate limited|Schema guard|Tool-call fallback|Stagnation guard|Vision|Z\.AI)/i.test(
        tag
      )
    ) {
      const restTrim =
        rest.length > 560 ? `${rest.slice(0, 557)}…` : rest
      const snippet = restTrim ? `${tag.slice(0, 40)} · ${restTrim}` : tag.slice(0, 72)
      return {
        id: `${index}-info-${tag}`,
        kind: 'info',
        name: snippet,
        icon: '◆',
        state: 'queued',
        category: 'info',
      }
    }
  }

  return null
}

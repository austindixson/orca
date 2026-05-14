/**
 * Cheap regex-based classifier for streamed agent output. We run this over
 * every new line of assistant text / tool output / sub-agent log tail to
 * surface counts on the agent tile (red "3 errors" pill, etc.) without
 * requiring the model to annotate anything.
 *
 * Rules are intentionally conservative — we prefer missed signals over false
 * positives, since counters bubble up into the Task list UI.
 *
 *   fail  → hard failure markers ("test failed", "build failed", "command exited with 1")
 *   error → explicit "Error:" / "[Error]" / "Exception:" / 5xx / "failed to"
 *   warn  → "warning:" / "[Warning]" / "WARN "
 *
 * Returns null for unrelated lines (prose, tool chips, status banners).
 */
export type AgentIssueKind = 'error' | 'warning' | 'fail'

const FAIL_RE =
  /\b(?:test(?:s)?\s+failed|build\s+failed|deploy(?:ment)?\s+failed|command\s+exited\s+with\s+code\s+[1-9]\d*|process\s+exited\s+with\s+code\s+[1-9]\d*|exit\s+code:\s*[1-9]\d*|FAIL(?:\s|:|$))/i

const ERROR_RE =
  /(?:^|\W)(?:error(?:\s*code)?:|\[error\]|uncaught\s+exception|exception:|panic:|segfault|traceback\s+\(most\s+recent\s+call\s+last\)|typeerror:|referenceerror:|syntaxerror:|unhandledrejection|http\/[12](?:\.\d)?\s+5\d\d\b|\bHTTP\s+5\d\d\b|failed\s+to\s+\w+)/i

const WARN_RE = /(?:^|\W)(?:warning:|\[warn(?:ing)?\]|WARN\s|deprecated:)/i

/**
 * Classify a single log line. Trims and ignores empties. Checks fail before
 * error so "build failed" counts once as a fail, not twice.
 */
export function classifyAgentLogLine(raw: string): AgentIssueKind | null {
  if (!raw) return null
  const line = raw.trim()
  if (!line) return null
  // Ignore our own `[Error: …]` chat banner because the real error upstream
  // already got classified once when the tool emitted it.
  if (/^\[Error:\s/.test(line)) return null
  if (FAIL_RE.test(line)) return 'fail'
  if (ERROR_RE.test(line)) return 'error'
  if (WARN_RE.test(line)) return 'warning'
  return null
}

/** Tally issue kinds over a slab of text (splits on newlines first). */
export function tallyAgentIssues(text: string): {
  error: number
  warning: number
  fail: number
} {
  const counts = { error: 0, warning: 0, fail: 0 }
  if (!text) return counts
  for (const line of text.split(/\r?\n/)) {
    const kind = classifyAgentLogLine(line)
    if (kind) counts[kind] += 1
  }
  return counts
}

/**
 * Parse a delegated-task prompt body into a list of discrete subtask bullets.
 *
 * We look for common bullet styles (`-`, `*`, `•`, `1.`, `1)`) anywhere in the
 * text. If a `Subtasks:` (or `Steps:` / `Tasks:` / `Checklist:`) marker
 * appears, we only consider bullets *after* that marker — this keeps a stray
 * bullet in the prose above from polluting the list.
 *
 * Returns trimmed bullet texts in source order; dedupes consecutive duplicates.
 */
export function parseSubtasks(raw: string): string[] {
  if (!raw) return []
  const text = String(raw)

  // If there's an explicit marker, restrict parsing to the text after it.
  const markerMatch = text.match(/^\s*(?:subtasks?|steps?|tasks?|checklist)\s*:\s*$/im)
  const working = markerMatch ? text.slice(markerMatch.index! + markerMatch[0].length) : text

  const lines = working.split(/\r?\n/)
  const bullets: string[] = []
  for (const rawLine of lines) {
    const ln = rawLine.trim()
    if (!ln) continue
    const m = ln.match(/^(?:[-*•●]|\d+[.)])\s+(.+)$/)
    if (!m) continue
    const t = m[1]!.trim().replace(/^\[[ x]\]\s*/i, '')
    if (!t) continue
    if (bullets.length > 0 && bullets[bullets.length - 1] === t) continue
    bullets.push(t)
  }
  return bullets
}

/**
 * Heuristically decide which subtasks have been "touched" by the agent, based
 * on its log tail / output text. Uses 1–3 line sliding windows so tokens that
 * land on different lines (common in tool traces) still match together.
 *
 * Never un-matches: callers should OR these flags with existing done state.
 */
export function detectCompletedSubtasks(subtasks: string[], logText: string): boolean[] {
  if (subtasks.length === 0) return []
  if (!logText) return subtasks.map(() => false)
  const lowerLines = logText.toLowerCase().split(/\r?\n/).filter((l) => l.length > 0)
  if (lowerLines.length === 0) return subtasks.map(() => false)

  /** Sliding windows of 1–3 lines for cross-line token hits. */
  const windows: string[] = []
  for (let i = 0; i < lowerLines.length; i++) {
    for (let w = 1; w <= 3 && i + w <= lowerLines.length; w++) {
      windows.push(lowerLines.slice(i, i + w).join(' '))
    }
  }

  return subtasks.map((task) => {
    const lower = task.toLowerCase()
    const tokens = Array.from(
      new Set(lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 5))
    ).slice(0, 4)

    if (tokens.length >= 2) {
      return windows.some((chunk) => tokens.every((tok) => chunk.includes(tok)))
    }
    const probe = lower
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (probe.length >= 8) {
      return windows.some((chunk) => chunk.includes(probe))
    }
    // Short subtask: one distinctive token (4+ chars) anywhere in a window.
    const single =
      tokens[0] ??
      lower
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4)
        .sort((a, b) => b.length - a.length)[0]
    if (!single || single.length < 4) return false
    return windows.some((chunk) => chunk.includes(single))
  })
}

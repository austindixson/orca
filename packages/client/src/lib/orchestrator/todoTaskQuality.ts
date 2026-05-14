import type { TodoTask } from '../../store/todoStore'

/**
 * Resume prompt body from `resumePromptStore` (no "Orchestrator:" prefix — that is added when persisting as a todo row).
 */
const RESUME_PROGRESS_RE = /Progress:\s*\d+%\s*\(\d+\/\d+\s+complete\)\.?/i
const RESUME_NEXT_TASK_RE = /Next task:\s*.+/i
const RESUME_TAIL_RE = /Then continue through remaining pending tasks in order\.?/i
const RESUME_YES_CONTINUE_RE = /^Yes\s+[—–-]\s*continue\b/i

/** Bare acknowledgements that should not become standalone todo rows. */
const BARE_ACK_RE = /^(continue|continued|yes|yep|ok|okay|sure|go|proceed)\.?$/i

/**
 * True when `displayText` is the resume-prompt injection (before `Orchestrator:` prefix is added).
 */
export function isOrchestratorSyntheticResumeMessage(body: string): boolean {
  const t = body.trim()
  if (!t) return false
  if (RESUME_TAIL_RE.test(t) && RESUME_NEXT_TASK_RE.test(t) && RESUME_PROGRESS_RE.test(t)) {
    return true
  }
  if (RESUME_YES_CONTINUE_RE.test(t) && RESUME_NEXT_TASK_RE.test(t)) {
    return true
  }
  return false
}

/**
 * Skip creating a new orchestrator root todo row for this run — avoids hundreds of duplicate
 * "Progress / Next task" rows when the user keeps resuming from the same template.
 */
export function shouldSuppressOrchestratorTodoRow(displayText: string): boolean {
  const t = displayText.trim()
  if (!t) return false
  if (isOrchestratorSyntheticResumeMessage(t)) return true
  if (BARE_ACK_RE.test(t)) return true
  return false
}

function stripOrchestratorPrefix(text: string): string {
  return text.replace(/^Orchestrator:\s*/i, '').trim()
}

/**
 * True for persisted todo rows that are resume spam, bare acks, or orchestrator status lines.
 */
export function isPersistedOrchestratorTodoNoise(task: TodoTask): boolean {
  if (task.source !== 'orchestrator') return false
  const body = stripOrchestratorPrefix(task.text)
  if (!body) return true
  if (isOrchestratorSyntheticResumeMessage(body)) return true
  if (BARE_ACK_RE.test(body)) return true
  // Multi-line resume card stored as one task title
  if (RESUME_TAIL_RE.test(body) && RESUME_NEXT_TASK_RE.test(body) && RESUME_PROGRESS_RE.test(body)) {
    return true
  }
  return false
}

/** Remove volatile progress line so near-duplicate resume rows collapse together. */
export function normalizeOrchestratorBodyForDedup(text: string): string {
  let s = stripOrchestratorPrefix(text)
  s = s.replace(RESUME_PROGRESS_RE, '')
  s = s.replace(/\s+/g, ' ').trim().toLowerCase()
  return s
}

/**
 * After removing obvious noise, collapse orchestrator tasks that only differ by progress % / counts.
 */
function dedupeOrchestratorTasksByNormalizedBody(tasks: TodoTask[]): TodoTask[] {
  const byKey = new Map<string, TodoTask[]>()
  for (const t of tasks) {
    if (t.source !== 'orchestrator') continue
    const key = normalizeOrchestratorBodyForDedup(t.text)
    if (!key) continue
    const list = byKey.get(key)
    if (list) list.push(t)
    else byKey.set(key, [t])
  }

  const dropIds = new Set<string>()
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    // Only collapse groups that look like resume/status spam (avoid merging unrelated dupes).
    const sample = stripOrchestratorPrefix(group[0].text)
    const resumeLike =
      RESUME_NEXT_TASK_RE.test(sample) ||
      /Progress:\s*\d+%/i.test(sample) ||
      RESUME_YES_CONTINUE_RE.test(sample)
    if (!resumeLike) continue

    group.sort((a, b) => b.updatedAt - a.updatedAt)
    const [keep, ...rest] = group
    if (!keep) continue
    for (const r of rest) {
      dropIds.add(r.id)
    }
  }

  if (dropIds.size === 0) return tasks
  return tasks.filter((t) => !dropIds.has(t.id))
}

/**
 * Startup / hydrate: remove non-actionable orchestrator rows and collapse near-duplicates.
 */
export function pruneOrchestratorTodoNoise(tasks: TodoTask[]): { cleaned: TodoTask[]; removed: number } {
  const before = tasks.length
  const noNoise = tasks.filter((t) => !isPersistedOrchestratorTodoNoise(t))
  const cleaned = dedupeOrchestratorTasksByNormalizedBody(noNoise)
  return { cleaned, removed: before - cleaned.length }
}

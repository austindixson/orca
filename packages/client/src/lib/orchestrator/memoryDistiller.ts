/**
 * End-of-session distillation: turn errors / stagnation / inspect / merge-review signals into
 * capped lessons in `.orca/MEMORY.md` and append raw rows to `.orca/MEMORY.signals.jsonl`.
 *
 * Safety invariants:
 * - Gated by `orcaMemoryDistillerEnabled` (default off; desktop only — see MEMORY_ARCHITECTURE.md).
 * - Redacts secrets before any persist (`applyVaultSecretRedaction`).
 * - Skips when the run was aborted/cancelled.
 * - Skips when the session is below a minimum useful length (turn count).
 * - Rotates `.orca/MEMORY.signals.jsonl` at 2MB (-> `.signals.1.jsonl`).
 * - Ring-trims lessons by whole bullets, never mid-line; caps total chars + bullet count.
 */
import * as tauri from '../tauri'
import { useSettingsStore } from '../../store/settingsStore'
import { classifyOrchestratorError } from './orchestratorErrorTaxonomy'
import {
  chatCompletionWithTools,
  orchestratorChatOptionsFromStore,
} from './chatCompletion'
import { resolveApiKey } from '../llmCredentials'
import { getDetectedIssues } from './inspectTools'
import { useMergeReviewStore } from '../../store/mergeReviewStore'
import {
  recordVaultMirrorSuccess,
  reportVaultMirrorFailure,
} from '../../store/vaultMirrorDiagnosticsStore'
import { applyVaultSecretRedaction } from '../vault/vaultBrainMirror'

const SIGNALS_REL = '.orca/MEMORY.signals.jsonl'
const SIGNALS_ROTATED_REL = '.orca/MEMORY.signals.1.jsonl'
const MEMORY_REL = '.orca/MEMORY.md'
const LESSONS_SECTION = '## Lessons (auto-distilled)'
const MAX_LESSONS_CHARS = 3_000
const MAX_BULLETS = 5
const MAX_TOTAL_LESSON_LINES = 40
/** Rotate signals JSONL when it exceeds 2MB (character-count approximation). */
const SIGNALS_ROTATE_AT = 2_000_000
/** Skip distillation for sessions with fewer than this many messages (system + user + ...). */
const MIN_SESSION_MESSAGES = 4

export type MemoryDistillerSignalKind =
  | 'error'
  | 'stagnation'
  | 'inspect'
  | 'merge_reject'
  /** PTY command lifecycle (Orca-wrapped); feeds recurring-signal / meta-harness review. */
  | 'terminal_command'

export type MemoryDistillerSignal = {
  ts: number
  sessionId: string
  kind: MemoryDistillerSignalKind
  detail: string
}

export type MemoryDistillerInput = {
  sessionId: string
  lastError: string | null
  stagnationHint: string | null
  /** Total number of messages in the session (post-run). Used by min-turn gate. */
  messageCount?: number
  /** True if the run was cancelled/aborted; distiller is skipped. */
  aborted?: boolean
}

function redact(s: string): string {
  return applyVaultSecretRedaction(s)
}

function collectInspectSnippets(): string[] {
  try {
    const issues = getDetectedIssues()
    return issues
      .filter((i) => i.resolved !== true && i.canAutoFix === false)
      .slice(0, 12)
      .map((i) => redact(`${i.severity}: ${i.title} (${i.id})`))
  } catch {
    return []
  }
}

function collectRejectedMergeReviews(): string[] {
  try {
    return useMergeReviewStore
      .getState()
      .mergeReviewQueueSnapshot()
      .filter((t) => t.status === 'rejected')
      .slice(-8)
      .map((t) => redact(`${t.id}: ${t.notes.slice(0, 160)}`))
  } catch {
    return []
  }
}

function buildHeuristicBullets(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    out.push(`- ${t.slice(0, 400)}`)
    if (out.length >= MAX_BULLETS) break
  }
  return out
}

async function distillBulletsWithLlm(lines: string[]): Promise<string[] | null> {
  if (lines.length === 0) return []
  const settings = useSettingsStore.getState()
  const models = settings.getAvailableModels()
  const selected =
    models.find((m) => m.id === settings.selectedModel) ??
    models.find((m) => m.provider === 'openrouter') ??
    models[0]
  if (!selected) return null
  const providerConfig = settings.providers[selected.provider]
  const apiKey = await resolveApiKey(selected.provider, providerConfig.apiKey)
  const sys =
    'You turn diagnostic lines into at most 5 terse markdown bullets starting with "- ". ' +
    'Output plain lines only, no heading, no code fence. Focus on what went wrong and what to ' +
    'avoid next session. Redact secrets.'
  const user = `Signals:\n${lines.join('\n')}`
  try {
    const res = await chatCompletionWithTools(
      selected.provider,
      selected.name,
      apiKey,
      providerConfig.baseUrl,
      [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      [],
      undefined,
      8_000,
      orchestratorChatOptionsFromStore(selected.provider)
    )
    const raw = res.choices[0]?.message?.content ?? ''
    const bullets = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('-'))
      .map((l) => redact(l))
      .slice(0, MAX_BULLETS)
    return bullets.length > 0 ? bullets : null
  } catch {
    return null
  }
}

/**
 * Splice new bullets into the lessons section, ring-trimming by whole bullets (never mid-line)
 * so the section stays under MAX_LESSONS_CHARS / MAX_TOTAL_LESSON_LINES.
 */
export function upsertLessonsSection(existing: string, newBullets: string[]): string {
  const trimmedNew = newBullets.map((b) => b.trim()).filter(Boolean)
  if (trimmedNew.length === 0 && !existing.includes(LESSONS_SECTION)) return existing

  const hasSection = existing.includes(LESSONS_SECTION)
  let beforeSection = existing
  let existingBullets: string[] = []
  let afterSection = ''

  if (hasSection) {
    const idx = existing.indexOf(LESSONS_SECTION)
    beforeSection = existing.slice(0, idx).trimEnd()
    const rest = existing.slice(idx + LESSONS_SECTION.length).replace(/^\s*\n/, '')
    const nextHeaderIdx = rest.search(/\n##\s+/)
    const sectionBody = nextHeaderIdx === -1 ? rest : rest.slice(0, nextHeaderIdx)
    afterSection = nextHeaderIdx === -1 ? '' : rest.slice(nextHeaderIdx)
    existingBullets = sectionBody
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('-'))
  }

  const seen = new Set<string>()
  const merged: string[] = []
  for (const b of [...trimmedNew, ...existingBullets]) {
    const key = b.slice(0, 200)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(b)
    if (merged.length >= MAX_TOTAL_LESSON_LINES) break
  }

  let sectionBodyText = merged.join('\n')
  while (
    (sectionBodyText.length > MAX_LESSONS_CHARS || merged.length > MAX_TOTAL_LESSON_LINES) &&
    merged.length > 1
  ) {
    merged.pop()
    sectionBodyText = merged.join('\n')
  }
  if (merged.length === 1 && sectionBodyText.length > MAX_LESSONS_CHARS) {
    const t = merged[0]!
    merged[0] = `${t.slice(0, Math.max(0, MAX_LESSONS_CHARS - 10))}…`
    sectionBodyText = merged.join('\n')
  }

  const section = `${LESSONS_SECTION}\n\n${sectionBodyText}\n`
  const head = beforeSection ? beforeSection + '\n\n' : ''
  const tail = afterSection ? '\n' + afterSection : ''
  return `${head}${section}${tail}`.replace(/\n{3,}/g, '\n\n')
}

async function rotateSignalsIfLarge(): Promise<void> {
  try {
    const cur = await tauri.readFile(SIGNALS_REL).catch(() => '')
    if (cur.length <= SIGNALS_ROTATE_AT) return
    await tauri.writeFile(SIGNALS_ROTATED_REL, cur)
    await tauri.writeFile(SIGNALS_REL, '')
  } catch {
    /* best-effort; rotation never fails the main write */
  }
}

/**
 * Append one distiller signal row (e.g. live `terminal_command` completions) without running the LLM distiller.
 * Same JSONL shape as session-end batches — gated on desktop + workspace path.
 */
export async function appendRawMemorySignal(sig: MemoryDistillerSignal): Promise<void> {
  if (!tauri.isTauri()) return
  const ws = await tauri.getWorkspace()
  if (!ws?.path || ws.path === '.') return
  try {
    await rotateSignalsIfLarge()
    const prev = await tauri.readFile(SIGNALS_REL).catch(() => '')
    const chunk = `${JSON.stringify(sig)}\n`
    await tauri.writeFile(SIGNALS_REL, prev + chunk)
    recordVaultMirrorSuccess('memory-signals', SIGNALS_REL)
  } catch (e) {
    reportVaultMirrorFailure('memory-signals', SIGNALS_REL, e)
  }
}

/**
 * Run after a session completes (with JSONL already updated). Gated by `orcaMemoryDistillerEnabled`
 * and safety conditions (non-abort, min turn count).
 */
export async function runMemoryDistillerAtSessionEnd(
  opts: MemoryDistillerInput
): Promise<void> {
  const s = useSettingsStore.getState()
  if (!s.orcaMemoryDistillerEnabled) return
  if (!tauri.isTauri()) return
  if (opts.aborted) return
  if (typeof opts.messageCount === 'number' && opts.messageCount < MIN_SESSION_MESSAGES) return

  const ws = await tauri.getWorkspace()
  if (!ws?.path || ws.path === '.') return

  const signals: MemoryDistillerSignal[] = []
  const lines: string[] = []
  const ts = Date.now()

  if (opts.lastError) {
    const c = classifyOrchestratorError(opts.lastError)
    const detail = redact(`${c.kind}: ${opts.lastError.slice(0, 500)}`)
    signals.push({ ts, sessionId: opts.sessionId, kind: 'error', detail })
    lines.push(`error:${c.kind} — ${detail.slice(detail.indexOf(':') + 1).slice(0, 400)}`)
  }
  if (opts.stagnationHint) {
    const detail = redact(opts.stagnationHint.slice(0, 800))
    signals.push({ ts, sessionId: opts.sessionId, kind: 'stagnation', detail })
    lines.push(`stagnation: ${detail.slice(0, 400)}`)
  }
  for (const snip of collectInspectSnippets()) {
    signals.push({ ts, sessionId: opts.sessionId, kind: 'inspect', detail: snip })
    lines.push(`inspect: ${snip}`)
  }
  for (const mr of collectRejectedMergeReviews()) {
    signals.push({ ts, sessionId: opts.sessionId, kind: 'merge_reject', detail: mr })
    lines.push(`merge: ${mr}`)
  }

  if (signals.length === 0) return

  try {
    await rotateSignalsIfLarge()
    const prev = await tauri.readFile(SIGNALS_REL).catch(() => '')
    const chunk = signals.map((sig) => JSON.stringify(sig)).join('\n') + '\n'
    await tauri.writeFile(SIGNALS_REL, prev + chunk)
    recordVaultMirrorSuccess('memory-signals', SIGNALS_REL)
  } catch (e) {
    reportVaultMirrorFailure('memory-signals', SIGNALS_REL, e)
  }

  let bullets = await distillBulletsWithLlm(lines)
  if (bullets === null || bullets.length === 0) bullets = buildHeuristicBullets(lines)
  if (bullets.length === 0) return

  let prior = ''
  try {
    prior = (await tauri.readFile(MEMORY_REL)).trimEnd()
  } catch {
    prior = ''
  }
  const nextBody = upsertLessonsSection(prior, bullets)
  try {
    await tauri.writeFile(MEMORY_REL, nextBody + (nextBody.endsWith('\n') ? '' : '\n'))
    recordVaultMirrorSuccess('memory-distiller', MEMORY_REL)
  } catch (e) {
    reportVaultMirrorFailure('memory-distiller', MEMORY_REL, e)
  }
}

/** @internal for tests */
export function _upsertLessonsSectionForTest(existing: string, bullets: string[]): string {
  return upsertLessonsSection(existing, bullets)
}

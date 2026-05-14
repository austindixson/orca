/**
 * Hermes-inspired memory for Orca:
 * - Short-term: sliding window over chat turns (see `trimMessagesForOrchestrator` + Settings → memory budget).
 * - Long-term: markdown files injected into the system prompt (workspace `.orca/MEMORY.md`, user `~/.orca/MEMORY.md`).
 */
import * as tauri from '../tauri'
import { useSettingsStore } from '../../store/settingsStore'
import { reportVaultMirrorFailure } from '../../store/vaultMirrorDiagnosticsStore'
import { truncateString } from './orchestratorContextBudget'

const WORKSPACE_MEMORY_REL = '.orca/MEMORY.md'
const WORKSPACE_USER_REL = '.orca/USER.md'

export const SHORT_TERM_MEMORY_MIN = 2_000
export const SHORT_TERM_MEMORY_MAX = 200_000
export const LONG_TERM_MEMORY_MIN = 500
export const LONG_TERM_MEMORY_MAX = 50_000

export const USER_PROFILE_MIN = 400
export const USER_PROFILE_MAX = 8_000

export function clampUserProfileChars(n: number): number {
  if (!Number.isFinite(n)) return 2_400
  return Math.min(USER_PROFILE_MAX, Math.max(USER_PROFILE_MIN, Math.floor(n)))
}

export function clampShortTermMemoryChars(n: number): number {
  if (!Number.isFinite(n)) return 18_000
  return Math.min(SHORT_TERM_MEMORY_MAX, Math.max(SHORT_TERM_MEMORY_MIN, Math.floor(n)))
}

export function clampLongTermMemoryChars(n: number): number {
  if (!Number.isFinite(n)) return 12_000
  return Math.min(LONG_TERM_MEMORY_MAX, Math.max(LONG_TERM_MEMORY_MIN, Math.floor(n)))
}

function joinUnderRoot(root: string, rel: string): string {
  const a = root.replace(/[/\\]+$/, '')
  const b = rel.replace(/^[\\/]+/, '')
  if (a.includes('\\') && !a.startsWith('/')) {
    return `${a}\\${b.replace(/\//g, '\\')}`
  }
  return `${a}/${b}`
}

export type SafeReadFileResult =
  | { ok: true; content: string }
  | { ok: false; content: ''; errorKind: 'missing' | 'io' }

export function _isMissingFileErrorForTest(e: unknown): boolean {
  return isMissingFileError(e)
}

export function _joinUnderRootForTest(root: string, rel: string): string {
  return joinUnderRoot(root, rel)
}

function isMissingFileError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  if (/not\s+found|ENOENT|no such file|does not exist|404/i.test(msg)) return true
  if (typeof e === 'object' && e && 'code' in e) {
    const c = (e as { code?: string }).code
    if (c === 'ENOENT' || c === 'ENOTFOUND') return true
  }
  return false
}

/**
 * Read a workspace-relative path; distinguishes missing files from I/O errors (callers log non-missing failures).
 */
export async function safeReadFile(relPath: string): Promise<SafeReadFileResult> {
  try {
    const content = (await tauri.readFile(relPath)).trim()
    return { ok: true, content }
  } catch (e) {
    const kind = isMissingFileError(e) ? 'missing' : 'io'
    if (kind === 'io') {
      reportVaultMirrorFailure('memory-read', relPath, e)
    }
    return { ok: false, content: '', errorKind: kind }
  }
}

/** `~/.orca/MEMORY.md` via `orca_read_file` — not workspace-scoped. */
async function safeReadOrcaUserMemory(): Promise<SafeReadFileResult> {
  try {
    const content = await tauri.readOrcaDataFile('MEMORY.md')
    if (content == null) return { ok: false, content: '', errorKind: 'missing' }
    return { ok: true, content: content.trim() }
  } catch (e) {
    const kind = isMissingFileError(e) ? 'missing' : 'io'
    if (kind === 'io') {
      reportVaultMirrorFailure('memory-read', '~/.orca/MEMORY.md', e)
    }
    return { ok: false, content: '', errorKind: kind }
  }
}

/**
 * Loads and formats long-term memory for the orchestrator system prompt (empty string if disabled / empty).
 */
export async function loadLongTermMemoryForSystemPrompt(): Promise<string> {
  const s = useSettingsStore.getState()
  if (!s.memoryLongTermEnabled) return ''

  const maxChars = clampLongTermMemoryChars(s.memoryLongTermMaxChars)
  const source = s.memoryLongTermSource

  let raw = ''

  const readWorkspace = async (): Promise<string> => {
    const ws = await tauri.getWorkspace()
    if (!ws?.path || ws.path === '.') return ''
    /** Workspace root is implicit — `read_file` only accepts paths relative to the project root. */
    const r = await safeReadFile(WORKSPACE_MEMORY_REL)
    return r.ok ? r.content : ''
  }

  const readUser = async (): Promise<string> => {
    const r = await safeReadOrcaUserMemory()
    return r.ok ? r.content : ''
  }

  if (source === 'workspace') {
    raw = await readWorkspace()
  } else if (source === 'user') {
    raw = await readUser()
  } else {
    const w = await readWorkspace()
    const u = await readUser()
    const parts: string[] = []
    if (w) parts.push(`#### Workspace (\`.orca/MEMORY.md\`)\n\n${w}`)
    if (u) parts.push(`#### User global (\`~/.orca/MEMORY.md\`)\n\n${u}`)
    raw = parts.join('\n\n')
  }

  if (!raw) return ''

  const body = truncateString(raw, maxChars)
  return `

### Long-term memory (Hermes-style)
Persisted notes below are included on every orchestrator run. Edit **workspace** \`${WORKSPACE_MEMORY_REL}\` and/or **user** \`~/.orca/MEMORY.md\` — source and caps are in **Settings → Harness → Memory**.

${body}
`
}

/** `~/.orca/USER.md` — Hermes-style user profile (preferences, communication style). */
async function safeReadOrcaUserProfile(): Promise<SafeReadFileResult> {
  try {
    const content = await tauri.readOrcaDataFile('USER.md')
    if (content == null) return { ok: false, content: '', errorKind: 'missing' }
    return { ok: true, content: content.trim() }
  } catch (e) {
    const kind = isMissingFileError(e) ? 'missing' : 'io'
    if (kind === 'io') {
      reportVaultMirrorFailure('memory-read', '~/.orca/USER.md', e)
    }
    return { ok: false, content: '', errorKind: kind }
  }
}

/**
 * User profile markdown for the system prompt (empty if disabled / empty files).
 * Workspace `.orca/USER.md` and/or `~/.orca/USER.md` — mirrors Hermes USER.md semantics.
 */
export async function loadUserProfileForSystemPrompt(): Promise<string> {
  const s = useSettingsStore.getState()
  if (!s.orcaUserProfileEnabled) return ''

  const maxChars = clampUserProfileChars(s.orcaUserProfileMaxChars)
  const source = s.orcaUserProfileSource

  const readWorkspace = async (): Promise<string> => {
    const ws = await tauri.getWorkspace()
    if (!ws?.path || ws.path === '.') return ''
    const r = await safeReadFile(WORKSPACE_USER_REL)
    return r.ok ? r.content : ''
  }

  const readUser = async (): Promise<string> => {
    const r = await safeReadOrcaUserProfile()
    return r.ok ? r.content : ''
  }

  let raw = ''
  if (source === 'workspace') {
    raw = await readWorkspace()
  } else if (source === 'user') {
    raw = await readUser()
  } else {
    const w = await readWorkspace()
    const u = await readUser()
    const parts: string[] = []
    if (w) parts.push(`#### Workspace (\`.orca/USER.md\`)\n\n${w}`)
    if (u) parts.push(`#### User global (\`~/.orca/USER.md\`)\n\n${u}`)
    raw = parts.join('\n\n')
  }

  if (!raw) return ''

  const body = truncateString(raw, maxChars)
  return `

### User profile (USER.md)
Persisted notes about **the human** (preferences, communication style, goals). Edit **workspace** \`${WORKSPACE_USER_REL}\` and/or **user** \`~/.orca/USER.md\` — caps in **Settings → Agent data → User profile**.

${body}
`
}

const SIGNALS_REL = '.orca/MEMORY.signals.jsonl'
const RECURRING_BLOCK_MAX = 1500

/**
 * Pure formatter for recurring distiller signals (tests + `buildRecurringIssueBlock`).
 * Counts JSONL rows in the last `windowMs` ending at `nowMs` with the same kind+detail (≥2 hits).
 */
export function formatRecurringIssueBlockFromSignalsJsonl(
  raw: string,
  nowMs: number,
  windowMs: number,
  maxChars: number
): string {
  const cutoff = nowMs - windowMs
  const counts = new Map<string, number>()
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const j = JSON.parse(t) as { ts?: number; kind?: string; detail?: string }
      if (typeof j.ts === 'number' && j.ts < cutoff) continue
      const key = `${j.kind ?? 'unknown'}:${(j.detail ?? '').slice(0, 160)}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    } catch {
      /* ignore */
    }
  }
  const recurring = [...counts.entries()].filter(([, n]) => n >= 2)
  if (recurring.length === 0) return ''
  const lines = recurring
    .slice(0, 12)
    .map(([k, n]) => {
      const detail = k.includes(':') ? k.slice(k.indexOf(':') + 1).trim() : k
      return `- Repeated (${n}x): ${detail || k}`
    })
  const body = `### Recent recurring signals (24h)\n${lines.join('\n')}\n`
  return truncateString(`\n\n${body}`, maxChars)
}

/**
 * Terse system-prompt block from recurring rows in `.orca/MEMORY.signals.jsonl` (last 24h, ≥2 hits).
 * Gated by `orcaMemoryDistillerEnabled`.
 */
export async function buildRecurringIssueBlock(): Promise<string> {
  const s = useSettingsStore.getState()
  if (!s.orcaMemoryDistillerEnabled) return ''
  const ws = await tauri.getWorkspace()
  if (!ws?.path || ws.path === '.') return ''
  let raw = ''
  try {
    raw = await tauri.readFile(SIGNALS_REL)
  } catch {
    return ''
  }
  return formatRecurringIssueBlockFromSignalsJsonl(raw, Date.now(), 24 * 60 * 60 * 1000, RECURRING_BLOCK_MAX)
}

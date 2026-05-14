/**
 * ~/.orca/sessions/<id>/ — conversation, timeline, sub-agent traces, meta, summary.
 *
 * **FTS5 session index (recall_session_history):** Upserts run only in **Tauri** via
 * `orca_index_upsert_message` after each persisted message (`appendConversationMessage`). The index
 * lives at `~/.orca/session-index.sqlite`. **Browser / web dev:** no SQLite index — `searchSessionsFts`
 * returns an empty array; conversations may still persist to localStorage keys (`orca.file.*`,
 * `orca.jsonl.*`) without FTS search.
 */

import type { ChatMessage } from '../orchestrator/types'
import * as tauri from '../tauri'
import { getOrcaSessionId } from './orcaSessionId'
import { workspaceStorageHash } from './taskPersistence'

/** When set (e.g. resume incomplete session), conversation files use this id exactly — no workspace suffix. */
let conversationSessionKeyOverride: string | null = null

/**
 * While set, {@link getDefaultSessionId} hashes this path for the workspace suffix instead of the live
 * `rootPath` (1-shot temp dirs switch `rootPath` without changing the orchestrator session bucket).
 */
let orchestratorWorkspaceKeyPin: string | null = null

/** Pin conversation storage to an existing ~/.orca/sessions/<id> folder (resume flow). */
export function setConversationSessionKeyOverride(id: string | null): void {
  conversationSessionKeyOverride = id?.trim() || null
}

/** Call when switching workspace folders so the next project gets a normal per-workspace session key. */
export function clearConversationSessionKeyOverride(): void {
  conversationSessionKeyOverride = null
}

/** Pin (or clear) which workspace path is hashed into the default session id — see {@link orchestratorWorkspaceKeyPin}. */
export function pinOrchestratorWorkspaceKeyForSession(rootPath: string | null): void {
  orchestratorWorkspaceKeyPin = rootPath?.trim() || null
}

const lastPersistedMessageCount = new Map<string, number>()

function sessionPrefix(sessionId: string): string {
  return `sessions/${sessionId}`
}

function browserConversationKey(sessionId: string): string {
  return `orca.conversation.${sessionId}`
}

export function messageContentText(msg: ChatMessage): string {
  if (msg.role === 'system') return msg.content
  if (msg.role === 'user') {
    if (typeof msg.content === 'string') return msg.content
    return msg.content
      .map((p) => (p.type === 'text' ? p.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  if (msg.role === 'assistant') {
    return typeof msg.content === 'string' ? msg.content ?? '' : ''
  }
  return msg.content
}

async function orcaAppendJsonl(relative: string, record: unknown): Promise<void> {
  const line = JSON.stringify(record)
  if (tauri.isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('orca_append_file', { relative, line })
    return
  }
  const key = `orca.jsonl.${relative}`
  const prev = typeof localStorage !== 'undefined' ? localStorage.getItem(key) ?? '' : ''
  const next = prev + (prev && !prev.endsWith('\n') ? '\n' : '') + line + '\n'
  try {
    localStorage.setItem(key, next)
  } catch {
    /* quota */
  }
}

async function orcaWrite(relative: string, content: string): Promise<void> {
  if (tauri.isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('orca_write_file', { relative, content })
    return
  }
  try {
    localStorage.setItem(`orca.file.${relative}`, content)
  } catch {
    /* quota */
  }
}

async function orcaMkdirp(relative: string): Promise<void> {
  if (tauri.isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('orca_mkdir_p', { relative })
  }
}

export async function ensureSessionLayout(sessionId: string): Promise<void> {
  const base = sessionPrefix(sessionId)
  await orcaMkdirp(base)
  await orcaMkdirp(`${base}/sub-agents`)
}

/** Write / update session meta (incomplete run flag for resume UI). */
export async function writeSessionMeta(
  sessionId: string,
  meta: {
    incomplete: boolean
    workspaceRoot?: string | null
  }
): Promise<void> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return
  const { useTodoStore } = await import('../../store/todoStore')

  await ensureSessionLayout(sessionId)
  const tasks = useTodoStore.getState().tasks
  const totalTasks = tasks.length
  const completedTasks = tasks.reduce(
    (acc, task) => (task.status === 'completed' ? acc + 1 : acc),
    0
  )
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
  const currentTaskNumber =
    totalTasks > 0
      ? Math.min(totalTasks, completedTasks + (meta.incomplete && completedTasks < totalTasks ? 1 : 0))
      : 0
  const payload = {
    incomplete: meta.incomplete,
    updatedAtMs: Date.now(),
    workspaceRoot: meta.workspaceRoot ?? undefined,
    progressPercent,
    currentTaskNumber,
    completedTaskCount: completedTasks,
    totalTaskCount: totalTasks,
  }
  await orcaWrite(`${sessionPrefix(sessionId)}/session-meta.json`, JSON.stringify(payload, null, 2))
}

export async function appendConversationMessage(
  sessionId: string,
  index: number,
  msg: ChatMessage
): Promise<void> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return

  await ensureSessionLayout(sessionId)
  const record = {
    index,
    at: Date.now(),
    message: msg,
  }
  await orcaAppendJsonl(`${sessionPrefix(sessionId)}/conversation.jsonl`, record)

  const text = messageContentText(msg)
  if (text.trim() && tauri.isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('orca_index_upsert_message', {
        sessionId,
        messageIndex: index,
        content: text.slice(0, 50_000),
      })
    } catch (e) {
      console.warn('[orca] index upsert failed', e)
    }
  }
}

/**
 * Sync full in-memory message list to disk (append-only new suffix).
 */
export async function syncConversationToDisk(sessionId: string, messages: ChatMessage[]): Promise<void> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return

  let start = lastPersistedMessageCount.get(sessionId) ?? 0
  if (start > messages.length) start = 0
  for (let i = start; i < messages.length; i++) {
    await appendConversationMessage(sessionId, i, messages[i]!)
  }
  lastPersistedMessageCount.set(sessionId, messages.length)

  void import('../vault/vaultChatTranscript').then((m) =>
    m.scheduleOrchestratorVaultChatMirror(sessionId, messages)
  )

  if (!tauri.isTauri()) {
    try {
      localStorage.setItem(
        browserConversationKey(sessionId),
        JSON.stringify(messages.map((m) => ({ m, at: Date.now() })))
      )
    } catch {
      /* quota */
    }
  }
}

export function resetPersistedMessageCursor(sessionId: string, count: number): void {
  lastPersistedMessageCount.set(sessionId, count)
}

/**
 * Rotate an unbounded `conversation.jsonl` down to a `replacement` message list.
 *
 * Writes the current on-disk contents (if any) to `conversation.<archiveLabel>.jsonl`
 * under the same session folder, then overwrites the live JSONL with freshly
 * re-indexed rows for `replacement`. Resets the in-memory persistence cursor so
 * the caller can continue appending via {@link syncConversationToDisk} without
 * double-writing.
 *
 * Used by auto-compaction ({@link ../persistence/sessionCompaction}): after
 * `summary.md` is written, the full transcript is archived and the live file
 * shrinks to a synthetic summary-prefix + the most recent N messages.
 *
 * No-op (and returns zeros) when persistence is disabled.
 */
export async function archiveConversationAndReplace(
  sessionId: string,
  replacement: ChatMessage[],
  archiveLabel: string = `archive-${Date.now()}`
): Promise<{ archivedCount: number; retainedCount: number }> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) {
    return { archivedCount: 0, retainedCount: 0 }
  }

  await ensureSessionLayout(sessionId)

  const existing = await loadConversationFromDisk(sessionId)
  if (existing.length > 0) {
    const archiveRel = `${sessionPrefix(sessionId)}/conversation.${archiveLabel}.jsonl`
    const now = Date.now()
    const archiveContent =
      existing
        .map((m, i) => JSON.stringify({ index: i, at: now, message: m }))
        .join('\n') + '\n'
    await orcaWrite(archiveRel, archiveContent)
  }

  const now = Date.now()
  const rebuilt =
    replacement.length > 0
      ? replacement
          .map((m, i) => JSON.stringify({ index: i, at: now, message: m }))
          .join('\n') + '\n'
      : ''
  await orcaWrite(`${sessionPrefix(sessionId)}/conversation.jsonl`, rebuilt)

  if (!tauri.isTauri()) {
    try {
      localStorage.setItem(
        browserConversationKey(sessionId),
        JSON.stringify(replacement.map((m) => ({ m, at: now })))
      )
    } catch {
      /* quota */
    }
  }

  lastPersistedMessageCount.set(sessionId, replacement.length)
  return { archivedCount: existing.length, retainedCount: replacement.length }
}

export async function appendTimelineEvent(
  sessionId: string,
  event: Record<string, unknown>
): Promise<void> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return
  await ensureSessionLayout(sessionId)
  await orcaAppendJsonl(`${sessionPrefix(sessionId)}/timeline.jsonl`, {
    at: Date.now(),
    ...event,
  })
}

export async function appendSubAgentTrace(
  sessionId: string,
  agentId: string,
  line: Record<string, unknown>
): Promise<void> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return
  await ensureSessionLayout(sessionId)
  const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  await orcaAppendJsonl(`${sessionPrefix(sessionId)}/sub-agents/${safeId}.jsonl`, line)
}

export async function loadConversationFromDisk(sessionId: string): Promise<ChatMessage[]> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return []

  if (tauri.isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const raw = (await invoke<string | null>('orca_read_file', {
      relative: `${sessionPrefix(sessionId)}/conversation.jsonl`,
    })) as string | null
    if (!raw?.trim()) return []
    const messages: ChatMessage[] = []
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        const row = JSON.parse(t) as { message?: ChatMessage; index?: number }
        if (row.message) messages.push(row.message)
      } catch {
        /* skip bad line */
      }
    }
    return messages
  }

  try {
    const raw = localStorage.getItem(browserConversationKey(sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<{ m: ChatMessage }>
    return parsed.map((x) => x.m)
  } catch {
    return []
  }
}

/** One line from `sessions/<id>/timeline.jsonl` (tool starts/ends, etc.). */
export type TimelineJsonlRecord = {
  at: number
  kind?: string
  line?: string
} & Record<string, unknown>

/**
 * Soft cap on how many timeline rows we hydrate into the activity store on load.
 * Timeline is append-only and can grow into the tens of thousands of lines on
 * old sessions; loading all of them synchronously is the primary source of
 * "freezes when opening a project" on small canvases. The tail is always the
 * interesting part, so we read the whole file but only parse the last N lines.
 */
const TIMELINE_LOAD_TAIL_LIMIT = 500

function parseJsonlTail(raw: string, limit: number): TimelineJsonlRecord[] {
  if (!raw.trim()) return []
  const lines = raw.split('\n')
  const start = Math.max(0, lines.length - limit)
  const out: TimelineJsonlRecord[] = []
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as TimelineJsonlRecord)
    } catch {
      /* skip malformed row */
    }
  }
  return out
}

export async function loadTimelineFromDisk(sessionId: string): Promise<TimelineJsonlRecord[]> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return []

  if (tauri.isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const raw = (await invoke<string | null>('orca_read_file', {
      relative: `${sessionPrefix(sessionId)}/timeline.jsonl`,
    })) as string | null
    return parseJsonlTail(raw ?? '', TIMELINE_LOAD_TAIL_LIMIT)
  }

  try {
    const key = `orca.jsonl.${sessionPrefix(sessionId)}/timeline.jsonl`
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) ?? '' : ''
    return parseJsonlTail(raw, TIMELINE_LOAD_TAIL_LIMIT)
  } catch {
    return []
  }
}

export async function searchSessionsFts(
  query: string,
  limit = 10
): Promise<Array<{ sessionId: string; messageIndex: number; content: string; score: number }>> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return []
  if (!tauri.isTauri() || !query.trim()) return []
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const fetchCap = Math.min(100, Math.max(limit, Math.ceil(limit * 2.5)))
    const rows = (await invoke<
      Array<{
        session_id: string
        message_index: number
        content: string
        bm25: number
      }>
    >('orca_index_search', { query: query.trim(), limit: fetchCap })) as Array<{
      session_id: string
      message_index: number
      content: string
      bm25: number
    }>
    const maxIdx = rows.reduce((m, r) => Math.max(m, Number(r.message_index)), 0)
    const denom = Math.max(1, maxIdx)
    const ranked = [...rows]
      .map((r) => {
        const messageIndex = Number(r.message_index)
        const bm25 = Number(r.bm25)
        const recencyBoost = (messageIndex / denom) * 1e-6
        return {
          sessionId: r.session_id,
          messageIndex,
          content: r.content,
          score: bm25 + recencyBoost,
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    return ranked
  } catch (e) {
    console.warn('[orca] fts search failed', e)
    return []
  }
}

export function getDefaultSessionId(): string {
  if (conversationSessionKeyOverride) return conversationSessionKeyOverride
  const base = getOrcaSessionId()
  try {
    // Avoid static import of workspaceStore (breaks circular init with workspace handoff).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useWorkspaceStore } = require('../../store/workspaceStore') as typeof import('../../store/workspaceStore')
    const liveRoot = useWorkspaceStore.getState().rootPath ?? '.'
    const rootForHash = orchestratorWorkspaceKeyPin ?? liveRoot
    const wh = workspaceStorageHash(rootForHash)
    if (!wh) return base
    return `${base}_${wh}`
  } catch {
    return base
  }
}

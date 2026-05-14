/**
 * Full orchestrator chat as markdown under workspace `Orca/chat/<sessionId>.md` (Obsidian vault when
 * workspace = vault). Gated by Settings; never throws.
 */

import type { ChatMessage } from '../orchestrator/types'
import * as tauri from '../tauri'
import { isCanvasPersistenceHydrating } from '../canvasStatePersistence'
import { messageContentText } from '../persistence/sessionPersistence'
import { useSettingsStore } from '../../store/settingsStore'
import {
  recordVaultMirrorSuccess,
  reportVaultMirrorFailure,
} from '../../store/vaultMirrorDiagnosticsStore'
import {
  applyVaultSecretRedaction,
  ensureDirForWorkspaceRelativeFile,
  maybeScheduleMemPalaceScanAfterMarkdownWrite,
  vaultBrainMirrorEnabled,
} from './vaultBrainMirror'

const CHAT_PREFIX = 'Orca/chat'
const MAX_MESSAGE_CHARS = 200_000
const MAX_FILE_CHARS = 1_500_000
/** Debounce for mirroring markdown when JSONL syncs every turn (mirror is not per-turn). */
const VAULT_CHAT_MIRROR_IDLE_MS = 10_000

let vaultChatMirrorIdleTimer: ReturnType<typeof setTimeout> | null = null

/** Schedule `Orca/chat/*.md` mirror after idle (JSONL remains canonical per-turn). */
export function scheduleOrchestratorVaultChatMirror(sessionId: string, messages: ChatMessage[]): void {
  if (vaultChatMirrorIdleTimer) clearTimeout(vaultChatMirrorIdleTimer)
  vaultChatMirrorIdleTimer = setTimeout(() => {
    vaultChatMirrorIdleTimer = null
    void mirrorOrchestratorConversationMarkdownToVault(sessionId, messages)
  }, VAULT_CHAT_MIRROR_IDLE_MS)
}

/** Cancel idle timer and mirror immediately (orchestrator run finished or app wants a flush). */
export function flushOrchestratorVaultChatMirror(sessionId: string, messages: ChatMessage[]): void {
  if (vaultChatMirrorIdleTimer) {
    clearTimeout(vaultChatMirrorIdleTimer)
    vaultChatMirrorIdleTimer = null
  }
  void mirrorOrchestratorConversationMarkdownToVault(sessionId, messages)
}

function safeSessionFileSegment(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'session'
}

function firstUserTitleLine(messages: ChatMessage[]): string {
  for (const m of messages) {
    if (m.role === 'user') {
      const t = messageContentText(m).trim().split('\n')[0] ?? ''
      const one = t.slice(0, 120)
      if (one) return one.replace(/[#|[\]]/g, '')
    }
  }
  return 'Orca orchestrator chat'
}

function formatMessageForMarkdown(msg: ChatMessage, index: number): string {
  if (msg.role === 'system') {
    return `### [System]\n\n*(Orca system prompt omitted — index ${index})*\n`
  }
  if (msg.role === 'user') {
    const body = applyVaultSecretRedaction(messageContentText(msg)).slice(0, MAX_MESSAGE_CHARS)
    return `### User\n\n${body}\n`
  }
  if (msg.role === 'assistant') {
    const text = typeof msg.content === 'string' ? msg.content ?? '' : ''
    const scrubbed = applyVaultSecretRedaction(text).slice(0, MAX_MESSAGE_CHARS)
    let block = `### Assistant\n\n${scrubbed || '(no text)'}\n`
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const names = msg.tool_calls.map((tc) => tc.function?.name ?? '?').join(', ')
      block += `\n*(tool calls: ${names})*\n`
    }
    return block
  }
  if (msg.role === 'tool') {
    const body = applyVaultSecretRedaction(msg.content).slice(0, MAX_MESSAGE_CHARS)
    return `### Tool (${msg.tool_call_id.slice(0, 24)})\n\n\`\`\`text\n${body}\n\`\`\`\n`
  }
  return ''
}

/**
 * Writes/replaces `Orca/chat/<sessionId>.md` with the current conversation (markdown, Obsidian-friendly).
 */
export async function mirrorOrchestratorConversationMarkdownToVault(
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  if (!vaultBrainMirrorEnabled()) return
  if (!useSettingsStore.getState().orcaVaultMirrorChatTranscript) return
  if (!tauri.isTauri()) return
  if (isCanvasPersistenceHydrating()) return
  const safeId = safeSessionFileSegment(sessionId)
  const rel = `${CHAT_PREFIX}/${safeId}.md`
  try {
    const ws = await tauri.getWorkspace()
    if (!ws?.path || ws.path === '.') return

    const title = firstUserTitleLine(messages)
    const updated = new Date().toISOString()

    const parts: string[] = []
    for (let i = 0; i < messages.length; i++) {
      parts.push(formatMessageForMarkdown(messages[i]!, i))
    }
    let body = parts.join('\n')
    if (body.length > MAX_FILE_CHARS) {
      body =
        body.slice(0, MAX_FILE_CHARS) +
        `\n\n---\n\n*(Export truncated at ${MAX_FILE_CHARS} characters.)*\n`
    }

    const file = `---
kind: Orca orchestrator transcript
session_id: ${sessionId}
workspace: ${ws.path.replace(/\\/g, '/')}
title: ${JSON.stringify(title)}
updated: ${updated}
---

# Orchestrator chat

${body}
`
    await ensureDirForWorkspaceRelativeFile(rel)
    await tauri.writeFile(rel, file)
    recordVaultMirrorSuccess('chat-transcript', rel)
    void import('./centralBrainMirror').then((m) => m.mirrorWorkspaceFileToCentral(rel, file))
    maybeScheduleMemPalaceScanAfterMarkdownWrite(rel)
  } catch (e) {
    reportVaultMirrorFailure('chat-transcript', rel, e)
  }
}

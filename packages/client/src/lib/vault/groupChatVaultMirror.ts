/**
 * Best-effort team-chat JSONL mirror → workspace vault.
 *
 * On every `postMessage` in `useGroupChatStore` we append one JSONL line to
 * `Orca/chat/team/<sessionId>.jsonl` in the user's workspace (the vault when
 * a workspace is open). Gated by the same vault-mirror flag as the markdown
 * transcript so it's a pure opt-in feature. Never throws — failures are
 * reported to `vaultMirrorDiagnosticsStore` for the Settings diagnostics pane.
 *
 * Called from `registerGroupChatVaultMirror` at app startup (side-effect
 * import in the client shell).
 */
import {
  subscribeGroupChatSink,
  type GroupChatMessage,
} from '../../store/groupChatStore'
import * as tauri from '../tauri'
import { isCanvasPersistenceHydrating } from '../canvasStatePersistence'
import { useSettingsStore } from '../../store/settingsStore'
import {
  recordVaultMirrorSuccess,
  reportVaultMirrorFailure,
} from '../../store/vaultMirrorDiagnosticsStore'
import {
  applyVaultSecretRedaction,
  ensureDirForWorkspaceRelativeFile,
  vaultBrainMirrorEnabled,
} from './vaultBrainMirror'

const TEAM_CHAT_PREFIX = 'Orca/chat/team'
/** Hard cap on a single JSONL file before we roll (just defensive truncation). */
const MAX_TEAM_JSONL_CHARS = 4_000_000

function safeSessionFileSegment(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'session'
}

/**
 * Serialize a group-chat message to a JSONL line. Sensitive-marked
 * (`ephemeral`) messages are skipped; `internal` is redacted for secrets.
 */
function serializeMessage(m: GroupChatMessage): string | null {
  if (m.sensitivity === 'ephemeral') return null
  const body = applyVaultSecretRedaction(m.body)
  const line = {
    v: m.schemaVersion,
    id: m.id,
    seq: m.seq,
    kind: m.kind,
    session_id: m.sessionId,
    sender_name: m.senderName,
    sender_tile_id: m.senderTileId ?? null,
    body,
    mentions: m.mentions,
    thread_id: m.threadId ?? null,
    reply_to: m.replyTo ?? null,
    correlation_id: m.correlationId ?? null,
    created_at: m.createdAt,
    provenance: m.provenance,
    sensitivity: m.sensitivity ?? 'internal',
  }
  return JSON.stringify(line)
}

/** Append `line\n` to `rel`. Uses read-concat-write because tauri has no append helper. */
async function appendLineToWorkspaceFile(rel: string, line: string): Promise<void> {
  let prev = ''
  try {
    prev = await tauri.readFile(rel)
  } catch {
    // file doesn't exist yet → prev stays empty
  }
  let next = prev + line + '\n'
  if (next.length > MAX_TEAM_JSONL_CHARS) {
    // Truncate from the top (oldest lines) to keep the file size bounded.
    const trimmed = next.slice(next.length - MAX_TEAM_JSONL_CHARS)
    const firstNewline = trimmed.indexOf('\n')
    next = firstNewline >= 0 ? trimmed.slice(firstNewline + 1) : trimmed
  }
  await tauri.writeFile(rel, next)
}

async function mirrorMessage(m: GroupChatMessage): Promise<void> {
  if (!vaultBrainMirrorEnabled()) return
  if (!useSettingsStore.getState().orcaVaultMirrorChatTranscript) return
  if (!tauri.isTauri()) return
  if (isCanvasPersistenceHydrating()) return
  const payload = serializeMessage(m)
  if (!payload) return
  const safeId = safeSessionFileSegment(m.sessionId)
  const rel = `${TEAM_CHAT_PREFIX}/${safeId}.jsonl`
  try {
    const ws = await tauri.getWorkspace()
    if (!ws?.path || ws.path === '.') return
    await ensureDirForWorkspaceRelativeFile(rel)
    await appendLineToWorkspaceFile(rel, payload)
    recordVaultMirrorSuccess('team-chat-jsonl', rel)
  } catch (e) {
    reportVaultMirrorFailure('team-chat-jsonl', rel, e)
  }
}

let registered = false

/**
 * Idempotent — wire the group-chat sink once at app startup. Returns the
 * unsubscribe function so tests can tear down.
 */
export function registerGroupChatVaultMirror(): () => void {
  if (registered) return () => {}
  registered = true
  return subscribeGroupChatSink((m) => {
    // Fire-and-forget; the sink must never block the caller.
    void mirrorMessage(m)
  })
}

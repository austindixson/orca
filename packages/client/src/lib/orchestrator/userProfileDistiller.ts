/**
 * Session-end distillation of **user-model** bullets into `USER.md` (separate from MEMORY.md).
 *
 * - Gated by `orcaUserProfileDistillerEnabled` + `orcaUserProfileEnabled` (default off).
 * - Skips heartbeat / aborted runs and short sessions.
 * - Redacts via `applyVaultSecretRedaction` before LLM + disk.
 */
import * as tauri from '../tauri'
import { useSettingsStore } from '../../store/settingsStore'
import {
  chatCompletionWithTools,
  orchestratorChatOptionsFromStore,
} from './chatCompletion'
import { resolveApiKey } from '../llmCredentials'
import {
  recordVaultMirrorSuccess,
  reportVaultMirrorFailure,
} from '../../store/vaultMirrorDiagnosticsStore'
import { applyVaultSecretRedaction } from '../vault/vaultBrainMirror'
import type { ChatMessage } from './types'
import { messageContentText } from '../persistence/sessionPersistence'

const WORKSPACE_USER_REL = '.orca/USER.md'
const USER_SECTION = '## Distilled user notes (auto)'
const MAX_BULLETS = 8
const MAX_SECTION_CHARS = 4_000
const MAX_TOTAL_LINES = 28
const MIN_SESSION_MESSAGES = 4
const TRANSCRIPT_MAX_CHARS = 8_000

function redact(s: string): string {
  return applyVaultSecretRedaction(s)
}

export function upsertUserProfileDistilledSection(existing: string, newBullets: string[]): string {
  const trimmedNew = newBullets.map((b) => b.trim()).filter(Boolean)
  if (trimmedNew.length === 0 && !existing.includes(USER_SECTION)) return existing

  const hasSection = existing.includes(USER_SECTION)
  let beforeSection = existing
  let existingBullets: string[] = []
  let afterSection = ''

  if (hasSection) {
    const idx = existing.indexOf(USER_SECTION)
    beforeSection = existing.slice(0, idx).trimEnd()
    const rest = existing.slice(idx + USER_SECTION.length).replace(/^\s*\n/, '')
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
    if (merged.length >= MAX_TOTAL_LINES) break
  }

  let sectionBodyText = merged.join('\n')
  while (
    (sectionBodyText.length > MAX_SECTION_CHARS || merged.length > MAX_TOTAL_LINES) &&
    merged.length > 1
  ) {
    merged.pop()
    sectionBodyText = merged.join('\n')
  }
  if (merged.length === 1 && sectionBodyText.length > MAX_SECTION_CHARS) {
    const t = merged[0]!
    merged[0] = `${t.slice(0, Math.max(0, MAX_SECTION_CHARS - 10))}…`
    sectionBodyText = merged.join('\n')
  }

  const section = `${USER_SECTION}\n\n${sectionBodyText}\n`
  const head = beforeSection ? beforeSection + '\n\n' : ''
  const tail = afterSection ? '\n' + afterSection : ''
  return `${head}${section}${tail}`.replace(/\n{3,}/g, '\n\n')
}

function buildTranscript(messages: ChatMessage[]): string {
  const slice = messages.slice(-24)
  const lines: string[] = []
  for (const m of slice) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const t = redact(messageContentText(m).trim())
    if (!t) continue
    lines.push(`${m.role}: ${t}`)
  }
  const joined = lines.join('\n')
  return joined.length > TRANSCRIPT_MAX_CHARS
    ? `…(truncated)\n${joined.slice(-TRANSCRIPT_MAX_CHARS)}`
    : joined
}

async function distillUserBulletsWithLlm(transcript: string): Promise<string[] | null> {
  if (!transcript.trim()) return []
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
    'You distill a short user profile from chat. Output at most 8 markdown bullets starting with "- ". ' +
    'Each bullet: one concrete preference, habit, communication style, or goal inferred about the **human user** ' +
    '(not the codebase). Skip bullets you are not reasonably confident about. ' +
    'No heading, no code fence. Redact secrets.'
  const user = `Recent transcript:\n${transcript}`
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
      6_000,
      orchestratorChatOptionsFromStore(selected.provider)
    )
    const raw = res.choices[0]?.message?.content ?? ''
    const bullets = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('-'))
      .map((l) => redact(l))
      .slice(0, MAX_BULLETS)
    return bullets.length > 0 ? bullets : []
  } catch {
    return null
  }
}

export type UserProfileDistillerInput = {
  sessionId: string
  messageCount?: number
  aborted?: boolean
  /** Skip synthetic proactive runs */
  runSource?: 'user' | 'sub_agent_handoff' | 'heartbeat'
  sessionMessages: ChatMessage[]
}

export async function runUserProfileDistillerAtSessionEnd(
  opts: UserProfileDistillerInput
): Promise<void> {
  const s = useSettingsStore.getState()
  if (!s.orcaUserProfileDistillerEnabled || !s.orcaUserProfileEnabled) return
  if (!tauri.isTauri()) return
  if (opts.aborted) return
  if (opts.runSource === 'heartbeat') return
  if (typeof opts.messageCount === 'number' && opts.messageCount < MIN_SESSION_MESSAGES) return

  const transcript = buildTranscript(opts.sessionMessages)
  if (!transcript.trim()) return

  let bullets = await distillUserBulletsWithLlm(transcript)
  if (bullets === null) return
  if (bullets.length === 0) return

  const source = s.orcaUserProfileSource

  const writeWorkspace = async (): Promise<void> => {
    const ws = await tauri.getWorkspace()
    if (!ws?.path || ws.path === '.') return
    let prior = ''
    try {
      prior = (await tauri.readFile(WORKSPACE_USER_REL)).trimEnd()
    } catch {
      prior = ''
    }
    const nextBody = upsertUserProfileDistilledSection(prior, bullets)
    try {
      await tauri.writeFile(WORKSPACE_USER_REL, nextBody + (nextBody.endsWith('\n') ? '' : '\n'))
      recordVaultMirrorSuccess('user-profile-distiller', WORKSPACE_USER_REL)
    } catch (e) {
      reportVaultMirrorFailure('user-profile-distiller', WORKSPACE_USER_REL, e)
    }
  }

  const writeUserGlobal = async (): Promise<void> => {
    let prior = ''
    try {
      const cur = await tauri.readOrcaDataFile('USER.md')
      prior = (cur ?? '').trimEnd()
    } catch {
      prior = ''
    }
    const nextBody = upsertUserProfileDistilledSection(prior, bullets)
    try {
      await tauri.writeOrcaDataFile('USER.md', nextBody + (nextBody.endsWith('\n') ? '' : '\n'))
      recordVaultMirrorSuccess('user-profile-distiller', '~/.orca/USER.md')
    } catch (e) {
      reportVaultMirrorFailure('user-profile-distiller', '~/.orca/USER.md', e)
    }
  }

  if (source === 'workspace') {
    await writeWorkspace()
  } else if (source === 'user') {
    await writeUserGlobal()
  } else {
    await writeWorkspace()
  }
}

/** @internal */
export function _upsertUserProfileDistilledSectionForTest(
  existing: string,
  bullets: string[]
): string {
  return upsertUserProfileDistilledSection(existing, bullets)
}

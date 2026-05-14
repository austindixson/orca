/**
 * GBrain-style compaction: conversation → summary.md + structured metadata.
 */

import type { ChatMessage } from '../orchestrator/types'
import {
  chatCompletionWithTools,
  orchestratorChatOptionsFromStore,
} from '../orchestrator/chatCompletion'
import { resolveApiKey } from '../llmCredentials'
import { useSettingsStore } from '../../store/settingsStore'
import { messageContentText, loadConversationFromDisk } from './sessionPersistence'
import { detectEntities } from './entityDetector'
import * as tauri from '../tauri'
import { getOrcaSessionId } from './orcaSessionId'

export interface CompactionResult {
  summary: string
  keyDecisions: string[]
  entitiesExtracted: string[]
}

function transcriptFromMessages(messages: ChatMessage[], maxChars = 80_000): string {
  const parts: string[] = []
  let n = 0
  for (const m of messages) {
    const role = m.role
    const text = messageContentText(m)
    const line = `[${role}]\n${text}\n`
    if (n + line.length > maxChars) break
    parts.push(line)
    n += line.length
  }
  return parts.join('\n')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

/** Cap kept-tail length to avoid re-blowing the window right after compaction. */
function clampKeepLastN(threshold: number): number {
  const t = Number.isFinite(threshold) && threshold > 0 ? Math.floor(threshold) : 50
  return Math.max(10, Math.min(40, Math.floor(t / 2)))
}

/**
 * Append a dated digest to `~/.orca/MEMORY.md` (user-global long-term memory),
 * so auto-compaction behaves like "self-compact + persist into memory" rather
 * than just trimming the log. Safe to call in the browser (becomes a no-op).
 */
async function appendToUserMemory(
  sessionId: string,
  summary: string,
  keyDecisions: string[]
): Promise<void> {
  if (!tauri.isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  const iso = new Date().toISOString()
  const decisionLines =
    keyDecisions.length > 0 ? keyDecisions.map((d) => `- ${d}`).join('\n') : '- (no discrete decisions)'
  const block =
    `\n## [${iso}] Session ${sessionId} compacted\n\n` +
    `${truncate(summary, 2_000)}\n\n` +
    `### Key decisions\n${decisionLines}\n`
  await invoke('orca_append_file', { relative: 'MEMORY.md', line: block })
}

export async function compactSession(sessionId: string): Promise<CompactionResult> {
  const messages = await loadConversationFromDisk(sessionId)
  const transcript = transcriptFromMessages(messages)

  const settings = useSettingsStore.getState()
  const models = settings.getAvailableModels()
  const selected =
    models.find((m) => m.id === settings.selectedModel) ?? models.find((m) => m.provider === 'openrouter') ?? models[0]

  const fallbackSummary = (): CompactionResult => {
    const lines = transcript.split('\n').filter(Boolean).slice(0, 40)
    return {
      summary: lines.join('\n').slice(0, 8000),
      keyDecisions: [],
      entitiesExtracted: [],
    }
  }

  if (!selected || !transcript.trim()) {
    return fallbackSummary()
  }

  const providerConfig = settings.providers[selected.provider]
  const apiKey = await resolveApiKey(selected.provider, providerConfig.apiKey)

  try {
    const sys =
      'You compress an agent session into a concise "compiled truth" markdown summary. Output JSON only with keys: summary (string), keyDecisions (string array), entitiesExtracted (string array of files/people/concepts mentioned).'
    const user = `Session transcript:\n\n${transcript.slice(0, 60_000)}`
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
      120_000,
      orchestratorChatOptionsFromStore(selected.provider)
    )
    const raw = res.choices[0]?.message?.content ?? ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as CompactionResult) : null
    if (parsed?.summary) {
      const rel = `sessions/${sessionId}/summary.md`
      const entityLines = detectEntities(transcript)
        .slice(0, 30)
        .map((e) => `- (${e.type}, tier ${e.tier}) ${e.name} — ${e.mentions}×`)
      const entitiesBlock =
        entityLines.length > 0
          ? `\n## Detected entities\n\n${entityLines.join('\n')}\n`
          : ''
      const md = `# Session summary\n\n${parsed.summary}\n${entitiesBlock}`
      if (tauri.isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('orca_write_file', { relative: rel, content: md })
      } else {
        try {
          localStorage.setItem(`orca.summary.${sessionId}`, md)
        } catch {
          /* quota */
        }
      }

      // Permanently anchor the digest in ~/.orca/MEMORY.md so the next session
      // open inherits the takeaways even after conversation.jsonl rotates.
      try {
        await appendToUserMemory(sessionId, parsed.summary, parsed.keyDecisions ?? [])
      } catch (e) {
        console.warn('[orca] appendToUserMemory failed', e)
      }

      // Rotate conversation.jsonl to a synthetic summary prefix + recent tail.
      // Next loadSession is cheap; old transcript lives in conversation.archive-*.jsonl.
      try {
        const keepLastN = clampKeepLastN(settings.orcaAutoCompactionThreshold)
        const { useOrchestratorSessionStore } = await import('../../store/orchestratorSessionStore')
        const prefix: ChatMessage = {
          role: 'system',
          content: `[Session compacted ${new Date().toISOString()}] Prior context condensed to ~/.orca/sessions/${sessionId}/summary.md. Earlier turns archived. Digest:\n\n${truncate(parsed.summary, 4_000)}`,
        }
        await useOrchestratorSessionStore.getState().applyCompactionRotation(prefix, keepLastN)
      } catch (e) {
        console.warn('[orca] compaction rotation failed', e)
      }

      return {
        summary: parsed.summary,
        keyDecisions: parsed.keyDecisions ?? [],
        entitiesExtracted: parsed.entitiesExtracted ?? [],
      }
    }
  } catch (e) {
    console.warn('[orca] compaction LLM failed', e)
  }

  return fallbackSummary()
}

/**
 * Injected into the orchestrator system prompt when Settings → auto-compaction is enabled
 * (Hermes-style “compiled” continuity hint).
 */
export function getAutoCompactionSystemPromptBlock(): string {
  if (useSettingsStore.getState().orcaAutoCompactionEnabled !== true) return ''
  const sessionId = getOrcaSessionId()
  return `

### Session auto-compaction (enabled in Settings)
Long conversations are periodically summarized to **\`~/.orca/sessions/${sessionId}/summary.md\`** (desktop), and the live **\`conversation.jsonl\`** is rotated — the full transcript moves to \`conversation.archive-*.jsonl\` and a compact digest is appended to **\`~/.orca/MEMORY.md\`**. Those paths are **outside** the workspace — do not rely on \`read_file\` for them. Use \`recall_session_history\` to keyword-search prior orchestrator chat (FTS5 on desktop), and \`search_workspace_memory\` for vault/wiki notes inside the project.
`
}

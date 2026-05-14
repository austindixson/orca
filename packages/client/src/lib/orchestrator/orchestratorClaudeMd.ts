import { isTauri, readFile } from '../tauri'
import { useSettingsStore } from '../../store/settingsStore'
import { truncateString } from './orchestratorContextBudget'

const MAX_CLAUDE_MD_CHARS = 24_000
const MAX_GLOBAL_CHARS = 12_000
const MAX_WORKSPACE_CHARS = 12_000
const MAX_PERSONALITY_CHARS = 8_000
const MAX_SOUL_CHARS = 8_000

/** Relative to workspace root (matches Tauri `read_file` join). Prefer `orca.md`; `CLAUDE.md` remains as legacy fallback. */
const WORKSPACE_RELATIVE = [
  'orca.md',
  '.claude/orca.md',
  'CLAUDE.md',
  '.claude/CLAUDE.md',
] as const

/** Workspace-relative candidates for a standalone personality file. First match wins. */
const WORKSPACE_PERSONALITY_RELATIVE = [
  'personality.md',
  '.orca/personality.md',
  '.claude/personality.md',
] as const

/** Workspace-relative candidates for a standalone soul file. First match wins. */
const WORKSPACE_SOUL_RELATIVE = [
  'soul.md',
  '.orca/soul.md',
  '.claude/soul.md',
] as const

let cache: { merged: string | null; atMs: number; signature: string } | null = null
const CACHE_TTL_MS = 45_000
let inFlight: Promise<string | null> | null = null

function currentSettingsSignature(): string {
  const s = useSettingsStore.getState()
  const name = (s.orchestratorDisplayName ?? '').trim() || 'Assistant'
  return `${name}|${s.orchestratorPersonalityEnabled ? 1 : 0}|${s.orchestratorSoulEnabled ? 1 : 0}`
}

async function resolveHomeInstructionAbsolutePaths(): Promise<string[]> {
  if (!isTauri()) return []
  try {
    const { homeDir } = await import('@tauri-apps/api/path')
    const home = await homeDir()
    if (typeof home === 'string' && home.length > 0) {
      const sep = home.includes('\\') ? '\\' : '/'
      const base = `${home.replace(/[/\\]+$/, '')}${sep}.claude${sep}`
      return [`${base}orca.md`, `${base}CLAUDE.md`]
    }
  } catch {
    /* path API missing or unavailable */
  }
  return []
}

async function readGlobalClaudeMd(): Promise<string | null> {
  for (const abs of await resolveHomeInstructionAbsolutePaths()) {
    try {
      const raw = await readFile(abs)
      const t = raw.trim()
      if (t) return truncateString(t, MAX_GLOBAL_CHARS)
    } catch {
      /* missing or unreadable */
    }
  }
  return null
}

async function readWorkspaceClaudeMd(): Promise<string | null> {
  for (const rel of WORKSPACE_RELATIVE) {
    try {
      const raw = await readFile(rel)
      const t = raw.trim()
      if (t) return truncateString(t, MAX_WORKSPACE_CHARS)
    } catch {
      /* missing or unreadable */
    }
  }
  return null
}

async function resolveHomeAuxPaths(fileName: string): Promise<string[]> {
  if (!isTauri()) return []
  try {
    const { homeDir } = await import('@tauri-apps/api/path')
    const home = await homeDir()
    if (typeof home !== 'string' || home.length === 0) return []
    const sep = home.includes('\\') ? '\\' : '/'
    const base = home.replace(/[/\\]+$/, '')
    return [
      `${base}${sep}.claude${sep}${fileName}`,
      `${base}${sep}.orca${sep}${fileName}`,
    ]
  } catch {
    return []
  }
}

async function readAuxMarkdown(
  workspaceCandidates: readonly string[],
  fileName: string,
  maxChars: number
): Promise<string | null> {
  for (const rel of workspaceCandidates) {
    try {
      const raw = await readFile(rel)
      const t = raw.trim()
      if (t) return truncateString(t, maxChars)
    } catch {
      /* missing or unreadable */
    }
  }
  for (const abs of await resolveHomeAuxPaths(fileName)) {
    try {
      const raw = await readFile(abs)
      const t = raw.trim()
      if (t) return truncateString(t, maxChars)
    } catch {
      /* missing or unreadable */
    }
  }
  return null
}

function mergeBlocks(
  globalPart: string | null,
  workspacePart: string | null,
  personalityPart: string | null,
  soulPart: string | null,
  identityPart: string | null
): string | null {
  if (!globalPart && !workspacePart && !personalityPart && !soulPart && !identityPart) return null
  const parts: string[] = []
  if (identityPart) {
    parts.push(identityPart)
  }
  if (personalityPart) {
    parts.push(`### Personality (personality.md)\n${personalityPart}`)
  }
  if (soulPart) {
    parts.push(`### Soul (soul.md)\n${soulPart}`)
  }
  if (globalPart) {
    parts.push(`### User defaults (~/.claude/orca.md or ~/.claude/CLAUDE.md)\n${globalPart}`)
  }
  if (workspacePart) {
    parts.push(`### Workspace project (orca.md or CLAUDE.md)\n${workspacePart}`)
  }
  const merged = parts.join('\n\n')
  return truncateString(merged, MAX_CLAUDE_MD_CHARS)
}

/**
 * Loads global `~/.claude/orca.md` (then `~/.claude/CLAUDE.md`) plus workspace `orca.md` / `.claude/orca.md`
 * (then legacy `CLAUDE.md` paths), merged for the orchestrator system prompt (workspace section complements user defaults).
 */
export async function loadProjectInstructionsForPrompt(force = false): Promise<string | null> {
  const sig = currentSettingsSignature()
  if (!force && cache && cache.signature === sig && Date.now() - cache.atMs < CACHE_TTL_MS) {
    return cache.merged
  }
  if (!force && inFlight) return inFlight

  const load = async (): Promise<string | null> => {
    const settings = useSettingsStore.getState()
    const personalityEnabled = settings.orchestratorPersonalityEnabled !== false
    const soulEnabled = settings.orchestratorSoulEnabled !== false
    const displayNameRaw = (settings.orchestratorDisplayName ?? '').trim()
    const displayName = displayNameRaw.length > 0 ? displayNameRaw : 'Assistant'
    const identityPart =
      displayName !== 'Assistant'
        ? `### Identity\nYour preferred name in this chat is **${displayName}**. Respond as ${displayName} would, matching any personality/soul guidance below.`
        : null
    const [globalPart, workspacePart, personalityPart, soulPart] = await Promise.all([
      readGlobalClaudeMd(),
      readWorkspaceClaudeMd(),
      personalityEnabled
        ? readAuxMarkdown(WORKSPACE_PERSONALITY_RELATIVE, 'personality.md', MAX_PERSONALITY_CHARS)
        : Promise.resolve(null),
      soulEnabled
        ? readAuxMarkdown(WORKSPACE_SOUL_RELATIVE, 'soul.md', MAX_SOUL_CHARS)
        : Promise.resolve(null),
    ])
    const merged = mergeBlocks(globalPart, workspacePart, personalityPart, soulPart, identityPart)
    cache = { merged, atMs: Date.now(), signature: sig }
    return merged
  }

  if (force) return load()

  inFlight = load()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/** @deprecated Use `loadProjectInstructionsForPrompt` */
export async function loadWorkspaceClaudeMdForPrompt(): Promise<string | null> {
  return loadProjectInstructionsForPrompt()
}

/** First matching personality.md (workspace then home) for canvas narrator voice — independent of prompt toggles. */
const NARRATOR_PERSONALITY_MAX = 1_200

export async function loadPersonalityMarkdownForNarrator(): Promise<string | null> {
  return readAuxMarkdown(WORKSPACE_PERSONALITY_RELATIVE, 'personality.md', NARRATOR_PERSONALITY_MAX)
}

import { readFile, writeFile } from '../tauri'
import { getWorkspaceRootForSkills } from '../skillCommands'

/** Upstream Claude Code skill (not at repo root). */
export const DIVIDE_AND_CONQUER_SKILL_RAW_URL =
  'https://raw.githubusercontent.com/austindixson/divideandconquer/main/claude-code-skill/SKILL.md'

const INSTALL_RELATIVE = '.cursor/skills/divideandconquer/SKILL.md'

const CANDIDATE_RELATIVE_PATHS = [
  '.cursor/skills/divideandconquer/SKILL.md',
  '.claude/skills/divideandconquer/SKILL.md',
  '.openclaw/skills/divideandconquer/SKILL.md',
]

export type DivideAndConquerSkillLoad =
  | {
      guidance: string
      source: 'workspace' | 'installed' | 'fetched-ephemeral'
      persistedRelativePath?: string
      logLine: string
    }
  | { guidance: null; source: 'unavailable'; logLine: string }

function fetchWithTimeout(url: string, ms: number, signal?: AbortSignal): Promise<Response> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  const parent = signal
  if (parent) {
    if (parent.aborted) {
      clearTimeout(t)
      return Promise.reject(parent.reason ?? new Error('aborted'))
    }
    parent.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        ac.abort(parent.reason)
      },
      { once: true }
    )
  }
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(t))
}

/**
 * Load the Divide and Conquer skill for orchestrator decomposition: read from the workspace if
 * present; otherwise fetch from GitHub and install under `.cursor/skills/divideandconquer/` when a
 * workspace root exists and writes are allowed.
 */
export async function loadDivideAndConquerSkillForDecomposition(
  options: { signal?: AbortSignal } = {}
): Promise<DivideAndConquerSkillLoad> {
  for (const rel of CANDIDATE_RELATIVE_PATHS) {
    try {
      const content = await readFile(rel)
      if (content.trim()) {
        return {
          guidance: content,
          source: 'workspace',
          persistedRelativePath: rel,
          logLine: `[Decomposition] Using divideandconquer skill from ${rel}`,
        }
      }
    } catch {
      /* try next */
    }
  }

  let text: string
  try {
    const res = await fetchWithTimeout(DIVIDE_AND_CONQUER_SKILL_RAW_URL, 20_000, options.signal)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    text = await res.text()
    if (!text.trim()) throw new Error('Empty skill body')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      guidance: null,
      source: 'unavailable',
      logLine: `[Decomposition] divideandconquer skill unavailable (${msg})`,
    }
  }

  const ws = await getWorkspaceRootForSkills()
  if (ws) {
    try {
      await writeFile(INSTALL_RELATIVE, text)
      return {
        guidance: text,
        source: 'installed',
        persistedRelativePath: INSTALL_RELATIVE,
        logLine: `[Decomposition] Installed divideandconquer to ${INSTALL_RELATIVE} (austindixson/divideandconquer)`,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        guidance: text,
        source: 'fetched-ephemeral',
        logLine: `[Decomposition] divideandconquer fetched but not saved (${msg}); using in-memory copy for this run`,
      }
    }
  }

  return {
    guidance: text,
    source: 'fetched-ephemeral',
    logLine:
      '[Decomposition] divideandconquer fetched (no workspace root); using in-memory copy for this run',
  }
}

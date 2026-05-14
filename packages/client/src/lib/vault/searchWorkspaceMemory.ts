/**
 * Unified keyword search over workspace markdown mirrors: wiki/, Orca/brain/, Orca/chat/.
 */
import * as tauri from '../tauri'
import { listAllMarkdownPaths } from '../memPalace/buildObsidianBrainGraph'

const MAX_FILE_BYTES = 256 * 1024
export const DEFAULT_MAX_HITS = 24

/** Workspace mirrors + optional `central:` hits merged from Tauri central brain search. */
export type WorkspaceMemoryScopeId = 'wiki' | 'orca_brain' | 'orca_chat' | 'central'

export interface WorkspaceMemoryHit {
  path: string
  snippet: string
  /** Short label for prompt context (e.g. wiki, orca_brain, orca_chat). */
  scope: WorkspaceMemoryScopeId
}

function scopeForPath(normPath: string): WorkspaceMemoryScopeId | null {
  const n = normPath.replace(/\\/g, '/').toLowerCase()
  if (n.startsWith('wiki/')) return 'wiki'
  if (n.startsWith('orca/brain/')) return 'orca_brain'
  if (n.startsWith('orca/chat/')) return 'orca_chat'
  return null
}

function pathMatchesScopes(normPath: string, scopes: WorkspaceMemoryScopeId[]): boolean {
  const s = scopeForPath(normPath)
  return s !== null && scopes.includes(s)
}

const DEFAULT_SCOPES_ALL: WorkspaceMemoryScopeId[] = ['wiki', 'orca_brain', 'orca_chat']

/** Parse tool `scopes` arg; invalid entries ignored. */
export function parseWorkspaceMemoryScopes(raw: unknown): WorkspaceMemoryScopeId[] | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw)) return undefined
  const allow = new Set<WorkspaceMemoryScopeId>(['wiki', 'orca_brain', 'orca_chat'])
  const out: WorkspaceMemoryScopeId[] = []
  for (const x of raw) {
    if (typeof x === 'string' && allow.has(x as WorkspaceMemoryScopeId)) {
      out.push(x as WorkspaceMemoryScopeId)
    }
  }
  return out.length > 0 ? out : undefined
}

/**
 * Keyword search (case-insensitive substring) over markdown files in the given scopes.
 */
export async function searchWorkspaceMemoryMarkdown(
  query: string,
  maxHits = DEFAULT_MAX_HITS,
  scopes: WorkspaceMemoryScopeId[] = DEFAULT_SCOPES_ALL
): Promise<{ hits: WorkspaceMemoryHit[]; scanned_files: number }> {
  const q = query.trim().toLowerCase()
  if (!q) return { hits: [], scanned_files: 0 }

  const paths = await listAllMarkdownPaths()
  const scoped = paths.filter((p) => pathMatchesScopes(p.replace(/\\/g, '/'), scopes))

  const hits: WorkspaceMemoryHit[] = []
  let scanned = 0
  for (const p of scoped) {
    if (hits.length >= maxHits) break
    scanned += 1
    const scope = scopeForPath(p.replace(/\\/g, '/'))
    if (!scope) continue
    let content: string
    try {
      content = await tauri.readFile(p)
    } catch {
      continue
    }
    if (content.length > MAX_FILE_BYTES) {
      content = content.slice(0, MAX_FILE_BYTES)
    }
    const low = content.toLowerCase()
    const idx = low.indexOf(q)
    if (idx < 0) continue
    const start = Math.max(0, idx - 100)
    const snippet = content.slice(start, start + 220).replace(/\s+/g, ' ').trim()
    hits.push({ path: p, snippet, scope })
  }

  return { hits, scanned_files: scoped.length }
}

/**
 * @deprecated Prefer {@link searchWorkspaceMemoryMarkdown} with scopes `wiki` + `orca_brain`.
 * Keyword search over workspace markdown under wiki/ and Orca/brain/ (vault LLM-wiki layer).
 */

import {
  DEFAULT_MAX_HITS,
  searchWorkspaceMemoryMarkdown,
  type WorkspaceMemoryHit,
} from './searchWorkspaceMemory'

export interface WikiSearchHit {
  path: string
  snippet: string
}

export async function searchProjectWikiMarkdown(
  query: string,
  maxHits = DEFAULT_MAX_HITS
): Promise<{ hits: WikiSearchHit[]; scanned_files: number }> {
  const { hits, scanned_files } = await searchWorkspaceMemoryMarkdown(query, maxHits, [
    'wiki',
    'orca_brain',
  ])
  return {
    hits: hits.map(stripScope),
    scanned_files,
  }
}

function stripScope(h: WorkspaceMemoryHit): WikiSearchHit {
  return { path: h.path, snippet: h.snippet }
}

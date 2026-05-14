import { create } from 'zustand'
import { nanoid } from 'nanoid'

export type ResearchEntryKind =
  | 'web_search'
  | 'mcp_context7'
  | 'mcp_generic'
  | 'url_fetch'

/** Orchestrator web_search lifecycle in the Research tile; other kinds omit (treated as done). */
export type ResearchEntryStatus = 'queued' | 'active' | 'done'

export interface ResearchEntry {
  id: string
  ts: number
  kind: ResearchEntryKind
  query: string
  ok: boolean
  /** Set for orchestrator web_search rows pre-registered from a tool batch. */
  status?: ResearchEntryStatus
  error?: string
  abstract?: string
  source?: string
  related?: string[]
  provider?: string
  snippets?: { title: string; body: string; url?: string }[]
  runGeneration?: number
  subAgentTileId?: string
}

const MAX_ENTRIES = 100

function trimBuffer(entries: ResearchEntry[]): ResearchEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries
  return entries.slice(entries.length - MAX_ENTRIES)
}

export type ResearchTab = 'all' | ResearchEntryKind

interface ResearchSessionState {
  entries: ResearchEntry[]
  appendEntry: (partial: Omit<ResearchEntry, 'id' | 'ts'> & { id?: string; ts?: number }) => void
  patchEntry: (id: string, partial: Partial<Omit<ResearchEntry, 'id' | 'ts'>>) => void
  clear: () => void
  /** Entries matching tab + optional text filter (query, abstract, snippet bodies). */
  selectFiltered: (tab: ResearchTab, filterText: string) => ResearchEntry[]
  /** Distinct kinds present in current buffer (for dynamic tabs). */
  getActiveKinds: () => ResearchEntryKind[]
}

function normalizeFilter(t: string): string {
  return t.trim().toLowerCase()
}

function entryMatchesFilter(e: ResearchEntry, q: string): boolean {
  if (!q) return true
  const hay: string[] = [e.query, e.abstract ?? '', e.error ?? '', e.source ?? '']
  for (const s of e.related ?? []) hay.push(s)
  for (const sn of e.snippets ?? []) {
    hay.push(sn.title, sn.body, sn.url ?? '')
  }
  return hay.some((h) => h.toLowerCase().includes(q))
}

export const useResearchSessionStore = create<ResearchSessionState>((set, get) => ({
  entries: [],

  appendEntry: (partial) => {
    const id = partial.id ?? nanoid()
    const ts = partial.ts ?? Date.now()
    const next: ResearchEntry = {
      id,
      ts,
      kind: partial.kind,
      query: partial.query,
      ok: partial.ok,
      status: partial.status,
      error: partial.error,
      abstract: partial.abstract,
      source: partial.source,
      related: partial.related,
      provider: partial.provider,
      snippets: partial.snippets,
      runGeneration: partial.runGeneration,
      subAgentTileId: partial.subAgentTileId,
    }
    set((s) => ({
      entries: trimBuffer([...s.entries, next]),
    }))
  },

  patchEntry: (id, partial) => {
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? ({ ...e, ...partial } as ResearchEntry) : e)),
    }))
  },

  clear: () => set({ entries: [] }),

  selectFiltered: (tab, filterText) => {
    const q = normalizeFilter(filterText)
    const { entries } = get()
    return entries.filter((e) => {
      if (tab !== 'all' && e.kind !== tab) return false
      return entryMatchesFilter(e, q)
    })
  },

  getActiveKinds: () => {
    const kinds = new Set<ResearchEntryKind>()
    for (const e of get().entries) kinds.add(e.kind)
    return Array.from(kinds).sort()
  },
}))

import { useResearchSessionStore, type ResearchEntryKind } from '../../store/researchSessionStore'
import type { OrchestratorToolContext } from './executeTools'
import { emitRefreshResearch } from '../uiEvents'

function parseJsonLoose(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/**
 * Heuristic: Context7 `query-docs` or similar — tool name / args may vary by provider/OpenRouter proxy.
 */
export function isLikelyContext7QueryDocs(name: string, rawArgs: string): boolean {
  const n = name.toLowerCase()
  if (n.includes('context7') && (n.includes('query') || n.includes('docs'))) return true
  try {
    const a = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
    const server = String(a.server ?? a.mcpServer ?? a.mcp_server ?? '').toLowerCase()
    const tool = String(a.tool ?? a.toolName ?? a.name ?? '').toLowerCase()
    if (server.includes('context7') && (tool.includes('query') || tool.includes('docs'))) return true
  } catch {
    /* ignore */
  }
  return false
}

function extractSnippetsFromContent(content: string): { title: string; body: string; url?: string }[] {
  const t = content.trim()
  if (!t) return []
  const parsed = parseJsonLoose(t)
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.snippets)) {
      const out: { title: string; body: string; url?: string }[] = []
      for (const row of obj.snippets) {
        if (row && typeof row === 'object') {
          const r = row as Record<string, unknown>
          const title = String(r.title ?? r.name ?? 'Snippet').slice(0, 200)
          const body = String(r.body ?? r.text ?? r.content ?? '').slice(0, 8000)
          const url = typeof r.url === 'string' ? r.url : undefined
          if (body) out.push({ title, body, url })
        }
      }
      if (out.length > 0) return out
    }
    const textLike = obj.content ?? obj.text ?? obj.result ?? obj.message
    if (typeof textLike === 'string' && textLike.trim()) {
      return [{ title: 'Documentation', body: textLike.slice(0, 8000) }]
    }
    if (Array.isArray(obj.content)) {
      const parts: string[] = []
      for (const c of obj.content) {
        if (c && typeof c === 'object' && 'text' in c) parts.push(String((c as { text?: string }).text ?? ''))
      }
      const joined = parts.join('\n\n').trim()
      if (joined) return [{ title: 'Documentation', body: joined.slice(0, 8000) }]
    }
  }
  return [{ title: 'Result', body: t.slice(0, 8000) }]
}

function parseQueryFromArgs(rawArgs: string): string {
  try {
    const a = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
    const q = String(a.query ?? a.q ?? a.search_query ?? a.topic ?? '').trim()
    if (q) return q
    const lib = String(a.libraryName ?? a.libraryId ?? '').trim()
    if (lib) return `${lib} (library docs)`
  } catch {
    /* ignore */
  }
  return ''
}

function toolResultLooksOk(content: string): boolean {
  const j = parseJsonLoose(content.trim())
  if (j && typeof j === 'object' && 'ok' in j) {
    return (j as { ok?: boolean }).ok === true
  }
  const low = content.toLowerCase()
  return low.length > 0 && !low.startsWith('error') && !low.includes('"ok":false')
}

/**
 * After assistant tool execution: if the tool looks like Context7 query-docs, push a structured row.
 * Skips `web_search` (handled in executeTools).
 */
export function recordResearchFromAssistantToolResult(
  name: string,
  rawArgs: string,
  filteredContent: string,
  context: OrchestratorToolContext
): void {
  if (name === 'web_search') return
  if (!isLikelyContext7QueryDocs(name, rawArgs)) return

  const query = parseQueryFromArgs(rawArgs) || name
  const ok = toolResultLooksOk(filteredContent)
  const snippets = extractSnippetsFromContent(filteredContent)

  const kind: ResearchEntryKind = 'mcp_context7'
  useResearchSessionStore.getState().appendEntry({
    kind,
    query,
    ok,
    error: ok ? undefined : filteredContent.slice(0, 600),
    provider: 'Context7',
    snippets: ok ? snippets : [{ title: 'Error', body: filteredContent.slice(0, 2000) }],
    runGeneration: context.runGeneration,
    subAgentTileId: context.subAgentTileId,
  })
  emitRefreshResearch()
}

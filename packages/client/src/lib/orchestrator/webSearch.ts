/**
 * Lightweight web research for orchestrator `web_search` tool (DuckDuckGo instant answer API).
 */

function flattenDdgTopics(topics: unknown, depth = 0): string[] {
  if (depth > 4) return []
  if (!Array.isArray(topics)) return []
  const out: string[] = []
  for (const t of topics) {
    if (typeof t === 'string') {
      out.push(t)
      continue
    }
    if (t && typeof t === 'object') {
      const o = t as Record<string, unknown>
      if (typeof o.Text === 'string') out.push(o.Text)
      if (Array.isArray(o.Topics)) {
        out.push(...flattenDdgTopics(o.Topics, depth + 1))
      }
    }
  }
  return out
}

export async function performWebSearch(query: string, numResults = 5): Promise<{
  query: string
  abstract: string
  source?: string
  related: string[]
  raw_url: string
}> {
  const q = query.trim().slice(0, 400)
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`web_search HTTP ${res.status}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  const abstract = String(data.AbstractText ?? '')
  const src = typeof data.AbstractSource === 'string' ? data.AbstractSource : undefined
  const related = flattenDdgTopics(data.RelatedTopics).slice(0, Math.max(1, numResults))
  return {
    query: q,
    abstract,
    source: src,
    related,
    raw_url: url,
  }
}

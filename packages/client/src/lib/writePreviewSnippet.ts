/** Rough +N / -M counts for a text replacement (hunk between common prefix/suffix). */
export function roughLineDiffStats(oldText: string, newText: string): { added: number; removed: number } {
  const ol = oldText.split('\n')
  const nl = newText.split('\n')
  let start = 0
  while (start < ol.length && start < nl.length && ol[start] === nl[start]) start++
  let eo = ol.length - 1
  let en = nl.length - 1
  while (eo >= start && en >= start && ol[eo] === nl[en]) {
    eo--
    en--
  }
  if (en < start) {
    return { added: 0, removed: Math.max(0, eo - start + 1) }
  }
  if (eo < start) {
    return { added: Math.max(0, en - start + 1), removed: 0 }
  }
  return {
    removed: Math.max(0, eo - start + 1),
    added: Math.max(0, en - start + 1),
  }
}

export type SnippetLine = { kind: 'del' | 'add'; text: string }

/** A few red/green lines for the inline write preview (Cursor-style). */
export function buildWriteDiffSnippet(
  previous: string,
  next: string,
  maxLines = 6
): SnippetLine[] {
  const ol = previous.split('\n')
  const nl = next.split('\n')
  let start = 0
  while (start < ol.length && start < nl.length && ol[start] === nl[start]) start++
  let eo = ol.length - 1
  let en = nl.length - 1
  while (eo >= start && en >= start && ol[eo] === nl[en]) {
    eo--
    en--
  }

  const out: SnippetLine[] = []

  if (en < start) {
    for (let i = start; i <= eo && out.length < maxLines; i++) {
      out.push({ kind: 'del', text: ol[i] ?? '' })
    }
    return out
  }
  if (eo < start) {
    for (let i = start; i <= en && out.length < maxLines; i++) {
      out.push({ kind: 'add', text: nl[i] ?? '' })
    }
    return out
  }

  for (let i = start; i <= eo && out.length < maxLines; i++) {
    out.push({ kind: 'del', text: ol[i] ?? '' })
  }
  for (let i = start; i <= en && out.length < maxLines; i++) {
    out.push({ kind: 'add', text: nl[i] ?? '' })
  }
  return out.slice(0, maxLines)
}

export function snippetLinesToStreamText(lines: SnippetLine[]): string {
  return lines.map((l) => (l.kind === 'del' ? `- ${l.text}` : `+ ${l.text}`)).join('\n')
}

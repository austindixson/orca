/**
 * Shared unified-diff row styling for orchestrator streaming blocks and markdown fences.
 * Left accent bars read closer to Cursor-style diff gutters than flat fills alone.
 */

export type UnifiedDiffLineKind = 'header' | 'del' | 'add' | 'context'

/** Classify a line from a `diff` / `patch` fenced block or StreamingCodeBlock. */
export function classifyUnifiedDiffLine(row: string): UnifiedDiffLineKind {
  if (row.startsWith('@@')) return 'header'
  if (row.startsWith('--- ') || row.startsWith('+++ ') || row.startsWith('diff ')) return 'header'
  const isDel = row.startsWith('-') && !row.startsWith('---')
  const isAdd = row.startsWith('+') && !row.startsWith('+++')
  if (isDel) return 'del'
  if (isAdd) return 'add'
  return 'context'
}

/** Write-preview snippets use "- " / "+ " prefixes (see writePreviewSnippet). */
export function classifyWritePreviewLine(row: string): 'del' | 'add' | 'context' {
  if (row.startsWith('- ')) return 'del'
  if (row.startsWith('+ ')) return 'add'
  return 'context'
}

export function unifiedDiffRowClassNames(kind: UnifiedDiffLineKind): string {
  switch (kind) {
    case 'header':
      return 'border-l-2 border-violet-400/55 bg-violet-950/40 pl-1.5 text-violet-100/90'
    case 'del':
      return 'border-l-2 border-rose-400/60 bg-rose-950/45 pl-1.5 text-rose-50/95'
    case 'add':
      return 'border-l-2 border-emerald-400/55 bg-emerald-950/38 pl-1.5 text-emerald-50/95'
    case 'context':
    default:
      return 'border-l-2 border-white/5 pl-1.5 text-gray-400/95'
  }
}

export function writePreviewRowClassNames(kind: 'del' | 'add' | 'context'): string {
  switch (kind) {
    case 'del':
      return 'border-l-2 border-rose-400/60 bg-rose-950/50 pl-1.5 text-rose-50/95'
    case 'add':
      return 'border-l-2 border-emerald-400/55 bg-emerald-950/42 pl-1.5 text-emerald-50/95'
    case 'context':
    default:
      return 'border-l-2 border-white/5 pl-1.5 text-gray-400/90'
  }
}

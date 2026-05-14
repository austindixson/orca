/**
 * One file in a multi-file diff review session (diff tile meta `reviewFiles`).
 * Serialized in canvas tile meta as JSON-compatible plain objects.
 */
export interface DiffReviewFileMeta {
  path: string
  fileName: string
  language: string
  original: string
  modified: string
  truncated: boolean
  added: number
  removed: number
}

export function isDiffReviewFileMeta(x: unknown): x is DiffReviewFileMeta {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.path === 'string' &&
    typeof o.fileName === 'string' &&
    typeof o.language === 'string' &&
    typeof o.original === 'string' &&
    typeof o.modified === 'string' &&
    typeof o.truncated === 'boolean' &&
    typeof o.added === 'number' &&
    typeof o.removed === 'number'
  )
}

export function parseReviewFilesMeta(meta: Record<string, unknown> | undefined): DiffReviewFileMeta[] | null {
  const rf = meta?.reviewFiles
  if (!Array.isArray(rf) || rf.length === 0) return null
  const ok = rf.filter(isDiffReviewFileMeta)
  return ok.length > 0 ? ok : null
}

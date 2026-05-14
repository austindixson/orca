import { useCanvasStore, type TileType } from '../../store/canvasStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import type { OrchestratorWritePreview } from '../../store/orchestratorActivityStore'
import { truncateForDiffMeta } from '../inferEditorLanguage'
import { lineRangeForTextChange } from '../lineRangeForTextChange'
import { revealOrchestratorTile } from './revealOrchestratorTile'
import {
  type DiffReviewFileMeta,
  parseReviewFilesMeta,
} from './diffReviewTypes'

function findFirstTileIdByType(type: TileType): string | null {
  for (const [id, t] of useCanvasStore.getState().tiles) {
    if (t.type === type) return id
  }
  return null
}

export function dedupePreviewsByPath(items: OrchestratorWritePreview[]): OrchestratorWritePreview[] {
  const map = new Map<string, OrchestratorWritePreview>()
  for (const p of items) {
    map.set(p.path, p)
  }
  return Array.from(map.values())
}

export function previewToReviewEntry(p: OrchestratorWritePreview): DiffReviewFileMeta {
  const o = truncateForDiffMeta(p.previous)
  const m = truncateForDiffMeta(p.next)
  return {
    path: p.path,
    fileName: p.fileName,
    language: p.language,
    original: o.text,
    modified: m.text,
    truncated: o.truncated || m.truncated,
    added: p.added,
    removed: p.removed,
  }
}

/**
 * After `write_file`, merge into an active multi-file review session if the diff tile has `reviewFiles`;
 * otherwise keep single-file meta (backward compatible).
 */
export function upsertDiffReviewSessionMeta(
  prevMeta: Record<string, unknown>,
  entry: DiffReviewFileMeta,
  diffScrollTo: { startLine: number; endLine: number }
): Record<string, unknown> {
  const existing = parseReviewFilesMeta(prevMeta)
  if (!existing || existing.length === 0) {
    return {
      ...prevMeta,
      path: entry.path,
      file: entry.path,
      original: entry.original,
      modified: entry.modified,
      language: entry.language,
      truncated: entry.truncated,
      diffScrollTo,
    }
  }

  const nextFiles = [...existing]
  const ix = nextFiles.findIndex((f) => f.path === entry.path)
  if (ix >= 0) nextFiles[ix] = entry
  else nextFiles.push(entry)
  const reviewIndex = nextFiles.findIndex((f) => f.path === entry.path)
  const cur = nextFiles[reviewIndex]!
  return {
    ...prevMeta,
    reviewFiles: nextFiles,
    reviewIndex,
    path: cur.path,
    file: cur.path,
    original: cur.original,
    modified: cur.modified,
    language: cur.language,
    truncated: cur.truncated,
    diffScrollTo,
  }
}

/**
 * Open or focus the diff tile with a **multi-file** review session (Cursor-style list + one diff at a time).
 */
export function openOrchestratorDiffReviewSession(
  previews: OrchestratorWritePreview[],
  startIndex: number,
  orchestratorTileId: string | null
): string {
  const deduped = dedupePreviewsByPath(previews)
  const entries = deduped.map(previewToReviewEntry)
  if (entries.length === 0) {
    let diffTileId = findFirstTileIdByType('diff')
    if (!diffTileId) {
      diffTileId = useCanvasStore.getState().addTileIntelligent('diff')
      useCanvasStore.getState().updateTile(diffTileId, {
        title: 'Changes',
        meta: { source: 'orchestrator-review' },
      })
    }
    return diffTileId
  }

  const idx = Math.max(0, Math.min(startIndex, entries.length - 1))
  const cur = entries[idx]!
  const diffScrollTo = lineRangeForTextChange(cur.original, cur.modified)

  let diffTileId = findFirstTileIdByType('diff')
  if (!diffTileId) {
    diffTileId = useCanvasStore.getState().addTileIntelligent('diff')
  }
  const prevTile = useCanvasStore.getState().tiles.get(diffTileId)
  const title =
    entries.length > 1 ? `Review · ${entries.length} files` : cur.fileName

  useCanvasStore.getState().updateTile(diffTileId, {
    title,
    meta: {
      ...(prevTile?.meta ?? {}),
      source: 'orchestrator-review',
      reviewFiles: entries,
      reviewIndex: idx,
      path: cur.path,
      file: cur.path,
      original: cur.original,
      modified: cur.modified,
      language: cur.language,
      truncated: cur.truncated,
      diffScrollTo,
    },
  })
  revealOrchestratorTile(
    diffTileId,
    { label: 'Review…', effect: 'shimmer' },
    orchestratorTileId
  )
  return diffTileId
}

/**
 * Sidebar “Review” / file row: loads **all** pending previews as one session and focuses the clicked file.
 */
export function openOrchestratorDiffForPreview(
  preview: OrchestratorWritePreview,
  orchestratorTileId: string | null
): string {
  const { writePreviewItems } = useOrchestratorActivityStore.getState()
  const deduped = dedupePreviewsByPath(writePreviewItems)
  const idx = deduped.findIndex((p) => p.path === preview.path)
  return openOrchestratorDiffReviewSession(deduped, idx >= 0 ? idx : 0, orchestratorTileId)
}

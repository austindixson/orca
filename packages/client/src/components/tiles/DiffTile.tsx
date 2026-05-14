import { useCallback, useEffect, useRef, useState } from 'react'
import { DiffEditor, Editor, type OnMount } from '@monaco-editor/react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { inferEditorLanguageFromPath } from '../../lib/inferEditorLanguage'
import { revealLineRangeInCenter } from '../../lib/monacoRevealRange'
import { useCanvasStore } from '../../store/canvasStore'
import clsx from 'clsx'
import {
  type DiffReviewFileMeta,
  parseReviewFilesMeta,
} from '../../lib/orchestrator/diffReviewTypes'
import { lineRangeForTextChange } from '../../lib/lineRangeForTextChange'
import { useTileMountAck } from '../../hooks/useTileMountAck'
import { buildDiffTileMonacoPaths } from './diffTileMonacoPaths'

type DiffPanel = 'compare' | 'newFile'

function pathLabel(meta: Record<string, unknown> | undefined): string {
  if (typeof meta?.path === 'string' && meta.path.trim()) return meta.path.trim()
  if (typeof meta?.file === 'string' && meta.file.trim()) return meta.file.trim()
  return '—'
}

function parseDiffScrollTo(meta: Record<string, unknown> | undefined): {
  startLine: number
  endLine: number
} | null {
  const r = meta?.diffScrollTo
  if (!r || typeof r !== 'object') return null
  const o = r as { startLine?: unknown; endLine?: unknown }
  const startLine = Number(o.startLine)
  const endLine = Number(o.endLine)
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null
  return { startLine, endLine }
}

export function DiffTile({ data }: TileComponentProps) {
  useTileMountAck(data.id, true)
  const reviewFiles = parseReviewFilesMeta(data.meta)
  const reviewIndexRaw = Number(data.meta?.reviewIndex)
  const reviewIndex =
    reviewFiles && reviewFiles.length > 0
      ? Math.max(0, Math.min(
          Number.isFinite(reviewIndexRaw) ? Math.floor(reviewIndexRaw) : 0,
          reviewFiles.length - 1
        ))
      : 0

  const label = pathLabel(data.meta)
  const original =
    typeof data.meta?.original === 'string' ? data.meta.original : ''
  const modified =
    typeof data.meta?.modified === 'string' ? data.meta.modified : ''
  const language =
    typeof data.meta?.language === 'string' && data.meta.language.trim()
      ? String(data.meta.language).trim()
      : inferEditorLanguageFromPath(label)
  const truncated = data.meta?.truncated === true
  const diffScrollTo = parseDiffScrollTo(data.meta)

  const multiFile = !!(reviewFiles && reviewFiles.length > 1)
  const reviewList = reviewFiles ?? null

  const origLines = original ? original.split('\n').length : 0
  const modLines = modified ? modified.split('\n').length : 0
  const lineDelta = modLines - origLines

  const hasAny = original.length > 0 || modified.length > 0

  const [panel, setPanel] = useState<DiffPanel>(() =>
    original.length === 0 && modified.length > 0 ? 'newFile' : 'compare'
  )

  const firstContentRef = useRef(false)
  useEffect(() => {
    if (!hasAny) return
    const preferNew = original.length === 0 && modified.length > 0
    if (!firstContentRef.current) {
      firstContentRef.current = true
      setPanel(preferNew ? 'newFile' : 'compare')
      return
    }
    setPanel(preferNew ? 'newFile' : 'compare')
  }, [hasAny, original, modified])

  const shellRef = useRef<HTMLDivElement>(null)

  const goToReviewIndex = useCallback(
    (nextIdx: number) => {
      const files = parseReviewFilesMeta(useCanvasStore.getState().tiles.get(data.id)?.meta)
      if (!files || files.length === 0) return
      const i = Math.max(0, Math.min(nextIdx, files.length - 1))
      const tile = useCanvasStore.getState().tiles.get(data.id)
      if (!tile) return
      const cur = files[i]!
      const dScroll = lineRangeForTextChange(cur.original, cur.modified)
      const n = files.length
      useCanvasStore.getState().updateTile(data.id, {
        title: n > 1 ? `Review · ${n} files` : cur.fileName,
        meta: {
          ...tile.meta,
          reviewIndex: i,
          path: cur.path,
          file: cur.path,
          original: cur.original,
          modified: cur.modified,
          language: cur.language,
          truncated: cur.truncated,
          diffScrollTo: dScroll,
        },
      })
    },
    [data.id]
  )

  const editorChrome = {
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    lineHeight: 20,
    readOnly: true,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    padding: { top: 10 },
  } as const

  type StandaloneDiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor

  const diffEditorRef = useRef<StandaloneDiffEditor | null>(null)
  const diffListenerRef = useRef<{ dispose: () => void } | null>(null)

  const clearDiffScrollMeta = useCallback(() => {
    const tile = useCanvasStore.getState().tiles.get(data.id)
    if (!tile) return
    const nextMeta = { ...tile.meta }
    delete nextMeta.diffScrollTo
    useCanvasStore.getState().updateTile(data.id, { meta: nextMeta })
  }, [data.id])

  const scrollModifiedFromStoreMeta = useCallback(() => {
    const r = parseDiffScrollTo(useCanvasStore.getState().tiles.get(data.id)?.meta)
    if (!r) return
    const diffEditor = diffEditorRef.current
    if (!diffEditor) return
    revealLineRangeInCenter(diffEditor.getModifiedEditor(), r.startLine, r.endLine)
    clearDiffScrollMeta()
  }, [data.id, clearDiffScrollMeta])

  const handleCompareDiffMount = useCallback(
    (diffEditor: StandaloneDiffEditor) => {
      diffEditorRef.current = diffEditor
      diffListenerRef.current?.dispose()
      diffListenerRef.current = diffEditor.onDidUpdateDiff(() => {
        scrollModifiedFromStoreMeta()
      })
      requestAnimationFrame(() => {
        scrollModifiedFromStoreMeta()
      })
    },
    [scrollModifiedFromStoreMeta]
  )

  const handleNewFileMount: OnMount = useCallback(
    (editor) => {
      const r = parseDiffScrollTo(useCanvasStore.getState().tiles.get(data.id)?.meta)
      if (!r) return
      revealLineRangeInCenter(editor, r.startLine, r.endLine)
      clearDiffScrollMeta()
    },
    [data.id, clearDiffScrollMeta]
  )

  useEffect(() => {
    return () => {
      diffListenerRef.current?.dispose()
      diffListenerRef.current = null
      diffEditorRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!diffScrollTo || panel !== 'compare') return
    let cancelled = false
    let attempts = 0
    const maxAttempts = 80
    const run = () => {
      if (cancelled) return
      attempts++
      if (!diffEditorRef.current) {
        if (attempts < maxAttempts) requestAnimationFrame(run)
        return
      }
      scrollModifiedFromStoreMeta()
    }
    requestAnimationFrame(run)
    return () => {
      cancelled = true
    }
  }, [diffScrollTo, original, modified, panel, scrollModifiedFromStoreMeta])

  const headerTitle =
    multiFile && reviewList
      ? `${reviewList[reviewIndex]?.fileName ?? label} (${reviewIndex + 1}/${reviewList.length})`
      : label
  const monacoPaths = buildDiffTileMonacoPaths(data.id, headerTitle)

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      onClick={() => shellRef.current?.focus()}
      className="flex h-full w-full flex-col bg-[#1e1e1e] outline-none focus:ring-1 focus:ring-inset focus:ring-accent-teal/35"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[#1e1e1e] bg-[#252526] px-4 py-2">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <svg
              className="h-4 w-4 shrink-0 text-accent-orange"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="truncate text-sm text-gray-300" data-tooltip={headerTitle}>
              {headerTitle}
            </span>
          </div>
          {multiFile && reviewList && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={reviewIndex <= 0}
                onClick={() => goToReviewIndex(reviewIndex - 1)}
                className="rounded border border-[#3c3c3c] bg-[#2d2d2d] px-2 py-0.5 text-[11px] text-gray-300 hover:bg-[#3c3c3c] disabled:cursor-not-allowed disabled:opacity-40"
                data-tooltip="Previous file"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={reviewIndex >= reviewList.length - 1}
                onClick={() => goToReviewIndex(reviewIndex + 1)}
                className="rounded border border-[#3c3c3c] bg-[#2d2d2d] px-2 py-0.5 text-[11px] text-gray-300 hover:bg-[#3c3c3c] disabled:cursor-not-allowed disabled:opacity-40"
                data-tooltip="Next file"
              >
                Next
              </button>
            </div>
          )}
          {hasAny && (
            <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
              <div
                className="flex rounded-md border border-[#3c3c3c] bg-[#2d2d2d] p-0.5"
                role="tablist"
                aria-label="Diff view mode"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'compare'}
                  className={clsx(
                    'rounded px-2 py-0.5 font-medium transition-colors',
                    panel === 'compare'
                      ? 'bg-[#3c3c3c] text-gray-100'
                      : 'text-gray-500 hover:text-gray-300'
                  )}
                  onClick={() => setPanel('compare')}
                >
                  Compare
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'newFile'}
                  className={clsx(
                    'rounded px-2 py-0.5 font-medium transition-colors',
                    panel === 'newFile'
                      ? 'bg-[#3c3c3c] text-gray-100'
                      : 'text-gray-500 hover:text-gray-300'
                  )}
                  onClick={() => setPanel('newFile')}
                  data-tooltip="Full new file (all lines, not only change hunks)"
                >
                  New file
                </button>
              </div>
              {lineDelta !== 0 &&
                (lineDelta > 0 ? (
                  <span className="text-green-400">+{lineDelta} lines</span>
                ) : (
                  <span className="text-red-400">{lineDelta} lines</span>
                ))}
              <span className="text-gray-500">
                {origLines}→{modLines} lines
              </span>
            </div>
          )}
        </div>
        {truncated && (
          <span className="ml-2 shrink-0 text-xs text-amber-400/90">Truncated for display</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        {multiFile && reviewList && (
          <aside
            className="w-[min(240px,38%)] shrink-0 overflow-y-auto border-r border-[#1e1e1e] bg-[#252526]"
            aria-label="Files in this review"
          >
            <div className="sticky top-0 border-b border-[#1e1e1e] bg-[#2d2d2d] px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Files
            </div>
            {reviewList.map((f: DiffReviewFileMeta, i: number) => (
              <button
                key={f.path}
                type="button"
                onClick={() => goToReviewIndex(i)}
                className={clsx(
                  'flex w-full flex-col gap-0.5 border-b border-[#1e1e1e]/80 px-2 py-2 text-left text-[12px] transition-colors',
                  i === reviewIndex
                    ? 'bg-accent-teal/15 text-gray-100'
                    : 'text-gray-400 hover:bg-[#2a2a2a] hover:text-gray-200'
                )}
              >
                <span className="truncate font-medium" data-tooltip={f.path}>
                  {f.fileName}
                </span>
                <span className="font-mono text-[10px] tabular-nums">
                  <span className="text-emerald-400">+{f.added}</span>{' '}
                  <span className="text-rose-400/95">−{f.removed}</span>
                </span>
              </button>
            ))}
          </aside>
        )}

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {hasAny ? (
          panel === 'newFile' ? (
            <Editor
              height="100%"
              value={modified}
              language={language}
              path={monacoPaths.editorPath}
              keepCurrentModel
              theme="vs-dark"
              options={editorChrome}
              onMount={handleNewFileMount}
            />
          ) : (
            <DiffEditor
              height="100%"
              original={original}
              modified={modified}
              language={language}
              originalModelPath={monacoPaths.originalModelPath}
              modifiedModelPath={monacoPaths.modifiedModelPath}
              keepCurrentOriginalModel
              keepCurrentModifiedModel
              theme="vs-dark"
              options={{
                ...editorChrome,
                renderSideBySide: true,
                useInlineViewWhenSpaceIsLimited: false,
                hideUnchangedRegions: {
                  enabled: false,
                },
              }}
              onMount={handleCompareDiffMount}
            />
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 px-8 text-center text-gray-500 text-sm">
            <p className="text-gray-400 max-w-md">
              No diff yet. The orchestrator should add a <strong className="text-gray-300">diff</strong>{' '}
              tile when building websites — each <code className="text-accent-orange">write_file</code>{' '}
              syncs here automatically.
            </p>
            <p className="text-xs text-gray-600 max-w-md">
              Side-by-side before/after appears after the first save when a diff tile is on the canvas.
            </p>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

import { useState, useRef, useEffect, useCallback } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { TileComponentProps } from '../Canvas/TileRegistry'
import * as tauri from '../../lib/tauri'
import {
  getActiveEditor,
  registerEditor,
  setActiveEditor,
  unregisterEditor,
  type ActiveEditorApi,
} from '../../lib/activeEditorRegistry'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { revealLineRangeInCenter } from '../../lib/monacoRevealRange'
import { useTileMountAck } from '../../hooks/useTileMountAck'
import { parseAgentWriteStreamMeta } from '../../lib/orchestrator/agentWriteStream'

/** Scales sweep duration vs line span (~3.33× the base curve). */
const READ_SCAN_SLOWDOWN = 1 / 0.3
/** Max duration for the stepped read sweep (one Monaco update per line, no rAF loop). */
const READ_SCAN_ANIM_CAP_MS = 6_000

function shouldPreemptEditorAnimation(tileId: string): boolean {
  const h = useOrchestratorActivityStore.getState().autoFocusHighlight
  return Boolean(h && h.tileId !== tileId)
}

function patchPillToThinkingAfterRead(tileId: string): void {
  const { autoFocusHighlight, setAutoFocusHighlight } = useOrchestratorActivityStore.getState()
  const h = autoFocusHighlight
  if (!h || h.tileId !== tileId || !/^Reading\b/i.test(h.label)) return
  setAutoFocusHighlight({ ...h, label: 'Thinking…', effect: 'pulse' })
}

function patchPillToThinkingAfterWrite(tileId: string): void {
  const { autoFocusHighlight, setAutoFocusHighlight } = useOrchestratorActivityStore.getState()
  const h = autoFocusHighlight
  if (!h || h.tileId !== tileId) return
  if (!/^(Writing|Creating)\b/i.test(h.label)) return
  setAutoFocusHighlight({ ...h, label: 'Thinking…', effect: 'pulse' })
}

/** Debounced disk write for workspace files (Claude Code–style; no manual save needed for normal edits). */
const AUTO_SAVE_DEBOUNCE_MS = 1200

const READ_FILE_RETRY_ATTEMPTS = 4
const READ_FILE_RETRY_BASE_MS = 1200

function isSoftLoadFailureMessage(msg: string): boolean {
  const t = msg.toLowerCase()
  return (
    t.includes('no such file') ||
    t.includes('not found') ||
    t.includes('enoent') ||
    t.includes('rate') ||
    t.includes('quota') ||
    t.includes('429') ||
    t.includes('timeout') ||
    t.includes('network') ||
    t.includes('fetch') ||
    t.includes('timed out') ||
    t.includes('connection refused') ||
    t.includes('econnrefused') ||
    t.includes('temporarily unavailable')
  )
}

const DEFAULT_CODE = `// Welcome to Orca Coder Editor
import { useState, useEffect } from 'react'

interface User {
  id: string
  name: string
  email: string
}

export async function fetchUser(id: string): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`)
  if (!response.ok) {
    throw new Error('User not found')
  }
  return response.json()
}

export function useUser(id: string) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    fetchUser(id)
      .then(setUser)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [id])

  return { user, loading, error }
}
`

const LANGUAGES = [
  { id: 'typescript', name: 'TypeScript', ext: '.ts' },
  { id: 'javascript', name: 'JavaScript', ext: '.js' },
  { id: 'python', name: 'Python', ext: '.py' },
  { id: 'rust', name: 'Rust', ext: '.rs' },
  { id: 'go', name: 'Go', ext: '.go' },
  { id: 'json', name: 'JSON', ext: '.json' },
  { id: 'css', name: 'CSS', ext: '.css' },
  { id: 'html', name: 'HTML', ext: '.html' },
]

function parseScrollToRange(meta: Record<string, unknown> | undefined): {
  startLine: number
  endLine: number
} | null {
  const r = meta?.scrollToRange
  if (!r || typeof r !== 'object') return null
  const o = r as { startLine?: unknown; endLine?: unknown }
  const startLine = Number(o.startLine)
  const endLine = Number(o.endLine)
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null
  return { startLine, endLine }
}

function parseAgentReadScan(meta: Record<string, unknown> | undefined): {
  lineCount: number
  token: number
  startLine: number
  endLine: number
} | null {
  const r = meta?.agentReadScan
  if (!r || typeof r !== 'object') return null
  const o = r as { lineCount?: unknown; token?: unknown; startLine?: unknown; endLine?: unknown }
  const lineCount = Math.max(1, Math.floor(Number(o.lineCount)))
  const token = Number(o.token)
  if (!Number.isFinite(lineCount) || !Number.isFinite(token)) return null
  const sl = Number(o.startLine)
  const el = Number(o.endLine)
  if (Number.isFinite(sl) && Number.isFinite(el)) {
    return { lineCount, token, startLine: sl, endLine: el }
  }
  /** Legacy payloads: only `lineCount` — cap viewport so we do not sweep the whole file. */
  const cap = Math.min(lineCount, 80)
  return { lineCount, token, startLine: 1, endLine: Math.max(1, cap) }
}

function parseAgentWriteFlash(meta: Record<string, unknown> | undefined): {
  startLine: number
  endLine: number
  token: number
} | null {
  const r = meta?.agentWriteFlash
  if (!r || typeof r !== 'object') return null
  const o = r as { startLine?: unknown; endLine?: unknown; token?: unknown }
  const startLine = Number(o.startLine)
  const endLine = Number(o.endLine)
  const token = Number(o.token)
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || !Number.isFinite(token))
    return null
  return { startLine, endLine, token }
}

export function EditorTile({ data }: TileComponentProps) {
  const ackMount = useTileMountAck(data.id)
  const fileFromMeta = typeof data.meta?.file === 'string' ? data.meta.file : null
  const fileVersion =
    typeof data.meta?.fileVersion === 'number' ? data.meta.fileVersion : 0
  const scrollToRange = parseScrollToRange(data.meta)
  /** Declared before file-load effect so deps do not include full `data.meta` (orchestrator read/write UI would re-fetch on every meta twitch). */
  const writeStream = parseAgentWriteStreamMeta(data.meta)

  const [code, setCode] = useState(() => (fileFromMeta ? '' : DEFAULT_CODE))
  const [language, setLanguage] = useState('typescript')
  const [filename, setFilename] = useState(() =>
    fileFromMeta ? fileFromMeta.split(/[/\\]/).pop() ?? fileFromMeta : 'untitled.ts'
  )
  const [isEditingFilename, setIsEditingFilename] = useState(false)
  const [filenameInput, setFilenameInput] = useState('untitled.ts')
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadErrorSoft, setLoadErrorSoft] = useState(false)
  const [remoteLoading, setRemoteLoading] = useState(() => Boolean(fileFromMeta))
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const agentDecorationIdsRef = useRef<string[]>([])
  const filenameInputRef = useRef<HTMLInputElement>(null)
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const editorApiRef = useRef<ActiveEditorApi | null>(null)
  const agentWriteStreamRunIdRef = useRef(0)

  const clearAgentDecorations = useCallback(() => {
    const editor = editorRef.current
    if (editor && agentDecorationIdsRef.current.length > 0) {
      editor.deltaDecorations(agentDecorationIdsRef.current, [])
      agentDecorationIdsRef.current = []
    }
  }, [])

  const editorAgentLineAnimationsEnabled = useSettingsStore((s) => s.editorAgentLineAnimationsEnabled)
  const editorAutoSaveEnabled = useSettingsStore((s) => s.editorAutoSaveEnabled)
  const editorWordWrap = useSettingsStore((s) => s.editorWordWrap)

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    editor.focus()
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current()
    })
    editor.onDidFocusEditorWidget(() => {
      const api = editorApiRef.current
      if (api) setActiveEditor(api)
    })
    editor.onDidBlurEditorWidget(() => {
      if (getActiveEditor()?.tileId === data.id) setActiveEditor(null)
    })
    ackMount()
  }

  const handleChange = (value: string | undefined) => {
    if (value !== undefined) {
      setCode(value)
      setIsDirty(true)
    }
  }

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang)
    const lang = LANGUAGES.find(l => l.id === newLang)
    if (lang) {
      const baseName = filename.split('.')[0]
      const newFilename = baseName + lang.ext
      setFilename(newFilename)
      setFilenameInput(newFilename)
    }
  }

  const handleFilenameClick = () => {
    setFilenameInput(filename)
    setIsEditingFilename(true)
  }

  const handleFilenameSubmit = () => {
    const trimmed = filenameInput.trim()
    if (trimmed && trimmed !== filename) {
      setFilename(trimmed)
      // Detect language from extension
      const ext = trimmed.split('.').pop()?.toLowerCase() || ''
      const effectiveExt = ext === 'htm' ? 'html' : ext
      const lang = LANGUAGES.find(l => l.ext === '.' + effectiveExt)
      if (lang) {
        setLanguage(lang.id)
      }
    }
    setIsEditingFilename(false)
  }

  const handleFilenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFilenameSubmit()
    } else if (e.key === 'Escape') {
      setFilenameInput(filename)
      setIsEditingFilename(false)
    }
  }

  useEffect(() => {
    if (isEditingFilename && filenameInputRef.current) {
      filenameInputRef.current.focus()
      filenameInputRef.current.select()
    }
  }, [isEditingFilename])

  useEffect(() => {
    if (!fileFromMeta) {
      setRemoteLoading(false)
      return
    }
    if (writeStream) {
      setRemoteLoading(false)
      return
    }
    let cancelled = false
    setRemoteLoading(true)
    setSaveError(null)
    setLoadError(null)
    setLoadErrorSoft(false)
    ;(async () => {
      let lastErr: unknown
      try {
        let c: string | null = null
        for (let attempt = 0; attempt < READ_FILE_RETRY_ATTEMPTS; attempt++) {
          if (cancelled) return
          try {
            c = await tauri.readFile(fileFromMeta)
            break
          } catch (e) {
            lastErr = e
            if (attempt < READ_FILE_RETRY_ATTEMPTS - 1 && !cancelled) {
              await new Promise((r) => setTimeout(r, READ_FILE_RETRY_BASE_MS * (attempt + 1)))
            }
          }
        }
        if (c === null) throw lastErr ?? new Error('Failed to read file')
        if (cancelled) return
        setCode(c)
        const base = fileFromMeta.split(/[/\\]/).pop() ?? fileFromMeta
        setFilename(base)
        setFilenameInput(base)
        const ext = base.split('.').pop()?.toLowerCase() || ''
        const lang = LANGUAGES.find((l) => l.ext === '.' + ext)
        if (lang) setLanguage(lang.id)
        setIsDirty(false)
      } catch (error) {
        if (!cancelled) {
          const raw = error instanceof Error ? error.message : 'Failed to load file'
          const soft = isSoftLoadFailureMessage(raw)
          setLoadErrorSoft(soft)
          setLoadError(
            soft
              ? 'Not loaded yet — the file may still be written or the API may be busy. Try again in a moment.'
              : raw
          )
          setCode(
            soft
              ? '// Waiting for file… (retry or reopen when the run finishes)'
              : `// ${raw}`
          )
        }
      } finally {
        if (!cancelled) setRemoteLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fileFromMeta, fileVersion, writeStream?.token])

  /** Orchestrator: typewriter reveal for write_file only (no legacy line sweep flash). */
  useEffect(() => {
    if (!writeStream || !fileFromMeta) return

    const runId = ++agentWriteStreamRunIdRef.current
    let cancelled = false
    let scrollFollowRaf = 0

    const scheduleScrollToOffset = (endOffset: number) => {
      if (scrollFollowRaf) cancelAnimationFrame(scrollFollowRaf)
      scrollFollowRaf = requestAnimationFrame(() => {
        scrollFollowRaf = 0
        if (cancelled || runId !== agentWriteStreamRunIdRef.current) return
        const ed = editorRef.current
        const m = ed?.getModel()
        const monaco = monacoRef.current
        if (!ed || !m || !monaco) return
        try {
          const len = m.getValueLength()
          const o = Math.min(Math.max(0, endOffset), len)
          const pos = m.getPositionAt(o)
          /**
           * Keep the live write cursor anchored to viewport center.
           * Smooth scrolling lags behind per-char updates and makes the
           * generation point drift downward during fast streams.
           */
          ed.revealPositionInCenter(pos, monaco.editor.ScrollType.Immediate)
        } catch {
          /* invalid offset / model in flux */
        }
      })
    }

    const run = () => {
      if (cancelled || runId !== agentWriteStreamRunIdRef.current) return
      const editor = editorRef.current
      const model = editor?.getModel()
      const monacoApi = monacoRef.current
      if (!editor || !model || !monacoApi) {
        requestAnimationFrame(run)
        return
      }

      void (async () => {
        if (cancelled || runId !== agentWriteStreamRunIdRef.current) return
        const monacoApiInner = monacoRef.current
        if (!monacoApiInner) return
        const ws = writeStream
        const prevSmoothScrolling = editor.getOption(
          monacoApiInner.editor.EditorOption.smoothScrolling
        )
        const Range = monacoApiInner.Range
        const charsPerFrame = Math.max(1, Math.round(ws.cps / 60))
        const deadline = performance.now() + ws.budgetMs
        const nextFrame = () =>
          new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

        editor.updateOptions({ readOnly: true, smoothScrolling: false })

        model.setValue(ws.previous)
        setCode(ws.previous)
        setIsDirty(false)
        /** One undo step for the whole reveal (pushEditOperations + stack boundaries). */
        model.pushStackElement()

        const replaceFullModel = (text: string) => {
          const full = model.getFullModelRange()
          model.pushEditOperations(null, [{ range: full, text }], () => null)
        }

        try {
          let delta = 0
          let overBudget = false

          for (const h of ws.hunks) {
            if (cancelled || runId !== agentWriteStreamRunIdRef.current) break

            const delStart = h.startOffset + delta
            const delEnd = h.startOffset + delta + h.oldLength
            if (h.oldLength > 0) {
              model.pushEditOperations(
                null,
                [
                  {
                    range: Range.fromPositions(
                      model.getPositionAt(delStart),
                      model.getPositionAt(delEnd)
                    ),
                    text: '',
                  },
                ],
                () => null
              )
            }

            let written = 0
            while (written < h.replacement.length) {
              if (cancelled || runId !== agentWriteStreamRunIdRef.current) break
              if (performance.now() > deadline) {
                overBudget = true
                break
              }
              const n = Math.min(charsPerFrame, h.replacement.length - written)
              const chunk = h.replacement.slice(written, written + n)
              const insertOff = h.startOffset + delta + written
              const pos = model.getPositionAt(insertOff)
              model.pushEditOperations(
                null,
                [{ range: Range.fromPositions(pos, pos), text: chunk }],
                () => null
              )
              written += n
              scheduleScrollToOffset(insertOff + n)
              await nextFrame()
            }

            if (overBudget) {
              if (model.getValue() !== ws.next) replaceFullModel(ws.next)
              break
            }
            delta += h.replacement.length - h.oldLength
          }

          if (!cancelled && runId === agentWriteStreamRunIdRef.current) {
            if (model.getValue() !== ws.next) replaceFullModel(ws.next)
            model.pushStackElement()
            setCode(ws.next)
            setIsDirty(false)
            scheduleScrollToOffset(model.getValueLength())

            const tile = useCanvasStore.getState().tiles.get(data.id)
            if (tile) {
              const nextMeta = { ...tile.meta } as Record<string, unknown>
              delete nextMeta.agentWriteStream
              delete nextMeta.agentWriteFlash
              useCanvasStore.getState().updateTile(data.id, { meta: nextMeta })
            }
            patchPillToThinkingAfterWrite(data.id)
          }
        } finally {
          editor.updateOptions({
            readOnly: false,
            smoothScrolling: prevSmoothScrolling,
          })
        }
      })()
    }

    run()
    return () => {
      cancelled = true
      if (scrollFollowRaf) cancelAnimationFrame(scrollFollowRaf)
    }
  }, [writeStream?.token, fileFromMeta, data.id])

  useEffect(() => {
    if (!fileFromMeta || remoteLoading || !scrollToRange) return
    if (parseAgentWriteStreamMeta(data.meta)) return

    let cancelled = false
    let attempts = 0
    const maxAttempts = 80

    const run = () => {
      if (cancelled) return
      attempts++
      const editor = editorRef.current
      const model = editor?.getModel()
      if (!editor || !model) {
        if (attempts < maxAttempts) requestAnimationFrame(run)
        return
      }

      revealLineRangeInCenter(editor, scrollToRange.startLine, scrollToRange.endLine)

      const tile = useCanvasStore.getState().tiles.get(data.id)
      if (tile) {
        const nextMeta = { ...tile.meta }
        delete nextMeta.scrollToRange
        useCanvasStore.getState().updateTile(data.id, { meta: nextMeta })
      }
    }

    requestAnimationFrame(run)
    return () => {
      cancelled = true
    }
  }, [
    fileFromMeta,
    fileVersion,
    remoteLoading,
    code,
    data.id,
    scrollToRange?.startLine,
    scrollToRange?.endLine,
    writeStream?.token,
  ])

  const readScan = parseAgentReadScan(data.meta)
  useEffect(() => {
    if (!readScan || remoteLoading) return

    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return

    const model = editor.getModel()
    if (!model) return

    const modelLines = Math.max(1, model.getLineCount())
    const startL = Math.max(1, Math.min(Math.floor(readScan.startLine), modelLines))
    const endL = Math.max(startL, Math.min(Math.floor(readScan.endLine), modelLines))
    const span = Math.max(1, endL - startL + 1)

    let cancelled = false

    const clearMetaReadScan = () => {
      const tile = useCanvasStore.getState().tiles.get(data.id)
      if (!tile) return
      const next = { ...tile.meta } as Record<string, unknown>
      delete next.agentReadScan
      useCanvasStore.getState().updateTile(data.id, { meta: next })
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!editorAgentLineAnimationsEnabled || prefersReducedMotion) {
      const focusLine = Math.min(modelLines, Math.max(startL, Math.floor((startL + endL) / 2)))
      const lastCol = model.getLineMaxColumn(focusLine)
      revealLineRangeInCenter(editor, startL, endL)
      agentDecorationIdsRef.current = editor.deltaDecorations(agentDecorationIdsRef.current, [
        {
          range: new monaco.Range(focusLine, 1, focusLine, lastCol),
          options: {
            isWholeLine: true,
            className: 'orca-agent-read-line',
          },
        },
      ])
      const t = window.setTimeout(() => {
        clearAgentDecorations()
        clearMetaReadScan()
      }, 420)
      return () => {
        window.clearTimeout(t)
        clearAgentDecorations()
      }
    }

    const durationMs = Math.min(
      READ_SCAN_ANIM_CAP_MS,
      Math.max(600, READ_SCAN_SLOWDOWN * (280 + span * 42))
    )
    const msPerStep = Math.max(1, durationMs / span)

    let timeoutId: number | null = null

    const finishSweep = () => {
      patchPillToThinkingAfterRead(data.id)
      clearAgentDecorations()
      clearMetaReadScan()
    }

    const applyLine = (line: number) => {
      const lastCol = model.getLineMaxColumn(line)
      agentDecorationIdsRef.current = editor.deltaDecorations(agentDecorationIdsRef.current, [
        {
          range: new monaco.Range(line, 1, line, lastCol),
          options: {
            isWholeLine: true,
            className: 'orca-agent-read-line',
          },
        },
      ])
      editor.revealLineInCenter(line)
    }

    let lineIdx = 0
    const step = () => {
      if (cancelled) return
      if (shouldPreemptEditorAnimation(data.id)) {
        cancelled = true
        if (timeoutId != null) window.clearTimeout(timeoutId)
        timeoutId = null
        clearAgentDecorations()
        clearMetaReadScan()
        return
      }
      const line = startL + lineIdx
      applyLine(line)
      lineIdx++
      if (lineIdx < span) {
        timeoutId = window.setTimeout(step, msPerStep)
      } else {
        timeoutId = null
        finishSweep()
      }
    }

    step()
    return () => {
      cancelled = true
      if (timeoutId != null) window.clearTimeout(timeoutId)
      clearAgentDecorations()
    }
  }, [
    readScan?.token,
    readScan?.lineCount,
    readScan?.startLine,
    readScan?.endLine,
    remoteLoading,
    data.id,
    clearAgentDecorations,
    editorAgentLineAnimationsEnabled,
  ])

  const writeFlash = parseAgentWriteFlash(data.meta)
  useEffect(() => {
    if (parseAgentWriteStreamMeta(data.meta)) return
    if (!writeFlash || remoteLoading) return

    // Legacy fallback removed: write_file should only use stream animation.
    // Still complete the activity handoff so UI never stays in "Writing…".
    patchPillToThinkingAfterWrite(data.id)
    const tile = useCanvasStore.getState().tiles.get(data.id)
    if (tile) {
      const next = { ...tile.meta } as Record<string, unknown>
      delete next.agentWriteFlash
      useCanvasStore.getState().updateTile(data.id, { meta: next })
    }
  }, [
    writeFlash?.token,
    remoteLoading,
    data.id,
  ])

  const performSave = useCallback(async () => {
    const path = fileFromMeta ?? filename
    if (!path) return
    setIsSaving(true)
    setSaveError(null)
    try {
      await tauri.writeFile(path, code)
      setIsDirty(false)
      if (fileFromMeta) {
        await useWorkspaceStore.getState().syncExplorerAfterWrite(fileFromMeta)
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save')
      console.error('Save error:', error)
    } finally {
      setIsSaving(false)
    }
  }, [fileFromMeta, filename, code])

  const reloadFromDisk = useCallback(async () => {
    if (!fileFromMeta) return
    const tileNow = useCanvasStore.getState().tiles.get(data.id)
    if (tileNow && parseAgentWriteStreamMeta(tileNow.meta as Record<string, unknown>)) return
    setRemoteLoading(true)
    setSaveError(null)
    setLoadError(null)
    setLoadErrorSoft(false)
    try {
      let c: string | null = null
      let lastErr: unknown
      for (let attempt = 0; attempt < READ_FILE_RETRY_ATTEMPTS; attempt++) {
        try {
          c = await tauri.readFile(fileFromMeta)
          break
        } catch (e) {
          lastErr = e
          if (attempt < READ_FILE_RETRY_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, READ_FILE_RETRY_BASE_MS * (attempt + 1)))
          }
        }
      }
      if (c === null) throw lastErr ?? new Error('Failed to read file')
      setCode(c)
      const base = fileFromMeta.split(/[/\\]/).pop() ?? fileFromMeta
      setFilename(base)
      setFilenameInput(base)
      const ext = base.split('.').pop()?.toLowerCase() || ''
      const lang = LANGUAGES.find((l) => l.ext === '.' + ext)
      if (lang) setLanguage(lang.id)
      setIsDirty(false)
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Failed to load file'
      const soft = isSoftLoadFailureMessage(raw)
      setLoadErrorSoft(soft)
      setLoadError(
        soft
          ? 'Not loaded yet — the file may still be written or the API may be busy. Try again in a moment.'
          : raw
      )
    } finally {
      setRemoteLoading(false)
    }
  }, [fileFromMeta, data.id])

  const saveAsNewPath = useCallback(
    async (relativeDest: string) => {
      setIsSaving(true)
      setSaveError(null)
      try {
        await tauri.writeFile(relativeDest, code)
        setIsDirty(false)
        const base = relativeDest.split(/[/\\]/).pop() ?? relativeDest
        setFilename(base)
        setFilenameInput(base)
        const ext = base.split('.').pop()?.toLowerCase() || ''
        const effectiveExt = ext === 'htm' ? 'html' : ext
        const lang = LANGUAGES.find((l) => l.ext === '.' + effectiveExt)
        if (lang) setLanguage(lang.id)
        useCanvasStore.getState().updateTile(data.id, {
          title: base,
          meta: { ...data.meta, file: relativeDest, fileVersion: Date.now() },
        })
        await useWorkspaceStore.getState().syncExplorerAfterWrite(relativeDest)
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Failed to save')
      } finally {
        setIsSaving(false)
      }
    },
    [code, data.id, data.meta]
  )

  const toggleWordWrapFromApi = useCallback(() => {
    const s = useSettingsStore.getState()
    const next = s.editorWordWrap === 'on' ? 'off' : 'on'
    s.setEditorWordWrap(next)
    editorRef.current?.updateOptions({ wordWrap: next === 'on' ? 'on' : 'off' })
    void tauri.syncNativeMenuChecks(s.editorAutoSaveEnabled, next === 'on')
  }, [])

  useEffect(() => {
    const api: ActiveEditorApi = {
      tileId: data.id,
      save: () => performSave(),
      saveAs: (p) => saveAsNewPath(p),
      revert: () => reloadFromDisk(),
      runMonacoAction: (actionId) => {
        void editorRef.current?.getAction(actionId)?.run()
      },
      toggleWordWrap: toggleWordWrapFromApi,
      isDirty: () => isDirty,
      getBuffer: () => code,
      getFilePath: () => fileFromMeta,
    }
    editorApiRef.current = api
    registerEditor(api)
    return () => unregisterEditor(data.id)
  }, [
    data.id,
    performSave,
    saveAsNewPath,
    reloadFromDisk,
    toggleWordWrapFromApi,
    isDirty,
    code,
    fileFromMeta,
  ])

  useEffect(() => {
    saveRef.current = performSave
  }, [performSave])

  useEffect(() => {
    if (!editorAutoSaveEnabled) return
    if (!fileFromMeta || !isDirty || remoteLoading) return
    const id = window.setTimeout(() => void performSave(), AUTO_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [editorAutoSaveEnabled, code, fileFromMeta, isDirty, remoteLoading, performSave])

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: editorWordWrap === 'on' ? 'on' : 'off' })
  }, [editorWordWrap])

  return (
    <div className="w-full h-full flex flex-col bg-[#1e1e1e]">
      {/* Tab Bar */}
      <div className="flex items-center justify-between px-2 py-1 bg-[#252526] border-b border-[#1e1e1e]">
        <div className="flex items-center">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1e1e1e] rounded-t border-t border-x border-[#3c3c3c] text-sm">
            <svg className="w-4 h-4 text-accent-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            {isEditingFilename ? (
              <input
                ref={filenameInputRef}
                type="text"
                value={filenameInput}
                onChange={(e) => setFilenameInput(e.target.value)}
                onBlur={handleFilenameSubmit}
                onKeyDown={handleFilenameKeyDown}
                className="bg-[#3c3c3c] text-gray-200 text-sm px-1.5 py-0.5 rounded outline-none border border-accent-blue min-w-[100px]"
              />
            ) : (
              <button
                onClick={handleFilenameClick}
                className="text-gray-300 hover:text-white hover:bg-[#3c3c3c] px-1.5 py-0.5 rounded transition-colors cursor-text"
                data-tooltip="Click to rename"
              >
                {filename}
              </button>
            )}
            {isDirty && <span className="w-2 h-2 rounded-full bg-white" />}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="px-2 py-1 bg-[#3c3c3c] text-gray-300 text-xs rounded border-none outline-none cursor-pointer"
          >
            {LANGUAGES.map(lang => (
              <option key={`${lang.id}${lang.ext}`} value={lang.id}>{lang.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            {fileFromMeta && (
              <span className="text-[10px] uppercase tracking-wide text-gray-600" data-tooltip="Changes save automatically">
                Auto-save
              </span>
            )}
            <button
              type="button"
              onClick={() => void performSave()}
              disabled={!isDirty || isSaving}
              className="px-2 py-1 text-xs text-gray-400 transition-colors hover:text-white disabled:opacity-50"
              data-tooltip={
                fileFromMeta
                  ? 'Save now (⌘S) — also happens automatically after you stop typing'
                  : 'Save to workspace (⌘S)'
              }
            >
              {isSaving ? 'Saving…' : isDirty ? 'Save' : fileFromMeta ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      
      {/* Load / save errors */}
      {loadError && (
        <div
          className={
            loadErrorSoft
              ? 'px-3 py-1.5 bg-amber-500/15 text-amber-200/90 text-xs border-b border-amber-500/25'
              : 'px-3 py-1.5 bg-red-500/20 text-red-400 text-xs border-b border-red-500/30'
          }
        >
          {loadError}
        </div>
      )}
      {saveError && !loadError && (
        <div className="px-3 py-1.5 bg-red-500/20 text-red-400 text-xs border-b border-red-500/30">
          {saveError}
        </div>
      )}
      {fileFromMeta &&
        !remoteLoading &&
        !loadError &&
        !writeStream &&
        code === '' && (
          <div className="px-3 py-1.5 border-b border-amber-500/20 bg-amber-500/10 text-[11px] text-amber-100/90">
            This path is empty on disk (0 bytes). If a terminal is still scaffolding (e.g.{' '}
            <code className="text-amber-50/95">npm create</code>), finish or cancel that step, then
            reload — or confirm you opened the right file (e.g. root vs{' '}
            <code className="text-amber-50/95">frontend/</code>).
          </div>
        )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden relative">
        {remoteLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1e1e1e]/80 text-xs text-gray-400">
            Loading…
          </div>
        )}
        <Editor
          height="100%"
          language={language}
          // Imperative stream updates fight with controlled `value`; omit `value` while meta streams.
          value={writeStream ? undefined : code}
          defaultValue={
            writeStream ? writeStream.previous : fileFromMeta ? '' : DEFAULT_CODE
          }
          onChange={handleChange}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={{
            fontSize: 13,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            lineHeight: 20,
            minimap: { enabled: true, scale: 1 },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 10 },
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling: true,
            tabSize: 2,
            wordWrap: editorWordWrap === 'on' ? 'on' : 'off',
            bracketPairColorization: { enabled: true },
            guides: {
              indentation: true,
              bracketPairs: true,
            },
          }}
        />
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[#007acc] text-white text-xs">
        <div className="flex items-center gap-3">
          <span>Ln 1, Col 1</span>
          <span>Spaces: 2</span>
        </div>
        <div className="flex items-center gap-3">
          <span>UTF-8</span>
          <span>{LANGUAGES.find(l => l.id === language)?.name}</span>
        </div>
      </div>
    </div>
  )
}

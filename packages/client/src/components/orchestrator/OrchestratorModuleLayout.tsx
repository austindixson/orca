import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import { HERMES_PROVIDER_MODEL_ID, useSettingsStore } from '../../store/settingsStore'
import { useOneShotStore } from '../../store/oneShotStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useToastStore } from '../../store/toastStore'
import { useResumePromptStore } from '../../store/resumePromptStore'
import {
  extractClipboardFiles,
  filesToInputAttachments,
  pathsToInputAttachments,
} from '../../lib/inputAttachments'
import { truncateComposerPaste } from '../../lib/pasteTruncation'
import { OrchestratorModelPicker } from '../Toolbar/OrchestratorModelPicker'
import { HermesLeadToggle } from '../Toolbar/HermesLeadToggle'
import { getHomeDir, getWorkspace, isTauri } from '../../lib/tauri'
import {
  buildWriteDiffSnippet,
  snippetLinesToStreamText,
} from '../../lib/writePreviewSnippet'
import { openOrchestratorDiffForPreview } from '../../lib/orchestrator/orchestratorDiffReview'
import type { OrchestratorWritePreview } from '../../store/orchestratorActivityStore'
import { OrchestratorMarkdown } from './OrchestratorMarkdown'
import { OrchestratorPlanningDraftPanel } from './OrchestratorPlanningDraftPanel'
import {
  OrchestratorTracePeekRows,
  ORCHESTRATOR_TRACE_PEEK_LINE_COUNT,
} from './OrchestratorTracePeekRows'
import {
  classifyUnifiedDiffLine,
  classifyWritePreviewLine,
  unifiedDiffRowClassNames,
  writePreviewRowClassNames,
} from './orchestratorDiffLineStyle'
import { compactToolLine } from './orchestratorLineCompaction'
import {
  discoverSlashMenuItems,
  parseSlashMenuQuery,
  replaceSlashTokenAtCursor,
  type SlashMenuItem,
} from '../../lib/skillCommands'
import {
  OrchestratorSlashPalette,
  getSlashPickIndex,
  useSlashFlatLength,
} from './OrchestratorSlashPalette'
import {
  parseFencedSegments,
  isOrchestratorTraceLine,
  shouldSuppressBracketTraceLine,
  isSuppressedBracketReasoningBlockStart,
  isSuppressedBracketReasoningBlockBoundary,
  suppressBracketReasoningBlocks,
  type ParsedSegment,
} from '../../lib/orchestrator/activityLineParsing'
import {
  extractDelegatedTraceChip,
  type DelegatedTraceChip,
} from '../../lib/orchestrator/delegatedLogPresentation'
import { chipClass } from '../tiles/agent-tile/styles'
import { OneShotClarifyModal } from '../OneShot/OneShotClarifyModal'
import { OrchestratorQueuePanel } from './OrchestratorQueuePanel'
import { OrchestratorResumeCard } from './OrchestratorResumeCard'
import { OneShotWorkspacePickerModal } from '../OneShot/OneShotWorkspacePickerModal'
import { OneShotTempProjectsManager } from '../OneShot/OneShotTempProjectsManager'
import { ensureOrchestratorWidgetTile } from '../../lib/orchestrator/ensureOrchestratorWidgetTile'
import {
  focusOrchestratorActiveTileNow,
  revealOrchestratorTile,
} from '../../lib/orchestrator/revealOrchestratorTile'
import { quickOrchestratorInputUiStore } from './QuickOrchestratorInput'

const ASSISTANT_BUBBLE_RE = /^[A-Za-z][A-Za-z0-9 _'-]{0,46} · /

function isOrchestratorUserBubbleLine(line: string): boolean {
  return line.trimStart().startsWith('You ·')
}

/** Start of a new assistant bubble (stored prefix or configured display name). */
function isOrchestratorAssistantHeaderLine(line: string): boolean {
  const t = line.trimStart()
  return t.startsWith('Assistant ·') || ASSISTANT_BUBBLE_RE.test(t)
}

function lineClass(line: string): string {
  const t = line.trimStart()
  if (t.startsWith('You ·')) return 'text-gray-100/95 border-l-2 border-accent-teal/55 pl-2 -ml-0.5'
  if (ASSISTANT_BUBBLE_RE.test(t)) return 'text-gray-100/95 border-l-2 border-cyan-500/25 pl-2 -ml-0.5'
  if (t.startsWith('[Error]')) return 'text-red-300'
  /** System / status lines: `[Resumed]`, `[Phase …]`, etc. */
  if (t.startsWith('[')) return 'text-[11px] leading-snug text-gray-500'
  if (t.startsWith('→')) return 'text-amber-200/95'
  if (t.startsWith('←')) return 'text-emerald-300/95'
  if (t.startsWith('◆')) return 'text-cyan-300/90'
  return 'text-gray-300'
}

function extractDroppedFiles(dt: DataTransfer): File[] {
  const fromFiles = Array.from(dt.files || [])
  if (fromFiles.length > 0) return fromFiles
  const fromItems = Array.from(dt.items || [])
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f)
  return fromItems
}

function extractDroppedPaths(dt: DataTransfer): string[] {
  const uriList = dt.getData('text/uri-list') || dt.getData('text/plain')
  if (!uriList) return []
  return uriList
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.startsWith('file://'))
    .map((uri) => {
      try {
        return decodeURIComponent(uri.replace(/^file:\/\//, ''))
      } catch {
        return uri.replace(/^file:\/\//, '')
      }
    })
}

function isToolLine(line: string): boolean {
  const t = line.trimStart()
  const blockquoteTool = t.startsWith('>') && (t.startsWith('> ') || t.startsWith('>\t'))
  return blockquoteTool || t.startsWith('[') || t.startsWith('→') || t.startsWith('←') || t.startsWith('◆') || t.startsWith('⋯')
}

function isWriteFileStartLine(line: string): boolean {
  return line.trimStart().startsWith('→ write_file(')
}

const tracePeekMaskStyle: CSSProperties = {
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 45%, black 100%)',
  maskImage: 'linear-gradient(to bottom, transparent 0%, black 45%, black 100%)',
}

function StreamingCodeBlock({
  code,
  language,
  animate,
  onProgress,
}: {
  code: string
  language?: string
  animate: boolean
  onProgress?: () => void
}) {
  const lines = useMemo(() => code.split('\n'), [code])
  const lineTotal = lines.length
  const [lineCount, setLineCount] = useState(() => (animate ? 0 : lineTotal))
  const codeScrollerRef = useRef<HTMLPreElement | null>(null)
  const codeStickToBottomRef = useRef(true)
  const prevAnimateRef = useRef(animate)

  useEffect(() => {
    if (animate && !prevAnimateRef.current) {
      codeStickToBottomRef.current = true
    }
    prevAnimateRef.current = animate
  }, [animate])

  useEffect(() => {
    const total = lines.length
    if (!animate) {
      setLineCount(total)
      return
    }
    setLineCount(0)
    let n = 0
    const step = Math.max(1, Math.ceil(total / 64))
    const id = window.setInterval(() => {
      n = Math.min(total, n + step)
      setLineCount(n)
      onProgress?.()
      if (n >= total) window.clearInterval(id)
    }, 20)
    return () => window.clearInterval(id)
  }, [animate, code, lines.length, onProgress])

  const visibleLines = lines.slice(0, lineCount)

  useEffect(() => {
    const el = codeScrollerRef.current
    if (!el) return
    if (!codeStickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [lineCount, animate])

  const isDiffLang =
    (language ?? '').toLowerCase() === 'diff' || (language ?? '').toLowerCase() === 'patch'
  const streamingActive = animate && lineCount < lineTotal

  return (
    <div
      className={`overflow-hidden rounded-lg border border-tile-border/50 bg-canvas-bg/60 transition-shadow duration-300 ${
        animate ? 'shadow-[0_0_22px_-6px_rgba(45,212,191,0.18)] ring-1 ring-teal-400/20' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b border-tile-border/40 bg-black/15 px-2 py-0.5">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-gray-500">
          <span>{language || 'code'}</span>
          {streamingActive ? (
            <span className="normal-case text-teal-400/85 tabular-nums">streaming</span>
          ) : null}
        </span>
        <span className="text-[10px] tabular-nums text-gray-500">
          {lineCount}/{lineTotal} lines
        </span>
      </div>
      {isDiffLang ? (
        <pre
          ref={codeScrollerRef}
          onScroll={(e) => {
            const el = e.currentTarget
            const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight)
            codeStickToBottomRef.current = remaining < 24
          }}
          className="max-h-52 overflow-auto px-2 py-2 font-mono text-[10px] leading-relaxed"
        >
          <code>
            {visibleLines.map((row, i) => {
              const kind = classifyUnifiedDiffLine(row)
              return (
                <div key={`${i}-${row.slice(0, 16)}`} className={unifiedDiffRowClassNames(kind)}>
                  {row || '\u00a0'}
                  {streamingActive && i === visibleLines.length - 1 ? (
                    <span className="ml-0.5 inline text-teal-400/85" aria-hidden>
                      ▍
                    </span>
                  ) : null}
                </div>
              )
            })}
          </code>
        </pre>
      ) : (
        <pre
          ref={codeScrollerRef}
          onScroll={(e) => {
            const el = e.currentTarget
            const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight)
            codeStickToBottomRef.current = remaining < 24
          }}
          className="max-h-52 overflow-auto px-2.5 py-2 text-[11px] leading-snug text-gray-200/95"
        >
          <code className="whitespace-pre-wrap break-words">
            {visibleLines.join('\n')}
            {streamingActive ? (
              <span className="ml-px inline text-teal-400/90" aria-hidden>
                ▍
              </span>
            ) : null}
          </code>
        </pre>
      )}
    </div>
  )
}

function TsxFileGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="12" cy="12" r="2.5" className="text-sky-400" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4" className="text-sky-400/80" stroke="currentColor" fill="none" />
      <ellipse cx="12" cy="12" rx="4" ry="10" className="text-sky-400/80" stroke="currentColor" fill="none" />
    </svg>
  )
}

/** Inline write preview with streaming diff snippet (Cursor-style). */
function OrchestratorWritePreviewCard({
  preview,
  animate,
  onStreamTick,
}: {
  preview: OrchestratorWritePreview
  animate: boolean
  onStreamTick?: () => void
}) {
  const streamText = useMemo(() => {
    const lines = buildWriteDiffSnippet(preview.previous, preview.next, 8)
    return snippetLinesToStreamText(lines)
  }, [preview.previous, preview.next])

  const lines = useMemo(() => streamText.split('\n'), [streamText])
  const lineTotal = lines.length
  const [lineCount, setLineCount] = useState(() => (animate ? 0 : lineTotal))
  const previewScrollRef = useRef<HTMLPreElement | null>(null)
  const previewStickBottomRef = useRef(true)

  useEffect(() => {
    const total = lines.length
    if (!animate) {
      setLineCount(total)
      return
    }
    setLineCount(0)
    let n = 0
    const step = Math.max(1, Math.ceil(total / 56))
    const id = window.setInterval(() => {
      n = Math.min(total, n + step)
      setLineCount(n)
      onStreamTick?.()
      if (n >= total) window.clearInterval(id)
    }, 18)
    return () => window.clearInterval(id)
  }, [animate, streamText, lines.length, onStreamTick])

  const visibleLines = lines.slice(0, lineCount)

  useEffect(() => {
    const el = previewScrollRef.current
    if (!el) return
    if (!previewStickBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [lineCount])

  const streamingActive = animate && lineCount < lineTotal

  const ext = preview.fileName.includes('.')
    ? preview.fileName.split('.').pop()?.toLowerCase() ?? ''
    : ''
  const showReactGlyph = ext === 'tsx' || ext === 'jsx'

  return (
    <div
      className={`overflow-hidden rounded-lg border border-tile-border/50 bg-canvas-bg/70 shadow-sm transition-shadow duration-300 ${
        preview.done
          ? 'ring-0'
          : animate
            ? 'ring-1 ring-teal-400/25 shadow-[0_0_24px_-8px_rgba(45,212,191,0.22)]'
            : 'ring-1 ring-teal-500/10'
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-tile-border/40 bg-black/15 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {showReactGlyph ? (
            <TsxFileGlyph className="h-4 w-4 shrink-0 text-sky-400" />
          ) : (
            <svg
              className="h-4 w-4 shrink-0 text-accent-blue"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          )}
          <span className="truncate font-medium text-gray-100 text-[13px]" data-tooltip={preview.path}>
            {preview.fileName}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums">
          {streamingActive ? (
            <span className="text-[10px] font-sans font-medium normal-case text-teal-400/90">streaming</span>
          ) : null}
          <span className="text-emerald-400">+{preview.added}</span>
          <span className="text-rose-400/95">−{preview.removed}</span>
        </div>
      </div>
      <pre
        ref={previewScrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight)
          previewStickBottomRef.current = remaining < 24
        }}
        className="max-h-40 overflow-auto px-2 py-2 font-mono text-[10px] leading-relaxed"
      >
        <code>
          {visibleLines.map((row, i) => {
            const kind = classifyWritePreviewLine(row)
            const body = kind === 'del' ? row.slice(2) : kind === 'add' ? row.slice(2) : row
            return (
              <div key={`${i}-${row.slice(0, 12)}`} className={writePreviewRowClassNames(kind)}>
                {body || '\u00a0'}
                {streamingActive && i === visibleLines.length - 1 ? (
                  <span className="ml-0.5 inline text-teal-400/85" aria-hidden>
                    ▍
                  </span>
                ) : null}
              </div>
            )
          })}
        </code>
      </pre>
    </div>
  )
}

export type OrchestratorModuleVariant = 'sidebar' | 'tile' | 'planWorkspace'

export interface OrchestratorModuleLayoutProps {
  /** Sidebar dock uses flex-1; canvas tile uses h-full so the module fills the tile body. */
  variant?: OrchestratorModuleVariant
}

/** Cap visible composer height (px); scroll inside after this. */
const ORCHESTRATOR_TEXTAREA_MAX_HEIGHT_PX = 192
/** Show long-prompt hint; full text still goes to the run. */
const ORCHESTRATOR_LONG_INPUT_HINT_CHARS = 3_500

/** Approximate token count from serialized context (`~4 chars/token`). */
function estimateTokensFromMessages(messages: unknown): number {
  try {
    const chars = JSON.stringify(messages).length
    return Math.max(0, Math.round(chars / 4))
  } catch {
    return 0
  }
}

function formatK(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return `${Math.round(n)}`
}

function buildProgressBar(percent: number, slots = 10): string {
  const p = Math.max(0, Math.min(100, percent))
  const filled = Math.round((p / 100) * slots)
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, slots - filled))}`
}

export function OrchestratorModuleLayout({ variant = 'sidebar' }: OrchestratorModuleLayoutProps) {
  const input = useOrchestratorSessionStore((s) => s.input)
  const running = useOrchestratorSessionStore((s) => s.running)
  const inputAttachments = useOrchestratorSessionStore((s) => s.inputAttachments)
  const oneShotMode = useOrchestratorSessionStore((s) => s.oneShotMode)
  const setInput = useOrchestratorSessionStore((s) => s.setInput)
  const appendInputAttachments = useOrchestratorSessionStore((s) => s.appendInputAttachments)
  const removeInputAttachment = useOrchestratorSessionStore((s) => s.removeInputAttachment)
  const run = useOrchestratorSessionStore((s) => s.run)
  const stop = useOrchestratorSessionStore((s) => s.stop)
  const planningDraft = useOrchestratorSessionStore((s) => s.planningDraft)
  const resumePromptData = useResumePromptStore((s) => s.data)
  const addToast = useToastStore((s) => s.addToast)
  const orchestratorAutoFocus = useWorkspaceStore((s) => s.orchestratorAutoFocus)
  const setOrchestratorAutoFocus = useWorkspaceStore((s) => s.setOrchestratorAutoFocus)
  const orchestratorClarifyFocusLock = useWorkspaceStore((s) => s.orchestratorClarifyFocusLock)
  const setOrchestratorClarifyFocusLock = useWorkspaceStore((s) => s.setOrchestratorClarifyFocusLock)
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel)
  const activePanel = useWorkspaceStore((s) => s.activePanel)
  const oneShotTempPath = useOneShotStore((s) => s.tempWorkspacePath)
  const oneShotDisposable = useOneShotStore((s) => s.oneShotUsesDisposableTemp)
  const oneShotPhase = useOneShotStore((s) => s.phase)
  const oneShotDiscard = useOneShotStore((s) => s.discard)
  const oneShotConfirmSave = useOneShotStore((s) => s.confirmSave)
  const clarifyPhase = useOneShotStore((s) => s.clarifyPhase)
  const clarifyAbortController = useOneShotStore((s) => s.clarifyAbortController)
  /** Clarify LLM runs outside `session.running` but uses the same activity strip + elapsed timer. */
  const showOrchestratorRunStatus = running || clarifyPhase === 'generating'

  const handleOrchestratorStop = useCallback(() => {
    if (clarifyPhase === 'generating' && clarifyAbortController) {
      clarifyAbortController.abort()
    }
    stop()
  }, [clarifyPhase, clarifyAbortController, stop])
  const clarifyQuestions = useOneShotStore((s) => s.clarifyQuestions)
  const submitClarifyAnswers = useOneShotStore((s) => s.submitClarifyAnswers)
  const skipClarify = useOneShotStore((s) => s.skipClarify)
  const pendingOrchestratorTileId = useOneShotStore((s) => s.pendingOrchestratorTileId)
  const orchestratorTileIdForOneShot = useOneShotStore((s) => s.orchestratorTileIdForOneShot)
  const orchestratorDisplayNameRaw = useSettingsStore((s) => s.orchestratorDisplayName)
  const leadProfile = useSettingsStore((s) => s.leadProfile)
  const selectedModelId = useSettingsStore((s) => s.selectedModel)
  const availableModels = useSettingsStore((s) => s.getAvailableModels())
  const sessionMessages = useOrchestratorSessionStore((s) => s.sessionMessages)
  const orchestratorDisplayName = useMemo(() => {
    const trimmed = (orchestratorDisplayNameRaw ?? '').trim()
    return trimmed.length > 0 ? trimmed : 'Assistant'
  }, [orchestratorDisplayNameRaw])
  const runStartedAtMs = useOrchestratorActivityStore((s) => s.runStartedAtMs)
  const runUsageTotalTokens = useOrchestratorActivityStore((s) => s.runUsageTotalTokens)
  const runEstimatedContextTokens = useOrchestratorActivityStore((s) => s.runEstimatedContextTokens)
  const activity = useOrchestratorActivityStore((s) => s.activityFeed)
  const writePreviewItems = useOrchestratorActivityStore((s) => s.writePreviewItems)
  const clearWritePreviews = useOrchestratorActivityStore((s) => s.clearWritePreviews)
  const autoAcceptOrchestratorDiffs = useOrchestratorActivityStore((s) => s.autoAcceptOrchestratorDiffs)
  const setAutoAcceptOrchestratorDiffs = useOrchestratorActivityStore(
    (s) => s.setAutoAcceptOrchestratorDiffs
  )
  /** Elapsed runtime ticker shared by Hermes context strip and trace timing affordances. */
  const [runElapsedMs, setRunElapsedMs] = useState<number>(0)
  useEffect(() => {
    if (runStartedAtMs == null) return
    setRunElapsedMs(Math.max(0, Date.now() - runStartedAtMs))
    const elapsedId = window.setInterval(() => {
      setRunElapsedMs(Math.max(0, Date.now() - runStartedAtMs))
    }, 250)
    return () => {
      window.clearInterval(elapsedId)
    }
  }, [runStartedAtMs])

  const runLastToolChip = useMemo<DelegatedTraceChip | null>(() => {
    const tail = activity.slice(-40)
    for (let i = tail.length - 1; i >= 0; i--) {
      const chip = extractDelegatedTraceChip(tail[i] ?? '', i)
      if (chip && chip.kind !== 'info') return chip
    }
    return null
  }, [activity])

  const selectedModelConfig = useMemo(
    () => availableModels.find((m) => m.id === selectedModelId) ?? null,
    [availableModels, selectedModelId]
  )
  const hermesModeActive =
    leadProfile === 'hermes' || selectedModelId === HERMES_PROVIDER_MODEL_ID || selectedModelConfig?.provider === 'hermes'
  const statusModelLabel = (selectedModelConfig?.name || selectedModelConfig?.displayName || selectedModelId || 'unknown').trim()
  const rawContextLength = (selectedModelConfig as { contextLength?: unknown } | null)?.contextLength
  const contextCapTokens =
    typeof rawContextLength === 'number' && Number.isFinite(rawContextLength) && rawContextLength > 0
      ? rawContextLength
      : hermesModeActive
        ? 400_000
        : null
  const estimatedContextUsedTokens = useMemo(
    () => estimateTokensFromMessages(sessionMessages),
    [sessionMessages]
  )
  const contextUsedTokens =
    runUsageTotalTokens > 0
      ? runUsageTotalTokens
      : runEstimatedContextTokens > 0
        ? runEstimatedContextTokens
        : estimatedContextUsedTokens
  const contextUsagePercent = contextCapTokens
    ? Math.max(0, Math.min(100, Math.round((contextUsedTokens / Math.max(1, contextCapTokens)) * 100)))
    : null
  const statusElapsedLabel = `${(Math.max(0, runElapsedMs) / 1000).toFixed(1)}s`

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const [dragActive, setDragActive] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const slashMenuCacheRef = useRef<{
    key: string
    data: { skills: SlashMenuItem[]; commands: SlashMenuItem[] }
  } | null>(null)

  const [slashOpen, setSlashOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashLoading, setSlashLoading] = useState(false)
  const [slashData, setSlashData] = useState<{
    skills: SlashMenuItem[]
    commands: SlashMenuItem[]
  } | null>(null)
  const [slashSkillsShowAll, setSlashSkillsShowAll] = useState(false)
  const [slashCommandsShowAll, setSlashCommandsShowAll] = useState(false)

  const loadSlashMenu = useCallback(async () => {
    const ws = await getWorkspace()
    const home = await getHomeDir()
    const cacheKey = `${ws?.path ?? ''}||${home ?? ''}`
    const c = slashMenuCacheRef.current
    if (c && c.key === cacheKey && c.data) {
      setSlashData(c.data)
      return
    }
    setSlashLoading(true)
    try {
      const data = await discoverSlashMenuItems()
      slashMenuCacheRef.current = { key: cacheKey, data }
      setSlashData(data)
    } finally {
      setSlashLoading(false)
    }
  }, [])

  useEffect(() => {
    slashMenuCacheRef.current = null
  }, [rootPath])

  const slashFlatLen = useSlashFlatLength(
    slashData?.skills ?? [],
    slashData?.commands ?? [],
    slashFilter,
    slashSkillsShowAll,
    slashCommandsShowAll
  )

  useEffect(() => {
    if (!slashOpen || slashFlatLen <= 0) return
    setSlashIndex((i) => Math.min(Math.max(0, i), slashFlatLen - 1))
  }, [slashOpen, slashFlatLen, slashFilter])

  const syncSlashFromCursor = useCallback(
    (v: string, pos: number, resetIndex: boolean) => {
      const q = parseSlashMenuQuery(v, pos)
      if (q.active) {
        setSlashOpen(true)
        setSlashFilter(q.filter)
        if (resetIndex) setSlashIndex(0)
        void loadSlashMenu()
      } else {
        setSlashOpen(false)
      }
    },
    [loadSlashMenu]
  )

  const handleSlashPick = useCallback(
    (item: SlashMenuItem) => {
      const ta = textareaRef.current
      const pos = ta?.selectionStart ?? input.length
      const rep = replaceSlashTokenAtCursor(input, pos, item.name, true)
      if (rep) {
        setInput(rep.next)
        setSlashOpen(false)
        requestAnimationFrame(() => {
          const el = textareaRef.current
          if (el) {
            el.selectionStart = el.selectionEnd = rep.cursor
            el.focus()
          }
        })
      }
    },
    [input, setInput]
  )

  const visible = useMemo(() => activity.slice(-220), [activity])
  const traceLines = useMemo(() => {
    const withoutSuppressedReasoning = suppressBracketReasoningBlocks(visible)
    return withoutSuppressedReasoning.filter(
      (line) => isOrchestratorTraceLine(line) && !shouldSuppressBracketTraceLine(line, leadProfile === 'hermes')
    )
  }, [visible, leadProfile])

  /** Hide raw write_file arrows from the trace strip — the main column shows the diff card. */
  const traceLinesForPeek = useMemo(
    () =>
      traceLines.filter((line) => {
        const t = line.trimStart()
        return !t.startsWith('→ write_file(') && !t.startsWith('← write_file')
      }),
    [traceLines]
  )

  const mainColumnItems = useMemo(() => {
    /** Prefix count of `→ write_file(` lines in `activity` (length activity.length + 1). */
    const writeOccPrefix: number[] = new Array(activity.length + 1).fill(0)
    for (let i = 0; i < activity.length; i++) {
      writeOccPrefix[i + 1] = writeOccPrefix[i] + (isWriteFileStartLine(activity[i]) ? 1 : 0)
    }

    const totalWrites = writeOccPrefix[activity.length]
    const previewsLen = writePreviewItems.length
    /** Oldest write events evicted from `writePreviewItems` (store caps at ~32). */
    const skipped = Math.max(0, totalWrites - previewsLen)

    const activityOffset = activity.length - visible.length

    const out: Array<
      | { kind: 'write'; preview: OrchestratorWritePreview; renderKey: string }
      | {
          kind: 'bubble'
          id: string
          line: string
          segments: ParsedSegment[]
          isTool: boolean
          compactLabel: string | null
        }
    > = []

    /** Merge consecutive non-trace lines when the model/feed split one reply across rows (e.g. ``` on the next line). */
    let bubbleAcc: string | null = null
    let bubbleStartVi = -1
    let suppressReasoningBlock = false

    const flushBubbleAcc = () => {
      if (bubbleAcc === null) return
      const raw = bubbleAcc
      const displayLine =
        orchestratorDisplayName === 'Assistant'
          ? raw
          : raw.replace(/^(\s*)Assistant · /, `$1${orchestratorDisplayName} · `)
      const firstLine = raw.split('\n')[0] ?? raw
      out.push({
        kind: 'bubble',
        id: `b-${bubbleStartVi}-${raw.slice(0, 40)}`,
        line: displayLine,
        isTool: isToolLine(firstLine),
        compactLabel: compactToolLine(firstLine),
        segments: parseFencedSegments(displayLine),
      })
      bubbleAcc = null
    }

    for (let vi = 0; vi < visible.length; vi++) {
      const line = visible[vi]

      if (suppressReasoningBlock) {
        if (isSuppressedBracketReasoningBlockStart(line)) {
          flushBubbleAcc()
          continue
        }
        if (!isSuppressedBracketReasoningBlockBoundary(line)) {
          flushBubbleAcc()
          continue
        }
        suppressReasoningBlock = false
      }

      if (isWriteFileStartLine(line)) {
        flushBubbleAcc()
        const ai = activityOffset + vi
        const occInclusive = writeOccPrefix[ai + 1]
        const previewIndex = occInclusive - 1 - skipped
        const preview =
          previewIndex >= 0 && previewIndex < previewsLen ? writePreviewItems[previewIndex] : undefined
        if (preview) {
          out.push({
            kind: 'write',
            preview,
            renderKey: `w-${occInclusive}-${preview.id}`,
          })
        }
        continue
      }
      if (isSuppressedBracketReasoningBlockStart(line)) {
        suppressReasoningBlock = true
        flushBubbleAcc()
        continue
      }

      if (isOrchestratorTraceLine(line)) {
        flushBubbleAcc()
        continue
      }

      const isContinuation =
        bubbleAcc !== null &&
        vi === bubbleStartVi + 1 &&
        !isOrchestratorUserBubbleLine(line) &&
        !isOrchestratorAssistantHeaderLine(line) &&
        !isToolLine(line)

      if (isContinuation) {
        bubbleAcc += '\n' + line
        continue
      }

      flushBubbleAcc()
      bubbleAcc = line
      bubbleStartVi = vi
    }
    flushBubbleAcc()
    return out
  }, [visible, activity, writePreviewItems, orchestratorDisplayName])

  /** One row per path (latest write wins) — Cursor-style file list for the diff tracker. */
  const diffTrackerFiles = useMemo(() => {
    const map = new Map<string, OrchestratorWritePreview>()
    for (const p of writePreviewItems) {
      map.set(p.path, p)
    }
    return Array.from(map.values())
  }, [writePreviewItems])

  const handleDiffReview = useCallback(() => {
    const last = diffTrackerFiles[diffTrackerFiles.length - 1]
    if (!last) return
    openOrchestratorDiffForPreview(last, null)
  }, [diffTrackerFiles])

  const handleAcceptAllDiffs = useCallback(() => {
    if (diffTrackerFiles.length === 0) return
    const paths = [...new Set(diffTrackerFiles.map((p) => p.path))]
    for (const path of paths) {
      void useWorkspaceStore.getState().syncExplorerAfterWrite(path)
    }
    clearWritePreviews()
    addToast({
      type: 'success',
      title: 'Accepted all',
      message: `${paths.length} file${paths.length === 1 ? '' : 's'} dismissed from the tracker. Contents are already on disk.`,
    })
  }, [diffTrackerFiles, clearWritePreviews, addToast])

  const tracePeekRows = useMemo(() => {
    const last = traceLinesForPeek.slice(-ORCHESTRATOR_TRACE_PEEK_LINE_COUNT)
    const pad = Math.max(0, ORCHESTRATOR_TRACE_PEEK_LINE_COUNT - last.length)
    return [...Array<string>(pad).fill(''), ...last]
  }, [traceLinesForPeek])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])
  const lastMainColumnKey = useMemo(() => {
    if (mainColumnItems.length === 0) return 'empty'
    const last = mainColumnItems[mainColumnItems.length - 1]
    if (last.kind === 'write') return `w:${last.renderKey}:${last.preview.done}`
    return `b:${last.line.length}:${last.line.slice(0, 40)}:${last.line.slice(-40)}`
  }, [mainColumnItems])

  /** Bumps when trace tail changes so scroll follows streaming trace at the bottom of the chat. */
  const tracePeekScrollKey = useMemo(
    () =>
      traceLinesForPeek.length > 0
        ? `${traceLinesForPeek.length}:${traceLinesForPeek[traceLinesForPeek.length - 1]?.length ?? 0}:${traceLinesForPeek[
            traceLinesForPeek.length - 1
          ]?.slice(-96) ?? ''}`
        : running
          ? 'running'
          : 'idle',
    [traceLinesForPeek, running]
  )
  /** Scroll when formatted plan lands; streaming no longer grows visible DOM from draft body. */
  const planningDraftUiKey = useMemo(() => {
    if (!planningDraft) return 'none'
    if (planningDraft.phase === 'formatted') {
      return `fmt:${planningDraft.title}:${planningDraft.body.length}`
    }
    return `stream:${planningDraft.title}`
  }, [planningDraft])

  /**
   * `resumePromptVisible` is included so the "Continue where we left off?" card scrolls
   * into view the moment it spawns at the bottom of the chat (above the input).
   */
  const resumePromptVisible = resumePromptData != null
  useEffect(() => {
    if (running || stickToBottomRef.current || resumePromptVisible) {
      requestAnimationFrame(scrollToBottom)
    }
  }, [
    running,
    lastMainColumnKey,
    tracePeekScrollKey,
    planningDraftUiKey,
    resumePromptVisible,
    scrollToBottom,
  ])

  const handleStreamingProgress = useCallback(() => {
    if (running || stickToBottomRef.current) {
      scrollToBottom()
    }
  }, [running, scrollToBottom])

  const focusClarifyUi = useCallback(() => {
    // Do not open the right orchestrator sidebar — duplicate layout + modal. Pan/zoom to the
    // canvas orchestrator widget only (auto-focus the tile).
    requestAnimationFrame(scrollToBottom)
    const widgetId =
      pendingOrchestratorTileId ?? orchestratorTileIdForOneShot ?? ensureOrchestratorWidgetTile()
    if (widgetId) {
      revealOrchestratorTile(
        widgetId,
        { label: 'Clarifying…', effect: 'pulse' },
        widgetId,
        { bypassAutoFocusPreference: true, forceCamera: true }
      )
    }
  }, [orchestratorTileIdForOneShot, pendingOrchestratorTileId, scrollToBottom])

  useEffect(() => {
    const locked = clarifyPhase === 'waiting' && (clarifyQuestions?.length ?? 0) > 0
    setOrchestratorClarifyFocusLock(locked)
    if (locked) {
      focusClarifyUi()
    }
  }, [clarifyPhase, clarifyQuestions, focusClarifyUi, setOrchestratorClarifyFocusLock])

  useEffect(() => {
    return () => {
      useWorkspaceStore.getState().setOrchestratorClarifyFocusLock(false)
    }
  }, [])

  const hasOrchestratorWidgetTile = useCanvasStore((s) =>
    [...s.tiles.values()].some(
      (t) => t.type === 'orchestrator' && t.meta?.orchestratorWidget === true
    )
  )

  // Auto-focus and select input: canvas widget tile is the primary surface when it exists.
  // Include `running` so sidebar Run (which switches active panel to tasks) still focuses the tile.
  useEffect(() => {
    const shouldFocus =
      !orchestratorClarifyFocusLock &&
      (variant === 'planWorkspace' ||
        (variant === 'tile' &&
          hasOrchestratorWidgetTile &&
          (activePanel === 'orchestrator' || running)) ||
        (variant === 'sidebar' && activePanel === 'orchestrator' && !hasOrchestratorWidgetTile))

    if (shouldFocus && textareaRef.current) {
      const delay = variant === 'tile' ? 360 : 50
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          if (variant === 'planWorkspace') {
            const ae = document.activeElement as HTMLElement | null
            if (ae?.closest?.('[data-orca-plan-document]')) return
          }
          textareaRef.current.focus()
          textareaRef.current.select()
        }
      }, delay)
      return () => clearTimeout(timer)
    }
  }, [
    variant,
    activePanel,
    running,
    orchestratorClarifyFocusLock,
    hasOrchestratorWidgetTile,
  ])

  const handleDropFiles = async (
    files: File[],
    opts?: {
      preferLocalImagePaths?: boolean
    }
  ) => {
    if (files.length === 0) {
      addToast({
        type: 'warning',
        title: 'No files detected',
        message: 'Drop files directly onto the input area.',
      })
      return
    }
    const { attachments, rejected } = await filesToInputAttachments(files, {
      preferLocalImagePaths: opts?.preferLocalImagePaths,
    })
    if (attachments.length > 0) {
      appendInputAttachments(attachments)
      addToast({
        type: 'success',
        title: 'Attachments added',
        message: `${attachments.length} file${attachments.length === 1 ? '' : 's'} attached.`,
      })
    }
    if (rejected.length > 0) {
      addToast({
        type: 'warning',
        title: 'Some files were skipped',
        message: rejected.slice(0, 2).join(' · '),
      })
    }
  }

  const handleDropPaths = async (paths: string[]) => {
    if (paths.length === 0) return
    const { attachments, rejected } = await pathsToInputAttachments(paths)
    if (attachments.length > 0) {
      appendInputAttachments(attachments)
      addToast({
        type: 'success',
        title: 'Attachments added',
        message: `${attachments.length} file${attachments.length === 1 ? '' : 's'} attached.`,
      })
    }
    if (rejected.length > 0) {
      addToast({
        type: 'warning',
        title: 'Some files were skipped',
        message: rejected.slice(0, 2).join(' · '),
      })
    }
  }

  const handleDropDataTransfer = async (dt: DataTransfer) => {
    const files = extractDroppedFiles(dt)
    if (files.length > 0) {
      await handleDropFiles(files)
      return
    }
    const paths = extractDroppedPaths(dt)
    if (paths.length === 0) {
      addToast({
        type: 'warning',
        title: 'No files detected',
        message: 'Drop files directly onto the input area.',
      })
      return
    }
    await handleDropPaths(paths)
  }

  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | null = null
    let alive = true

    const install = async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
        const win = getCurrentWebviewWindow()
        unlisten = await win.onDragDropEvent(async (event) => {
          if (!alive) return
          const { type } = event.payload

          if (type === 'over') {
            setDragActive(true)
            return
          }
          if (type === 'drop') {
            setDragActive(false)
            const paths = Array.isArray(event.payload.paths) ? event.payload.paths : []
            await handleDropPaths(paths)
            return
          }
          if (type === 'leave') {
            setDragActive(false)
          }
        })
      } catch {
        // Fall back to browser DataTransfer handlers only.
      }
    }

    void install()
    return () => {
      alive = false
      if (unlisten) unlisten()
    }
  }, [handleDropPaths])

  /** Include planning + resume prompt so those UIs are not hidden behind the empty placeholder
   * (main column is driven by `activityFeed`, which can lag `loadSession` or be empty briefly). */
  const showChatShell =
    mainColumnItems.length > 0 ||
    traceLinesForPeek.length > 0 ||
    running ||
    planningDraft != null ||
    resumePromptData != null

  /** Canvas tile: single-line input until focused (sidebar keeps slightly taller default). */
  const compactTileInput =
    variant === 'tile' && !inputFocused && inputAttachments.length === 0

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el || compactTileInput) {
      if (el && compactTileInput) {
        el.style.height = ''
        el.style.maxHeight = ''
        el.style.overflowY = ''
      }
      return
    }
    el.style.maxHeight = `${ORCHESTRATOR_TEXTAREA_MAX_HEIGHT_PX}px`
    el.style.height = 'auto'
    const minH = 36
    const sh = el.scrollHeight
    const target = Math.min(Math.max(sh, minH), ORCHESTRATOR_TEXTAREA_MAX_HEIGHT_PX)
    el.style.height = `${target}px`
    el.style.overflowY = sh > ORCHESTRATOR_TEXTAREA_MAX_HEIGHT_PX ? 'auto' : 'hidden'
  }, [input, compactTileInput])

  const rootClass =
    variant === 'tile' || variant === 'planWorkspace'
      ? 'flex h-full min-h-0 flex-col bg-canvas-depth-raised/95 text-left text-gray-200'
      : 'orchestrator-sidebar-root flex min-h-0 flex-1 flex-col bg-tile-bg/70 text-gray-200'

  /** Match Research / agent tiles: neutral chrome; teal only on accents (mode, run). */
  const dropZoneClass = dragActive
    ? 'space-y-2 rounded-lg border border-tile-border bg-teal-500/5 p-2'
    : 'space-y-2 rounded-lg border border-tile-border/80 bg-black/10 p-2'

  const textareaClass = [
    'w-full resize-none rounded-lg border border-tile-border/70 bg-canvas-bg/90 px-3 pr-28 text-sm text-gray-100 placeholder:text-gray-600 transition-colors duration-150 ease-out focus:outline-none focus:border-teal-500/35',
    compactTileInput
      ? 'py-1.5 pb-1.5 min-h-[2.25rem] max-h-[2.25rem] overflow-hidden leading-5'
      : 'py-2 pb-10 leading-snug min-h-[2.25rem] overflow-hidden',
  ].join(' ')

  const runFromTileComposer = useCallback(() => {
    if (variant === 'tile') {
      quickOrchestratorInputUiStore.getState().setSuppressedUntilIdle(true)
    }
    return run()
  }, [run, variant])

  return (
    <div className={rootClass}>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight)
          stickToBottomRef.current = remaining < 96
        }}
        className="flex-1 overflow-auto px-3 py-2 text-[13px] leading-relaxed"
      >
        <div className="flex min-h-full flex-col justify-end gap-2 font-sans">
          {!showChatShell ? (
            <div className="rounded-md bg-transparent px-2.5 py-2 text-xs text-gray-500">
              Replies and final output appear here. Latest trace lines show at the bottom of the panel; expand
              Trace below for the full log.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-lg border border-tile-border/50 bg-transparent px-2.5 py-1.5 shadow-sm">
              {mainColumnItems.map((entry, i) =>
                entry.kind === 'write' ? (
                  <OrchestratorWritePreviewCard
                    key={entry.renderKey}
                    preview={entry.preview}
                    animate={running && i === mainColumnItems.length - 1}
                    onStreamTick={handleStreamingProgress}
                  />
                ) : (
                  <div
                    key={entry.id}
                    className={`rounded-lg bg-transparent px-2.5 py-2 text-gray-100 ${lineClass(
                      entry.line
                    )}`}
                  >
                    {entry.isTool ? (
                      <div className="space-y-1">
                        {entry.compactLabel ? (
                          <div className="text-[12px] font-medium text-amber-100/95">{entry.compactLabel}</div>
                        ) : null}
                        {entry.compactLabel && entry.compactLabel.trim() !== entry.line.trim() ? (
                          <details className="rounded border border-tile-border/40 bg-black/15 px-2 py-1 text-[11px] text-gray-300">
                            <summary className="cursor-pointer list-none text-[10px] uppercase tracking-wide text-gray-500 marker:content-none [&::-webkit-details-marker]:hidden">
                              Details
                            </summary>
                            <div className="mt-1 whitespace-pre-wrap break-words">{entry.line}</div>
                          </details>
                        ) : (
                          <div className="whitespace-pre-wrap break-words">{entry.line}</div>
                        )}
                      </div>
                    ) : (
                      entry.segments.map((seg, sIdx) =>
                        seg.type === 'code' ? (
                          <StreamingCodeBlock
                            key={`${entry.id}-code-${sIdx}`}
                            code={seg.content}
                            language={seg.language}
                            animate={running && i === mainColumnItems.length - 1}
                            onProgress={handleStreamingProgress}
                          />
                        ) : seg.content ? (
                          <OrchestratorMarkdown key={`${entry.id}-txt-${sIdx}`} content={seg.content} />
                        ) : null
                      )
                    )}
                  </div>
                )
              )}
              {planningDraft ? (
                <OrchestratorPlanningDraftPanel planningDraft={planningDraft} />
              ) : null}
              <OrchestratorResumeCard />
              {(traceLines.length > 0 || running) && (
                <div
                  className="shrink-0"
                  data-tooltip="Latest trace lines (expand Trace below for the full log)"
                >
                  <OrchestratorTracePeekRows
                    tracePeekRows={tracePeekRows}
                    running={running}
                    traceLineCount={traceLines.length}
                    maskStyle={tracePeekMaskStyle}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 space-y-1 border-t border-tile-border/50 bg-transparent px-2.5 pb-2 pt-1.5">
        {oneShotMode && <OneShotTempProjectsManager />}

        {oneShotTempPath && (oneShotPhase === 'preview' || oneShotPhase === 'complete') && (
          <div className="rounded-lg border border-tile-border/50 bg-canvas-bg/80 px-3 py-2 text-[11px] text-gray-200">
            <p className="font-medium text-teal-200/90">Preview workspace ready</p>
            <p className="mt-1 break-all font-mono text-[10px] text-gray-400">{oneShotTempPath}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void oneShotDiscard()}
                className="rounded-md border border-tile-border/80 bg-black/30 px-2 py-1 text-[10px] text-gray-200 hover:bg-white/5"
              >
                {oneShotDisposable ? 'Discard temp' : 'Discard run'}
              </button>
              <button
                type="button"
                onClick={() => setActivePanel('explorer')}
                className="rounded-md border border-teal-500/35 bg-teal-500/10 px-2 py-1 text-[10px] font-medium text-teal-200 hover:bg-teal-500/20"
              >
                Open explorer
              </button>
              <button
                type="button"
                onClick={() => void oneShotConfirmSave()}
                className="rounded-md border border-teal-500/40 bg-teal-500/15 px-2 py-1 text-[10px] font-medium text-teal-100 hover:bg-teal-500/25"
              >
                Save project as…
              </button>
            </div>
          </div>
        )}

        {traceLines.length > 0 && (
          <details className="group rounded-lg border border-tile-border/50 bg-canvas-bg/60 font-mono text-[10px] text-gray-500">
            <summary className="cursor-pointer list-none px-2 py-1.5 text-[10px] text-gray-400 transition-colors marker:content-none hover:text-gray-200 [&::-webkit-details-marker]:hidden">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="rounded border border-tile-border/60 bg-black/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-gray-500">
                  Trace
                </span>
                <span>{traceLines.length} lines</span>
                <span className="text-gray-600">· planning, tools, model</span>
                {runLastToolChip && runLastToolChip.kind !== 'info' ? (
                  <span
                    className={
                      runLastToolChip.kind === 'call'
                        ? chipClass('cyan') + ' max-w-[210px] truncate py-0'
                        : chipClass('emerald') + ' max-w-[210px] truncate py-0'
                    }
                    data-tooltip={runLastToolChip.name}
                  >
                    <span className="shrink-0 opacity-70">{runLastToolChip.kind === 'call' ? '→' : '←'}</span>
                    <span className="truncate">{runLastToolChip.name}</span>
                  </span>
                ) : null}
                <span className="ml-auto text-[9px] text-gray-600 group-open:hidden">▸</span>
                <span className="ml-auto hidden text-[9px] text-gray-600 group-open:inline">▾</span>
              </span>
            </summary>
            <div className="max-h-36 space-y-0.5 overflow-y-auto border-t border-tile-border/40 px-2 py-1.5 leading-tight">
              {traceLines.map((line, idx) => (
                <div key={`t-${idx}-${line.slice(0, 24)}`} className={`whitespace-pre-wrap break-all ${lineClass(line)}`}>
                  {line}
                </div>
              ))}
            </div>
          </details>
        )}

        {diffTrackerFiles.length > 0 && (
          <details className="group rounded-lg border border-tile-border/50 bg-canvas-bg/60 font-mono text-[10px] text-gray-500">
            <summary className="cursor-pointer list-none px-2 py-1.5 text-[10px] text-gray-400 transition-colors marker:content-none hover:text-gray-200 [&::-webkit-details-marker]:hidden">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="rounded border border-tile-border/60 bg-black/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-gray-500">
                    Diffs
                  </span>
                  <span>{diffTrackerFiles.length} files</span>
                  <span className="hidden text-gray-600 sm:inline">· pending review</span>
                  <span className="ml-auto text-[9px] text-gray-600 group-open:hidden">▸</span>
                  <span className="ml-auto hidden text-[9px] text-gray-600 group-open:inline">▾</span>
                </span>
                <span
                  className="flex shrink-0 flex-wrap items-center justify-end gap-2"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="flex cursor-pointer items-center gap-1.5 font-sans text-[9px] text-gray-500">
                    <input
                      type="checkbox"
                      className="h-3 w-3 accent-teal"
                      checked={autoAcceptOrchestratorDiffs}
                      onChange={(e) => setAutoAcceptOrchestratorDiffs(e.target.checked)}
                    />
                    Auto-accept
                  </label>
                  <button
                    type="button"
                    className="rounded border border-tile-border/60 bg-[#3c3c3c] px-2 py-0.5 font-sans text-[10px] font-medium text-gray-100 hover:bg-[#4a4a4a]"
                    onClick={() => handleDiffReview()}
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    className="rounded border border-teal-500/35 bg-teal-500/10 px-2 py-0.5 font-sans text-[10px] font-medium text-teal-200 hover:bg-teal-500/20"
                    onClick={() => handleAcceptAllDiffs()}
                  >
                    Accept all
                  </button>
                </span>
              </div>
            </summary>
            <div className="max-h-40 space-y-0.5 overflow-y-auto border-t border-tile-border/40 px-2 py-1.5 font-sans">
              {diffTrackerFiles.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-[11px] text-gray-300 hover:bg-white/5"
                  onClick={() => openOrchestratorDiffForPreview(p, null)}
                >
                  <span className="min-w-0 truncate" data-tooltip={p.path}>
                    {p.fileName}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">
                    <span className="text-emerald-400">+{p.added}</span>{' '}
                    <span className="text-rose-400/95">−{p.removed}</span>
                  </span>
                </button>
              ))}
            </div>
          </details>
        )}

        {hermesModeActive && contextUsagePercent !== null && (
          <div className="flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded border border-teal-500/20 bg-teal-500/5 px-2.5 font-mono text-[10px] text-teal-100/90">
            <span className="truncate text-teal-200/90">⚕ {statusModelLabel}</span>
            <span className="text-teal-300/40">│</span>
            <span className="shrink-0 tabular-nums">{formatK(contextUsedTokens)}/{formatK(contextCapTokens ?? 0)}</span>
            <span className="text-teal-300/40">│</span>
            <span className="shrink-0">[{buildProgressBar(contextUsagePercent)}] {contextUsagePercent}%</span>
            <span className="text-teal-300/40">│</span>
            <span className="shrink-0 tabular-nums">{statusElapsedLabel}</span>
          </div>
        )}


        <OrchestratorQueuePanel />

        <div
          ref={dropZoneRef}
          className={dropZoneClass}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragActive(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const nextTarget = e.relatedTarget as Node | null
            if (nextTarget && e.currentTarget.contains(nextTarget)) return
            setDragActive(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragActive(false)
            void handleDropDataTransfer(e.dataTransfer)
          }}
        >
          {!compactTileInput && input.length > ORCHESTRATOR_LONG_INPUT_HINT_CHARS && (
            <p className="text-[10px] leading-tight text-gray-500">
              Too much to display — your full prompt is still sent when you run.
            </p>
          )}
          <div className="relative">
            {slashOpen && (
              <OrchestratorSlashPalette
                skills={slashData?.skills ?? []}
                commands={slashData?.commands ?? []}
                filter={slashFilter}
                loading={slashLoading}
                skillsShowAll={slashSkillsShowAll}
                commandsShowAll={slashCommandsShowAll}
                onToggleSkillsMore={() => setSlashSkillsShowAll((s) => !s)}
                onToggleCommandsMore={() => setSlashCommandsShowAll((s) => !s)}
                selectedIndex={slashIndex}
                onHoverIndex={setSlashIndex}
                onPick={handleSlashPick}
              />
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                const v = e.target.value
                const pos = e.target.selectionStart ?? v.length
                setInput(v)
                syncSlashFromCursor(v, pos, true)
              }}
              onSelect={(e) => {
                const el = e.currentTarget
                syncSlashFromCursor(el.value, el.selectionStart ?? 0, false)
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragActive(true)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragActive(false)
                void handleDropDataTransfer(e.dataTransfer)
              }}
              onPaste={(e) => {
                const files = extractClipboardFiles(e.clipboardData)
                if (files.length > 0) {
                  e.preventDefault()
                  e.stopPropagation()
                  void handleDropFiles(files, { preferLocalImagePaths: true })
                  return
                }

                const pastedText = e.clipboardData?.getData('text/plain') ?? ''
                if (!pastedText) return
                const truncated = truncateComposerPaste(pastedText)
                if (!truncated.truncated) return

                e.preventDefault()
                e.stopPropagation()
                const el = e.currentTarget
                const start = el.selectionStart ?? input.length
                const end = el.selectionEnd ?? start
                const next = `${input.slice(0, start)}${truncated.text}${input.slice(end)}`
                const cursor = start + truncated.text.length
                setInput(next)
                syncSlashFromCursor(next, cursor, true)
                requestAnimationFrame(() => {
                  const ta = textareaRef.current
                  if (!ta) return
                  ta.selectionStart = ta.selectionEnd = cursor
                })
                addToast({
                  type: 'info',
                  title: 'Large paste truncated',
                  message: `${truncated.keptLines}/${truncated.totalLines} lines kept to protect context window.`,
                })
              }}
              onKeyDown={(e) => {
                if (slashOpen) {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setSlashOpen(false)
                    return
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    setSlashOpen(false)
                    return
                  }
                  if (slashData && slashFlatLen > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setSlashIndex((i) => Math.min(i + 1, slashFlatLen - 1))
                      return
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setSlashIndex((i) => Math.max(0, i - 1))
                      return
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (slashData && slashFlatLen > 0) {
                      const item = getSlashPickIndex(
                        slashData.skills,
                        slashData.commands,
                        slashFilter,
                        slashSkillsShowAll,
                        slashCommandsShowAll,
                        slashIndex
                      )
                      if (item) handleSlashPick(item)
                    }
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void runFromTileComposer()
                }
              }}
              placeholder={
                oneShotMode
                  ? 'Describe the project you want to build… (1-shot uses text only)'
                  : 'Ask orchestrator… (drag files here)'
              }
              rows={1}
              className={textareaClass}
            />
            <div className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-tile-border/80 bg-black/30 text-gray-300 hover:text-white"
                data-tooltip="Attach files"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-8.49 8.49a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.82l8.48-8.48" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void runFromTileComposer()}
                disabled={!input.trim() && inputAttachments.length === 0}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-teal-500/40 bg-teal-500/15 text-teal-200 hover:bg-teal-500/25 disabled:opacity-40"
                data-tooltip={running ? 'Queue message' : 'Run'}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleOrchestratorStop}
                disabled={!showOrchestratorRunStatus}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-tile-border/80 bg-black/30 text-gray-300 hover:text-white disabled:opacity-40"
                data-tooltip="Stop"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="7" y="7" width="10" height="10" rx="1.5" />
                </svg>
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files || [])
              if (files.length > 0) void handleDropFiles(files)
              e.currentTarget.value = ''
            }}
          />
          {inputAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 pb-1">
              {inputAttachments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => removeInputAttachment(a.id)}
                  className="inline-flex items-center gap-1 rounded border border-teal-500/30 bg-black/30 px-2 py-0.5 text-[11px] text-teal-200/95"
                  data-tooltip={`${a.name} (${Math.max(1, Math.round(a.size / 1024))}KB)${a.sourcePath ? `\n${a.sourcePath}` : ''} — click to remove`}
                >
                  <span>{a.kind === 'image' ? '🖼' : '📄'}</span>
                  <span className="max-w-[180px] truncate">{a.name}</span>
                  <span className="text-gray-400">×</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                if (e.shiftKey || e.altKey) {
                  setOrchestratorAutoFocus(!orchestratorAutoFocus)
                  return
                }
                if (!orchestratorAutoFocus) setOrchestratorAutoFocus(true)
                focusOrchestratorActiveTileNow()
              }}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                orchestratorAutoFocus
                  ? 'border-teal-500/35 bg-teal-500/10 text-teal-200'
                  : 'border-tile-border/70 text-gray-400 hover:bg-white/5 hover:text-gray-200'
              }`}
              data-tooltip={
                orchestratorClarifyFocusLock
                  ? 'Clarify questions are temporarily pinning focus to the orchestrator until you answer or skip.'
                  : 'Click: pan + zoom to fit the tile the orchestrator is using · Shift-click: toggle auto-focus on/off'
              }
              aria-pressed={orchestratorAutoFocus}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  orchestratorAutoFocus
                    ? 'bg-teal-400/90 shadow-[0_0_8px_rgba(45,212,191,0.8)]' : 'bg-gray-500'
                }`}
              />
              Auto-focus
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current/40 text-[9px] leading-none">
                ?
              </span>
            </button>
            <HermesLeadToggle />
            {leadProfile !== 'hermes' && (
              <div className="min-w-0 max-w-[min(100%,20rem)] flex-1">
                <OrchestratorModelPicker hideLabel />
              </div>
            )}
          </div>
        </div>
      </div>

      <OneShotWorkspacePickerModal />

      {oneShotMode && clarifyPhase === 'waiting' && (clarifyQuestions?.length ?? 0) > 0 && (
        <OneShotClarifyModal
          questions={clarifyQuestions ?? []}
          onFocusQuestionChange={focusClarifyUi}
          onSubmit={(answers) => void submitClarifyAnswers(answers)}
          onSkip={() => void skipClarify()}
          onCancel={() => void oneShotDiscard()}
        />
      )}
    </div>
  )
}


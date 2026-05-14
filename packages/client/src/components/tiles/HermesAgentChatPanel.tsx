import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useCanvasStore } from '../../store/canvasStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useToastStore } from '../../store/toastStore'
import {
  HERMES_API_DEFAULT_BASE,
  formatHermesConnectionError,
  hermesConversationForTile,
  probeHermesModels,
  sendHermesPrompt,
  type HermesProbeResult,
} from '../../lib/hermes/hermesResponses'
import {
  isLocalHermesBaseUrl,
  spawnHermesGatewayTerminal,
} from '../../lib/hermes/hermesGatewayLauncher'
import { ensureOrchestratorWidgetTile } from '../../lib/orchestrator/ensureOrchestratorWidgetTile'
import { getDefaultSessionId } from '../../lib/persistence/sessionPersistence'
import { useHermesTelemetryStore } from '../../store/hermesTelemetryStore'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import {
  collapseStillWaitingRuns,
  extractDelegatedTraceChip,
  formatTraceChipLabel,
  type DelegatedTraceChip,
} from '../../lib/orchestrator/delegatedLogPresentation'
import { parseAgentOutputText, type ParsedOutputBlock } from './agent-tile/agentOutputParse'
import { AgentAvatar } from '../AgentAvatar'
import { useTileMountAck } from '../../hooks/useTileMountAck'
import { openHermesTelemetryForTile } from '../../lib/openHermesTelemetryForTile'
import { useAnimationActivityGate } from '../../hooks/useAnimationActivityGate'

/**
 * Hermes-flavored working verbs — shown inside the streaming bubble while Hermes
 * is generating. Distinct from orchestrator status verbs (claw-code–style strip).
 */
const HERMES_VERBS = [
  'Consulting the gateway',
  'Weaving Hermes thoughts',
  'Reading the knowledge base',
  'Following a skill trail',
  'Listening on /v1/responses',
  'Routing through Hermes',
  'Pondering tools',
  'Composing a reply',
] as const

function pickHermesVerb(seed: number): string {
  return HERMES_VERBS[seed % HERMES_VERBS.length]
}

type ChatLine = {
  id: string
  role: 'user' | 'assistant'
  content: string
  error?: boolean
}

type GatewayState = 'unknown' | 'checking' | 'reachable' | 'auth_failed' | 'unreachable'

type Props = {
  tileId: string
  tileMeta: Record<string, unknown> | undefined
}

const MAX_PERSISTED_LINES = 200
const MAX_RAW_TRACE_LINES = 120
const PROBE_INTERVAL_MS = 30_000
const POST_SPAWN_PROBE_MS = 2_500

/** Pixels from bottom to treat as “near bottom” for auto-scroll (matches orchestrator chat). */
const HERMES_CHAT_STICK_TO_BOTTOM_PX = 96

/**
 * User message bubble — right-aligned (`ml-8`) vs assistant (`mr-8`). Normal document flow (no sticky)
 * so assistant replies are never covered by a pinned user row.
 */
export const HERMES_USER_MESSAGE_BUBBLE_CLASS =
  'ml-8 rounded-lg border border-teal-500/30 bg-teal-950/60 px-2.5 py-2 text-gray-100'

function emitDebugLog(
  runId: string,
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  fetch('http://127.0.0.1:7696/ingest/d871edbc-ff39-4d74-96b8-887cea450cfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'eaa681' },
    body: JSON.stringify({
      sessionId: 'eaa681',
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}

function hydrateLinesFromMeta(meta: Record<string, unknown> | undefined): ChatLine[] {
  const raw = meta?.hermesChat
  if (!Array.isArray(raw)) return []
  const out: ChatLine[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id ? o.id : nanoid()
    const role = o.role === 'user' || o.role === 'assistant' ? o.role : null
    const content = typeof o.content === 'string' ? o.content : null
    if (!role || content == null) continue
    out.push({ id, role, content, error: o.error === true })
    if (out.length >= MAX_PERSISTED_LINES) break
  }
  return out
}

function HermesDiffBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const lines = content.split(/\r?\n/)
  return (
    <div
      data-testid="hermes-chat-diff-block"
      className={`mt-1 max-w-full overflow-x-auto rounded border border-violet-500/35 bg-black/55 px-0 py-1 font-mono text-[10px] leading-snug ${
        streaming ? 'ring-1 ring-cyan-500/25' : ''
      }`}
    >
      <div className="border-b border-tile-border/60 px-2 pb-1 text-[9px] font-semibold uppercase tracking-wide text-violet-300/90">
        Diff {streaming ? <span className="text-cyan-400/90">· streaming</span> : null}
      </div>
      <div className="max-h-64 overflow-y-auto px-1 py-0.5">
        {lines.map((line, i) => {
          const t = line.replace(/\r$/, '')
          let rowClass = 'text-gray-400/95'
          if (t.startsWith('+') && !t.startsWith('+++')) rowClass = 'bg-emerald-950/40 text-emerald-100/95'
          else if (t.startsWith('-') && !t.startsWith('---')) rowClass = 'bg-rose-950/35 text-rose-100/95'
          else if (t.startsWith('@@')) rowClass = 'bg-violet-950/50 text-violet-200/95'
          return (
            <div key={i} className={`whitespace-pre-wrap break-all px-1.5 py-[1px] ${rowClass}`}>
              {t || ' '}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HermesCodeBlock({
  lang,
  content,
  streaming,
}: {
  lang: string
  content: string
  streaming?: boolean
}) {
  return (
    <div
      data-testid="hermes-chat-code-block"
      className={`mt-1 max-w-full overflow-x-auto rounded border border-gray-600/50 bg-black/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-gray-200 [overflow-wrap:anywhere] ${
        streaming ? 'ring-1 ring-cyan-500/30' : ''
      }`}
    >
      {lang && lang !== 'text' ? (
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">{lang}</div>
      ) : null}
      <pre className="whitespace-pre-wrap break-words">{content}</pre>
      {streaming ? <div className="mt-1 text-[9px] font-medium text-cyan-400/90">Streaming…</div> : null}
    </div>
  )
}

function HermesAssistantContent({ content }: { content: string }) {
  const blocks = parseAgentOutputText(content)
  if (!blocks.length) return <div className="whitespace-pre-wrap break-words">{content}</div>

  return (
    <div className="space-y-1">
      {blocks.map((b: ParsedOutputBlock, i) => {
        if (b.kind === 'diff') return <HermesDiffBlock key={`d-${i}`} content={b.content} streaming={b.streaming} />
        if (b.kind === 'code') {
          return <HermesCodeBlock key={`c-${i}`} lang={b.lang} content={b.content} streaming={b.streaming} />
        }
        if (b.kind === 'assistant' || b.kind === 'user' || b.kind === 'systemInfo' || b.kind === 'error') {
          return (
            <div key={`t-${i}`} className="whitespace-pre-wrap break-words">
              {b.text}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

export function HermesAgentChatPanel({ tileId, tileMeta }: Props) {
  const openSettingsToSection = useSettingsStore((s) => s.openSettingsToSection)
  const hermesApiBaseUrl = useSettingsStore((s) => s.hermesApiBaseUrl)
  const hermesApiKey = useSettingsStore((s) => s.hermesApiKey)
  const hermesModel = useSettingsStore((s) => s.hermesModel)
  const updateTile = useCanvasStore((s) => s.updateTile)
  const addToast = useToastStore((s) => s.addToast)
  const appendTelemetry = useHermesTelemetryStore((s) => s.append)
  useTileMountAck(tileId, true)

  const [lines, setLines] = useState<ChatLine[]>(() => hydrateLinesFromMeta(tileMeta))
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [assistantStreaming, setAssistantStreaming] = useState('')
  const [gatewayState, setGatewayState] = useState<GatewayState>('unknown')
  const [gatewayHint, setGatewayHint] = useState<string>('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [verbSeed, setVerbSeed] = useState(0)
  const [traceChips, setTraceChips] = useState<DelegatedTraceChip[]>([])
  const [rawTraceLines, setRawTraceLines] = useState<string[]>([])
  const [hermesTraceExpanded, setHermesTraceExpanded] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const lastUserTextRef = useRef<string>('')
  const hydratedRef = useRef(false)
  const streamStartRef = useRef<number | null>(null)
  /** Orchestrator-driven sends (meta.taskId) — hand off to lead session in `finally`. */
  const delegationContextRef = useRef<{
    taskId: string
    parentOrchestratorTileId: string
  } | null>(null)
  const processedOrchestratorTaskIdsRef = useRef<Set<string>>(new Set())
  const traceIndexRef = useRef(0)

  const conversationId = hermesConversationForTile(tileId, tileMeta)
  const effectiveBaseUrl = hermesApiBaseUrl?.trim() || HERMES_API_DEFAULT_BASE
  const canAutostart = useMemo(() => isLocalHermesBaseUrl(effectiveBaseUrl), [effectiveBaseUrl])

  const scrollChatToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    if (streaming || stickToBottomRef.current) {
      requestAnimationFrame(scrollChatToBottom)
    }
  }, [lines, assistantStreaming, streaming, scrollChatToBottom])

  // Rotate Hermes working verb + tick elapsed counter while streaming.
  useEffect(() => {
    if (!streaming) {
      setElapsedMs(0)
      streamStartRef.current = null
      return
    }
    if (streamStartRef.current == null) streamStartRef.current = performance.now()
    const tick = window.setInterval(() => {
      const started = streamStartRef.current
      if (started != null) setElapsedMs(performance.now() - started)
    }, 250)
    const verbTick = window.setInterval(() => {
      setVerbSeed((s) => s + 1)
    }, 2200)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(verbTick)
    }
  }, [streaming])

  const applyProbeResult = useCallback((probe: HermesProbeResult) => {
    // #region agent log
    emitDebugLog('hermes-gateway-issues', 'H1', 'HermesAgentChatPanel.tsx:220', 'Applied Hermes probe result', {
      ok: probe.ok,
      status: probe.status,
      hint: probe.hint.slice(0, 180),
    })
    // #endregion
    if (probe.ok) {
      setGatewayState('reachable')
      setGatewayHint(probe.hint || 'Gateway reachable.')
      return
    }
    if (probe.status === 0) setGatewayState('unreachable')
    else setGatewayState('auth_failed')
    setGatewayHint(probe.hint || 'Gateway not ready.')
  }, [])

  const runProbe = useCallback(
    async (signal?: AbortSignal): Promise<HermesProbeResult> => {
      setGatewayState((prev) => (prev === 'unknown' ? 'checking' : prev))
      const probe = await probeHermesModels(
        effectiveBaseUrl,
        hermesApiKey?.trim() || undefined,
        signal
      )
      if (!signal?.aborted) applyProbeResult(probe)
      return probe
    },
    [effectiveBaseUrl, hermesApiKey, applyProbeResult]
  )

  /** Single 30 s probe loop — folds the old autostart polling state machine in. */
  useEffect(() => {
    const ac = new AbortController()
    void runProbe(ac.signal).catch(() => {})
    const tick = window.setInterval(() => {
      if (ac.signal.aborted) return
      void runProbe(ac.signal).catch(() => {})
    }, PROBE_INTERVAL_MS)
    return () => {
      ac.abort()
      window.clearInterval(tick)
    }
  }, [runProbe])

  const persistLines = useCallback(
    (next: ChatLine[]) => {
      const trimmed = next.length > MAX_PERSISTED_LINES ? next.slice(-MAX_PERSISTED_LINES) : next
      const t = useCanvasStore.getState().tiles.get(tileId)
      const prevMeta =
        t?.meta && typeof t.meta === 'object' ? (t.meta as Record<string, unknown>) : {}
      updateTile(tileId, {
        meta: {
          ...prevMeta,
          hermesChat: trimmed.map((ln) => ({
            id: ln.id,
            role: ln.role,
            content: ln.content,
            ...(ln.error ? { error: true } : {}),
          })),
        },
      })
    },
    [tileId, updateTile]
  )

  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true
      return
    }
    persistLines(lines)
  }, [lines, persistLines])

  const setTileWorking = useCallback(
    (working: boolean) => updateTile(tileId, { tileStatus: working ? 'working' : 'idle' }),
    [tileId, updateTile]
  )

  const pushTraceChip = useCallback((raw: string) => {
    const chip = extractDelegatedTraceChip(raw, traceIndexRef.current++)
    if (!chip) return
    setTraceChips((prev) => {
      const next = [...prev, chip]
      return next.length > 8 ? next.slice(-8) : next
    })
  }, [])

  const appendRawTrace = useCallback((raw: string) => {
    const line = raw.trimEnd()
    if (!line) return
    setRawTraceLines((prev) => [...prev, line].slice(-MAX_RAW_TRACE_LINES))
  }, [])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    useAgentTeamStore.getState().setAbortController(tileId, null)
    setStreaming(false)
    setAssistantStreaming('')
    setTraceChips([])
    traceIndexRef.current = 0
    setRawTraceLines([])
    setHermesTraceExpanded(false)
    setTileWorking(false)
  }, [tileId, setTileWorking])

  const handleClear = useCallback(() => {
    setLines([])
    setAssistantStreaming('')
    setTraceChips([])
    traceIndexRef.current = 0
    setRawTraceLines([])
    setHermesTraceExpanded(false)
    const t = useCanvasStore.getState().tiles.get(tileId)
    const prevMeta = t?.meta && typeof t.meta === 'object' ? (t.meta as Record<string, unknown>) : {}
    const nextMeta = { ...prevMeta }
    delete (nextMeta as Record<string, unknown>).hermesChat
    updateTile(tileId, { meta: nextMeta })
  }, [tileId, updateTile])

  const handleNewSession = useCallback(() => {
    const t = useCanvasStore.getState().tiles.get(tileId)
    const prevMeta = t?.meta && typeof t.meta === 'object' ? (t.meta as Record<string, unknown>) : {}
    const newConv = `orca-hermes-${nanoid(12)}`
    const nextMeta: Record<string, unknown> = { ...prevMeta, conversation: newConv }
    delete nextMeta.hermesChat
    updateTile(tileId, { meta: nextMeta })
    setLines([])
    setAssistantStreaming('')
    setTraceChips([])
    traceIndexRef.current = 0
    setRawTraceLines([])
    setHermesTraceExpanded(false)
    addToast({
      type: 'info',
      title: 'Hermes chat',
      message: 'Started a new conversation id on this tile.',
    })
  }, [tileId, updateTile, addToast])

  const startGateway = useCallback(() => {
    if (!canAutostart) {
      addToast({
        type: 'warning',
        title: 'Hermes gateway',
        message: 'Start gateway only works for local gateways (127.0.0.1 / localhost).',
      })
      return
    }
    const result = spawnHermesGatewayTerminal(
      useCanvasStore.getState() as unknown as Parameters<typeof spawnHermesGatewayTerminal>[0],
      {
        baseUrl: effectiveBaseUrl,
        skipIfNonLocal: true,
        parentOrchestratorTileId: ensureOrchestratorWidgetTile(),
        sessionId: getDefaultSessionId(),
      }
    )
    // #region agent log
    emitDebugLog('hermes-gateway-issues', 'H4', 'HermesAgentChatPanel.tsx:361', 'Start gateway action', {
      action: result.action,
      baseUrl: effectiveBaseUrl,
      canAutostart,
    })
    // #endregion
    if (result.action === 'skipped_non_local') {
      addToast({
        type: 'warning',
        title: 'Hermes gateway',
        message: 'Start gateway skipped: Hermes API base URL is not local.',
      })
      return
    }
    addToast({
      type: 'info',
      title: 'Hermes gateway',
      message:
        result.action === 'spawned'
          ? 'Spawning terminal: API_SERVER_ENABLED=true hermes gateway'
          : 'Reusing existing hermes gateway terminal — waiting for it to come up.',
    })
    setGatewayState('checking')
    setGatewayHint('Starting hermes gateway…')
    window.setTimeout(() => {
      void runProbe().catch(() => {})
    }, POST_SPAWN_PROBE_MS)
  }, [canAutostart, effectiveBaseUrl, addToast, runProbe])

  const runSend = useCallback(
    async (
      text: string,
      orchestratorOpts?: { taskId: string; parentOrchestratorTileId: string }
    ) => {
      if (!text || streaming) return
      if (orchestratorOpts) {
        processedOrchestratorTaskIdsRef.current.add(orchestratorOpts.taskId)
        delegationContextRef.current = orchestratorOpts
      }
      lastUserTextRef.current = text

      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      useAgentTeamStore.getState().setAbortController(tileId, ac)

      const userLine: ChatLine = { id: nanoid(), role: 'user', content: text }
      setLines((prev) => [...prev, userLine])
      setDraft('')
      setStreaming(true)
      setAssistantStreaming('')
      setTraceChips([])
      traceIndexRef.current = 0
      setRawTraceLines([])
      setHermesTraceExpanded(false)
      setTileWorking(true)

      const baseUrl = hermesApiBaseUrl?.trim() || HERMES_API_DEFAULT_BASE
      const model = hermesModel?.trim() || 'hermes-agent'
      const conv = hermesConversationForTile(
        tileId,
        useCanvasStore.getState().tiles.get(tileId)?.meta
      )

      let acc = ''
      let handoffOutcome: 'done' | 'error' | 'cancelled' = 'done'
      let handoffSummary = ''
      let handoffError: string | undefined
      try {
        await sendHermesPrompt({
          baseUrl,
          apiKey: hermesApiKey?.trim() || undefined,
          model,
          input: text,
          conversation: conv,
          signal: ac.signal,
          onTextDelta: (s) => {
            acc = s
            setAssistantStreaming(s)
          },
          onProgress: (line) => {
            appendTelemetry(`[tile ${tileId.slice(0, 8)}] ${line}`)
            appendRawTrace(line)
            pushTraceChip(line)
          },
          onTelemetryEvent: (payload) => {
            appendTelemetry(`[tile ${tileId.slice(0, 8)}] ${payload.slice(0, 3000)}`)
            appendRawTrace(payload)
            pushTraceChip(payload)
          },
        })

        const finalText = acc.trim() || '(empty reply)'
        handoffSummary = finalText
        setLines((prev) => [...prev, { id: nanoid(), role: 'assistant', content: finalText }])
        void runProbe().catch(() => {})
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e)
        // #region agent log
        emitDebugLog('hermes-gateway-issues', 'H5', 'HermesAgentChatPanel.tsx:458', 'Hermes send failure', {
          baseUrl,
          message: raw.slice(0, 260),
          aborted: ac.signal.aborted,
        })
        // #endregion
        if (ac.signal.aborted || /abort/i.test(raw)) {
          handoffOutcome = 'cancelled'
          handoffSummary = '[Cancelled]'
          setLines((prev) => [...prev, { id: nanoid(), role: 'assistant', content: '[Cancelled]' }])
        } else {
          handoffOutcome = 'error'
          const formatted = formatHermesConnectionError(e, baseUrl)
          handoffError = formatted
          handoffSummary = formatted
          addToast({ type: 'error', title: 'Hermes chat', message: formatted.slice(0, 260) })
          setLines((prev) => [
            ...prev,
            { id: nanoid(), role: 'assistant', content: formatted, error: true },
          ])
          void runProbe().catch(() => {})
        }
      } finally {
        setAssistantStreaming('')
        setStreaming(false)
        useAgentTeamStore.getState().setAbortController(tileId, null)
        abortRef.current = null
        setTileWorking(false)

        const dc = delegationContextRef.current
        delegationContextRef.current = null
        if (dc) {
          const t = useCanvasStore.getState().tiles.get(tileId)
          const m =
            t?.meta && typeof t.meta === 'object' ? (t.meta as Record<string, unknown>) : null
          if (
            m &&
            m.taskId === dc.taskId &&
            m.parentOrchestratorTileId === dc.parentOrchestratorTileId
          ) {
            const displayName =
              typeof m.hermesTileDisplayName === 'string' && m.hermesTileDisplayName.trim()
                ? m.hermesTileDisplayName.trim()
                : 'Hermes'
            useOrchestratorSessionStore.getState().recordSubAgentHandoff({
              displayName,
              role: 'Hermes chat',
              tileId,
              outcome: handoffOutcome,
              summary: handoffOutcome === 'error' ? undefined : handoffSummary,
              error: handoffOutcome === 'error' ? handoffError : undefined,
            })
            useAgentTeamStore.getState().patchMember(tileId, {
              status:
                handoffOutcome === 'done' ? 'done' : handoffOutcome === 'cancelled' ? 'idle' : 'error',
              lastSummary: handoffOutcome !== 'error' ? handoffSummary : undefined,
              error: handoffOutcome === 'error' ? handoffError : undefined,
              currentTask: 'Done',
            })
            useCanvasStore.getState().updateTile(tileId, { tileStatus: 'idle' })
          }
        }
      }
    },
    [
      streaming,
      hermesApiBaseUrl,
      hermesApiKey,
      hermesModel,
      tileId,
      addToast,
      appendTelemetry,
      appendRawTrace,
      pushTraceChip,
      setTileWorking,
      runProbe,
    ]
  )

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text) return
    await runSend(text)
  }, [draft, runSend])

  /** Lead orchestrator sets `taskId` + `delegatedTask` on the tile — auto-send once per taskId. */
  useEffect(() => {
    const taskId = typeof tileMeta?.taskId === 'string' ? tileMeta.taskId.trim() : ''
    const task = typeof tileMeta?.delegatedTask === 'string' ? tileMeta.delegatedTask.trim() : ''
    const parent =
      typeof tileMeta?.parentOrchestratorTileId === 'string'
        ? tileMeta.parentOrchestratorTileId.trim()
        : ''
    if (!taskId || !task || !parent) return
    if (processedOrchestratorTaskIdsRef.current.has(taskId)) return
    void runSend(task, { taskId, parentOrchestratorTileId: parent })
  }, [
    tileMeta?.taskId,
    tileMeta?.delegatedTask,
    tileMeta?.parentOrchestratorTileId,
    runSend,
    streaming,
  ])

  const retryLast = useCallback(async () => {
    const text = lastUserTextRef.current.trim()
    if (!text || streaming) return
    await runSend(text)
  }, [runSend, streaming])

  const hermesTracePreview = useMemo(
    () => collapseStillWaitingRuns(rawTraceLines).join('\n'),
    [rawTraceLines]
  )

  const pill = useMemo(() => {
    switch (gatewayState) {
      case 'reachable':
        return { className: 'border-teal-500/40 bg-teal-950/40 text-teal-200', label: 'Gateway OK' }
      case 'auth_failed':
        return {
          className: 'border-amber-500/50 bg-amber-950/30 text-amber-200',
          label: 'Auth mismatch',
        }
      case 'unreachable':
        return {
          className: 'border-rose-500/50 bg-rose-950/30 text-rose-200',
          label: 'Gateway unreachable',
        }
      case 'checking':
        return {
          className: 'border-gray-600/60 bg-black/30 text-gray-300',
          label: 'Gateway: checking…',
        }
      default:
        return {
          className: 'border-gray-600/60 bg-black/30 text-gray-400',
          label: 'Gateway: unknown',
        }
    }
  }, [gatewayState])

  const showStartBtn = canAutostart && gatewayState !== 'reachable'
  const { containerRef, allowAnimation } = useAnimationActivityGate(
    tileId,
    streaming || assistantStreaming.length > 0
  )

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col bg-canvas-bg">
      <div className="shrink-0 space-y-1 border-b border-teal-500/15 px-3 py-2">
        <div className="flex items-center gap-2">
          <AgentAvatar
            displayName="Hermes"
            role="Hermes gateway"
            provider="hermes"
            size={24}
            editable
            data-tooltip="Hermes — click to change avatar"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-teal-200/90">Hermes</div>
            <p className="truncate font-mono text-[10px] text-gray-600">
              Model: {hermesModel || 'hermes-agent'} · conversation:{' '}
              <span data-tooltip={conversationId}>
                {conversationId.slice(0, 36)}
                {conversationId.length > 36 ? '…' : ''}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="hermes-gateway-pill"
            data-tooltip={gatewayHint || undefined}
            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${pill.className}`}
          >
            {pill.label}
          </span>
          {showStartBtn ? (
            <button
              type="button"
              onClick={startGateway}
              className="rounded border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-900/40"
              data-testid="hermes-start-gateway"
            >
              Start gateway
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openHermesTelemetryForTile(tileId)}
            className="inline-flex items-center gap-1 rounded border border-teal-500/30 bg-teal-950/35 px-2 py-1 text-[10px] font-medium text-teal-200/95 hover:bg-teal-900/40"
            data-tooltip="Open Hermes telemetry sidebar filtered to this tile"
          >
            <svg className="h-3.5 w-3.5 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 12h2l1.5-6L10 18l2.5-12L15 14h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Telemetry
          </button>
          <button
            type="button"
            onClick={() => openSettingsToSection('integrations')}
            className="rounded border border-teal-500/30 bg-teal-950/35 px-2 py-1 text-[10px] text-teal-200/95 hover:bg-teal-900/40"
          >
            Hermes API settings
          </button>
          <button
            type="button"
            onClick={handleNewSession}
            disabled={streaming}
            className="rounded border border-tile-border/80 bg-black/30 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-40"
          >
            New session
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={streaming || (lines.length === 0 && !assistantStreaming)}
            className="rounded border border-tile-border/80 bg-black/30 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-40"
          >
            Clear transcript
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight)
          stickToBottomRef.current = remaining < HERMES_CHAT_STICK_TO_BOTTOM_PX
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2 text-[13px] leading-relaxed"
      >
        {lines.length === 0 && !assistantStreaming ? (
          <div className="space-y-2 text-[12px] text-gray-600">
            <p>
              Send a message to reach Hermes over HTTP. Start the gateway from a terminal tile if
              needed; Orca auto-reads <code className="text-gray-500">API_SERVER_KEY</code> from{' '}
              <code className="text-gray-500">~/.hermes/.env</code>.
            </p>
          </div>
        ) : null}
        {lines.map((ln, idx) => {
          const isLast = idx === lines.length - 1
          const errorBubble = ln.role === 'assistant' && ln.error === true
          return (
            <div
              key={ln.id}
              className={
                ln.role === 'user'
                  ? HERMES_USER_MESSAGE_BUBBLE_CLASS
                  : errorBubble
                  ? 'mr-8 rounded-lg border border-rose-500/40 bg-rose-950/20 px-2.5 py-2 text-rose-100'
                  : 'mr-8 rounded-lg border border-tile-border/60 bg-black/25 px-2.5 py-2 text-gray-300'
              }
            >
              <div
                className={`mb-1 text-[9px] font-semibold uppercase tracking-wide ${
                  errorBubble ? 'text-rose-200/90' : 'text-gray-500'
                }`}
              >
                {ln.role === 'user' ? 'You' : errorBubble ? 'Hermes · error' : 'Hermes'}
              </div>
              {ln.role === 'assistant' ? (
                <HermesAssistantContent content={ln.content} />
              ) : (
                <div className="whitespace-pre-wrap break-words">{ln.content}</div>
              )}
              {errorBubble && isLast ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void retryLast()}
                    disabled={streaming || !lastUserTextRef.current}
                    className="rounded border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-900/40 disabled:opacity-40"
                    data-testid="hermes-retry"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => openSettingsToSection('integrations')}
                    className="rounded border border-teal-500/30 bg-teal-950/30 px-2 py-0.5 text-[10px] text-teal-200/95 hover:bg-teal-900/40"
                  >
                    Open integrations
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
        {streaming || assistantStreaming ? (
          <div
            data-testid="hermes-streaming-bubble"
            className="mr-8 rounded-lg border border-teal-500/30 bg-teal-950/15 px-2.5 py-2 text-gray-300 shadow-[0_0_12px_rgba(20,184,166,0.08)]"
          >
            <div className="mb-1 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wide text-teal-200/85">
              <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${allowAnimation ? 'bg-teal-300 shadow-[0_0_8px_rgba(94,234,212,0.8)]' : 'bg-teal-300'}`} />
              <span>Hermes</span>
              <span className="text-gray-500 normal-case tracking-normal">·</span>
              <span
                data-testid="hermes-working-verb"
                className="normal-case tracking-normal text-teal-100/80"
              >
                {pickHermesVerb(verbSeed)}…
              </span>
              <span className="ml-auto font-mono text-[9px] text-gray-500">
                {(elapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
            {assistantStreaming ? (
              <HermesAssistantContent content={assistantStreaming} />
            ) : (
              <div className="text-[11px] italic text-gray-500">Waiting for first token…</div>
            )}
            {traceChips.length > 0 ? (
              <div
                data-testid="hermes-trace-chips"
                className="mt-2 flex flex-wrap gap-1.5 border-t border-teal-500/10 pt-1.5"
              >
                {traceChips.map((chip, i) => (
                  <span
                    key={chip.id}
                    className="rounded border border-teal-500/20 bg-black/25 px-1.5 py-0.5 font-mono text-[9px] text-teal-200/70 transition-opacity"
                    style={{ opacity: 0.45 + 0.55 * ((i + 1) / traceChips.length) }}
                    data-tooltip={formatTraceChipLabel(chip)}
                  >
                    {formatTraceChipLabel(chip)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {rawTraceLines.length > 0 ? (
        <div className="shrink-0 border-t border-teal-500/15 bg-black/20 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-teal-200/75">
              Gateway trace
            </span>
            <button
              type="button"
              onClick={() => setHermesTraceExpanded((v) => !v)}
              className="rounded border border-teal-500/25 px-2 py-0.5 text-[10px] text-teal-100/90 hover:bg-teal-950/40"
              aria-expanded={hermesTraceExpanded}
            >
              {hermesTraceExpanded ? 'Collapse' : 'Expand'} ({rawTraceLines.length})
            </button>
          </div>
          {hermesTraceExpanded ? (
            <pre
              data-testid="hermes-raw-trace"
              className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-teal-500/15 bg-black/35 p-2 font-mono text-[10px] leading-relaxed text-gray-400"
            >
              {hermesTracePreview}
            </pre>
          ) : (
            <p className="mt-1 line-clamp-2 font-mono text-[10px] leading-snug text-gray-500">
              {hermesTracePreview.slice(0, 220)}
              {hermesTracePreview.length > 220 ? '…' : ''}
            </p>
          )}
        </div>
      ) : null}

      <div className="shrink-0 border-t border-teal-500/15 p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          disabled={streaming}
          placeholder="Message Hermes… (Enter send, Shift+Enter newline)"
          rows={3}
          className="mb-2 w-full resize-y rounded-lg border border-tile-border/80 bg-black/35 px-2.5 py-2 font-sans text-[13px] text-gray-100 placeholder-gray-600 focus:border-teal-500/50 focus:outline-none disabled:opacity-50"
        />
        <div className="flex justify-end gap-2">
          {streaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-lg bg-rose-600/90 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-rose-500"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim()}
              className="rounded-lg bg-teal-600/85 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-teal-500 disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

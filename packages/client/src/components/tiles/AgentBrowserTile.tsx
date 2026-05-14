import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  PRESENTATION_CLICK_FEEDBACK_MS,
  PRESENTATION_DEFAULT_TRANSITION_MS,
  clickFeedbackDurationMs,
  dwellBeforeClickMs,
  moveDurationMs,
} from '../../lib/agentBrowser/agentBrowserPresentation'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { useCanvasStore, type AgentBrowserTileMeta } from '../../store/canvasStore'
import { useToastStore } from '../../store/toastStore'
import { useTileMountAck } from '../../hooks/useTileMountAck'
import {
  AgentBrowserWsClient,
  parseSnapshotRefs,
  type CursorPosition,
  type FrameMetadata,
} from '../../lib/agentBrowser/agentBrowserClient'
import { CursorOverlay, ViewportCanvas } from '../../lib/agentBrowser/CursorOverlay'
import { normalizeAndValidateAgentBrowserUrl } from '../../lib/agentBrowser/agentBrowserUrlPolicy'
import { navigateAgentBrowserTile } from '../../lib/agentBrowser/navigateAgentBrowserTile'
import {
  AGENT_BROWSER_BASE_TITLE,
  AGENT_BROWSER_ERROR_TITLE,
  buildAgentBrowserErrorSubtitle,
} from '../../lib/agentBrowser/chrome'
import * as tauri from '../../lib/tauri'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

function getMeta(data: { meta?: Record<string, unknown> }): AgentBrowserTileMeta {
  return (data.meta ?? {}) as AgentBrowserTileMeta
}

export function AgentBrowserTile({ data }: TileComponentProps) {
  const ackMount = useTileMountAck(data.id)
  const updateTile = useCanvasStore((s) => s.updateTile)
  const toast = useToastStore((s) => s.addToast)

  // State
  const [inputUrl, setInputUrl] = useState('')
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [frame, setFrame] = useState<string | null>(null)
  const [frameMetadata, setFrameMetadata] = useState<FrameMetadata | null>(null)
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({
    x: 0,
    y: 0,
    visible: false,
    isClicking: false,
  })
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [showSnapshot, setShowSnapshot] = useState(false)
  const [activityLog, setActivityLog] = useState<string[]>([])
  const [isInitializing, setIsInitializing] = useState(false)
  const [pointerTransitionMs, setPointerTransitionMs] = useState(
    PRESENTATION_DEFAULT_TRANSITION_MS
  )
  const [clickOverlayFeedbackMs, setClickOverlayFeedbackMs] = useState(PRESENTATION_CLICK_FEEDBACK_MS)
  const [reducedMotion, setReducedMotion] = useState(false)

  // Refs
  const wsClientRef = useRef<AgentBrowserWsClient | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  /** Monotonic id to cancel in-flight pointer stories when a new one starts. */
  const presentationRunIdRef = useRef(0)
  const lastPointerForPresentationRef = useRef({ x: 0, y: 0, visible: false })
  /** Avoid overwriting the URL bar while the user is editing (orchestrator may update meta.currentUrl). */
  const urlBarFocusedRef = useRef(false)

  const meta = useMemo(() => getMeta(data), [data.meta])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    lastPointerForPresentationRef.current = {
      x: cursorPosition.x,
      y: cursorPosition.y,
      visible: cursorPosition.visible,
    }
  }, [cursorPosition.x, cursorPosition.y, cursorPosition.visible])

  // Initialize on mount
  useEffect(() => {
    ackMount()
  }, [ackMount])

  // Sync URL bar from canvas meta when orchestrator/tools update the tile (not while typing).
  useEffect(() => {
    if (!meta.currentUrl || urlBarFocusedRef.current) return
    setInputUrl(meta.currentUrl)
  }, [meta.currentUrl])

  // Sync snapshot from meta
  useEffect(() => {
    if (meta.lastSnapshot) {
      setSnapshot(meta.lastSnapshot)
    }
  }, [meta.lastSnapshot])

  // Connect to WebSocket when stream port is available
  useEffect(() => {
    const port = meta.streamPort
    if (!port) return

    if (wsClientRef.current) {
      wsClientRef.current.updatePort(port)
    } else {
      const client = new AgentBrowserWsClient(port)

      client.onConnection((connected) => {
        setConnectionState(connected ? 'connected' : 'disconnected')
      })

      client.onFrame((frameData, metadata) => {
        setFrame(frameData)
        setFrameMetadata(metadata)
      })

      client.onCursorMove((pos) => {
        setCursorPosition(pos)
      })

      client.connect()
      wsClientRef.current = client
      setConnectionState('connecting')
    }

    return () => {
      if (wsClientRef.current) {
        wsClientRef.current.disconnect()
        wsClientRef.current = null
      }
    }
  }, [meta.streamPort])

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setActivityLog((prev) => [`[${timestamp}] ${message}`, ...prev.slice(0, 49)])
  }, [])

  const updateMeta = useCallback(
    (updates: Partial<AgentBrowserTileMeta>) => {
      updateTile(data.id, {
        meta: { ...meta, ...updates },
      })
    },
    [data.id, meta, updateTile]
  )

  const handleNavigate = useCallback(async () => {
    const raw = inputUrl.trim()
    if (!raw) {
      toast({
        type: 'warning',
        title: 'Agent Browser',
        message: 'Enter a URL first',
        duration: 3000,
      })
      return
    }

    if (!tauri.isTauri()) {
      const message = 'agent-browser requires the Orca desktop app'
      updateTile(data.id, {
        title: AGENT_BROWSER_ERROR_TITLE,
        tileStatus: 'error',
        meta: {
          ...meta,
          lastSessionError: message,
          subtitle: buildAgentBrowserErrorSubtitle(message),
        },
      })
      toast({
        type: 'error',
        title: AGENT_BROWSER_BASE_TITLE,
        message,
        duration: 5000,
      })
      return
    }

    setIsInitializing(true)
    setConnectionState('connecting')
    addLog('Checking agent-browser dependency...')

    try {
      await tauri.ensureAgentBrowserCliInstalled()
      const validated = normalizeAndValidateAgentBrowserUrl(raw)
      addLog(`Navigating to ${validated}`)
      const { snapshot } = await navigateAgentBrowserTile(data.id, validated)
      setInputUrl(validated)
      setSnapshot(snapshot)
      addLog('Navigation complete')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionState('error')
      addLog(`Error: ${message}`)
      updateTile(data.id, {
        title: AGENT_BROWSER_ERROR_TITLE,
        tileStatus: 'error',
        meta: {
          ...meta,
          lastSessionError: message,
          subtitle: buildAgentBrowserErrorSubtitle(message),
        },
      })
      toast({
        type: 'error',
        title: 'Navigation failed',
        message,
        duration: 5000,
      })
    } finally {
      setIsInitializing(false)
    }
  }, [inputUrl, data.id, addLog, toast])

  const handleRefresh = useCallback(async () => {
    if (!meta.sessionName) return

    addLog('Refreshing page...')
    try {
      await tauri.runAgentBrowser(['reload'], { sessionName: meta.sessionName })
      addLog('Page refreshed')
    } catch (error) {
      addLog(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [meta.sessionName, addLog])

  const handleSnapshot = useCallback(async () => {
    if (!meta.sessionName) return

    addLog('Taking snapshot...')
    try {
      const result = await tauri.runAgentBrowser(['snapshot', '-i', '--json'], { sessionName: meta.sessionName })
      try {
        const parsed = JSON.parse(result) as { data?: { snapshot?: string } }
        if (parsed.data?.snapshot) {
          setSnapshot(parsed.data.snapshot)
          updateMeta({ lastSnapshot: parsed.data.snapshot })
          setShowSnapshot(true)
          addLog('Snapshot captured')
        }
      } catch {
        setSnapshot(result)
        setShowSnapshot(true)
      }
    } catch (error) {
      addLog(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [meta.sessionName, updateMeta, addLog])

  const runPointerStory = useCallback(
    (opts: {
      myRun: number
      targetX: number
      targetY: number
      sessionName: string
      tauriRef?: string
      clearMetaPresentation: boolean
      onAfterTauriClick?: () => void
    }) => {
      const { myRun, targetX, targetY, sessionName, tauriRef, clearMetaPresentation, onAfterTauriClick } =
        opts
      if (myRun !== presentationRunIdRef.current) return
      const from = lastPointerForPresentationRef.current.visible
        ? { x: lastPointerForPresentationRef.current.x, y: lastPointerForPresentationRef.current.y }
        : { x: targetX, y: targetY }
      const moveMs = moveDurationMs(from, { x: targetX, y: targetY }, { reducedMotion })
      const dwell = dwellBeforeClickMs({ reducedMotion })
      const feedback = clickFeedbackDurationMs({ reducedMotion })
      setPointerTransitionMs(moveMs)
      setClickOverlayFeedbackMs(feedback)
      setTimeout(() => {
        if (myRun !== presentationRunIdRef.current) return
        wsClientRef.current?.emitCursorTarget(targetX, targetY, false)
      }, 0)
      const t1 = moveMs + dwell
      setTimeout(() => {
        if (myRun !== presentationRunIdRef.current) return
        if (tauriRef) {
          void tauri.runAgentBrowser(['click', tauriRef], { sessionName })
          onAfterTauriClick?.()
        }
        wsClientRef.current?.emitCursorTarget(targetX, targetY, true)
        setTimeout(() => {
          if (myRun !== presentationRunIdRef.current) return
          wsClientRef.current?.emitCursorTarget(targetX, targetY, false)
          setPointerTransitionMs(PRESENTATION_DEFAULT_TRANSITION_MS)
          if (clearMetaPresentation) {
            const st = useCanvasStore.getState()
            const t = st.tiles.get(data.id)
            if (t) {
              const m = { ...(t.meta as Record<string, unknown>) }
              delete m.agentBrowserPresentation
              st.updateTile(data.id, { meta: m })
            }
          }
        }, feedback)
      }, t1)
    },
    [data.id, reducedMotion]
  )

  const handleScreenshot = useCallback(async () => {
    if (!meta.sessionName) return

    addLog('Taking screenshot...')
    try {
      const result = await tauri.runAgentBrowser(['screenshot', '--annotate', '--json'], {
        sessionName: meta.sessionName,
      })
      try {
        const parsed = JSON.parse(result) as { data?: { path?: string } }
        if (parsed.data?.path) {
          addLog(`Screenshot saved: ${parsed.data.path}`)
          toast({
            type: 'success',
            title: 'Screenshot saved',
            message: parsed.data.path,
            duration: 3000,
          })
        }
      } catch {
        addLog('Screenshot taken')
      }
    } catch (error) {
      addLog(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [meta.sessionName, addLog, toast])

  const handleClose = useCallback(async () => {
    if (meta.sessionName) {
      addLog('Closing browser session...')
      try {
        await tauri.runAgentBrowser(['close'], { sessionName: meta.sessionName })
        addLog('Session closed')
      } catch {
        // Ignore close errors
      }
    }
    setFrame(null)
    setSnapshot(null)
    setConnectionState('disconnected')
    updateTile(data.id, {
      title: AGENT_BROWSER_BASE_TITLE,
      tileStatus: 'idle',
      meta: {
        ...meta,
        currentUrl: undefined,
        streamPort: undefined,
        lastSnapshot: undefined,
        lastSessionError: undefined,
        subtitle: undefined,
      },
    })
  }, [meta, meta.sessionName, updateTile, data.id, addLog])

  // Handle click passthrough to browser
  const handleViewportMouseDown = useCallback(
    (x: number, y: number) => {
      wsClientRef.current?.sendMouseEvent({ eventType: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    },
    []
  )

  const handleViewportMouseUp = useCallback(
    (x: number, y: number) => {
      wsClientRef.current?.sendMouseEvent({ eventType: 'mouseReleased', x, y, button: 'left' })
    },
    []
  )

  const handleViewportKeyDown = useCallback(
    (key: string, code: string) => {
      wsClientRef.current?.sendKeyboardEvent({ eventType: 'keyDown', key, code })
    },
    []
  )

  // Handle clicking refs in snapshot
  const handleRefClick = useCallback(
    async (ref: string) => {
      if (!meta.sessionName) return

      const myRun = ++presentationRunIdRef.current
      addLog(`Clicking ${ref}`)
      try {
        let hasBox = false
        let targetX = 0
        let targetY = 0
        try {
          const boxResult = await tauri.runAgentBrowser(['get', 'box', ref, '--json'], {
            sessionName: meta.sessionName,
          })
          const box = JSON.parse(boxResult) as {
            success?: boolean
            data?: { x: number; y: number; width: number; height: number }
          }
          if (box.success && box.data) {
            hasBox = true
            targetX = box.data.x + box.data.width / 2
            targetY = box.data.y + box.data.height / 2
          }
        } catch {
          // Continue without animation
        }

        if (myRun !== presentationRunIdRef.current) return

        if (!hasBox) {
          await tauri.runAgentBrowser(['click', ref], { sessionName: meta.sessionName })
          setTimeout(() => void handleSnapshot(), 500)
          addLog(`Clicked ${ref}`)
          return
        }

        runPointerStory({
          myRun,
          targetX,
          targetY,
          sessionName: meta.sessionName,
          tauriRef: ref,
          clearMetaPresentation: false,
          onAfterTauriClick: () => {
            setTimeout(() => void handleSnapshot(), 500)
          },
        })
        addLog(`Clicked ${ref}`)
      } catch (error) {
        addLog(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [addLog, handleSnapshot, meta.sessionName, runPointerStory]
  )

  /** Orchestrator `browser_click` — visual hint in meta; real click is already done. */
  useEffect(() => {
    const p = meta.agentBrowserPresentation
    if (!p || !meta.sessionName) return
    if (!wsClientRef.current) return
    const myRun = ++presentationRunIdRef.current
    runPointerStory({
      myRun,
      targetX: p.targetX,
      targetY: p.targetY,
      sessionName: meta.sessionName,
      clearMetaPresentation: true,
    })
  }, [meta.agentBrowserPresentation?.requestId, meta.sessionName, meta.streamPort, runPointerStory])

  const viewportSize = useMemo(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    return {
      displayWidth: rect?.width ?? 800,
      displayHeight: rect?.height ?? 600,
      deviceWidth: frameMetadata?.deviceWidth ?? 1280,
      deviceHeight: frameMetadata?.deviceHeight ?? 720,
    }
  }, [frameMetadata])

  const parsedSnapshot = useMemo(() => {
    if (!snapshot) return []
    return parseSnapshotRefs(snapshot)
  }, [snapshot])

  const effectiveConnectionState: ConnectionState = meta.lastSessionError ? 'error' : connectionState

  return (
    <div className="h-full flex flex-col bg-[#1a1a1a] text-white overflow-hidden">
      {/* URL Bar */}
      <div className="px-3 py-2 border-b border-tile-border/60 space-y-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputUrl}
            onFocus={() => {
              urlBarFocusedRef.current = true
            }}
            onBlur={() => {
              urlBarFocusedRef.current = false
            }}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleNavigate()
              }
            }}
            className="flex-1 rounded bg-black/35 border border-tile-border px-2 py-1 text-xs font-mono"
            placeholder="https://example.com"
          />
          <button
            type="button"
            onClick={() => void handleNavigate()}
            disabled={isInitializing}
            className="px-2 py-1 rounded bg-accent-teal/25 text-accent-teal text-xs hover:bg-accent-teal/35 disabled:opacity-50"
          >
            {isInitializing ? 'Starting...' : 'Go'}
          </button>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={!meta.sessionName}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20 disabled:opacity-50"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={() => void handleSnapshot()}
            disabled={!meta.sessionName}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20 disabled:opacity-50"
            data-tooltip="Get accessibility snapshot"
          >
            📋
          </button>
          <button
            type="button"
            onClick={() => void handleScreenshot()}
            disabled={!meta.sessionName}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20 disabled:opacity-50"
            data-tooltip="Take annotated screenshot"
          >
            📸
          </button>
          <button
            type="button"
            onClick={() => void handleClose()}
            disabled={!meta.sessionName}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {meta.lastSessionError ? (
          <div
            className="rounded border border-rose-500/40 bg-rose-950/40 px-2 py-1.5 text-[11px] text-rose-100/95"
            data-testid="agent-browser-session-error"
          >
            <span className="font-semibold">Session error: </span>
            <span className="font-mono break-words">{meta.lastSessionError}</span>
          </div>
        ) : null}

        {/* Status bar */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-400">Status:</span>
          <span
            className={
              effectiveConnectionState === 'connected'
                ? 'text-emerald-400'
                : effectiveConnectionState === 'connecting'
                  ? 'text-amber-400'
                  : effectiveConnectionState === 'error'
                    ? 'text-rose-400'
                    : 'text-gray-500'
            }
          >
            {effectiveConnectionState}
          </span>
          {meta.currentUrl && (
            <>
              <span className="text-gray-600">|</span>
              <span className="text-gray-400 truncate max-w-[300px]" data-tooltip={meta.currentUrl}>
                {meta.currentUrl}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex min-h-0">
        {/* Viewport */}
        <div ref={viewportRef} className="flex-1 relative bg-black/40 overflow-hidden">
          <ViewportCanvas
            frame={frame}
            viewport={viewportSize}
            onMouseDown={handleViewportMouseDown}
            onMouseUp={handleViewportMouseUp}
            onKeyDown={handleViewportKeyDown}
          />
          <CursorOverlay
            position={cursorPosition}
            viewport={viewportSize}
            pointerTransitionMs={pointerTransitionMs}
            clickFeedbackMs={clickOverlayFeedbackMs}
            reducedMotion={reducedMotion}
          />
        </div>

        {/* Snapshot panel (collapsible) */}
        {showSnapshot && snapshot && (
          <div className="w-72 border-l border-tile-border/60 flex flex-col bg-black/20">
            <div className="px-2 py-1 border-b border-tile-border/40 flex items-center justify-between">
              <span className="text-xs text-gray-400">Accessibility Snapshot</span>
              <button
                type="button"
                onClick={() => setShowSnapshot(false)}
                className="text-gray-500 hover:text-gray-300 text-xs"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2 text-xs font-mono text-gray-300 whitespace-pre-wrap">
              {parsedSnapshot.map((node, i) =>
                node.ref ? (
                  <span
                    key={i}
                    onClick={() => void handleRefClick(node.ref!)}
                    className="text-accent-teal cursor-pointer hover:underline"
                    data-tooltip={`Click to interact with ${node.ref}`}
                  >
                    {node.text}
                  </span>
                ) : (
                  <span key={i}>{node.text}</span>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Activity log */}
      <div className="h-20 border-t border-tile-border/60 overflow-auto bg-black/30">
        <div className="px-2 py-1 text-xs font-mono text-gray-500 space-y-0.5">
          {activityLog.length === 0 ? (
            <div className="text-gray-600 italic">
              Navigate to a URL to start browser automation
            </div>
          ) : (
            activityLog.map((log, i) => (
              <div key={i} className={log.includes('Error') ? 'text-rose-400' : ''}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

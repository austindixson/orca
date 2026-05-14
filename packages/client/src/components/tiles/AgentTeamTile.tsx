import { useEffect, useMemo, useRef, useState } from 'react'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useAgentTaskStore } from '../../store/agentTaskStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useGroupChatStore } from '../../store/groupChatStore'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { AgentAvatar } from '../AgentAvatar'
import { activateModuleOnCanvas } from '../../lib/canvasModuleNavigation'
import { useTileMountAck } from '../../hooks/useTileMountAck'
import { ensureGroupChatTile } from '../../lib/orchestrator/ensureGroupChatTile'
import { getDefaultSessionId } from '../../lib/persistence/sessionPersistence'
import { TextShimmer } from '../ui/TextShimmer'
import { useSystemPrefersReducedMotion } from '../../hooks/useReducedMotionPreference'

const MAX_TABS = 20

function statusPill(status: string, animateWorking: boolean) {
  const styles: Record<string, string> = {
    idle: 'bg-amber-500/15 text-amber-200/90 border-amber-500/25',
    working: animateWorking
      ? 'bg-blue-500/15 text-blue-200 border-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.35)]'
      : 'bg-blue-500/15 text-blue-200 border-blue-500/30',
    done: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/25',
    error: 'bg-red-500/15 text-red-200 border-red-500/25',
    needs_review:
      'bg-violet-500/15 text-violet-100 border-violet-400/35 ring-1 ring-violet-400/20',
  }
  return styles[status] ?? styles.idle
}

function statusDot(status: string): string {
  if (status === 'working') return 'bg-blue-300 shadow-[0_0_8px_rgba(147,197,253,0.95)]'
  if (status === 'done') return 'bg-emerald-300'
  if (status === 'error') return 'bg-red-300'
  if (status === 'needs_review') return 'bg-violet-300'
  return 'bg-amber-300'
}

const GROUP_MESSAGE_PREVIEW_MAX_CHARS = 220
const TRACE_INDICATOR_MAX_CHARS = 72

function toSingleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateForPreview(value: string, maxChars: number): { text: string; truncated: boolean } {
  const compact = toSingleLine(value)
  if (compact.length <= maxChars) return { text: compact, truncated: false }
  return { text: `${compact.slice(0, maxChars).trimEnd()}…`, truncated: true }
}

function deriveLatestTraceIndicator(logTail: string[]): string | null {
  for (let i = logTail.length - 1; i >= 0; i--) {
    const line = toSingleLine(logTail[i] ?? '')
    if (!line) continue
    if (line.startsWith('→') || line.startsWith('←') || line.startsWith('◆') || line.startsWith('┊')) {
      return truncateForPreview(line, TRACE_INDICATOR_MAX_CHARS).text
    }
  }
  return null
}

export function AgentTeamTile({ data }: TileComponentProps) {
  useTileMountAck(data.id, true)
  const membersByTileId = useAgentTeamStore((s) => s.membersByTileId)
  const removeMemberForTile = useAgentTeamStore((s) => s.removeMemberForTile)
  const tasksByTileId = useAgentTaskStore((s) => s.byTileId)
  const tiles = useCanvasStore((s) => s.tiles)
  const activeInteractionTileId = useCanvasStore((s) => s.activeInteractionTileId)
  const prefersReducedMotion = useSystemPrefersReducedMotion()

  const rows = useMemo(() => {
    const list = Object.values(membersByTileId)
    const withTitles = list.map((m) => {
      const t = tiles.get(m.tileId)
      const title = t?.title && t.title !== 'Agent' ? t.title : m.displayName
      return {
        ...m,
        headerTitle: title,
        tileStillOnCanvas: Boolean(t),
      }
    })
    return withTitles.sort((a, b) => a.headerTitle.localeCompare(b.headerTitle))
  }, [membersByTileId, tiles])

  const teamSummary = useMemo(() => {
    const total = rows.length
    const done = rows.filter((m) => m.status === 'done').length
    const working = rows.filter((m) => m.status === 'working').length
    return { total, done, working }
  }, [rows])

  const visibleRows = useMemo(() => rows.slice(0, MAX_TABS), [rows])
  const overflowCount = Math.max(0, rows.length - visibleRows.length)

  const [selectedTileId, setSelectedTileId] = useState<string | null>(null)
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  )
  const [isInViewport, setIsInViewport] = useState(true)
  const tileRootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (visibleRows.length === 0) {
      setSelectedTileId(null)
      return
    }
    if (!selectedTileId || !visibleRows.some((r) => r.tileId === selectedTileId)) {
      setSelectedTileId(visibleRows[0]!.tileId)
    }
  }, [visibleRows, selectedTileId])

  useEffect(() => {
    const onVisibility = () => {
      setIsDocumentVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    const node = tileRootRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsInViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0]
        setIsInViewport(Boolean(first?.isIntersecting))
      },
      { threshold: 0.05 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const selected = useMemo(
    () => visibleRows.find((r) => r.tileId === selectedTileId) ?? visibleRows[0] ?? null,
    [visibleRows, selectedTileId]
  )

  useEffect(() => {
    const tile = useCanvasStore.getState().tiles.get(data.id)
    if (!tile) return
    const targetW = visibleRows.length > 1 ? 860 : 760
    const targetH = Math.min(760, Math.max(520, 520 + Math.min(visibleRows.length, MAX_TABS) * 8))
    if (tile.w < targetW || tile.h < targetH) {
      useCanvasStore.getState().updateTile(data.id, {
        w: Math.max(tile.w, targetW),
        h: Math.max(tile.h, targetH),
      })
    }
  }, [data.id, visibleRows.length])

  const selectedTasks = selected ? tasksByTileId[selected.tileId] ?? [] : []
  const selectedRecentLog = selected?.logTail?.slice(-40) ?? []
  const selectedLatestTask = selectedTasks[selectedTasks.length - 1]
  const sessionId = useMemo(() => getDefaultSessionId(), [])
  const groupMessages = useGroupChatStore((s) => s.messagesBySession[sessionId] ?? [])
  const selectedLatestGroupMessage = useMemo(() => {
    if (!selected) return null
    for (let i = groupMessages.length - 1; i >= 0; i--) {
      const msg = groupMessages[i]
      if (msg?.senderTileId === selected.tileId && msg.body.trim().length > 0) return msg
    }
    return null
  }, [groupMessages, selected])
  const selectedLatestGroupPreview = useMemo(() => {
    if (!selectedLatestGroupMessage) return null
    return truncateForPreview(selectedLatestGroupMessage.body, GROUP_MESSAGE_PREVIEW_MAX_CHARS)
  }, [selectedLatestGroupMessage])
  const selectedTraceIndicator = useMemo(
    () => deriveLatestTraceIndicator(selectedRecentLog),
    [selectedRecentLog]
  )
  const [expandedGroupMessageByTileId, setExpandedGroupMessageByTileId] = useState<Record<string, boolean>>({})
  const groupMessageExpanded = selected ? Boolean(expandedGroupMessageByTileId[selected.tileId]) : false
  const logScrollRef = useRef<HTMLDivElement | null>(null)
  const workingSelected = selected?.status === 'working'
  const animateSelected =
    Boolean(workingSelected) &&
    !prefersReducedMotion &&
    isDocumentVisible &&
    isInViewport &&
    activeInteractionTileId === data.id

  useEffect(() => {
    const el = logScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [selected?.tileId, selectedRecentLog])

  const focusTile = (tileId: string) => {
    if (!useCanvasStore.getState().tiles.has(tileId)) return
    activateModuleOnCanvas(tileId, { intent: 'user_sidebar' })
  }

  const cycle = (dir: 1 | -1) => {
    if (visibleRows.length <= 1 || !selected) return
    const idx = visibleRows.findIndex((r) => r.tileId === selected.tileId)
    if (idx < 0) return
    const next = (idx + dir + visibleRows.length) % visibleRows.length
    setSelectedTileId(visibleRows[next]!.tileId)
  }

  return (
    <div ref={tileRootRef} className="flex h-full w-full flex-col bg-canvas-bg">
      <div className="border-b border-tile-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Agent team</div>
            <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
              Multi-agent workspace with vertical tabs. Render one agent at a time for lower UI load.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="rounded border border-tile-border/70 bg-black/25 px-2 py-1 text-[10px] text-gray-300 hover:bg-tile-hover"
              onClick={() => cycle(-1)}
              disabled={visibleRows.length <= 1}
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded border border-tile-border/70 bg-black/25 px-2 py-1 text-[10px] text-gray-300 hover:bg-tile-hover"
              onClick={() => cycle(1)}
              disabled={visibleRows.length <= 1}
            >
              Next
            </button>
          </div>
        </div>
        {teamSummary.total > 0 ? (
          <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-emerald-400/45 bg-emerald-500/15 px-2.5 py-1.5 text-emerald-100">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.85)]" />
            <span className="text-[12px] font-semibold tabular-nums">
              {teamSummary.done}/{teamSummary.total} done
            </span>
            <span className="text-[10px] text-emerald-200/90">
              {teamSummary.total} agents{teamSummary.working > 0 ? ` · ${teamSummary.working} active` : ''}
            </span>
          </div>
        ) : null}
      </div>

      {visibleRows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-3">
          <div className="rounded-lg border border-dashed border-tile-border/80 bg-black/20 px-3 py-6 text-center text-sm text-gray-500">
            No sub-agents yet. Use <code className="rounded bg-black/40 px-1 text-accent-teal/90">spawn_sub_agent</code>{' '}
            to delegate work in parallel.
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex flex-1 overflow-hidden">
          <aside className="flex w-[216px] shrink-0 flex-col border-r border-tile-border bg-black/20">
            <div className="border-b border-tile-border/70 px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500">
              Agents ({visibleRows.length}{overflowCount > 0 ? ` +${overflowCount}` : ''})
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              <ul className="space-y-1">
                {visibleRows.map((m) => {
                  const isSelected = selected?.tileId === m.tileId
                  return (
                    <li key={m.tileId}>
                      <button
                        type="button"
                        onClick={() => setSelectedTileId(m.tileId)}
                        className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                          isSelected
                            ? 'border-accent-teal/50 bg-accent-teal/10 text-gray-100'
                            : 'border-tile-border/60 bg-black/20 text-gray-300 hover:bg-black/35'
                        }`}
                        data-tooltip={m.role}
                      >
                        <div className="relative shrink-0">
                          <AgentAvatar
                            displayName={m.headerTitle}
                            role={m.role}
                            provider={m.executionProvider ?? 'openrouter'}
                            size={24}
                            editable
                          />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-black ${statusDot(m.status)}`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium">{m.headerTitle}</div>
                          <div className="truncate text-[10px] text-gray-500">{m.currentTask}</div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </aside>

          <section className="min-h-0 flex flex-1 flex-col overflow-hidden">
            {selected ? (
              <>
                <div className="border-b border-tile-border/70 bg-black/15 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-100">{selected.headerTitle}</div>
                      <div className="truncate text-[11px] text-gray-500">{selected.role}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] text-gray-400">{selected.currentTask}</div>
                      {selectedTraceIndicator ? (
                        <div
                          className={`mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-cyan-400/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.18)] ${animateSelected ? 'animate-[pulse_4.2s_ease-in-out_infinite]' : ''}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.8)]" />
                          <span className="truncate">{selectedTraceIndicator}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${statusPill(selected.status, animateSelected)}`}
                      >
                        {selected.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => focusTile(selected.tileId)}
                        disabled={!selected.tileStillOnCanvas}
                        className="rounded border border-tile-border/70 bg-black/25 px-2 py-1 text-[10px] text-gray-300 hover:bg-tile-hover disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Go to tile
                      </button>
                      {selected.status !== 'working' && !selected.tileStillOnCanvas ? (
                        <button
                          type="button"
                          onClick={() => removeMemberForTile(selected.tileId)}
                          className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-200 hover:bg-red-500/20"
                        >
                          Dismiss
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_1fr] gap-2 overflow-hidden p-2">
                  <div className="rounded-md border border-tile-border/70 bg-black/20 px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Task progress</div>
                    <div className="mt-1 text-[11px] text-gray-200">
                      {selectedTasks.length} total · {selectedTasks.filter((t) => t.status === 'done').length} done
                    </div>
                    {selectedLatestTask ? (
                      <div className="mt-1.5 line-clamp-2 text-[11px] text-gray-400">Latest: {selectedLatestTask.text}</div>
                    ) : null}
                  </div>

                  {selectedLatestGroupMessage && selectedLatestGroupPreview ? (
                    <div className="rounded-md border border-slate-400/30 bg-slate-500/10 px-2.5 py-2 text-[11px] leading-snug text-slate-100/90">
                      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-slate-300/75">
                        <span>Latest group update</span>
                        <span className="normal-case text-[10px] text-slate-400">{selectedLatestGroupMessage.senderName}</span>
                      </div>
                      <div className="whitespace-pre-wrap break-words">
                        {groupMessageExpanded ? selectedLatestGroupMessage.body : selectedLatestGroupPreview.text}
                      </div>
                      {selectedLatestGroupPreview.truncated ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!selected) return
                            setExpandedGroupMessageByTileId((prev) => ({
                              ...prev,
                              [selected.tileId]: !groupMessageExpanded,
                            }))
                          }}
                          className="mt-1 rounded border border-slate-400/35 bg-black/20 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-black/35"
                        >
                          {groupMessageExpanded ? 'Read less' : 'Read more'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {selected.lastSummary ? (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/8 px-2.5 py-2 text-[11px] leading-snug text-emerald-100/90">
                      {selected.lastSummary.slice(0, 500)}
                      {selected.lastSummary.length > 500 ? '…' : ''}
                    </div>
                  ) : null}

                  <div
                    ref={logScrollRef}
                    className="min-h-0 overflow-auto rounded-md border border-tile-border/70 bg-black/25 px-2 py-1.5"
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">Live log</span>
                      <button
                        type="button"
                        onClick={() => ensureGroupChatTile({ createIfMissing: true, focus: true })}
                        className="rounded border border-accent-teal/40 bg-accent-teal/10 px-2 py-0.5 text-[10px] text-accent-teal hover:bg-accent-teal/20"
                      >
                        Open group chat
                      </button>
                    </div>
                    {selectedRecentLog.length === 0 ? (
                      <div className="text-[11px] text-gray-500">No logs yet.</div>
                    ) : (
                      <ul className="space-y-1">
                        {selectedRecentLog.map((line, idx) => {
                          const isLatest = idx === selectedRecentLog.length - 1
                          const normalized = toSingleLine(line)
                          return (
                            <li
                              key={`${selected.tileId}-${idx}`}
                              className="whitespace-pre-wrap break-words text-[11px] text-gray-300"
                            >
                              {isLatest && animateSelected ? (
                                <TextShimmer
                                  key={`trace-shimmer-${selected.tileId}-${idx}-${normalized}`}
                                  tileType="agent"
                                  shimmerRgb={[148, 163, 184]}
                                  duration={3.8}
                                  spread={2}
                                  className="text-[11px] font-normal text-gray-300"
                                  title={line}
                                >
                                  {line}
                                </TextShimmer>
                              ) : (
                                line
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </section>
        </div>
      )}
    </div>
  )
}

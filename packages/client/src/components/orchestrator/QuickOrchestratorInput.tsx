import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { create } from 'zustand'
import { ORCA_ORCHESTRATOR_GLASS_BACKDROP_BLUR_CLASS } from '../../lib/orcaOrchestratorGlass'
import { getHomeDir, getWorkspace } from '../../lib/tauri'
import {
  discoverSlashMenuItems,
  parseSlashMenuQuery,
  replaceSlashTokenAtCursor,
  type SlashMenuItem,
} from '../../lib/skillCommands'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useOrchestratorRightPanelVisible } from '../../hooks/useOrchestratorRightPanelVisible'
import { useOneShotStore } from '../../store/oneShotStore'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useResumePromptStore } from '../../store/resumePromptStore'
import {
  OrchestratorSlashPalette,
  getSlashPickIndex,
  useSlashFlatLength,
} from './OrchestratorSlashPalette'
import { truncateComposerPaste } from '../../lib/pasteTruncation'

type QuickInputUiState = {
  suppressedUntilIdle: boolean
  setSuppressedUntilIdle: (v: boolean) => void
  setSuppressedManually: (v: boolean) => void
  clearSuppressionIfUntilIdle: () => void
  revealRequestId: number
  requestReveal: () => void
  suppressionReason: 'manual' | 'until-idle' | null
}

/** Shared with CanvasToolbar Ask button — re-show + focus the quick input without opening the side panel. */
export const quickOrchestratorInputUiStore = create<QuickInputUiState>((set) => ({
  /** Default collapsed: prompt lives in the toolbar; expand to type (or use Ask). */
  suppressedUntilIdle: true,
  suppressionReason: null,
  setSuppressedUntilIdle: (v) =>
    set({
      suppressedUntilIdle: v,
      suppressionReason: v ? 'until-idle' : null,
    }),
  setSuppressedManually: (v) =>
    set({
      suppressedUntilIdle: v,
      suppressionReason: v ? 'manual' : null,
    }),
  clearSuppressionIfUntilIdle: () =>
    set((s) => {
      if (!s.suppressedUntilIdle || s.suppressionReason !== 'until-idle') return s
      return { suppressedUntilIdle: false, suppressionReason: null }
    }),
  revealRequestId: 0,
  requestReveal: () =>
    set((s) => ({
      revealRequestId: s.revealRequestId + 1,
      suppressedUntilIdle: false,
      suppressionReason: null,
    })),
}))

export function computeCanStopAllSnapshot(): boolean {
  const s = useOrchestratorSessionStore.getState()
  const oneShot = useOneShotStore.getState()
  const team = useAgentTeamStore.getState()
  const pendingSubAgentHandoffCount = s.pendingSubAgentHandoffs.length
  const abortInFlightCount = Object.keys(team.abortByTileId).length
  const workingMemberCount = Object.values(team.membersByTileId).filter((m) => m.status === 'working')
    .length
  return (
    s.running ||
    oneShot.running ||
    s.waitingForSubAgents ||
    abortInFlightCount > 0 ||
    workingMemberCount > 0 ||
    pendingSubAgentHandoffCount > 0
  )
}

function useCanStopAll(): boolean {
  const running = useOrchestratorSessionStore((s) => s.running)
  const waitingForSubAgents = useOrchestratorSessionStore((s) => s.waitingForSubAgents)
  const pendingSubAgentHandoffCount = useOrchestratorSessionStore(
    (s) => s.pendingSubAgentHandoffs.length
  )
  const oneShotRunning = useOneShotStore((s) => s.running)
  const abortInFlightCount = useAgentTeamStore((s) => Object.keys(s.abortByTileId).length)
  const workingMemberCount = useAgentTeamStore(
    (s) => Object.values(s.membersByTileId).filter((m) => m.status === 'working').length
  )
  return (
    running ||
    oneShotRunning ||
    waitingForSubAgents ||
    abortInFlightCount > 0 ||
    workingMemberCount > 0 ||
    pendingSubAgentHandoffCount > 0
  )
}

/**
 * Orchestrator prompt embedded in the bottom toolbar (side panel closed).
 * Collapsed by default — expand to type or use Ask / chevron. After submit, collapses again until idle.
 */
export function OrchestratorToolbarPrompt() {
  const orchestratorRightPanelVisible = useOrchestratorRightPanelVisible()
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const suppressedUntilIdle = quickOrchestratorInputUiStore((s) => s.suppressedUntilIdle)
  const setSuppressedUntilIdle = quickOrchestratorInputUiStore((s) => s.setSuppressedUntilIdle)
  const clearSuppressionIfUntilIdle = quickOrchestratorInputUiStore(
    (s) => s.clearSuppressionIfUntilIdle
  )
  const revealRequestId = quickOrchestratorInputUiStore((s) => s.revealRequestId)
  const canStopAll = useCanStopAll()
  const resumePromptData = useResumePromptStore((s) => s.data)
  const resumeDismiss = useResumePromptStore((s) => s.dismiss)
  const resumeContinueNow = useResumePromptStore((s) => s.continueNow)

  const [value, setValue] = useState('')
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const bootFocusDoneRef = useRef(false)
  const prevCanStopAllRef = useRef(canStopAll)

  const loadSlashMenu = useCallback(async () => {
    const ws = await getWorkspace()
    const home = await getHomeDir()
    const cacheKey = `${ws?.path ?? rootPath ?? ''}||${home ?? ''}`
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
  }, [rootPath])

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
      const pos = ta?.selectionStart ?? value.length
      const rep = replaceSlashTokenAtCursor(value, pos, item.name, true)
      if (rep) {
        setValue(rep.next)
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
    [value]
  )

  const autosizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = Number.parseFloat(window.getComputedStyle(el).lineHeight) || 18
    const minHeight = lineHeight
    const maxHeight = lineHeight * 3
    const nextHeight = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight))
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(() => {
    autosizeTextarea()
  }, [autosizeTextarea, value])

  // Re-show only when work actually stops (true -> false), and only for auto "until idle"
  // suppression. Manual collapse must persist until the user explicitly reveals it.
  useEffect(() => {
    if (prevCanStopAllRef.current === true && !canStopAll) {
      clearSuppressionIfUntilIdle()
    }
    prevCanStopAllRef.current = canStopAll
  }, [canStopAll, clearSuppressionIfUntilIdle])

  // On first launch (or when the quick bar first becomes visible), focus so the user can type immediately.
  useEffect(() => {
    if (bootFocusDoneRef.current) return
    if (orchestratorRightPanelVisible || suppressedUntilIdle) return
    const t = window.setTimeout(() => {
      if (bootFocusDoneRef.current) return
      if (suppressedUntilIdle) return
      textareaRef.current?.focus({ preventScroll: true })
      bootFocusDoneRef.current = true
    }, 0)
    return () => window.clearTimeout(t)
  }, [orchestratorRightPanelVisible, suppressedUntilIdle])

  // Ask button: focus textarea when reveal is requested.
  useEffect(() => {
    if (revealRequestId === 0) return
    const t = window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(t)
  }, [revealRequestId])

  const submit = async () => {
    const trimmed = value.trim()
    if (resumePromptData) {
      if (!trimmed) {
        setSuppressedUntilIdle(true)
        await resumeContinueNow()
        if (!computeCanStopAllSnapshot()) {
          setSuppressedUntilIdle(false)
        }
        return
      }
      const lower = trimmed.toLowerCase()
      if (lower === 'no' || lower === 'n' || lower === 'nope' || lower === 'skip' || lower === 'not now') {
        resumeDismiss()
        setValue('')
        return
      }
    }

    if (!trimmed) return
    const s = useOrchestratorSessionStore.getState()
    s.setInput(trimmed)
    setValue('')
    setSuppressedUntilIdle(true)
    await s.run()
    // Skipped/empty runs never set busy — show the quick input again.
    if (!computeCanStopAllSnapshot()) {
      setSuppressedUntilIdle(false)
    }
  }

  if (orchestratorRightPanelVisible) return null

  const resumePlaceholder = 'Ask orchestrator…'

  if (suppressedUntilIdle) {
    return null
  }

  return (
    <div
      ref={shellRef}
      data-testid="quick-orchestrator-input"
      data-quick-orchestrator-hidden="false"
      className="w-full min-w-0"
    >
      <div
        className={clsx(
          /* no overflow-hidden — it clips the slash palette (absolute, bottom-full) above the field */
          'relative flex w-full min-w-0 items-center rounded-xl border border-tile-border/90 bg-canvas-bg/30 px-3 py-1.5',
          ORCA_ORCHESTRATOR_GLASS_BACKDROP_BLUR_CLASS,
          'shadow-[inset_0_0_0_9999px_rgba(255,255,255,0.02),0_4px_14px_rgba(0,0,0,0.3)]',
          'focus-within:border-accent-teal/30 focus-within:shadow-[inset_0_0_0_9999px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.38),0_0_0_1px_rgb(var(--accent-teal-rgb)_/_0.2),0_0_16px_rgb(var(--accent-teal-rgb)_/_0.14)]'
        )}
      >
        <div className="relative flex min-h-0 min-w-0 w-full flex-1 items-center">
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
            value={value}
            rows={1}
            onChange={(e) => {
              const v = e.target.value
              const pos = e.target.selectionStart ?? v.length
              setValue(v)
              syncSlashFromCursor(v, pos, true)
            }}
            onSelect={(e) => {
              const el = e.currentTarget
              syncSlashFromCursor(el.value, el.selectionStart ?? 0, false)
            }}
            onPaste={(e) => {
              const pastedText = e.clipboardData?.getData('text/plain') ?? ''
              if (!pastedText) return
              const truncated = truncateComposerPaste(pastedText)
              if (!truncated.truncated) return
              e.preventDefault()
              e.stopPropagation()
              const el = e.currentTarget
              const start = el.selectionStart ?? value.length
              const end = el.selectionEnd ?? start
              const next = `${value.slice(0, start)}${truncated.text}${value.slice(end)}`
              const cursor = start + truncated.text.length
              setValue(next)
              syncSlashFromCursor(next, cursor, true)
              requestAnimationFrame(() => {
                const ta = textareaRef.current
                if (!ta) return
                ta.selectionStart = ta.selectionEnd = cursor
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
                void submit()
              }
            }}
            placeholder={resumePlaceholder}
            className="min-h-0 min-w-0 w-full resize-none border-0 bg-transparent py-0 text-sm leading-5 text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-0"
            aria-label="Ask orchestrator"
            data-tooltip="Enter: run · Shift+Enter: new line"
          />
        </div>
        <div className="flex shrink-0 flex-col justify-center pl-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!value.trim()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-accent-teal/55 bg-accent-teal/20 text-accent-teal hover:bg-accent-teal/30 disabled:cursor-not-allowed disabled:opacity-40"
            data-tooltip="Run"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

/** @deprecated Prefer `OrchestratorToolbarPrompt` — prompt is embedded in `CanvasToolbar`. */
export const QuickOrchestratorInput = OrchestratorToolbarPrompt

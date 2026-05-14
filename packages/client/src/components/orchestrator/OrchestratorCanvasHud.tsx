import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useResumePromptStore } from '../../store/resumePromptStore'
import { ORCA_ORCHESTRATOR_GLASS_BACKDROP_BLUR_CLASS } from '../../lib/orcaOrchestratorGlass'
import { computeCanStopAllSnapshot, quickOrchestratorInputUiStore } from './QuickOrchestratorInput'
import { ORCA_TOOLBAR_TOP_FROM_BOTTOM_VAR } from '../../lib/orcaCanvasLayoutVars'
import {
  deriveNarratorStatusSnapshot,
  extractLatestPhaseLineFromActivity,
  extractPlanHeadLine,
  formatTileSwitchNarration,
} from '../../lib/orchestrator/orchestratorCanvasHudLines'
import { loadPersonalityMarkdownForNarrator } from '../../lib/orchestrator/orchestratorClaudeMd'
import { useSettingsStore } from '../../store/settingsStore'
import { useProjectTaskCompletion } from '../../hooks/useProjectTaskCompletion'
import { useOneShotStore } from '../../store/oneShotStore'
import {
  buildFallbackBulletsFromSeed,
  generateAiNarratorLine,
  generateTemplateNarrationVariant,
  narratorTemplateSeed,
  parseTaskReasonSeed,
} from '../../lib/orchestrator/narratorLineGenerator'

const NARRATION_RATE_MS = 5000

/** Idle-only secondary lines — narrator can stay one row + slim progress until there is real activity. */
function isIdleOnlyNarratorSecondary(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  return /^\s*-\s*(Ready|I am ready for the next step\.?)\s*$/i.test(t)
}

function isReadyLikeLine(line: string | null | undefined): boolean {
  const t = (line ?? '').trim()
  if (!t) return true
  return /^(ready|i am ready for the next step\.?)$/i.test(t)
}

function toNaturalNarrationLine(line: string | null | undefined): string | null {
  const raw = (line ?? '').trim()
  if (!raw) return null
  let t = raw
    .replace(/^\s*[-*•]+\s*/, '')
    .replace(/^\s*\[[^\]]+\]\s*/, '')
    .replace(/^\s*[→←◆⋯]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return null
  if (isReadyLikeLine(t)) return null
  // Ignore trace/tool-like lines and path/command noise.
  if (
    /(^| )((npm|pnpm|yarn|npx|git|cargo|python|node|bash|zsh)\b|[A-Za-z0-9_]+\([^)]*\)|\/Users\/|\.tsx?\b|\.json\b)/i.test(
      t
    )
  ) {
    return null
  }
  const words = t.split(/\s+/).filter(Boolean).length
  if (words < 4) return null
  if (!/[.!?]$/.test(t)) t = `${t}.`
  return t
}

/** Slightly smaller than the original 48px ring; nudged right with `pl-*` so it sits off the copy. */
function NarratorTaskProgressRing({
  taskPct,
  taskDone,
  taskTotal,
  layout,
}: {
  taskPct: number
  taskDone: number
  taskTotal: number
  layout: 'compactRow' | 'expandedColumn'
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(taskPct)))
  const r = 13
  const c = 2 * Math.PI * r
  const offset = c * (1 - clamped / 100)
  const title = `Project tasks: ${taskDone} of ${taskTotal} (${clamped}%)`

  const ring = (
    <div className="relative h-10 w-10 shrink-0" data-tooltip={title}>
      <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="rgb(6 95 70 / 0.35)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="rgb(52 211 153 / 0.95)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[8px] font-semibold tabular-nums leading-none text-emerald-100">
        {clamped}%
      </div>
    </div>
  )

  if (layout === 'compactRow') {
    return (
      <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
        {ring}
        <span className="shrink-0 tabular-nums text-[9px] text-emerald-200/90">
          tasks {taskDone}/{taskTotal}
        </span>
      </div>
    )
  }

  return (
    <div className="ml-auto flex min-w-[72px] shrink-0 flex-col items-end gap-0.5 self-center pl-1.5">
      {ring}
      <div className="text-[9px] tabular-nums text-emerald-200/90">
        tasks {taskDone}/{taskTotal}
      </div>
    </div>
  )
}

/**
 * Fixed above the bottom canvas toolbar: (1) current phase / plan head, (2) tile-switch narration (rate-limited).
 * Replaces the old fenced-code “peek” block.
 */
export function OrchestratorCanvasHud() {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const setQuickInputSuppressedUntilIdle = quickOrchestratorInputUiStore((s) => s.setSuppressedUntilIdle)

  const running = useOrchestratorActivityStore((s) => s.running)
  const verb = useOrchestratorActivityStore((s) => s.verb)
  const activityFeed = useOrchestratorActivityStore((s) => s.activityFeed)
  const agentTileFocus = useOrchestratorActivityStore((s) => s.agentTileFocus)
  const autoFocusHighlight = useOrchestratorActivityStore((s) => s.autoFocusHighlight)
  const planningDraft = useOrchestratorSessionStore((s) => s.planningDraft)
  const resumePromptData = useResumePromptStore((s) => s.data)
  const resumeDismiss = useResumePromptStore((s) => s.dismiss)
  const resumeContinueNow = useResumePromptStore((s) => s.continueNow)
  const clarifyPhase = useOneShotStore((s) => s.clarifyPhase)
  const clarifyQuestionCount = useOneShotStore((s) => s.clarifyQuestions?.length ?? 0)
  const tiles = useCanvasStore((s) => s.tiles)
  const narratorMode = useSettingsStore((s) => s.narratorMode)
  const narratorAiModelId = useSettingsStore((s) => s.narratorAiModelId)
  const shouldUseAiNarration = running || narratorMode === 'ai'
  const suppressGeneratedNarration = Boolean(resumePromptData && !running)
  const { pct: taskPct, done: taskDone, total: taskTotal } = useProjectTaskCompletion()

  const tileTitleById = useMemo(
    () => (id: string) => tiles.get(id)?.title,
    [tiles]
  )

  const [narratorPersonalityMd, setNarratorPersonalityMd] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadPersonalityMarkdownForNarrator().then((md) => {
      if (!cancelled) setNarratorPersonalityMd(md)
    })
    return () => {
      cancelled = true
    }
  }, [rootPath])

  const phaseOrPlanLine = useMemo(() => {
    if (!running && !planningDraft) return null
    const fromLog = extractLatestPhaseLineFromActivity(activityFeed)
    if (fromLog) {
      const natural = toNaturalNarrationLine(fromLog)
      if (natural) return natural
    }
    const fromPlan = extractPlanHeadLine(planningDraft)
    if (fromPlan) {
      const natural = toNaturalNarrationLine(fromPlan)
      if (natural) return natural
    }
    if (running && verb && verb !== 'Ready') {
      return toNaturalNarrationLine(verb) ?? null
    }
    return running ? 'Working through this step.' : null
  }, [activityFeed, planningDraft, running, verb])

  const rawNarration = useMemo(
    () => {
      const line = formatTileSwitchNarration(agentTileFocus, autoFocusHighlight, tileTitleById, {
        personalityMarkdown: narratorPersonalityMd,
      })
      const natural = toNaturalNarrationLine(line)
      return natural
    },
    [agentTileFocus, autoFocusHighlight, tileTitleById, narratorPersonalityMd]
  )
  const statusSnapshot = useMemo(
    () => deriveNarratorStatusSnapshot(activityFeed, phaseOrPlanLine),
    [activityFeed, phaseOrPlanLine]
  )
  const normalizedVerb = (verb ?? '').trim().toLowerCase()
  const isVerbDuplicate = (text: string | null): boolean => {
    if (!text || !normalizedVerb) return false
    const normalizedText = text.trim().toLowerCase()
    return normalizedText.includes(normalizedVerb)
  }
  const narrationSeedLine = useMemo(() => {
    if (suppressGeneratedNarration) return null
    const whoTarget = agentTileFocus
      ? tileTitleById(agentTileFocus.tileId) || agentTileFocus.tileType
      : 'orchestrator'
    const what =
      (phaseOrPlanLine && !isVerbDuplicate(phaseOrPlanLine) ? phaseOrPlanLine : null) ??
      (rawNarration && !isVerbDuplicate(rawNarration) ? rawNarration : null) ??
      verb
    const whyCore =
      statusSnapshot.progress && statusSnapshot.progress !== phaseOrPlanLine
        ? toNaturalNarrationLine(statusSnapshot.progress)
        : phaseOrPlanLine || null
    const whyBits: string[] = []
    if (whyCore) whyBits.push(whyCore)
    if (statusSnapshot.obstacle) {
      const obstacle = toNaturalNarrationLine(statusSnapshot.obstacle)
      if (obstacle) whyBits.push(`Clearing blocker: ${obstacle}`)
    }
    if (statusSnapshot.mitigation) {
      const mitigation = toNaturalNarrationLine(statusSnapshot.mitigation)
      if (mitigation) whyBits.push(`Fix path: ${mitigation}`)
    }
    const why = whyBits.join(' · ')

    const task = what || `Working in ${whoTarget}`
    const primaryPrefix = phaseOrPlanLine ? `Primary\n${phaseOrPlanLine}\n\n` : ''
    return `${primaryPrefix}Task\n${task}\n\nReason\n${why}`.slice(0, 420)
  }, [
    suppressGeneratedNarration,
    agentTileFocus,
    phaseOrPlanLine,
    rawNarration,
    statusSnapshot,
    normalizedVerb,
    tileTitleById,
    verb,
  ])

  const [narrationLine, setNarrationLine] = useState<string | null>(null)
  const lastEmitAtRef = useRef(0)
  const pendingRef = useRef<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emitTickRef = useRef(0)
  const aiReqSeqRef = useRef(0)
  const aiAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!narrationSeedLine?.trim()) {
      pendingRef.current = null
      if (aiAbortRef.current) {
        aiAbortRef.current.abort()
        aiAbortRef.current = null
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (aiTimeoutRef.current) {
        clearTimeout(aiTimeoutRef.current)
        aiTimeoutRef.current = null
      }
      setNarrationLine(null)
      return
    }

    const now = Date.now()
    const since = now - lastEmitAtRef.current

    const primaryForDedupe =
      phaseOrPlanLine ?? (resumePromptData ? 'Resume available' : null)

    const flush = (text: string) => {
      const templateSource = phaseOrPlanLine || rawNarration || verb || text
      const fallbackRaw = shouldUseAiNarration
        ? buildFallbackBulletsFromSeed(text, primaryForDedupe)
        : generateTemplateNarrationVariant(
            templateSource,
            narratorTemplateSeed(templateSource, emitTickRef.current++)
          )
      const fallback = toNaturalNarrationLine(fallbackRaw)
      if (!fallback) {
        pendingRef.current = null
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        return
      }
      lastEmitAtRef.current = Date.now()
      setNarrationLine(fallback)
      const seq = ++aiReqSeqRef.current
      if (aiAbortRef.current) {
        aiAbortRef.current.abort()
        aiAbortRef.current = null
      }
      if (shouldUseAiNarration) {
        const ctl = new AbortController()
        aiAbortRef.current = ctl
        void generateAiNarratorLine({
          baseLine: text,
          primaryLine: primaryForDedupe,
          personalityMarkdown: narratorPersonalityMd,
          modelId: narratorAiModelId,
          signal: ctl.signal,
        })
          .then((generated) => {
            const natural = toNaturalNarrationLine(generated)
            if (aiReqSeqRef.current !== seq || !natural) return
            const sinceLastEmit = Date.now() - lastEmitAtRef.current
            if (sinceLastEmit >= NARRATION_RATE_MS) {
              lastEmitAtRef.current = Date.now()
              setNarrationLine(natural)
              return
            }
            if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current)
            aiTimeoutRef.current = setTimeout(() => {
              if (aiReqSeqRef.current !== seq) return
              lastEmitAtRef.current = Date.now()
              setNarrationLine(natural)
              aiTimeoutRef.current = null
            }, NARRATION_RATE_MS - sinceLastEmit)
          })
          .catch(() => {
            /* keep template fallback */
          })
      }
      pendingRef.current = null
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    if (since >= NARRATION_RATE_MS) {
      flush(narrationSeedLine)
      return
    }

    pendingRef.current = narrationSeedLine
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      const p = pendingRef.current
      if (p) flush(p)
    }, NARRATION_RATE_MS - since)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [
    narrationSeedLine,
    shouldUseAiNarration,
    narratorAiModelId,
    narratorPersonalityMd,
    phaseOrPlanLine,
    rawNarration,
    resumePromptData,
    verb,
  ])

  useEffect(() => {
    if (!running) {
      pendingRef.current = null
      lastEmitAtRef.current = 0
      if (aiAbortRef.current) {
        aiAbortRef.current.abort()
        aiAbortRef.current = null
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (aiTimeoutRef.current) {
        clearTimeout(aiTimeoutRef.current)
        aiTimeoutRef.current = null
      }
      setNarrationLine(null)
    }
  }, [running])

  useEffect(
    () => () => {
      if (aiAbortRef.current) aiAbortRef.current.abort()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current)
    },
    []
  )

  const resumeNarrationLine = resumePromptData
    ? `- Resume ${resumePromptData.projectName} at ${resumePromptData.pct}% (${resumePromptData.done}/${resumePromptData.total}).`
    : null
  const currentTaskLine = useMemo(() => {
    const primaryNorm = (phaseOrPlanLine ?? '').trim().toLowerCase()
    const candidates: string[] = []
    if (rawNarration?.trim()) candidates.push(rawNarration.trim())
    if (narrationSeedLine?.trim()) {
      const { task } = parseTaskReasonSeed(narrationSeedLine)
      if (task.trim()) candidates.push(task.trim())
    }
    if (verb?.trim()) candidates.push(verb.trim())
    for (const candidate of candidates) {
      if (!candidate) continue
      const natural = toNaturalNarrationLine(candidate)
      if (!natural) continue
      if (isReadyLikeLine(candidate)) continue
      if (primaryNorm && natural.toLowerCase() === primaryNorm) continue
      return `- ${natural}`.slice(0, 260)
    }
    return null
  }, [phaseOrPlanLine, rawNarration, narrationSeedLine, verb])
  const clarifyWaiting = clarifyPhase === 'waiting' && clarifyQuestionCount > 0
  const clarifyPrimaryLine = clarifyWaiting ? 'Clarifying question pending' : null
  const clarifyInstructionLine = clarifyWaiting
    ? 'Answer the clarifying question in the orchestrator tile to proceed.'
    : null
  const primaryLine =
    clarifyPrimaryLine ?? phaseOrPlanLine ?? (resumePromptData ? 'Resume available' : null) ?? ''
  const hasPrimaryNarration = Boolean(primaryLine && !isReadyLikeLine(primaryLine))
  const hasSecondaryNarration = Boolean(
    narrationLine && !isIdleOnlyNarratorSecondary(narrationLine)
  )
  const showHud = Boolean(
    clarifyWaiting ||
      hasPrimaryNarration ||
      hasSecondaryNarration ||
      resumeNarrationLine ||
      currentTaskLine ||
      running
  )

  if (!showHud) return null

  const secondaryLine =
    clarifyInstructionLine ??
    narrationLine ??
    resumeNarrationLine ??
    currentTaskLine ??
    (running ? '- I am continuing this step.' : '- I am ready for the next step.')
  const hasSecondLine = Boolean(secondaryLine?.trim())
  const narratorCompactIdle =
    !running &&
    !resumePromptData &&
    !phaseOrPlanLine?.trim() &&
    !rawNarration?.trim() &&
    !narrationLine?.trim() &&
    !resumeNarrationLine &&
    isIdleOnlyNarratorSecondary(secondaryLine)
  const showHudProgress = !resumePromptData && taskTotal > 0

  /** Sit above the bottom toolbar (prompt is inline in the toolbar — no separate floating bar). */
  const hudBottomStyle = {
    bottom: `calc(var(${ORCA_TOOLBAR_TOP_FROM_BOTTOM_VAR}, 72px) + 8px)`,
  }

  return (
    <div
      data-testid="orchestrator-canvas-hud"
      style={hudBottomStyle}
      className={clsx(
        'pointer-events-none absolute left-1/2 z-[90] max-w-[calc(100%-2rem)] -translate-x-1/2 motion-safe:transition-[bottom] motion-safe:duration-200 motion-safe:ease-out',
        narratorCompactIdle ? 'w-max' : 'w-[min(92%,36rem)]'
      )}
    >
      <div
        className={clsx(
          'relative z-[1] overflow-hidden rounded-xl px-3',
          ORCA_ORCHESTRATOR_GLASS_BACKDROP_BLUR_CLASS,
          'bg-canvas-bg/50',
          'shadow-[0_6px_28px_rgba(0,0,0,0.55)]',
          narratorCompactIdle ? 'py-1' : hasSecondLine ? 'py-1.5' : 'py-1'
        )}
        aria-live="polite"
        aria-label="Orchestrator status"
      >
        {narratorCompactIdle ? (
          <div className="flex min-h-[1.25rem] min-w-0 items-center gap-2">
            <p className="line-clamp-1 min-w-0 flex-1 text-[12px] leading-tight text-gray-300">
              {secondaryLine}
            </p>
            {showHudProgress ? (
              <NarratorTaskProgressRing
                taskPct={taskPct}
                taskDone={taskDone}
                taskTotal={taskTotal}
                layout="compactRow"
              />
            ) : null}
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <div className={`min-w-0 flex-1 ${hasSecondLine ? 'space-y-0.5' : ''}`}>
              <div className="line-clamp-2 break-words text-[12px] font-semibold leading-tight text-gray-50">
                {primaryLine}
              </div>
              {hasSecondLine ? (
                <div className="line-clamp-3 whitespace-pre-line break-words text-[12px] leading-tight text-gray-300">
                  {secondaryLine}
                </div>
              ) : null}
            </div>
            {resumePromptData ? (
              <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1.5 self-center">
                <button
                  type="button"
                  onClick={() => {
                    setQuickInputSuppressedUntilIdle(true)
                    void resumeContinueNow()
                      .finally(() => {
                        if (!computeCanStopAllSnapshot()) {
                          setQuickInputSuppressedUntilIdle(false)
                        }
                      })
                  }}
                  className="inline-flex h-6 items-center justify-center rounded-md border border-emerald-400/55 bg-emerald-500/20 px-2 text-[10px] font-medium text-emerald-100 hover:bg-emerald-500/30"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={resumeDismiss}
                  className="inline-flex h-6 items-center justify-center rounded-md border border-red-500/55 bg-red-500/20 px-2 text-[10px] font-medium text-red-100 hover:bg-red-500/30"
                >
                  No
                </button>
              </div>
            ) : showHudProgress ? (
              <NarratorTaskProgressRing
                taskPct={taskPct}
                taskDone={taskDone}
                taskTotal={taskTotal}
                layout="expandedColumn"
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

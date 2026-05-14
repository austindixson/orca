import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useShallow } from 'zustand/react/shallow'
import { useCanvasStore, type TileData } from '../../store/canvasStore'
import {
  useOrchestratorActivityStore,
  type OrchestratorTileRevealEffect,
} from '../../store/orchestratorActivityStore'
import { resolveHubAgentHue } from '../../lib/orchestrator/resolveHubAgentHue'
import {
  DEFAULT_PLANNING_VERB,
  FALLBACK_LONG_WAIT_MS,
  FALLBACK_LONG_WAIT_VERB,
  verbStabilityKeyForFocusBanner,
} from '../../lib/orchestrator/orchestratorShimmerVerbs'
import { TextShimmer } from '../ui/TextShimmer'

function useFocusBannerHue(sourceSessionTileId: string | null | undefined): number {
  const tiles = useCanvasStore((s) => s.tiles)
  return useMemo(
    () => resolveHubAgentHue(sourceSessionTileId, tiles),
    [sourceSessionTileId, tiles]
  )
}

function useLiveElapsedMs(active: boolean, startMs: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || startMs == null) return
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [active, startMs])
  if (!active || startMs == null) return 0
  return Math.max(0, now - startMs)
}

/** Elapsed ms since `verb`'s stable key last changed (ignores ` · Ns` ticks). */
function useMsSinceVerbStableKey(running: boolean, verb: string): number {
  const stableKey = useMemo(
    () => (running ? verbStabilityKeyForFocusBanner(verb) : ''),
    [running, verb]
  )
  const [ms, setMs] = useState(0)
  const startAtRef = useRef<number | null>(null)
  useEffect(() => {
    if (!running) {
      startAtRef.current = null
      setMs(0)
      return
    }
    const t0 = Date.now()
    startAtRef.current = t0
    setMs(0)
    const id = window.setInterval(() => {
      if (startAtRef.current != null) setMs(Date.now() - startAtRef.current)
    }, 250)
    return () => window.clearInterval(id)
  }, [running, stableKey])
  return ms
}

function resolveAgentLabel(
  sourceSessionTileId: string | null | undefined,
  tiles: Map<string, TileData>
): string {
  if (!sourceSessionTileId) return 'Orchestrator'
  const src = tiles.get(sourceSessionTileId)
  if (!src) return 'Orchestrator'
  const raw = src.title?.trim()
  if (raw) return raw
  if (src.type === 'orchestrator') return 'Orchestrator'
  if (src.type === 'agent') return 'Agent'
  return 'Session'
}

export type ModuleFocusHighlight = {
  tileId: string
  label: string
  effect: OrchestratorTileRevealEffect
  sourceSessionTileId?: string | null
}

type Props = {
  highlight: ModuleFocusHighlight
  revealAttentionFx: boolean
}

/** Floats above a canvas tile while orchestrator auto-focus highlights it — agent title, trace chip, live counter. */
export function OrchestratorModuleFocusBanner({ highlight, revealAttentionFx }: Props) {
  const hue = useFocusBannerHue(highlight.sourceSessionTileId)
  const tiles = useCanvasStore((s) => s.tiles)

  const shimmerTileType = useMemo(() => {
    const t = tiles.get(highlight.tileId)?.type
    return t && typeof t === 'string' ? t : 'orchestrator'
  }, [tiles, highlight.tileId])

  const agentTitle = useMemo(
    () => resolveAgentLabel(highlight.sourceSessionTileId, tiles),
    [highlight.sourceSessionTileId, tiles]
  )

  const {
    verb,
    running,
    latestToolRunning,
    latestToolStartedAtMs,
    runStartedAtMs,
  } = useOrchestratorActivityStore(
    useShallow((s) => ({
      verb: s.verb,
      running: s.running,
      latestToolRunning: s.latestToolRunning,
      latestToolStartedAtMs: s.latestToolStartedAtMs,
      runStartedAtMs: s.runStartedAtMs,
    }))
  )

  const counterStartMs =
    latestToolRunning && latestToolStartedAtMs != null
      ? latestToolStartedAtMs
      : runStartedAtMs
  const counterActive = running && counterStartMs != null
  const elapsedMs = useLiveElapsedMs(counterActive, counterStartMs)
  const sec = Math.floor(elapsedMs / 1000)
  const verbHoldMs = useMsSinceVerbStableKey(running, verb)

  const traceText = useMemo(() => {
    if (!running) return highlight.label
    const hasVerb = verb.trim().length > 0 && verb !== 'Ready'
    const base = hasVerb ? verb : DEFAULT_PLANNING_VERB
    if (verbHoldMs >= FALLBACK_LONG_WAIT_MS) return FALLBACK_LONG_WAIT_VERB
    return base
  }, [running, verb, highlight.label, verbHoldMs])

  const sat = 58
  const chipBg = `linear-gradient(135deg, hsl(${hue} ${sat}% 16% / 0.92), hsl(${hue} ${sat}% 9% / 0.96))`
  const chipBorder = `hsl(${hue} ${Math.min(78, sat + 12)}% 42% / 0.65)`
  const chipText = `hsl(${hue} 88% 88%)`

  return (
    <div className="pointer-events-none absolute bottom-full left-0 right-0 z-[35] mb-1 flex justify-center px-1">
      <div
        className={clsx(
          'flex max-w-[min(100%,28rem)] items-center gap-2 rounded-xl border border-white/10 bg-black/75 px-2.5 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md',
          revealAttentionFx && 'ring-1 ring-accent-teal/25'
        )}
      >
        <span
          className="min-w-0 max-w-[10rem] truncate text-[10px] font-semibold tracking-tight text-gray-100"
          data-tooltip={agentTitle}
        >
          {agentTitle}
        </span>
        <span
          className={clsx(
            'inline-flex min-w-0 max-w-[14rem] items-center rounded-md border px-2 py-0.5 text-[9px] font-semibold leading-tight shadow-inner',
            revealAttentionFx && 'ring-1 ring-white/10'
          )}
          style={{
            background: chipBg,
            borderColor: chipBorder,
          }}
          data-tooltip={`${highlight.label} · ${traceText}`}
        >
          {running ? (
            <TextShimmer
              tileType={shimmerTileType}
              className="!inline truncate align-middle text-[9px] font-semibold leading-tight"
              title={traceText}
            >
              {traceText}
            </TextShimmer>
          ) : (
            <span className="truncate" style={{ color: chipText }}>
              {traceText}
            </span>
          )}
        </span>
        <span
          className="shrink-0 rounded-md bg-white/[0.07] px-2 py-0.5 font-['IBM_Plex_Mono',monospace] text-[10px] font-semibold tabular-nums text-accent-teal/95"
          data-tooltip="Elapsed this action"
        >
          {String(Math.floor(sec / 60)).padStart(2, '0')}:{String(sec % 60).padStart(2, '0')}
        </span>
      </div>
    </div>
  )
}

import type { DelegatedTraceChip } from '../../../lib/orchestrator/delegatedLogPresentation'
import { useAnimationActivityGate } from '../../../hooks/useAnimationActivityGate'
import { TextShimmer } from '../../ui/TextShimmer'
import { chipClass } from './styles'

type Props = {
  /** Parent tile id for visibility/active animation gating. */
  tileId: string
  /** Matches parent canvas tile (`TileData['type']`) so shimmer follows that tile’s rim hue. */
  tileType: string
  streaming: boolean
  verbPhrase: string
  elapsedMs: number
  lastToolChip: DelegatedTraceChip | null
  /** Priority warnings — only one row; streaming hides these in favor of run line. */
  delegatedNoWorker: boolean
  worktreeSkipped: boolean
  worktreeError?: string
  idleSummary: string
}

export function AgentStatusStrip({
  tileId,
  tileType,
  streaming,
  verbPhrase,
  elapsedMs,
  lastToolChip,
  delegatedNoWorker,
  worktreeSkipped,
  worktreeError,
  idleSummary,
}: Props) {
  const { containerRef, allowAnimation } = useAnimationActivityGate(tileId, streaming)
  if (streaming) {
    return (
      <div
        ref={containerRef}
        className="flex h-7 shrink-0 items-center gap-2 border-b border-tile-border bg-black/20 px-3 text-[11px]"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${allowAnimation ? 'bg-accent-teal shadow-[0_0_8px_rgba(var(--accent-teal-rgb),0.75)]' : 'bg-accent-teal'}`}
        />
        {allowAnimation ? (
          <TextShimmer
            key={verbPhrase || 'working'}
            tileType={tileType}
            duration={3}
            spread={2}
            className="min-w-0 flex-1"
            title={verbPhrase}
          >
            {verbPhrase || 'Working…'}
          </TextShimmer>
        ) : (
          <span className="min-w-0 flex-1 truncate" data-tooltip={verbPhrase}>
            {verbPhrase || 'Working…'}
          </span>
        )}
        <span className="shrink-0 tabular-nums text-gray-500">{(elapsedMs / 1000).toFixed(1)}s</span>
        {lastToolChip && lastToolChip.kind !== 'info' ? (
          <span
            className={
              lastToolChip.kind === 'call'
                ? chipClass('cyan') + ' max-w-[200px] truncate py-0'
                : chipClass('emerald') + ' max-w-[200px] truncate py-0'
            }
            data-tooltip={lastToolChip.name}
          >
            <span className="shrink-0 opacity-70">{lastToolChip.kind === 'call' ? '→' : '←'}</span>
            <span className="truncate">{lastToolChip.name}</span>
          </span>
        ) : null}
      </div>
    )
  }

  if (delegatedNoWorker) {
    return (
      <div className="flex min-h-7 shrink-0 items-start gap-2 border-b border-tile-border bg-amber-950/20 px-3 py-1.5 text-[11px] leading-snug text-amber-100/95">
        <span className="shrink-0 font-semibold text-amber-200">!</span>
        <span>
          <span className="font-semibold text-amber-200">No worker linked to this tile.</span> Canvas restored this tile
          but the sub-agent roster was empty. Spawn again or reload after a registered run.
        </span>
      </div>
    )
  }

  if (worktreeError) {
    return (
      <div
        className="flex min-h-7 shrink-0 items-start gap-2 border-b border-tile-border bg-rose-950/20 px-3 py-1.5 text-[11px] leading-snug text-rose-100/95"
        data-tooltip={worktreeError}
      >
        <span className="shrink-0 font-semibold text-rose-200">!</span>
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
          <span className="font-semibold text-rose-200">Git worktree failed.</span> {worktreeError}
        </span>
      </div>
    )
  }

  if (worktreeSkipped) {
    return (
      <div className="flex min-h-7 shrink-0 items-start gap-2 border-b border-tile-border bg-amber-950/20 px-3 py-1.5 text-[11px] leading-snug text-amber-100/95">
        <span className="shrink-0 font-semibold text-amber-200">!</span>
        <span>
          <span className="font-semibold text-amber-200">Isolated worktree was skipped.</span> Not a git repo — sub-agent
          uses the main workspace. Use <code className="rounded bg-black/35 px-1 text-[10px]">git init</code> or disable
          isolated worktrees in Settings → Agent data.
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-tile-border bg-black/15 px-3 text-[11px] text-gray-500">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-600" />
      <span className="truncate">{idleSummary}</span>
    </div>
  )
}

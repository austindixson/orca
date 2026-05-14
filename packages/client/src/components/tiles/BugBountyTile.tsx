import { useMemo, useState } from 'react'
import {
  useBugBountyStore,
  type BountySeverity,
  type BountyStatus,
  type BugBountyItem,
} from '../../store/bugBountyStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useCanvasStore } from '../../store/canvasStore'
import { activateModuleOnCanvas } from '../../lib/canvasModuleNavigation'
import { runPoolTickNow } from '../../lib/orchestrator/bountyHunterPool'
import { TileComponentProps } from '../Canvas/TileRegistry'

type SeverityTheme = {
  label: string
  barClass: string
  chipClass: string
  rank: number
}

const SEVERITY_THEMES: Record<BountySeverity, SeverityTheme> = {
  critical: {
    label: 'CRIT',
    barClass: 'bg-red-500',
    chipClass: 'bg-red-500/15 text-red-200 border-red-500/40',
    rank: 0,
  },
  high: {
    label: 'HIGH',
    barClass: 'bg-amber-500',
    chipClass: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
    rank: 1,
  },
  medium: {
    label: 'MED',
    barClass: 'bg-sky-500',
    chipClass: 'bg-sky-500/15 text-sky-200 border-sky-500/40',
    rank: 2,
  },
  low: {
    label: 'LOW',
    barClass: 'bg-emerald-500',
    chipClass: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
    rank: 3,
  },
}

const STATUS_LABEL: Record<BountyStatus, string> = {
  queued: 'Queued',
  investigating: 'Hunting',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
  triaged: 'Queued',
  reproducing: 'Hunting',
  fixing: 'Hunting',
  validated: 'Resolved',
  closed: 'Resolved',
}

function isOpen(b: BugBountyItem): boolean {
  return (
    b.status !== 'resolved' &&
    b.status !== 'dismissed' &&
    b.status !== 'closed' &&
    b.status !== 'validated'
  )
}

function relativeTime(ts: number): string {
  const delta = Math.max(0, Date.now() - ts)
  const s = Math.round(delta / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/**
 * **Bug bounty board** — queue of detected issues + active troubleshooter pool.
 * Errors from terminal / inspect / console stream in here; the pool keeps up
 * to `orcaBugBountyMaxHunters` (default 3) senior-engineer troubleshooter
 * sub-agents chewing through the board until it's empty.
 */
export function BugBountyTile(_props: TileComponentProps) {
  const items = useBugBountyStore((s) => s.items)
  const dismissBounty = useBugBountyStore((s) => s.dismissBounty)
  const removeBounty = useBugBountyStore((s) => s.removeBounty)
  const clearAll = useBugBountyStore((s) => s.clearAll)

  const laneEnabled = useSettingsStore((s) => s.orcaBugBountyLaneEnabled)
  const autoDelegate = useSettingsStore((s) => s.orcaBugBountyAutoDelegateSubagents)
  const maxHunters = useSettingsStore((s) => s.orcaBugBountyMaxHunters)
  const setLaneEnabled = useSettingsStore((s) => s.setOrcaBugBountyLaneEnabled)
  const setAutoDelegate = useSettingsStore((s) => s.setOrcaBugBountyAutoDelegateSubagents)
  const setMaxHunters = useSettingsStore((s) => s.setOrcaBugBountyMaxHunters)

  const members = useAgentTeamStore((s) => s.membersByTileId)
  const tiles = useCanvasStore((s) => s.tiles)

  const [showResolved, setShowResolved] = useState(false)

  const activeHunters = useMemo(() => {
    return Object.values(members).filter(
      (m) => m.role && m.role.includes('Bounty') && m.status === 'working'
    )
  }, [members])

  const visibleItems = useMemo(() => {
    const list = items.slice().sort((a, b) => {
      const sev = SEVERITY_THEMES[a.severity].rank - SEVERITY_THEMES[b.severity].rank
      if (sev !== 0) return sev
      return b.lastSeenAt - a.lastSeenAt
    })
    return showResolved ? list : list.filter(isOpen)
  }, [items, showResolved])

  const counts = useMemo(() => {
    const open = items.filter(isOpen)
    const byStatus = {
      queued: open.filter((b) => b.status === 'queued' || b.status === 'triaged').length,
      investigating: open.filter(
        (b) =>
          b.status === 'investigating' || b.status === 'reproducing' || b.status === 'fixing'
      ).length,
      resolved: items.filter(
        (b) => b.status === 'resolved' || b.status === 'validated' || b.status === 'closed'
      ).length,
      dismissed: items.filter((b) => b.status === 'dismissed').length,
    }
    const bySeverity = {
      critical: open.filter((b) => b.severity === 'critical').length,
      high: open.filter((b) => b.severity === 'high').length,
      medium: open.filter((b) => b.severity === 'medium').length,
      low: open.filter((b) => b.severity === 'low').length,
    }
    return { open: open.length, byStatus, bySeverity }
  }, [items])

  const goToTile = (tileId: string | undefined) => {
    if (!tileId) return
    if (!tiles.has(tileId)) return
    activateModuleOnCanvas(tileId, { intent: 'user_sidebar' })
  }

  return (
    <div className="flex h-full w-full flex-col bg-canvas-bg text-gray-200">
      <header className="border-b border-tile-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-red-400/80">
                · bounty
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Bug bounty board
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
              Open bounties routed to a pool of senior-engineer troubleshooters.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <StatCell label="open" value={counts.open} accent="text-gray-100" />
            <StatCell
              label="hunting"
              value={counts.byStatus.investigating}
              accent="text-sky-300"
            />
            <StatCell
              label="queued"
              value={counts.byStatus.queued}
              accent="text-amber-300"
            />
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-gray-500">
            <SeverityChip sev="critical" n={counts.bySeverity.critical} />
            <SeverityChip sev="high" n={counts.bySeverity.high} />
            <SeverityChip sev="medium" n={counts.bySeverity.medium} />
            <SeverityChip sev="low" n={counts.bySeverity.low} />
          </div>
          <button
            type="button"
            className="text-[10px] font-mono uppercase tracking-wider text-gray-500 hover:text-gray-200"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? 'hide resolved' : 'show resolved'}
          </button>
        </div>
      </header>

      <section className="border-b border-tile-border/70 bg-black/20 px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-400/80">
              hunters
            </span>
            <span className="text-[11px] text-gray-400">
              {activeHunters.length} / {maxHunters} active
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-gray-500">
            <label className="flex items-center gap-1">
              max
              <input
                type="number"
                min={1}
                max={8}
                value={maxHunters}
                onChange={(e) => setMaxHunters(Number(e.target.value))}
                className="w-10 rounded border border-tile-border bg-black/40 px-1 py-0.5 text-center text-[11px] text-gray-100 focus:border-accent-teal/60 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={runPoolTickNow}
              className="rounded border border-tile-border/60 px-1.5 py-0.5 hover:border-accent-teal/60 hover:text-accent-teal"
              data-tooltip="Dispatch queued bounties now"
            >
              tick
            </button>
          </div>
        </div>
        {activeHunters.length === 0 ? (
          <p className="text-[11px] text-gray-500">
            Pool idle. New bounties will auto-spawn hunters up to the cap.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {activeHunters.map((m) => (
              <li
                key={m.tileId}
                className="group flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                <button
                  type="button"
                  onClick={() => goToTile(m.tileId)}
                  className="font-mono text-[11px] hover:underline"
                  data-tooltip="Open hunter tile"
                >
                  {m.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center justify-between gap-2 border-b border-tile-border/70 bg-black/10 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-gray-500">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={laneEnabled}
            onChange={(e) => setLaneEnabled(e.target.checked)}
            className="accent-accent-teal"
          />
          lane
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={autoDelegate}
            onChange={(e) => setAutoDelegate(e.target.checked)}
            className="accent-accent-teal"
          />
          auto-hunt
        </label>
        <button
          type="button"
          onClick={() => {
            if (
              typeof window !== 'undefined' &&
              !window.confirm('Clear all bounties from the board?')
            )
              return
            clearAll()
          }}
          className="ml-auto rounded border border-tile-border/60 px-1.5 py-0.5 hover:border-red-500/60 hover:text-red-200"
        >
          clear all
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {visibleItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-tile-border/80 bg-black/20 px-3 py-8 text-center">
            <div className="mb-1 text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400/80">
              board clear
            </div>
            <p className="text-[12px] text-gray-400">
              No open bounties. Terminal errors and inspect issues will land here.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {visibleItems.map((item) => (
              <BountyRow
                key={item.id}
                item={item}
                onGoTo={goToTile}
                onDismiss={() => dismissBounty(item.id)}
                onRemove={() => removeBounty(item.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function StatCell({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: string
}) {
  return (
    <div className="rounded border border-tile-border/60 bg-black/20 px-1.5 py-0.5 text-center font-mono leading-tight">
      <div className={`text-sm font-semibold ${accent}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-gray-500">{label}</div>
    </div>
  )
}

function SeverityChip({ sev, n }: { sev: BountySeverity; n: number }) {
  const theme = SEVERITY_THEMES[sev]
  return (
    <span
      className={`rounded border px-1.5 py-0.5 ${theme.chipClass} ${
        n === 0 ? 'opacity-40' : ''
      }`}
    >
      {theme.label} {n}
    </span>
  )
}

function BountyRow({
  item,
  onGoTo,
  onDismiss,
  onRemove,
}: {
  item: BugBountyItem
  onGoTo: (tileId: string | undefined) => void
  onDismiss: () => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const theme = SEVERITY_THEMES[item.severity]
  const statusLabel = STATUS_LABEL[item.status]
  const isHunting =
    item.status === 'investigating' ||
    item.status === 'reproducing' ||
    item.status === 'fixing'
  const isResolved = !isOpen(item)

  return (
    <li
      className={`group relative overflow-hidden rounded border bg-black/30 transition-colors ${
        isResolved
          ? 'border-tile-border/50 opacity-60'
          : 'border-tile-border/70 hover:border-accent-teal/50'
      }`}
    >
      <div className={`absolute left-0 top-0 h-full w-0.5 ${theme.barClass}`} />
      <div className="flex items-start gap-2 pl-2.5 pr-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 font-mono text-[9px] leading-none text-gray-500 hover:text-gray-200"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded px-1 py-0 font-mono text-[9px] tracking-wider ${theme.chipClass}`}
            >
              {theme.label}
            </span>
            <span
              className={`text-[9px] font-mono uppercase tracking-wider ${
                isHunting
                  ? 'text-sky-300'
                  : item.status === 'resolved' || item.status === 'validated' || item.status === 'closed'
                    ? 'text-emerald-300'
                    : item.status === 'dismissed'
                      ? 'text-gray-500'
                      : 'text-amber-300'
              }`}
            >
              {statusLabel}
            </span>
            {item.occurrenceCount > 1 && (
              <span className="rounded border border-tile-border/60 bg-black/40 px-1 py-0 font-mono text-[9px] text-gray-400">
                ×{item.occurrenceCount}
              </span>
            )}
            <span className="ml-auto text-[9px] font-mono text-gray-500">
              {relativeTime(item.lastSeenAt)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[12px] leading-tight text-gray-100">
            {item.title}
          </div>
          {!expanded && item.summary && item.summary !== item.title && (
            <div className="mt-0.5 truncate text-[11px] text-gray-500">{item.summary}</div>
          )}
          {expanded && (
            <div className="mt-1.5 space-y-1.5">
              {item.summary && (
                <p className="text-[11px] leading-snug text-gray-400">{item.summary}</p>
              )}
              {item.samplePayload && (
                <pre className="max-h-32 overflow-auto rounded bg-black/60 p-1.5 font-mono text-[10px] leading-tight text-gray-300">
                  {item.samplePayload}
                </pre>
              )}
              {item.resolutionNote && (
                <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-1 text-[11px] text-emerald-200">
                  <div className="mb-0.5 text-[9px] font-mono uppercase tracking-wider text-emerald-400/80">
                    resolution
                  </div>
                  {item.resolutionNote}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-gray-500">
                {item.sourceKind && (
                  <span className="rounded bg-black/40 px-1 py-0">src:{item.sourceKind}</span>
                )}
                {item.sourceSignature && (
                  <span
                    className="max-w-[180px] truncate rounded bg-black/40 px-1 py-0"
                    data-tooltip={item.sourceSignature}
                  >
                    sig:{item.sourceSignature}
                  </span>
                )}
                {item.assignedAgentProfile && (
                  <span className="rounded bg-black/40 px-1 py-0">
                    role:{item.assignedAgentProfile}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {item.delegatedSubAgentTileId && (
                  <button
                    type="button"
                    onClick={() => onGoTo(item.delegatedSubAgentTileId)}
                    className="rounded border border-accent-teal/40 bg-accent-teal/10 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-accent-teal hover:bg-accent-teal/20"
                  >
                    open hunter
                  </button>
                )}
                {item.sourceTileId && (
                  <button
                    type="button"
                    onClick={() => onGoTo(item.sourceTileId)}
                    className="rounded border border-tile-border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-gray-300 hover:border-accent-teal/60 hover:text-accent-teal"
                  >
                    open source
                  </button>
                )}
                {!isResolved && (
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="rounded border border-tile-border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-gray-400 hover:border-red-500/50 hover:text-red-200"
                  >
                    dismiss
                  </button>
                )}
                <button
                  type="button"
                  onClick={onRemove}
                  className="ml-auto rounded border border-tile-border/40 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 hover:border-red-500/40 hover:text-red-300"
                  data-tooltip="Permanently remove from board"
                >
                  remove
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

import { useMemo } from 'react'
import clsx from 'clsx'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useAgentTaskStore } from '../../store/agentTaskStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useMergeReviewStore } from '../../store/mergeReviewStore'
import { useSettingsStore } from '../../store/settingsStore'
import { activateModuleOnCanvas } from '../../lib/canvasModuleNavigation'
import { approveAllPendingMergeReviews, approveMergeReviewTicket } from '../../lib/harness/mergeReviewerPipeline'
import { SettingsToggleRow } from '../Settings/settingsPrimitives'
import { ExpandableText } from '../common/ExpandableText'

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  working: 'Working',
  done: 'Done',
  error: 'Error',
}

export function AgentsSidebarPanel() {
  const membersByTileId = useAgentTeamStore((s) => s.membersByTileId)
  const tasksByTileId = useAgentTaskStore((s) => s.byTileId)
  const tiles = useCanvasStore((s) => s.tiles)
  const mergeTickets = useMergeReviewStore((s) => s.tickets)
  const setMergeReviewStatus = useMergeReviewStore((s) => s.setMergeReviewStatus)
  const autoApproveMergeReviews = useSettingsStore((s) => s.autoApproveMergeReviews)
  const setAutoApproveMergeReviews = useSettingsStore((s) => s.setAutoApproveMergeReviews)

  const rows = useMemo(() => {
    const list = Object.values(membersByTileId)
    return list.sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [membersByTileId])

  const mergeRows = useMemo(() => [...mergeTickets].reverse(), [mergeTickets])
  const doneAgents = useMemo(() => rows.filter((m) => m.status === 'done').length, [rows])

  return (
    <div className="flex h-full min-h-0 flex-col bg-tile-bg/60 text-gray-300 backdrop-blur-xl">
      <div className="shrink-0 border-b border-tile-border/80 px-4 py-2 text-xs uppercase tracking-wider text-gray-400">
        <div className="flex items-center justify-between gap-2">
          <span>Agents</span>
          {rows.length > 0 ? (
            <span className="rounded border border-emerald-400/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-emerald-100 tabular-nums">
              {doneAgents}/{rows.length} done
            </span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 border-b border-tile-border/60 px-2 py-2">
        <SettingsToggleRow
          label="Auto-merge sub-agent branches"
          hint="Same as Settings → Agent & memory. Merges worktree branches when sub-agents finish (desktop)."
          checked={autoApproveMergeReviews}
          onChange={(v) => {
            setAutoApproveMergeReviews(v)
            if (v) void approveAllPendingMergeReviews()
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-gray-600">
            No delegated agents yet. Spawn a sub-agent from the orchestrator to see them here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((m) => {
              const tile = tiles.get(m.tileId)
              const title = tile?.title ?? m.displayName
              const tasks = tasksByTileId[m.tileId] ?? []
              const doneTasks = tasks.filter((t) => t.status === 'done').length
              return (
                <li key={m.tileId}>
                  <button
                    type="button"
                    onClick={() =>
                      activateModuleOnCanvas(m.tileId, { intent: 'user_sidebar' })
                    }
                    className="w-full rounded-lg border border-tile-border/50 bg-black/15 px-2 py-2 text-left text-[11px] transition-colors hover:border-accent-teal/45 hover:bg-tile-hover/80"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-gray-200">{m.displayName}</span>
                      <span
                        className={clsx(
                          'shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase',
                          m.status === 'working' && 'bg-amber-500/20 text-amber-200',
                          m.status === 'done' && 'bg-accent-teal/20 text-accent-teal',
                          m.status === 'error' && 'bg-red-500/20 text-red-300',
                          m.status === 'idle' && 'bg-gray-600/30 text-gray-400'
                        )}
                      >
                        {STATUS_LABEL[m.status] ?? m.status}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-gray-500">{m.role}</div>
                    <div className="mt-1 line-clamp-2 text-[10px] text-gray-400">{m.currentTask}</div>
                    {tasks.length > 0 ? (
                      <div className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-200/90 tabular-nums">
                        Tasks: {doneTasks}/{tasks.length} done
                      </div>
                    ) : null}
                    <div className="mt-1 truncate text-[9px] text-gray-600" data-tooltip={title}>
                      Tile: {title}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {mergeRows.length > 0 && (
          <>
            <div className="mt-4 shrink-0 border-t border-tile-border/60 px-2 pt-3 text-[10px] uppercase tracking-wider text-gray-500">
              Merge review
            </div>
            <ul className="mt-1 flex flex-col gap-1">
              {mergeRows.map((t) => {
                const agentTile = tiles.get(t.agentTileId)
                const agentTitle = agentTile?.title ?? t.agentTileId.slice(0, 8)
                return (
                  <li
                    key={t.id}
                    className="rounded-lg border border-tile-border/40 bg-black/20 px-2 py-2 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={clsx(
                          'shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase',
                          t.status === 'pending' && 'bg-amber-500/20 text-amber-200',
                          t.status === 'approved' && 'bg-accent-teal/20 text-accent-teal',
                          t.status === 'rejected' && 'bg-red-500/15 text-red-300'
                        )}
                      >
                        {t.status}
                      </span>
                      <button
                        type="button"
                        className="truncate text-left text-[10px] text-gray-500 hover:text-accent-teal"
                        onClick={() =>
                          activateModuleOnCanvas(t.agentTileId, { intent: 'user_sidebar' })
                        }
                      >
                        {agentTitle}
                      </button>
                    </div>
                    {t.notes ? (
                      <div className="mt-1">
                        <ExpandableText
                          text={t.notes}
                          maxChars={180}
                          className="text-[10px] text-gray-500"
                          buttonClassName="text-[9px]"
                          moreLabel="Read more"
                          lessLabel="Show less"
                        />
                      </div>
                    ) : null}
                    {t.status === 'pending' && (
                      <div className="mt-2 flex gap-1">
                        <button
                          type="button"
                          className="flex-1 rounded border border-accent-teal/30 bg-accent-teal/10 px-2 py-1 text-[10px] text-accent-teal hover:bg-accent-teal/20"
                          onClick={() => {
                            void approveMergeReviewTicket(t.id)
                          }}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="flex-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/20"
                          onClick={() => setMergeReviewStatus(t.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

import type { OrchestratorPlanningDraft } from '../../store/orchestratorSessionStore'
import { OrchestratorMarkdown } from './OrchestratorMarkdown'

/**
 * Planning / articulation / decomposition preview: never show raw streaming tokens
 * (JSON or partial markdown). Only the finalized markdown body is rendered.
 */
export function OrchestratorPlanningDraftPanel({
  planningDraft,
}: {
  planningDraft: OrchestratorPlanningDraft
}) {
  return (
    <div className="rounded-lg border border-tile-border/50 bg-canvas-bg/80 px-2.5 py-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-300/85">
          {planningDraft.title}
        </span>
        {planningDraft.phase === 'streaming' ? (
          <span className="text-[9px] tabular-nums text-teal-300/80">Streaming…</span>
        ) : (
          <span
            className="max-w-[min(100%,14rem)] truncate font-mono text-[9px] text-gray-500"
            data-tooltip=".agent-canvas/plans/current-plan.md"
          >
            .agent-canvas/plans/current-plan.md
          </span>
        )}
      </div>
      {planningDraft.phase === 'streaming' ? (
        <div
          data-testid="orchestrator-planning-streaming-placeholder"
          className="flex min-h-[3.25rem] max-h-52 items-center gap-2 rounded-md border border-tile-border/40 bg-black/20 px-2 py-2 text-[11px] leading-snug text-gray-500"
        >
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gray-500"
            aria-hidden
          />
          <span>Preparing plan…</span>
        </div>
      ) : (
        <div className="max-h-52 overflow-auto text-[13px] leading-relaxed">
          <OrchestratorMarkdown content={planningDraft.body} />
        </div>
      )}
    </div>
  )
}

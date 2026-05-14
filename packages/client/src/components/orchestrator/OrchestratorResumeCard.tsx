import { useResumePromptStore } from '../../store/resumePromptStore'

/**
 * "Continue where we left off?" card, rendered at the bottom of the orchestrator
 * main column (as the newest message, directly above the input) when a project is
 * reopened and there's pending work + a prior conversation. See
 * {@link useResumePromptStore} for how the prompt is populated on project open
 * (in `resumePromptOnOpen.ts`) and how Continue/Dismiss behave.
 */
export function OrchestratorResumeCard() {
  const data = useResumePromptStore((s) => s.data)
  const dismiss = useResumePromptStore((s) => s.dismiss)
  const continueNow = useResumePromptStore((s) => s.continueNow)

  if (!data) return null

  const showProgress = data.total > 0

  return (
    <div className="rounded-lg border border-cyan-500/35 bg-cyan-500/[0.06] px-3 py-2.5 text-[13px] text-gray-100 shadow-sm">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-300/85">
        Continue where we left off?
      </div>
      <div className="leading-relaxed">
        {showProgress ? (
          <>
            We were{' '}
            <span className="font-semibold text-cyan-100 tabular-nums">{data.pct}%</span> done
            building <span className="font-semibold text-gray-50">{data.projectName}</span>
            <span className="text-gray-400">
              {' '}
              ({data.done}/{data.total} tasks)
            </span>
            .
          </>
        ) : (
          <>
            You had pending work on{' '}
            <span className="font-semibold text-gray-50">{data.projectName}</span>.
          </>
        )}
      </div>
      <div className="mt-0.5 leading-relaxed">
        Next step:{' '}
        <span className="font-medium text-gray-50">{data.nextTaskText}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void continueNow()
          }}
          className="rounded-md border border-cyan-500/45 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-medium text-cyan-50 transition-colors hover:bg-cyan-500/25"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md border border-tile-border/60 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:bg-gray-700/40"
        >
          Not now
        </button>
      </div>
    </div>
  )
}

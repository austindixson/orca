import { useState, type CSSProperties } from 'react'
import { TextShimmer } from '../ui/TextShimmer'

/** Exported for layout padding logic (must match peek row render count). */
export const ORCHESTRATOR_TRACE_PEEK_LINE_COUNT = 3

export const ORCHESTRATOR_TRACE_PEEK_ROW_SHIMMER_TEST_ID =
  'orchestrator-trace-peek-row-shimmer'
export const ORCHESTRATOR_TRACE_PEEK_PLACEHOLDER_SHIMMER_TEST_ID =
  'orchestrator-trace-peek-placeholder-shimmer'

/**
 * Bottom-of-chat strip of the last N gray trace lines. While running, the newest
 * visible line uses neutral gray shimmer. Click to expand to full trace log.
 */
export function OrchestratorTracePeekRows({
  tracePeekRows,
  running,
  traceLineCount,
  maskStyle,
  traceLines,
  onExpand,
  expanded,
}: {
  tracePeekRows: string[]
  running: boolean
  traceLineCount: number
  maskStyle?: CSSProperties
  traceLines?: string[]
  onExpand?: () => void
  expanded?: boolean
}) {
  const [localExpanded, setLocalExpanded] = useState(false)
  const isExpanded = expanded ?? localExpanded

  const handleClick = () => {
    if (onExpand) {
      onExpand()
    } else {
      setLocalExpanded(!isExpanded)
    }
  }

  const allLines = traceLines ?? tracePeekRows

  return (
    <div
      className="font-mono text-[10px] leading-[1.35] text-gray-500 cursor-pointer group/trace"
      onClick={handleClick}
      data-tooltip={isExpanded ? 'Click to collapse trace' : 'Click to expand full trace'}
    >
      {!isExpanded ? (
        <div
          className="flex min-h-[2.7rem] flex-col justify-end gap-px"
          style={maskStyle}
        >
          {tracePeekRows.map((line, idx) => {
            const isLastRow = idx === ORCHESTRATOR_TRACE_PEEK_LINE_COUNT - 1
            const showPlaceholder = traceLineCount === 0 && running && isLastRow
            const showEmpty = !line && !showPlaceholder
            return (
              <div
                key={`peek-row-${idx}`}
                className="min-h-[0.85rem] truncate whitespace-nowrap text-gray-500/90"
              >
                {showPlaceholder ? (
                  running ? (
                    <TextShimmer
                      key="trace-placeholder"
                      testId={ORCHESTRATOR_TRACE_PEEK_PLACEHOLDER_SHIMMER_TEST_ID}
                      tileType="orchestrator"
                      shimmerRgb={[148, 163, 184]}
                      duration={3}
                      spread={2}
                      className="text-[10px] font-normal text-gray-500/90"
                      title="Trace starting…"
                    >
                      Trace starting…
                    </TextShimmer>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-gray-500/75">
                      <span className="inline-block h-1 w-1 rounded-full bg-gray-500" />
                      <span>Trace starting…</span>
                    </span>
                  )
                ) : showEmpty ? (
                  <span className="invisible">.</span>
                ) : running && isLastRow ? (
                  <TextShimmer
                    key={line}
                    testId={ORCHESTRATOR_TRACE_PEEK_ROW_SHIMMER_TEST_ID}
                    tileType="orchestrator"
                    shimmerRgb={[148, 163, 184]}
                    duration={3}
                    spread={2}
                    title={line}
                    className="text-[10px] font-normal text-gray-500/90"
                  >
                    {line}
                  </TextShimmer>
                ) : (
                  <span className="inline-flex max-w-full items-baseline gap-0.5">
                    <span className="min-w-0 flex-1 truncate">{line}</span>
                  </span>
                )}
              </div>
            )
          })}
          <span className="ml-auto hidden text-[9px] text-gray-600 group-hover/trace:inline">
            ▸ expand
          </span>
        </div>
      ) : (
        <div className="max-h-56 space-y-0.5 overflow-y-auto rounded border border-tile-border/40 bg-canvas-bg/40 px-2 py-1.5 leading-tight">
          {allLines.map((line, idx) => (
            <div key={`t-${idx}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-all text-gray-500/90">
              {line}
            </div>
          ))}
        </div>
      )}
      {isExpanded && (
        <div className="px-2 pb-0.5 text-right text-[9px] text-gray-600">
          ▾ collapse
        </div>
      )}
    </div>
  )
}

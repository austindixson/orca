import { useEffect, useRef } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { useReasoningTraceStore } from '../../store/reasoningTraceStore'

export function ReasoningTraceTile({ data: _data }: TileComponentProps) {
  void _data
  const entries = useReasoningTraceStore((s) => s.entries)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length, entries[entries.length - 1]?.text])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#141414] text-gray-200">
      <div className="shrink-0 border-b border-tile-border/80 px-3 py-2 text-[11px] text-gray-500">
        Live orchestrator trace, planning stream tokens (when supported), and optional model reasoning
        chunks from the SSE stream.
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
        {entries.length === 0 ? (
          <p className="text-gray-600">
            Run the orchestrator to populate trace lines. Planning phases stream here when the model
            supports SSE; harness events always append.
          </p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="mb-3 border-b border-white/5 pb-2 last:mb-0 last:border-0">
              <div className="mb-0.5 flex flex-wrap items-baseline gap-2 text-[9px] uppercase tracking-wide text-gray-600">
                <span
                  className={
                    e.kind === 'reasoning'
                      ? 'text-violet-400/90'
                      : e.kind === 'content'
                        ? 'text-sky-400/90'
                        : 'text-gray-500'
                  }
                >
                  {e.kind}
                </span>
                <span className="text-gray-700">{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
              <pre className="whitespace-pre-wrap break-words text-gray-300">{e.text}</pre>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

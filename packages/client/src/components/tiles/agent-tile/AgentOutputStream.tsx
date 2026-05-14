import { useMemo, useState } from 'react'
import { parseAgentOutputText, type ParsedOutputBlock } from './agentOutputParse'
import { chipClass } from './styles'

type Props = {
  /** Joined raw log text (local or delegated). */
  rawText: string
  delegated: boolean
  localEmpty: boolean
  currentModelDisplayName?: string
}

function BlockRow({ block }: { block: ParsedOutputBlock }) {
  const [expanded, setExpanded] = useState(false)

  switch (block.kind) {
    case 'blank':
      return <div className="h-1" aria-hidden />
    case 'user':
      return (
        <div className="font-sans text-[13px] leading-snug text-accent-teal">
          <span className="mr-1.5 text-accent-teal/90">▸</span>
          <span className="text-gray-200">{block.text}</span>
        </div>
      )
    case 'assistant':
      return (
        <div className="font-sans text-[13px] leading-relaxed text-gray-200 whitespace-pre-wrap break-words">
          {block.text}
        </div>
      )
    case 'toolCall': {
      const args = block.args.trim()
      const longArgs = args.length > 120
      const shown = expanded || !longArgs ? args : `${args.slice(0, 117)}…`
      return (
        <div className="font-mono text-[11px] leading-snug">
          <button
            type="button"
            onClick={() => longArgs && setExpanded((e) => !e)}
            className={`flex w-full flex-col items-start gap-0.5 rounded border border-cyan-500/35 bg-cyan-500/5 px-2 py-1 text-left text-cyan-200/95 ${longArgs ? 'cursor-pointer hover:bg-cyan-500/10' : ''}`}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-cyan-400/90">→</span>
              <span className="min-w-0 font-semibold">{block.name}</span>
              {longArgs ? (
                <span className="ml-auto shrink-0 text-[9px] text-cyan-500/80">{expanded ? '▾' : '▸'}</span>
              ) : null}
            </span>
            <span className="w-full break-all text-cyan-100/80">{shown}</span>
          </button>
        </div>
      )
    }
    case 'toolResult': {
      const rest = block.rest?.trim() ?? ''
      const lower = rest.toLowerCase()
      const failed = lower.includes('error') || lower.includes('failed') || lower.includes('ok=false')
      return (
        <div className={`${chipClass(failed ? 'rose' : 'emerald')} max-w-full py-0.5`}>
          <span className="shrink-0 opacity-80">←</span>
          <span className="min-w-0 font-semibold">
            {block.name} {failed ? 'failed' : 'done'}
          </span>
          {rest ? <span className="min-w-0 truncate text-emerald-100/90">{rest}</span> : null}
        </div>
      )
    }
    case 'heartbeat':
      return (
        <div className="font-mono text-[10px] leading-snug text-gray-500 italic">{block.text}</div>
      )
    case 'systemInfo':
      return (
        <div className="inline-flex max-w-full rounded border border-amber-500/35 bg-amber-950/20 px-2 py-1 font-mono text-[10px] leading-snug text-amber-100/95 [overflow-wrap:anywhere]">
          {block.text}
        </div>
      )
    case 'error':
      return (
        <div className="inline-flex max-w-full items-start gap-2 rounded border border-rose-500/40 bg-rose-950/25 px-2 py-1 font-mono text-[10px] leading-snug text-rose-100 [overflow-wrap:anywhere]">
          <span className="shrink-0 font-semibold text-rose-300">!</span>
          <span>{block.text}</span>
        </div>
      )
    case 'code':
      return (
        <div
          className={`max-w-full overflow-x-auto rounded border border-gray-600/50 bg-black/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-gray-200 [overflow-wrap:anywhere] ${
            block.streaming ? 'ring-1 ring-cyan-500/30' : ''
          }`}
        >
          {block.lang && block.lang !== 'text' ? (
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">{block.lang}</div>
          ) : null}
          <pre className="whitespace-pre-wrap break-words">{block.content}</pre>
          {block.streaming ? (
            <div className="mt-1 text-[9px] font-medium text-cyan-400/90">Streaming…</div>
          ) : null}
        </div>
      )
    case 'diff':
      return <DiffFenceBlock content={block.content} streaming={block.streaming} />
    default:
      return null
  }
}

function DiffFenceBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const lines = content.split(/\r?\n/)
  return (
    <div
      className={`max-w-full overflow-x-auto rounded border border-violet-500/35 bg-black/55 px-0 py-1 font-mono text-[10px] leading-snug ${
        streaming ? 'ring-1 ring-cyan-500/25' : ''
      }`}
    >
      <div className="border-b border-tile-border/60 px-2 pb-1 text-[9px] font-semibold uppercase tracking-wide text-violet-300/90">
        Diff {streaming ? <span className="text-cyan-400/90">· streaming</span> : null}
      </div>
      <div className="max-h-64 overflow-y-auto px-1 py-0.5">
        {lines.map((line, i) => {
          const t = line.replace(/\r$/, '')
          let rowClass = 'text-gray-400/95'
          if (t.startsWith('+') && !t.startsWith('+++')) rowClass = 'bg-emerald-950/40 text-emerald-100/95'
          else if (t.startsWith('-') && !t.startsWith('---')) rowClass = 'bg-rose-950/35 text-rose-100/95'
          else if (t.startsWith('@@')) rowClass = 'bg-violet-950/50 text-violet-200/95'
          return (
            <div key={i} className={`whitespace-pre-wrap break-all px-1.5 py-[1px] ${rowClass}`}>
              {t || ' '}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AgentOutputStream({
  rawText,
  delegated,
  localEmpty,
  currentModelDisplayName,
}: Props) {
  const blocks = useMemo(() => {
    if (!rawText.trim()) return []
    return parseAgentOutputText(rawText)
  }, [rawText])

  if (delegated) {
    if (!rawText.trim()) {
      return (
        <div className="text-gray-600">
          <p>Sub-agent run starting…</p>
          <p className="mt-2 text-xs text-gray-500">Logs from the delegated session appear here.</p>
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-2">
        {blocks.map((b, i) => (
          <BlockRow key={`d-${i}-${b.kind}`} block={b} />
        ))}
      </div>
    )
  }

  if (localEmpty) {
    return (
      <div className="text-gray-600">
        <p>Ready to assist. Enter a task below.</p>
        {currentModelDisplayName ? (
          <p className="mt-2 text-xs">Model: {currentModelDisplayName}</p>
        ) : null}
        <p className="mt-2 text-xs text-gray-500">
          Canvas-wide orchestration uses the bottom bar. This tile is a separate agent session.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) => (
        <BlockRow key={`l-${i}-${b.kind}`} block={b} />
      ))}
    </div>
  )
}

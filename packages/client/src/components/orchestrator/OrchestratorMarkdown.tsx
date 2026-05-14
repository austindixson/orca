import { isValidElement, useEffect, useMemo, useRef, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { classifyUnifiedDiffLine, unifiedDiffRowClassNames } from './orchestratorDiffLineStyle'

function mdChildrenToString(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(mdChildrenToString).join('')
  if (isValidElement(children)) return mdChildrenToString(children.props?.children)
  if (children == null || children === false) return ''
  return String(children)
}

/** Unified diff / patch fences — green/red rows like the write preview cards. */
function MarkdownDiffFence({ raw }: { raw: string }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const lines = raw.replace(/\n$/, '').split('\n')

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    if (!stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [raw])

  return (
    <div
      data-orch-diff="1"
      ref={scrollerRef}
      onScroll={(e) => {
        const el = e.currentTarget
        const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight)
        stickToBottomRef.current = remaining < 24
      }}
      className="my-1.5 max-h-64 overflow-auto rounded-md border border-tile-border/60 bg-black/35 px-2 py-1.5"
    >
      <code className="block font-mono text-[10px] leading-relaxed">
        {lines.map((row, i) => {
          const kind = classifyUnifiedDiffLine(row)
          return (
            <div key={`d-${i}-${row.slice(0, 24)}`} className={unifiedDiffRowClassNames(kind)}>
              {row || '\u00a0'}
            </div>
          )
        })}
      </code>
    </div>
  )
}

function MarkdownAutoScrollPre({ children }: { children: ReactNode }) {
  const preRef = useRef<HTMLPreElement | null>(null)
  const stickToBottomRef = useRef(true)
  const contentKey = useMemo(() => mdChildrenToString(children), [children])

  useEffect(() => {
    const el = preRef.current
    if (!el) return
    if (!stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [contentKey])

  return (
    <pre
      ref={preRef}
      onScroll={(e) => {
        const el = e.currentTarget
        const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight)
        stickToBottomRef.current = remaining < 24
      }}
      className="my-1.5 max-h-52 overflow-auto rounded-md border border-tile-border/60 bg-black/30 px-2 py-1.5"
    >
      {children}
    </pre>
  )
}

/**
 * Renders orchestrator / agent chat text as Markdown (GFM tables, lists) with compact dark-UI styling.
 * Raw `##` / pipe tables in a narrow panel look broken without this.
 */
const mdComponents: Components = {
  h1: ({ children }) => (
    <h3 className="mb-1 mt-2 first:mt-0 text-[15px] font-semibold leading-snug text-gray-50">{children}</h3>
  ),
  h2: ({ children }) => (
    <h4 className="mb-1 mt-2 first:mt-0 text-[14px] font-semibold leading-snug text-gray-100">{children}</h4>
  ),
  h3: ({ children }) => (
    <h5 className="mb-1 mt-1.5 first:mt-0 text-[13px] font-semibold leading-snug text-gray-100/95">{children}</h5>
  ),
  h4: ({ children }) => (
    <h6 className="mb-0.5 mt-1.5 text-[12px] font-semibold text-gray-200/95">{children}</h6>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-snug text-gray-100/95">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-4 text-gray-200/90 marker:text-gray-500">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-4 text-gray-200/90 marker:text-gray-500">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-gray-50">{children}</strong>,
  em: ({ children }) => <em className="text-gray-200/95">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-teal/95 underline decoration-accent-teal/40 underline-offset-2 hover:text-accent-teal"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-2 border-0 border-t border-tile-border/50" />,
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-accent-teal/35 pl-2.5 text-gray-300/95">{children}</blockquote>
  ),
  code: ({ className, children }) => {
    const block = typeof className === 'string' && className.includes('language-')
    if (block) {
      const langMatch = /language-([A-Za-z0-9_+-]+)/.exec(className ?? '')
      const lang = langMatch?.[1]?.toLowerCase() ?? ''
      if (lang === 'diff' || lang === 'patch') {
        return <MarkdownDiffFence raw={mdChildrenToString(children)} />
      }
      return (
        <code
          className={`block whitespace-pre font-mono text-[11px] leading-relaxed text-cyan-100/95 ${className ?? ''}`}
        >
          {children}
        </code>
      )
    }
    return (
      <code className="rounded bg-black/45 px-1 py-0.5 font-mono text-[11px] text-cyan-100/90">{children}</code>
    )
  },
  pre: ({ children }) => {
    /** Avoid <pre><div/></pre>; our diff fence is a styled div. */
    if (isValidElement(children) && children.props?.['data-orch-diff'] === '1') {
      return <>{children}</>
    }
    return <MarkdownAutoScrollPre>{children}</MarkdownAutoScrollPre>
  },
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-tile-border/45 bg-black/25">
      <table className="w-full min-w-[12rem] border-collapse text-left text-[11px] leading-snug">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-tile-border/55 bg-black/20">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-tile-border/35">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-black/15">{children}</tr>,
  th: ({ children }) => (
    <th className="whitespace-nowrap px-2 py-1.5 font-medium text-gray-100">{children}</th>
  ),
  td: ({ children }) => <td className="px-2 py-1.5 text-gray-300/95">{children}</td>,
}

export function OrchestratorMarkdown({ content }: { content: string }) {
  return (
    <div className="orch-md text-[13px] leading-snug text-gray-100/95">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

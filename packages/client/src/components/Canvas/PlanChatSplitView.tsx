import clsx from 'clsx'
import { isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ORCA_TOOLBAR_TOP_FROM_BOTTOM_VAR } from '../../lib/orcaCanvasLayoutVars'
import * as tauri from '../../lib/tauri'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import { useTodoStore, type TodoStatus, type TodoTask } from '../../store/todoStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { OrchestratorPanel } from '../Sidebar/OrchestratorPanel'

/** Prefer agent canvas plan (Cursor-style living doc), then common fallbacks. */
const PLAN_SOURCE_FILES = [
  '.agent-canvas/plans/current-plan.md',
  '.cursor/plans/current-plan.md',
  'PLAN.md',
  'docs/PLAN.md',
  'orca.md',
] as const

const HERMES_PLAN_DIR = '.hermes/plans'

function isMarkdownPlanEntry(entry: { name: string; is_directory: boolean }): boolean {
  if (entry.is_directory) return false
  const n = entry.name.toLowerCase()
  return n.endsWith('.md')
}

async function findLatestHermesPlanPath(): Promise<string | null> {
  try {
    const entries = await tauri.readDirectory(HERMES_PLAN_DIR)
    const latest = entries
      .filter(isMarkdownPlanEntry)
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a))[0]
    if (!latest) return null
    return `${HERMES_PLAN_DIR}/${latest}`
  } catch {
    return null
  }
}

function shouldRefreshPlanFromToolLine(line: string): boolean {
  const t = line.trimStart()
  if (!t.startsWith('→') && !t.startsWith('←')) return false
  if (/^[→←]\s*(plan|todo)\b/i.test(t)) return true
  if (/\b\.agent-canvas\/plans\/current-plan\.md\b/i.test(t)) return true
  if (/\b\.hermes\/plans\//i.test(t)) return true
  return false
}

function labelForPlanToolLine(line: string): string | null {
  const t = line.trimStart()
  if (!t.startsWith('→') && !t.startsWith('←')) return null
  if (!/(plan|todo|write_file|read_file|search_files)/i.test(t)) return null
  if (t.length <= 120) return t
  return `${t.slice(0, 119)}…`
}

const planDocComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-6 border-b border-tile-border/40 pb-2 text-lg font-semibold tracking-tight text-gray-50 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 text-[15px] font-semibold text-gray-100 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-[13px] font-semibold text-gray-100/95">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-2 text-xs font-semibold text-gray-200">{children}</h4>
  ),
  p: ({ children }) => <p className="mb-2 text-[12px] leading-relaxed text-gray-200/95">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-0.5 pl-4 text-[12px] text-gray-200/90 marker:text-teal-500/80">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-0.5 pl-4 text-[12px] text-gray-200/90 marker:text-gray-500">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
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
  hr: () => <hr className="my-4 border-0 border-t border-tile-border/50" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-teal-500/40 bg-black/20 py-1 pl-2.5 text-[12px] text-gray-300/95">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const block = typeof className === 'string' && className.includes('language-')
    if (block) {
      return (
        <code
          className={`my-1.5 block overflow-x-auto rounded-md border border-tile-border/50 bg-black/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-cyan-100/95 ${className ?? ''}`}
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
    if (isValidElement(children) && children.props?.['data-orch-diff'] === '1') {
      return <>{children}</>
    }
    return (
      <pre className="my-2 overflow-x-auto rounded-md border border-tile-border/55 bg-black/35 p-2">{children}</pre>
    )
  },
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-md border border-tile-border/45 bg-black/25">
      <table className="w-full min-w-[14rem] border-collapse text-left text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-tile-border/55 bg-black/25">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-tile-border/30">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-black/15">{children}</tr>,
  th: ({ children }) => <th className="whitespace-nowrap px-2 py-1.5 font-medium text-gray-100">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1.5 text-gray-300/95">{children}</td>,
}

const PLAN_PLACEHOLDER = `# Project plan

This panel shows your **living project document** — the same idea as Cursor plan files: phases, tasks, and status at a glance.

## Add a plan

Create one of these in your workspace root (first match wins):

${PLAN_SOURCE_FILES.map((f) => `- \`${f}\``).join('\n')}

The orchestrator can update \`.agent-canvas/plans/current-plan.md\` while you work. Use **Refresh** after editing the file on disk.
`

function statusOrder(s: TodoStatus): number {
  if (s === 'in_progress') return 0
  if (s === 'pending') return 1
  if (s === 'failed') return 2
  if (s === 'completed') return 3
  return 4
}

function TodoStatusGlyph({ status, active }: { status: TodoStatus; active: boolean }) {
  if (status === 'completed') {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] text-emerald-300">
        ✓
      </span>
    )
  }
  if (status === 'in_progress' || (status === 'pending' && active)) {
    return (
      <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-teal-400/35 border-t-teal-400 animate-spin" />
    )
  }
  if (status === 'failed') {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-[10px] text-rose-300">
        !
      </span>
    )
  }
  return <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-gray-500/50 bg-black/20" />
}

export function PlanChatSplitView() {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel)

  const tasks = useTodoStore((s) => s.tasks)
  const addTask = useTodoStore((s) => s.addTask)
  const setTaskStatus = useTodoStore((s) => s.setTaskStatus)

  const running = useOrchestratorSessionStore((s) => s.running)
  const planningDraft = useOrchestratorSessionStore((s) => s.planningDraft)
  const autoFocusHighlight = useOrchestratorActivityStore((s) => s.autoFocusHighlight)
  const agentTileFocus = useOrchestratorActivityStore((s) => s.agentTileFocus)
  const toolFeed = useOrchestratorActivityStore((s) => s.toolFeed)

  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState<string>(PLAN_PLACEHOLDER)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastToolFeedCountRef = useRef(0)

  const loadPlan = useCallback(async () => {
    if (!rootPath) {
      setMarkdown(PLAN_PLACEHOLDER)
      setSourcePath(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const latestHermesPlan = await findLatestHermesPlanPath()
      const candidates = latestHermesPlan
        ? ([PLAN_SOURCE_FILES[0], latestHermesPlan, ...PLAN_SOURCE_FILES.slice(1)] as const)
        : PLAN_SOURCE_FILES
      let found: string | null = null
      let text: string | null = null
      for (const rel of candidates) {
        try {
          const body = await tauri.readFile(rel)
          found = rel
          text = body
          break
        } catch {
          /* try next */
        }
      }
      if (text != null && found) {
        setSourcePath(found)
        setMarkdown(text)
      } else {
        setSourcePath(null)
        setMarkdown(PLAN_PLACEHOLDER)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load plan')
      setSourcePath(null)
      setMarkdown(PLAN_PLACEHOLDER)
    } finally {
      setLoading(false)
    }
  }, [rootPath])

  useEffect(() => {
    void loadPlan()
  }, [loadPlan])

  useEffect(() => {
    if (!rootPath) return
    const start = Math.min(lastToolFeedCountRef.current, toolFeed.length)
    const fresh = toolFeed.slice(start)
    lastToolFeedCountRef.current = toolFeed.length
    if (fresh.length === 0) return
    const shouldReload = fresh.some((line) => shouldRefreshPlanFromToolLine(line))
    if (!shouldReload) return
    void loadPlan()
  }, [toolFeed, loadPlan, rootPath])

  const rootTodos = useMemo(() => {
    const list = tasks.filter((t) => !t.parentId)
    return [...list].sort((a, b) => {
      const o = statusOrder(a.status) - statusOrder(b.status)
      if (o !== 0) return o
      return b.updatedAt - a.updatedAt
    })
  }, [tasks])

  const visibleTodos = rootTodos.slice(0, 24)
  const todoOverflow = rootTodos.length - visibleTodos.length

  const contextRefs = useMemo(() => {
    const out: { id: string; label: string; active: boolean }[] = []
    const seenLabels = new Set<string>()
    const seenTileIds = new Set<string>()
    const push = (id: string, label: string, active: boolean) => {
      const tid = id.trim()
      const k = label.trim()
      if (!tid || !k || seenLabels.has(k) || seenTileIds.has(tid)) return
      seenLabels.add(k)
      seenTileIds.add(tid)
      out.push({ id: tid, label: k, active })
    }
    if (planningDraft?.title?.trim()) {
      push(
        'planning-draft',
        planningDraft.title.trim(),
        running && planningDraft.phase === 'streaming'
      )
    }
    if (autoFocusHighlight?.label) {
      push(autoFocusHighlight.tileId, autoFocusHighlight.label, running)
    }
    if (agentTileFocus) {
      const bits = [
        agentTileFocus.action,
        agentTileFocus.tileType,
        agentTileFocus.detail ? agentTileFocus.detail : null,
      ].filter(Boolean)
      push(agentTileFocus.tileId, bits.join(' · '), running)
    }
    const recentPlanToolLines = toolFeed
      .slice(-60)
      .map((line) => labelForPlanToolLine(line))
      .filter((line): line is string => Boolean(line))
      .slice(-8)
    recentPlanToolLines.forEach((label, idx) => {
      push(`plan-tool-${idx}`, label, running && label.startsWith('→'))
    })
    return out
  }, [planningDraft, autoFocusHighlight, agentTileFocus, running, toolFeed])

  const toggleTodo = useCallback(
    (t: TodoTask) => {
      if (t.status === 'completed') setTaskStatus(t.id, 'pending')
      else if (t.status === 'pending') setTaskStatus(t.id, 'completed')
      else if (t.status === 'in_progress') setTaskStatus(t.id, 'completed')
      else if (t.status === 'failed') setTaskStatus(t.id, 'pending')
    },
    [setTaskStatus]
  )

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-[15] flex min-h-0 min-w-0 bg-[#0d0d0d]"
      style={{
        /** Reserve space for the bottom canvas toolbar (Ask / view modes / zoom) so the plan + chat columns are not covered. Matches `--orca-toolbar-top-from-bottom` from CanvasToolbar. */
        paddingBottom: `calc(var(${ORCA_TOOLBAR_TOP_FROM_BOTTOM_VAR}, 5.75rem) + 0.75rem)`,
      }}
    >
      <div
        data-orca-plan-document
        className="flex min-h-0 w-1/2 min-w-0 flex-col border-r border-white/[0.08] bg-[#111111]"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {error && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90">
              {error}
            </div>
          )}

          {/* Plan document (first) */}
          <section className="mb-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Plan document
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-[10px] text-gray-500"
                  data-tooltip={sourcePath ?? ''}
                >
                  {sourcePath ?? 'Plan markdown · pick a file from the list below'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadPlan()}
                disabled={loading || !rootPath}
                className="shrink-0 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-gray-300 transition-colors hover:border-teal-500/35 hover:bg-teal-500/10 hover:text-gray-100 disabled:opacity-40"
              >
                {loading ? '…' : 'Refresh'}
              </button>
            </div>
            <article className="plan-doc-prose rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3 text-gray-100/95">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={planDocComponents}>
                {markdown}
              </ReactMarkdown>
            </article>
          </section>

          {/* Referenced / in context */}
          <section className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-gray-200">In context</span>
              <span className="text-[10px] text-gray-500">
                {contextRefs.length ? `${contextRefs.length} active` : 'Idle'}
              </span>
            </div>
            {contextRefs.length === 0 ? (
              <p className="text-[11px] text-gray-500">
                When the orchestrator reads files, plans, or focuses a tile, it shows up here (like
                Cursor’s referenced block).
              </p>
            ) : (
              <ul className="space-y-1">
                {contextRefs.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start gap-2 rounded-md py-1 text-[12px] text-gray-200/90"
                  >
                    {r.active ? (
                      <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-teal-400/35 border-t-teal-400 animate-spin" />
                    ) : (
                      <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-gray-600/60" />
                    )}
                    <span className="min-w-0 leading-snug">{r.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* To-dos (last) */}
          <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-gray-200">
                {rootTodos.length} To-do{rootTodos.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => {
                  addTask('New task')
                  setActivePanel('tasks')
                }}
                className="rounded-md border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-medium text-gray-300 hover:border-teal-500/30 hover:text-teal-200/95"
              >
                + New
              </button>
            </div>
            {visibleTodos.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-gray-500">
                No tasks yet. Add one here or from the orchestrator run — open the{' '}
                <button
                  type="button"
                  className="text-teal-400/90 underline decoration-teal-500/30 underline-offset-2"
                  onClick={() => setActivePanel('tasks')}
                >
                  Tasks
                </button>{' '}
                sidebar for the full list.
              </p>
            ) : (
              <ul className="space-y-0">
                {visibleTodos.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => toggleTodo(t)}
                      className="flex w-full items-start gap-2 rounded-md py-1.5 text-left transition-colors hover:bg-white/[0.04]"
                    >
                      <TodoStatusGlyph status={t.status} active={running && t.status === 'in_progress'} />
                      <span
                        className={clsx(
                          'min-w-0 flex-1 text-[12px] leading-snug text-gray-200/95',
                          t.status === 'completed' && 'text-gray-500 line-through'
                        )}
                      >
                        {t.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {todoOverflow > 0 ? (
              <button
                type="button"
                onClick={() => setActivePanel('tasks')}
                className="mt-1 text-[10px] text-teal-400/85 hover:underline"
              >
                +{todoOverflow} more in Tasks…
              </button>
            ) : null}
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.06] bg-black/40 px-4 py-2">
          <button
            type="button"
            onClick={() => setActivePanel('tasks')}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-gray-300 hover:bg-white/[0.08]"
          >
            Tasks
          </button>
          <button
            type="button"
            onClick={() => setActivePanel('explorer')}
            className="rounded-lg border border-teal-500/35 bg-teal-500/15 px-3 py-1.5 text-[11px] font-medium text-teal-100/95 hover:bg-teal-500/25"
          >
            Files
          </button>
        </div>
      </div>

      <div className="flex min-h-0 w-1/2 min-w-0 flex-col border-l border-white/[0.06] bg-[#0f0f0f]">
        <div className="shrink-0 border-b border-white/[0.06] bg-black/30 px-3 py-2">
          <span className="text-[11px] font-semibold text-gray-300">Orchestrator</span>
          <span className="ml-2 text-[10px] text-gray-500">Chat · tools · diffs</span>
        </div>
        <div className="min-h-0 flex-1">
          <OrchestratorPanel variant="planWorkspace" />
        </div>
      </div>
    </div>
  )
}

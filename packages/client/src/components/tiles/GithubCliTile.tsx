import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { useCanvasStore } from '../../store/canvasStore'
import { splitGhCliArgs } from '../../lib/githubCliArgs'
import { runGhCli, isTauri, type GhCliResult } from '../../lib/tauri'

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'error'

const PRESETS: { label: string; args: string }[] = [
  {
    label: 'My repos',
    args: 'repo list --limit 20 --json name,description,url,isPrivate,pushedAt',
  },
  {
    label: 'Search repos',
    args: 'search repos --limit 8 --json name,description,url,stargazersCount ',
  },
  {
    label: 'Search issues',
    args: 'search issues --limit 8 --json title,url,repository,state ',
  },
  {
    label: 'Search code',
    args: 'search code --limit 6 ',
  },
  {
    label: 'Auth status',
    args: 'auth status',
  },
  {
    label: 'Current user (API)',
    args: 'api user',
  },
]

function linkifyText(text: string): React.ReactNode {
  const urlRe = /(https?:\/\/[^\s<>"']+)/g
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(text.slice(last, m.index))
    }
    const href = m[1]
    parts.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-sky-400 underline decoration-sky-500/50 hover:text-sky-300"
      >
        {href}
      </a>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : text
}

function jsonRenderedAsTable(stdout: string): boolean {
  const t = stdout.trim()
  if (!t) return false
  try {
    const d = JSON.parse(t) as unknown
    if (
      Array.isArray(d) &&
      d.length > 0 &&
      d.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))
    ) {
      return true
    }
    if (d !== null && typeof d === 'object' && !Array.isArray(d)) {
      return true
    }
  } catch {
    return false
  }
  return false
}

function JsonView({ raw }: { raw: string }) {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null
  let data: unknown
  try {
    data = JSON.parse(trimmed) as unknown
  } catch {
    return null
  }

  if (Array.isArray(data) && data.length > 0 && data.every((r) => r !== null && typeof r === 'object')) {
    const rows = data as Record<string, unknown>[]
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 12)
    return (
      <div className="overflow-auto rounded border border-tile-border/60 bg-black/25">
        <table className="w-full min-w-[280px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-tile-border/50 bg-black/30 text-gray-400">
              {keys.map((k) => (
                <th key={k} className="px-2 py-1.5 font-medium">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((row, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03]">
                {keys.map((k) => (
                  <td key={k} className="max-w-[220px] whitespace-pre-wrap break-words px-2 py-1.5 text-gray-200">
                    {formatCell(row[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 40 && (
          <div className="border-t border-tile-border/40 px-2 py-1 text-[10px] text-gray-500">
            Showing 40 of {rows.length} rows — open raw for full output.
          </div>
        )}
      </div>
    )
  }

  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const o = data as Record<string, unknown>
    const keys = Object.keys(o).slice(0, 24)
    return (
      <dl className="space-y-1 rounded border border-tile-border/60 bg-black/25 p-2 text-[11px]">
        {keys.map((k) => (
          <div key={k} className="grid gap-1 sm:grid-cols-[minmax(0,8rem)_1fr]">
            <dt className="font-mono text-gray-500">{k}</dt>
            <dd className="whitespace-pre-wrap break-words text-gray-200">{formatCell(o[k])}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return null
}

function formatCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return linkifyText(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return (
      <span className="font-mono text-[10px] text-gray-400">
        {JSON.stringify(v, null, 0).slice(0, 400)}
      </span>
    )
  } catch {
    return String(v)
  }
}

export function GithubCliTile({ data }: TileComponentProps) {
  const updateTile = useCanvasStore((s) => s.updateTile)
  const initialArgs =
    typeof data.meta?.ghArgs === 'string' ? (data.meta.ghArgs as string) : PRESETS[0].args

  const [argsLine, setArgsLine] = useState(initialArgs)
  const [result, setResult] = useState<GhCliResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')

  // Track which ghArgs value we've auto-run for (to avoid re-running on same value)
  const autoRanForArgs = useRef<string | null>(null)

  const checkAuth = useCallback(async () => {
    if (!isTauri()) {
      setAuthStatus('error')
      return
    }
    setAuthStatus('checking')
    try {
      const out = await runGhCli(['auth', 'status'])
      if (!out) {
        setAuthStatus('error')
        return
      }
      // exit_code 0 means authenticated
      if (out.exit_code === 0) {
        setAuthStatus('authenticated')
      } else {
        setAuthStatus('unauthenticated')
      }
    } catch {
      setAuthStatus('error')
    }
  }, [])

  // Check gh auth status on mount
  useEffect(() => {
    void checkAuth()
  }, [checkAuth])

  useEffect(() => {
    if (typeof data.meta?.ghArgs === 'string') {
      setArgsLine(data.meta.ghArgs as string)
    }
  }, [data.id, data.meta?.ghArgs])

  const showPlainOutput = useMemo(() => {
    if (!result) return false
    if (!result.stdout.trim()) return false
    if (jsonRenderedAsTable(result.stdout)) return false
    return true
  }, [result])

  const run = useCallback(async () => {
    if (!isTauri()) {
      const cmd = argsLine.trim() || 'repo list'
      setError(`GitHub CLI requires the desktop app. Run this command instead:\n\ngh ${cmd}`)
      return
    }
    if (authStatus === 'unauthenticated') {
      setError('You need to authenticate first. Run: gh auth login')
      return
    }
    if (authStatus === 'checking') {
      setError('Still checking authentication status...')
      return
    }
    const argv = splitGhCliArgs(argsLine.trim())
    if (argv.length === 0) {
      setError('Enter arguments after gh (e.g. search repos react --limit 5 --json name,url).')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    updateTile(data.id, { meta: { ...data.meta, ghArgs: argsLine } })
    try {
      const out = await runGhCli(argv)
      if (!out) {
        setError('Could not run gh (desktop only).')
        return
      }
      setResult(out)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Failed to run gh')
    } finally {
      setLoading(false)
    }
  }, [argsLine, data.id, data.meta, updateTile, authStatus])

  // Auto-run when tile is created with ghArgs (orchestrator flow)
  // Only runs after auth is confirmed, and only once per unique ghArgs value
  useEffect(() => {
    if (!isTauri()) return
    if (authStatus !== 'authenticated') return
    const ghArgs = data.meta?.ghArgs
    if (typeof ghArgs !== 'string' || !ghArgs.trim()) return
    // Skip if we already ran for this exact ghArgs
    if (autoRanForArgs.current === ghArgs) return
    autoRanForArgs.current = ghArgs
    // Small delay to let the tile render first, then run directly
    const t = setTimeout(async () => {
      const argv = splitGhCliArgs(ghArgs.trim())
      if (argv.length === 0) return
      setLoading(true)
      setError(null)
      setResult(null)
      try {
        const out = await runGhCli(argv)
        if (!out) {
          setError('Could not run gh (desktop only).')
          return
        }
        setResult(out)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg || 'Failed to run gh')
      } finally {
        setLoading(false)
      }
    }, 150)
    return () => clearTimeout(t)
  }, [data.meta?.ghArgs, authStatus])

  return (
    <div className="flex h-full w-full min-h-0 flex-col bg-canvas-bg/70">
      <div className="shrink-0 border-b border-tile-border/60 px-3 py-2">
        <p className="mb-2 text-[11px] leading-snug text-gray-500">
          Runs the real <span className="font-mono text-gray-400">gh</span> from your workspace (no iframe). Use{' '}
          <span className="text-gray-400">--json</span> for structured tables.
        </p>
        <div className="mb-2 flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setArgsLine(p.args)
                setError(null)
              }}
              className="rounded border border-tile-border/70 bg-black/20 px-2 py-0.5 text-[10px] text-gray-400 hover:border-sky-500/40 hover:text-gray-200"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <span className="shrink-0 rounded border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-sky-400/90">
            gh
          </span>
          <input
            type="text"
            value={argsLine}
            onChange={(e) => setArgsLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run()
            }}
            placeholder='search repos vite --limit 5 --json name,url'
            className="min-w-0 flex-1 rounded border border-tile-border bg-black/30 px-2 py-1.5 font-mono text-[11px] text-gray-200 placeholder:text-gray-600 focus:border-sky-500/50 focus:outline-none"
            spellCheck={false}
            autoComplete="off"
            aria-label="GitHub CLI arguments"
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || authStatus !== 'authenticated'}
            className="shrink-0 rounded border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-[11px] font-medium text-sky-100 hover:bg-sky-500/25 disabled:opacity-50"
          >
            {loading ? '…' : 'Run'}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-gray-600">⌘↵ Run · Install: brew install gh · gh auth login</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
        {!isTauri() && !result && !error && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="mb-2 font-medium text-amber-100">Desktop App Required</p>
            <p className="mb-2 text-gray-300">GitHub CLI integration requires the desktop app.</p>
            <div className="rounded border border-black/30 bg-black/30 p-2">
              <p className="mb-1 text-[10px] text-gray-400">Run this command in your terminal:</p>
              <code className="block break-all rounded bg-black/50 px-2 py-1 font-mono text-[11px] text-green-300">
                gh {argsLine.trim()}
              </code>
            </div>
            <p className="mt-2 text-[10px] text-gray-400">Or download the desktop app for full GitHub integration.</p>
          </div>
        )}
        {isTauri() && authStatus === 'checking' && !result && !error && (
          <div className="flex items-center gap-2 text-gray-400">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
            Checking GitHub CLI authentication...
          </div>
        )}
        {isTauri() && authStatus === 'unauthenticated' && !result && !error && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="mb-2 font-medium text-amber-100">GitHub CLI Not Authenticated</p>
            <p className="mb-2 text-gray-300">You need to authenticate before using GitHub CLI commands.</p>
            <div className="rounded border border-black/30 bg-black/30 p-2">
              <p className="mb-1 text-[10px] text-gray-400">Run this command in your terminal:</p>
              <code className="block break-all rounded bg-black/50 px-2 py-1 font-mono text-[11px] text-green-300">
                gh auth login
              </code>
            </div>
            <button
              type="button"
              onClick={() => void checkAuth()}
              className="mt-3 rounded border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-[11px] font-medium text-sky-100 hover:bg-sky-500/25"
            >
              Check again
            </button>
          </div>
        )}
        {error && (
          <div className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-red-200/90">
            <p className="mb-1 font-medium">Error</p>
            <p className="whitespace-pre-wrap break-words">{error}</p>
            {error.includes('desktop app') && (
              <div className="mt-2 rounded border border-black/30 bg-black/30 p-2">
                <p className="mb-1 text-[10px] text-gray-400">Run this command instead:</p>
                <code className="block break-all rounded bg-black/50 px-2 py-1 font-mono text-[11px] text-green-300">
                  gh {argsLine.trim()}
                </code>
              </div>
            )}
          </div>
        )}
        {result && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
            <span>
              exit <span className="font-mono text-gray-400">{result.exit_code}</span>
            </span>
            {result.stderr ? <span className="text-amber-400/90">stderr present</span> : null}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(result.stdout + (result.stderr ? `\n${result.stderr}` : ''))
              }}
              className="rounded border border-tile-border px-1.5 py-0.5 text-gray-400 hover:text-gray-200"
            >
              Copy output
            </button>
          </div>
        )}
        {result ? <JsonView raw={result.stdout} /> : null}
        {result?.stderr ? (
          <pre className="mt-2 whitespace-pre-wrap break-words rounded border border-amber-500/20 bg-amber-500/5 p-2 font-mono text-[11px] text-amber-100/90">
            {result.stderr}
          </pre>
        ) : null}
        {result && showPlainOutput ? (
          <div className="mt-2 whitespace-pre-wrap break-words rounded border border-tile-border/50 bg-black/30 p-2 font-mono text-[11px] text-gray-300">
            {linkifyText(result.stdout)}
          </div>
        ) : null}
        {isTauri() && authStatus === 'authenticated' && !result && !error && !loading && (
          <p className="text-gray-500">Run a search or preset — results render as tables when output is JSON.</p>
        )}
      </div>
    </div>
  )
}

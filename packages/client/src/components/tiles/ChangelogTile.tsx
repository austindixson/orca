import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { getGitChangelogSnapshot, type GitChangelogSnapshot } from '../../lib/tauri'
import { useSettingsStore } from '../../store/settingsStore'
import { REFRESH_CHANGELOG_EVENT } from '../../lib/uiEvents'

function relativeAge(ms: number): string {
  const deltaSec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (deltaSec < 5) return 'just now'
  if (deltaSec < 60) return `${deltaSec}s ago`
  const min = Math.floor(deltaSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  return `${hr}h ago`
}

export function ChangelogTile({ data }: TileComponentProps) {
  const changelogAutomationEnabled = useSettingsStore((s) => s.changelogAutomationEnabled)
  const [snapshot, setSnapshot] = useState<GitChangelogSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Must not live in `refresh` deps — it would change after every fetch and retrigger the mount effect (infinite loop + stuck loading). */
  const snapshotRef = useRef<GitChangelogSnapshot | null>(null)
  snapshotRef.current = snapshot

  const fetchGenerationRef = useRef(0)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false
    const gen = ++fetchGenerationRef.current

    if (!silent || snapshotRef.current == null) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      const next = await getGitChangelogSnapshot()
      if (gen !== fetchGenerationRef.current) return
      setSnapshot(next)
      setError(null)
    } catch (e) {
      if (gen !== fetchGenerationRef.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Failed to load changelog')
    } finally {
      if (gen === fetchGenerationRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void refresh({ silent: false })
  }, [refresh, data.id])

  useEffect(() => {
    if (!changelogAutomationEnabled) return
    const onRefresh = () => {
      void refresh({ silent: true })
    }
    window.addEventListener(REFRESH_CHANGELOG_EVENT, onRefresh)
    return () => window.removeEventListener(REFRESH_CHANGELOG_EVENT, onRefresh)
  }, [changelogAutomationEnabled, refresh])

  const changedPreview = useMemo(() => (snapshot?.changed_files ?? []).slice(0, 10), [snapshot])

  return (
    <div className="h-full w-full overflow-auto bg-canvas-bg/70 p-3 text-xs text-gray-300">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-100">Auto changelog</div>
          <div className="truncate text-[11px] text-gray-500">
            {snapshot?.generated_at_ms ? `Updated ${relativeAge(snapshot.generated_at_ms)}` : 'No snapshot yet'}
          </div>
        </div>
        {refreshing && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent-teal/80 shadow-[0_0_8px_rgba(var(--accent-teal-rgb),0.7)]" data-tooltip="Refreshing" />
        )}
        <button
          type="button"
          onClick={() => void refresh({ silent: true })}
          className="rounded border border-tile-border px-2 py-1 text-[11px] text-gray-300 hover:border-accent-teal/40 hover:text-white"
        >
          Refresh
        </button>
      </div>

      <div className="mb-3 rounded border border-tile-border/70 bg-black/20 p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-gray-400">Automation</span>
          <span className={changelogAutomationEnabled ? 'text-accent-teal' : 'text-gray-500'}>
            {changelogAutomationEnabled ? 'On' : 'Off'}
          </span>
        </div>
        <div className="text-[11px] text-gray-500">
          {changelogAutomationEnabled
            ? 'Event-driven (orchestrator/agent/file writes)'
            : 'Enable in Settings > Themes'}
        </div>
      </div>

      {loading && <div className="text-gray-500">Loading changelog...</div>}
      {!loading && error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-red-300">{error}</div>
      )}

      {!loading && !error && snapshot == null && (
        <div className="rounded border border-tile-border/70 bg-black/20 p-2 text-gray-400">
          Changelog snapshot is unavailable in this environment. Open the desktop app and select a workspace folder.
        </div>
      )}

      {!loading && !error && snapshot && (
        <div className="space-y-3">
          {!snapshot.is_repo ? (
            <div className="rounded border border-tile-border/70 bg-black/20 p-2 text-gray-400">
              {snapshot.summary}
            </div>
          ) : (
            <>
              <div className="rounded border border-tile-border/70 bg-black/20 p-2">
                <div className="text-gray-100">{snapshot.summary}</div>
                <div className="mt-1 text-[11px] text-gray-500">
                  Branch: {snapshot.branch ?? 'detached'}
                  {snapshot.upstream ? ` -> ${snapshot.upstream}` : ''}
                </div>
              </div>

              <div className="rounded border border-tile-border/70 bg-black/20 p-2">
                <div className="mb-1 text-gray-400">Changed files</div>
                {changedPreview.length === 0 ? (
                  <div className="text-gray-500">Working tree clean</div>
                ) : (
                  <div className="space-y-1">
                    {changedPreview.map((f) => (
                      <div key={`${f.xy}-${f.path}`} className="flex items-center gap-2">
                        <code className="rounded bg-black/30 px-1 py-0.5 text-[10px] text-accent-teal">{f.xy}</code>
                        <span className="truncate text-gray-300">{f.path}</span>
                      </div>
                    ))}
                    {snapshot.changed_files.length > changedPreview.length && (
                      <div className="text-[11px] text-gray-500">
                        +{snapshot.changed_files.length - changedPreview.length} more...
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded border border-tile-border/70 bg-black/20 p-2">
                <div className="mb-1 text-gray-400">Push prep</div>
                <div className="space-y-1">
                  {snapshot.next_steps.map((step, i) => (
                    <div key={`${step}-${i}`} className="truncate text-gray-300">
                      {i + 1}. <code className="text-[11px] text-gray-200">{step}</code>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

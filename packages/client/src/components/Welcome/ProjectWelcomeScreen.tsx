import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import * as tauri from '../../lib/tauri'
import { getRecentProjects, removeRecentProject, type RecentProject } from '../../lib/recentProjects'
import {
  type OrcaIncompleteSession,
  formatSessionUpdatedAt,
} from '../../lib/persistence/orcaIncompleteSession'
import { resetOrcaSessionId } from '../../lib/persistence/orcaSessionId'
import {
  clearConversationSessionKeyOverride,
  getDefaultSessionId,
  pinOrchestratorWorkspaceKeyForSession,
  setConversationSessionKeyOverride,
} from '../../lib/persistence/sessionPersistence'
import { loadTasks, loadTasksForWorkspace } from '../../lib/persistence/taskPersistence'
import { pruneOrchestratorTodoNoise } from '../../lib/orchestrator/todoTaskQuality'
import { reconcileStaleDelegatedTasks } from '../../lib/orchestrator/todoResumeReconciliation'
import { maybeShowResumePromptOnOpen } from '../../lib/orchestrator/resumePromptOnOpen'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import { useTodoStore } from '../../store/todoStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useToastStore } from '../../store/toastStore'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'

/** Last segment of a workspace path for display (e.g. `/a/b/MyProject` → `MyProject`). */
function workspaceRootFolderName(path: string | undefined | null): string {
  if (path == null || !String(path).trim()) return 'Unknown workspace'
  const n = String(path).replace(/\\/g, '/').replace(/\/+$/g, '')
  const i = n.lastIndexOf('/')
  const base = i >= 0 ? n.slice(i + 1) : n
  return base.trim() || n || 'Unknown workspace'
}

function normalizeWorkspacePath(path: string | undefined | null): string {
  if (!path) return ''
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').trim()
}

function stripWelcomeFromUrl(): void {
  try {
    const u = new URL(window.location.href)
    u.searchParams.delete('welcome')
    const next = u.pathname + u.search + u.hash
    window.history.replaceState({}, '', next)
  } catch {
    /* ignore */
  }
}

export function ProjectWelcomeScreen({ onDismiss }: { onDismiss: () => void }) {
  const openFolder = useWorkspaceStore((s) => s.openFolder)
  const setRootPath = useWorkspaceStore((s) => s.setRootPath)
  const createEmptyProjectInParent = useWorkspaceStore((s) => s.createEmptyProjectInParent)
  const addToast = useToastStore((s) => s.addToast)

  const [recents, setRecents] = useState<RecentProject[]>(() => getRecentProjects())
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [folderName, setFolderName] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionMetas, setSessionMetas] = useState<OrcaIncompleteSession[]>([])
  const [resumeLoading, setResumeLoading] = useState(true)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [resumeDismissed, setResumeDismissed] = useState(false)

  const refreshRecents = useCallback(() => setRecents(getRecentProjects()), [])

  const startFreshSessionContext = useCallback(async () => {
    pinOrchestratorWorkspaceKeyForSession(null)
    clearConversationSessionKeyOverride()
    resetOrcaSessionId()
    const sid = getDefaultSessionId()
    await useOrchestratorSessionStore.getState().loadSession(sid)
    useTodoStore.getState().replaceTasks([])
  }, [])

  /** Refresh incomplete-session list (desktop) and prompt. */
  const refreshResumeMetasAndPrompt = useCallback(async () => {
    if (!tauri.isTauri()) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const latest = (await invoke<OrcaIncompleteSession[]>('orca_list_incomplete_sessions')) ?? []
      setSessionMetas(latest)
    } catch {
      /* keep last snapshot */
    }
    maybeShowResumePromptOnOpen()
  }, [])

  const findResumeSessionIdForPath = useCallback(
    (pickedPath: string) => {
      const normalizedTarget = normalizeWorkspacePath(pickedPath)
      const known = sessionMetas
        .filter((s) => normalizeWorkspacePath(s.workspaceRoot) === normalizedTarget)
        .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
      return known[0]?.sessionId ?? null
    },
    [sessionMetas]
  )

  useEffect(() => {
    if (!tauri.isTauri()) {
      setResumeLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const list = (await invoke<OrcaIncompleteSession[]>('orca_list_incomplete_sessions')) ?? []
        if (cancelled) return
        setSessionMetas(list)
      } catch {
        if (!cancelled) setSessionMetas([])
      } finally {
        if (!cancelled) setResumeLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const resumeUnfinishedSession = useCallback(
    async (s: OrcaIncompleteSession) => {
      setBusy(true)
      setResumeError(null)
      try {
        const sid = s.sessionId.trim()
        const root = s.workspaceRoot?.trim()
        if (root) {
          try {
            await setRootPath(root, {
              orchestratorSessionPolicy: 'follow-workspace',
              resumeSessionId: sid,
            })
          } catch {
            addToast({
              type: 'warning',
              title: 'Could not open saved folder',
              message: 'Orchestrator history was restored. Use Open folder if you need the project on disk.',
            })
          }
        } else {
          pinOrchestratorWorkspaceKeyForSession(null)
          setConversationSessionKeyOverride(sid)
          await useOrchestratorSessionStore.getState().loadSession(sid)
        }
        const tasks = root ? await loadTasksForWorkspace(root) : await loadTasks(s.sessionId)
        const { cleaned } = pruneOrchestratorTodoNoise(tasks)
        const hasLiveAgentRoster =
          Object.keys(useAgentTeamStore.getState().membersByTileId).length > 0
        const { tasks: reconciled, touchedCount } = reconcileStaleDelegatedTasks(cleaned, {
          hasLiveAgentRoster,
        })
        useTodoStore.getState().replaceTasks(reconciled)
        if (touchedCount > 0) {
          useOrchestratorActivityStore
            .getState()
            .appendActivityLine(
              `[Resume] Cleared stale sub-agent assignments from ${touchedCount} task row${touchedCount === 1 ? '' : 's'} (delegated tiles are not restored after restart).`
            )
        }
        stripWelcomeFromUrl()
        onDismiss()
      } catch (e) {
        setResumeError(e instanceof Error ? e.message : 'Could not resume session')
      } finally {
        setBusy(false)
      }
    },
    [addToast, onDismiss, setRootPath]
  )

  /** Do not filter out the persisted session id: it usually matches the last incomplete run, and excluding it hid the whole resume section. */
  const showResumeCard =
    !resumeLoading && !resumeDismissed && sessionMetas.some((s) => s.incomplete)
  const incompleteSessions = useMemo(
    () => sessionMetas.filter((s) => s.incomplete),
    [sessionMetas]
  )

  const openRecent = useCallback(
    async (p: RecentProject) => {
      setBusy(true)
      try {
        const resumeId = findResumeSessionIdForPath(p.path)?.trim() || null
        if (!tauri.isTauri()) {
          await setRootPath(p.path, { orchestratorSessionPolicy: 'follow-workspace' })
          maybeShowResumePromptOnOpen()
        } else {
          await setRootPath(p.path, {
            orchestratorSessionPolicy: 'follow-workspace',
            resumeSessionId: resumeId,
          })
          await refreshResumeMetasAndPrompt()
        }
        stripWelcomeFromUrl()
        onDismiss()
      } catch (e) {
        addToast({
          type: 'error',
          title: 'Could not open project',
          message: e instanceof Error ? e.message : 'Path may have moved or been removed.',
        })
      } finally {
        setBusy(false)
      }
    },
    [addToast, findResumeSessionIdForPath, onDismiss, refreshResumeMetasAndPrompt, setRootPath]
  )

  const handleOpenFolder = useCallback(async () => {
    setBusy(true)
    try {
      const opened = await openFolder(findResumeSessionIdForPath)
      if (opened) {
        const path = useWorkspaceStore.getState().rootPath
        if (path && path !== '.') {
          if (tauri.isTauri()) {
            await refreshResumeMetasAndPrompt()
          } else {
            maybeShowResumePromptOnOpen()
          }
        } else {
          await startFreshSessionContext()
        }
        stripWelcomeFromUrl()
        onDismiss()
      }
    } finally {
      setBusy(false)
    }
  }, [findResumeSessionIdForPath, openFolder, onDismiss, refreshResumeMetasAndPrompt, startFreshSessionContext])

  const pickParentForNewFolder = useCallback(async () => {
    setBusy(true)
    try {
      const picked = await tauri.openFolderDialog()
      if (picked) {
        setParentPath(picked.path)
        setFolderName('')
        setNewFolderOpen(true)
      }
    } finally {
      setBusy(false)
    }
  }, [])

  const confirmNewFolder = useCallback(async () => {
    if (!parentPath) return
    setBusy(true)
    try {
      await createEmptyProjectInParent(parentPath, folderName)
      await startFreshSessionContext()
      stripWelcomeFromUrl()
      onDismiss()
    } catch (e) {
      addToast({
        type: 'error',
        title: 'Could not create folder',
        message: e instanceof Error ? e.message : 'Try another name or location.',
      })
    } finally {
      setBusy(false)
    }
  }, [
    addToast,
    createEmptyProjectInParent,
    folderName,
    onDismiss,
    parentPath,
    startFreshSessionContext,
  ])

  const removeRecent = useCallback(
    (path: string, e: React.MouseEvent) => {
      e.stopPropagation()
      removeRecentProject(path)
      refreshRecents()
    },
    [refreshRecents]
  )

  const recentEmpty = useMemo(() => recents.length === 0, [recents.length])
  const recentProgressByPath = useMemo(() => {
    const latestByWorkspace = new Map<string, OrcaIncompleteSession>()
    for (const s of sessionMetas) {
      const key = normalizeWorkspacePath(s.workspaceRoot)
      if (!key) continue
      const prev = latestByWorkspace.get(key)
      if (!prev || (s.updatedAtMs ?? 0) > (prev.updatedAtMs ?? 0)) {
        latestByWorkspace.set(key, s)
      }
    }
    return latestByWorkspace
  }, [sessionMetas])

  return (
    <div className="relative z-[100] flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#121212] text-gray-200">
      {/* Single scroll region: start from top so nothing is clipped; safe-area for notched webviews */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain [scrollbar-gutter:stable] pb-[env(safe-area-inset-bottom,0px)]">
        <div className="mx-auto flex w-full max-w-lg flex-col items-stretch px-4 py-5 sm:px-6 sm:py-8">
        <div className="w-full space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Open a project</h1>
          <p className="text-sm text-gray-500">Choose a recent folder, create a new one, or open any folder.</p>
        </div>

        {showResumeCard ? (
          <div className="mt-5 w-full shrink-0 rounded-xl border border-amber-500/35 bg-amber-500/[0.07] px-3 py-3 text-left sm:mt-6 sm:px-4 sm:py-4">
            <h2 className="text-sm font-semibold text-amber-100/95">Do you want to resume your unfinished session?</h2>
            <p className="mt-1 text-xs text-gray-500">
              A previous orchestrator run did not finish cleanly. You can restore its history and tasks, or continue
              below without resuming.
            </p>
            <ul className="mt-3 max-h-[min(36vh,11rem)] space-y-2 overflow-y-auto overscroll-y-contain pr-0.5 sm:max-h-[min(40vh,12rem)]">
              {incompleteSessions.map((s, index) => (
                <li key={`${s.sessionId}-${index}`}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resumeUnfinishedSession(s)}
                    className="w-full rounded-lg border border-tile-border/80 bg-black/30 px-3 py-2 text-left text-[11px] text-gray-200 transition hover:border-accent-teal/45 hover:bg-black/45 disabled:opacity-50"
                  >
                    <div className="break-words text-[12px] font-semibold leading-snug text-accent-teal">
                      {workspaceRootFolderName(s.workspaceRoot)}
                    </div>
                    {s.workspaceRoot ? (
                      <div className="mt-0.5 break-all text-[10px] leading-snug text-gray-500">{s.workspaceRoot}</div>
                    ) : null}
                    <div className="mt-0.5 text-[9px] text-gray-600">
                      Updated {formatSessionUpdatedAt(s.updatedAtMs)}
                    </div>
                    <div className="mt-1 break-all font-mono text-[9px] leading-snug text-gray-600">{s.sessionId}</div>
                  </button>
                </li>
              ))}
            </ul>
            {resumeError ? <p className="mt-2 text-[11px] text-red-400">{resumeError}</p> : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => setResumeDismissed(true)}
              className="mt-3 text-xs text-gray-500 underline decoration-gray-600 underline-offset-2 hover:text-gray-400"
            >
              No thanks — open a project below
            </button>
          </div>
        ) : null}

        <div className="mt-5 flex w-full shrink-0 flex-col gap-3 sm:mt-6">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleOpenFolder()}
            data-tooltip="Choose an existing project folder and load it as the Orca workspace."
            className={clsx(
              'rounded-lg border border-accent-teal/50 bg-accent-teal/15 px-4 py-3 text-left text-sm font-medium text-accent-teal transition hover:bg-accent-teal/25',
              busy && 'opacity-50'
            )}
          >
            Open folder…
            <span className="mt-0.5 block text-xs font-normal text-gray-500">Browse with the system folder picker</span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void pickParentForNewFolder()}
            data-tooltip="Pick a parent directory, then name a new folder for a fresh project."
            className={clsx(
              'rounded-lg border border-tile-border bg-tile-bg/80 px-4 py-3 text-left text-sm font-medium text-gray-200 transition hover:border-accent-teal/40 hover:bg-tile-bg',
              busy && 'opacity-50'
            )}
          >
            New folder…
            <span className="mt-0.5 block text-xs font-normal text-gray-500">Pick a parent location, then name the project</span>
          </button>
        </div>

        <div className="mt-5 w-full min-h-0 shrink-0 pb-1 sm:mt-6">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-600">Recent</div>
          {recentEmpty ? (
            <p className="rounded-lg border border-dashed border-tile-border/80 bg-tile-bg/40 px-4 py-6 text-center text-sm text-gray-500">
              No recent projects yet — open or create a folder above.
            </p>
          ) : (
            <ul className="max-h-[min(10rem,30vh)] space-y-1 overflow-y-auto rounded-lg border border-tile-border bg-tile-bg/60 p-1 sm:max-h-[min(12rem,32vh)]">
              {recents.map((r) => (
                <li key={r.path}>
                  {(() => {
                    const progress = recentProgressByPath.get(normalizeWorkspacePath(r.path))
                    const total = Math.max(0, progress?.totalTaskCount ?? 0)
                    const currentTask = Math.max(
                      0,
                      Math.min(total || Number.MAX_SAFE_INTEGER, progress?.currentTaskNumber ?? 0)
                    )
                    const percent = Math.max(0, Math.min(100, progress?.progressPercent ?? 0))
                    return (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openRecent(r)}
                    data-tooltip={`Open this recent project at ${r.path}`}
                    className="group flex w-full min-w-0 flex-col gap-1 rounded-md px-3 py-2 text-left text-sm hover:bg-[#3c3c3c] sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                  >
                    <span className="min-w-0 shrink font-medium text-gray-200 sm:truncate">{r.name}</span>
                    <span className="flex min-w-0 flex-1 items-start justify-between gap-2 sm:items-center sm:justify-end">
                      <span
                        className="min-w-0 flex-1 break-all text-left text-xs text-gray-500 sm:max-w-[min(14rem,42vw)] sm:flex-initial sm:truncate"
                        data-tooltip={r.path}
                      >
                        {r.path}
                      </span>
                      {progress ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-tile-border/80 bg-black/25 px-1.5 py-1 text-[10px] text-gray-300">
                          <span
                            className="grid h-4 w-4 place-items-center rounded-full text-[8px] font-semibold text-gray-100"
                            style={{
                              background: `conic-gradient(rgba(45,212,191,0.92) ${percent}%, rgba(71,85,105,0.45) ${percent}% 100%)`,
                            }}
                            data-tooltip={`Progress ${percent}%`}
                          >
                            <span className="inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-[#1f1f1f] leading-none" />
                          </span>
                          <span className="whitespace-nowrap text-[10px] text-gray-400">
                            {percent}% · Task {currentTask}/{total}
                          </span>
                        </span>
                      ) : null}
                      <span
                        role="button"
                        tabIndex={0}
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-500 opacity-0 hover:text-rose-400 group-hover:opacity-100"
                        onClick={(e) => removeRecent(r.path, e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            removeRecent(r.path, e as unknown as React.MouseEvent)
                          }
                        }}
                      >
                        Remove
                      </span>
                    </span>
                  </button>
                    )
                  })()}
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>
      </div>

      {newFolderOpen && parentPath && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNewFolderOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal
            aria-labelledby="new-folder-title"
            className="w-full max-w-md rounded-xl border border-tile-border bg-[#1e1e1e] p-5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="new-folder-title" className="text-lg font-semibold text-white">
              New project folder
            </h2>
            <p className="mt-1 break-all text-xs text-gray-500">Inside: {parentPath}</p>
            <label className="mt-4 block text-sm text-gray-400">
              Folder name
              <input
                autoFocus
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmNewFolder()
                  if (e.key === 'Escape') setNewFolderOpen(false)
                }}
                placeholder="my-project"
                className="mt-1 w-full rounded-md border border-tile-border bg-[#2d2d2d] px-3 py-2 text-white outline-none focus:border-accent-teal/60"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm text-gray-400 hover:bg-[#3c3c3c] hover:text-white"
                onClick={() => setNewFolderOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !folderName.trim()}
                className="rounded-md bg-accent-teal/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-accent-teal disabled:opacity-40"
                onClick={() => void confirmNewFolder()}
              >
                Create & open
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

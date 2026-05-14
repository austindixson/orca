// Tauri API wrapper - provides native functionality when running in Tauri,
// falls back to HTTP API when running in browser (for development)

const isTauri = (): boolean => {
  // Check for Tauri internals - multiple ways to detect
  if (typeof window === 'undefined') return false
  
  // Check for __TAURI__ global (Tauri v1)
  if ('__TAURI__' in window) return true
  
  // Check for __TAURI_INTERNALS__ (Tauri v2)
  if ('__TAURI_INTERNALS__' in window) return true
  
  // Check for window.__TAURI_IPC__ (another Tauri indicator)
  if ('__TAURI_IPC__' in window) return true
  
  return false
}

function debugTerminalBridgeLog(
  hypothesisId: string,
  message: string,
  data: Record<string, unknown>
): void {
  fetch('http://127.0.0.1:7696/ingest/d871edbc-ff39-4d74-96b8-887cea450cfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '98326f' },
    body: JSON.stringify({
      sessionId: '98326f',
      runId: 'terminal-connect-investigation',
      hypothesisId,
      location: 'packages/client/src/lib/tauri.ts',
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}

// Log Tauri detection status on load
if (typeof window !== 'undefined') {
  console.log('[Tauri] Detection:', {
    hasTauri: '__TAURI__' in window,
    hasTauriInternals: '__TAURI_INTERNALS__' in window,
    hasTauriIPC: '__TAURI_IPC__' in window,
    isTauri: isTauri(),
  })
}

interface FileEntry {
  name: string
  path: string
  is_directory: boolean
}

interface FileContent {
  content: string
  path: string
}

export interface BinaryFileContent {
  name: string
  path: string
  mime: string
  size: number
  data_base64: string
}

interface WorkspaceInfo {
  path: string
  name: string
}

export interface ResourceUsage {
  pid: number
  rss_kb: number
  rss_mb: number
}

export interface GitFileChange {
  path: string
  xy: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export interface GitChangelogSnapshot {
  workspace_path: string
  is_repo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged_count: number
  unstaged_count: number
  untracked_count: number
  changed_files: GitFileChange[]
  recent_commits: string[]
  summary: string
  next_steps: string[]
  generated_at_ms: number
}

/**
 * Used for auto-adding the changelog tile: only when there is something to show —
 * working-tree changes or ahead/behind vs upstream — not a clean, synced repo with nothing pending.
 */
export function gitChangelogSnapshotHasVisibleActivity(s: GitChangelogSnapshot): boolean {
  if (!s.is_repo) return false
  if (s.changed_files.length > 0) return true
  if (s.ahead > 0 || s.behind > 0) return true
  return false
}

// File System Operations
export async function openFolderDialog(): Promise<WorkspaceInfo | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<WorkspaceInfo | null>('open_folder_dialog')
  }
  // Browser fallback - not supported
  console.warn('Folder dialog not available in browser')
  return null
}

export type FileDialogFilter = { name: string; extensions: string[] }

/** Native save-as dialog; returns an absolute path or `null`. */
export async function saveFileDialog(
  defaultPath: string | null,
  filters: FileDialogFilter[] | null
): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string | null>('save_file_dialog', {
      default_path: defaultPath,
      filters,
    })
  }
  return null
}

/** Native open-file dialog; returns an absolute path or `null`. */
export async function openFileDialog(filters: FileDialogFilter[] | null): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string | null>('open_file_dialog', { filters })
  }
  return null
}

/** Refresh **File → Open Recent** from workspace-relative or absolute project paths. */
export async function rebuildRecentSubmenu(paths: string[]): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('rebuild_recent_submenu', { paths })
  }
}

/** Keep native **Auto Save** / **Word Wrap** checks aligned with Zustand. */
export async function syncNativeMenuChecks(
  editorAutoSaveEnabled: boolean,
  editorWordWrapOn: boolean
): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('sync_native_menu_checks', {
      editorAutoSaveEnabled,
      editorWordWrapOn: editorWordWrapOn,
    })
  }
}

export async function setWorkspace(path: string): Promise<WorkspaceInfo> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<WorkspaceInfo>('set_workspace', { path })
  }
  // Browser fallback
  return { path, name: path.split('/').pop() || path }
}

export async function getWorkspace(): Promise<WorkspaceInfo | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<WorkspaceInfo | null>('get_workspace')
  }
  return null
}

/**
 * Absolute user home path (for listing `~/.cursor/skills`, `~/.claude/skills`, etc.).
 * Browser dev: `GET http://localhost:3001/api/home-dir` (agent-canvas-server); `null` if unreachable.
 */
export async function getHomeDir(): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string | null>('get_home_dir')
  }
  try {
    const response = await fetch('http://localhost:3001/api/home-dir')
    if (!response.ok) return null
    const data = (await response.json()) as { path?: string | null }
    const p = data.path
    if (typeof p !== 'string' || p.length === 0) return null
    return p
  } catch {
    return null
  }
}

/**
 * Read a UTF-8 file under `~/.orca/` (e.g. `MEMORY.md` for `~/.orca/MEMORY.md`).
 * Returns `null` if the path does not exist. Not for workspace files — use {@link readFile} with a relative path.
 */
export async function readOrcaDataFile(relative: string): Promise<string | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string | null>('orca_read_file', { relative })
}

/**
 * Write UTF-8 under `~/.orca/` (e.g. `USER.md`). Desktop only; no-op in browser dev.
 */
export async function writeOrcaDataFile(relative: string, content: string): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('orca_write_file', { relative, content })
}

export async function readDirectory(path: string): Promise<FileEntry[]> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<FileEntry[]>('read_directory', { path })
  }
  // Browser fallback - use HTTP API
  const response = await fetch(`http://localhost:3001/api/files?path=${encodeURIComponent(path)}`)
  if (!response.ok) throw new Error('Failed to read directory')
  const data = await response.json()
  return data.files.map((f: any) => ({
    name: f.name,
    path: f.path,
    is_directory: f.isDirectory,
  }))
}

export type WorkspaceGrepMatch = { path: string; line: number; text: string }
export type WorkspaceGrepResult = {
  matches: WorkspaceGrepMatch[]
  truncated: boolean
  scanned_files: number
  match_count: number
  note: string | null
}

export async function workspaceGrep(args: {
  path?: string
  pattern: string
  fixed_string?: boolean
  case_insensitive?: boolean
  glob?: string
  max_matches?: number
}): Promise<WorkspaceGrepResult> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<WorkspaceGrepResult>('workspace_grep', {
      path: args.path ?? '.',
      pattern: args.pattern,
      fixed_string: args.fixed_string,
      case_insensitive: args.case_insensitive,
      glob: args.glob,
      max_matches: args.max_matches,
    })
  }
  const p = new URLSearchParams()
  p.set('pattern', args.pattern)
  p.set('path', args.path ?? '.')
  if (args.fixed_string) p.set('fixed_string', 'true')
  if (args.case_insensitive) p.set('case_insensitive', 'true')
  if (args.glob) p.set('glob', args.glob)
  if (args.max_matches != null) p.set('max_matches', String(args.max_matches))
  const response = await fetch(`http://localhost:3001/api/workspace-grep?${p.toString()}`)
  if (!response.ok) {
    const j = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error ?? 'workspace_grep failed')
  }
  return (await response.json()) as WorkspaceGrepResult
}

export async function readFile(path: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<FileContent>('read_file', { path })
    return result.content
  }
  // Browser fallback
  const response = await fetch(`http://localhost:3001/api/file?path=${encodeURIComponent(path)}`)
  if (!response.ok) throw new Error('Failed to read file')
  const data = await response.json()
  return data.content
}

export async function readFileBinary(path: string): Promise<BinaryFileContent> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<BinaryFileContent>('read_file_binary', { path })
  }
  throw new Error('Binary file read is only available in Tauri')
}

/** Save pasted image bytes under OS temp and return absolute local path (desktop only). */
export async function saveClipboardImageTemp(args: {
  dataBase64: string
  mime: string
  suggestedName?: string
}): Promise<string> {
  if (!isTauri()) {
    throw new Error('saveClipboardImageTemp is only available in Tauri')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('save_clipboard_image_temp', {
    data_base64: args.dataBase64,
    mime: args.mime,
    suggested_name: args.suggestedName,
  })
}

export async function writeFile(path: string, content: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke('write_file', { path, content })
  }
  // Browser fallback
  const response = await fetch('http://localhost:3001/api/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  })
  if (!response.ok) throw new Error('Failed to write file')
}

export async function createDirectory(path: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke('create_directory', { path })
  }
  throw new Error('Create directory not available in browser')
}

export async function deletePath(path: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke('delete_path', { path })
  }
  const response = await fetch(
    `http://localhost:3001/api/file?path=${encodeURIComponent(path)}`,
    { method: 'DELETE' }
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Failed to delete file')
  }
}

export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke('rename_path', { oldPath, newPath })
  }
  throw new Error('Rename not available in browser')
}

/** Result of `run_workspace_shell_command` — one-shot subprocess, no PTY. */
export type WorkspaceShellResult = {
  exit_code: number
  stdout: string
  stderr: string
  timed_out: boolean
  stdout_truncated: boolean
  stderr_truncated: boolean
}

/**
 * Run a bounded shell command in the workspace via Rust subprocess (not a PTY).
 * Desktop only; reduces PTY load vs terminal tiles for installs/tests.
 */
export async function runWorkspaceShellCommand(params: {
  command: string
  timeoutMs?: number
  cwdRelative?: string
}): Promise<WorkspaceShellResult> {
  if (!isTauri()) {
    throw new Error('runWorkspaceShellCommand requires Orca desktop')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<WorkspaceShellResult>('run_workspace_shell_command', {
    command: params.command,
    timeout_ms: params.timeoutMs,
    cwd_relative: params.cwdRelative,
  })
}

// PTY Terminal Operations
export async function createPtySession(id: string): Promise<void> {
  if (isTauri()) {
    // #region agent log
    debugTerminalBridgeLog('H9', 'createPtySession:before_invoke', { id })
    // #endregion
    const { invoke } = await import('@tauri-apps/api/core')
    try {
      await invoke('create_pty_session', { id })
      // #region agent log
      debugTerminalBridgeLog('H9', 'createPtySession:after_invoke', { id })
      // #endregion
    } catch (error) {
      // #region agent log
      debugTerminalBridgeLog('H9', 'createPtySession:invoke_error', { id, error: String(error) })
      // #endregion
      throw error
    }
  }
  // Browser fallback uses WebSocket
  console.log('PTY session will use WebSocket fallback')
}

export async function writeToPty(id: string, data: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke('write_to_pty', { id, data })
  }
  throw new Error('PTY not available in browser')
}

export async function resizePty(id: string, cols: number, rows: number): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke('resize_pty', { id, cols, rows })
  }
  // Browser fallback - handled by WebSocket
}

export async function closePtySession(id: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke('close_pty_session', { id })
  }
  // Browser fallback - handled by WebSocket
}

// PTY Event Listener
export async function onPtyOutput(id: string, callback: (data: string) => void): Promise<() => void> {
  if (isTauri()) {
    // #region agent log
    debugTerminalBridgeLog('H6', 'onPtyOutput:before_import_event', { id })
    // #endregion
    const { listen } = await import('@tauri-apps/api/event')
    // #region agent log
    debugTerminalBridgeLog('H6', 'onPtyOutput:before_listen', { id, eventName: `pty-output-${id}` })
    // #endregion
    const unlisten = await listen<string>(`pty-output-${id}`, (event) => {
      callback(event.payload)
    })
    // #region agent log
    debugTerminalBridgeLog('H6', 'onPtyOutput:after_listen', { id, eventName: `pty-output-${id}` })
    // #endregion
    return unlisten
  }
  // Browser fallback - no-op, WebSocket handles this
  return () => {}
}

/** Payload is the shell exit code (`0` = success); `null` if unavailable. */
export async function onPtyExit(
  id: string,
  callback: (exitCode: number | null) => void
): Promise<() => void> {
  if (isTauri()) {
    // #region agent log
    debugTerminalBridgeLog('H7', 'onPtyExit:before_import_event', { id })
    // #endregion
    const { listen } = await import('@tauri-apps/api/event')
    // #region agent log
    debugTerminalBridgeLog('H7', 'onPtyExit:before_listen', { id, eventName: `pty-exit-${id}` })
    // #endregion
    const unlisten = await listen<number | null>(`pty-exit-${id}`, (event) => {
      callback(event.payload ?? null)
    })
    // #region agent log
    debugTerminalBridgeLog('H7', 'onPtyExit:after_listen', { id, eventName: `pty-exit-${id}` })
    // #endregion
    return unlisten
  }
  return () => {}
}

/**
 * Run a callback when the user requests closing the window (Tauri desktop).
 * Use for best-effort cleanup before exit (e.g. abort in-flight agents).
 *
 * **Must** use {@link getCurrentWebviewWindow} (not `getCurrentWindow`): in Tauri 2,
 * `Window.listen` targets `kind: 'Window'` while close events are delivered to
 * `kind: 'WebviewWindow'`. Using `Window` meant the close handler never ran, so
 * `destroy()` never ran and the macOS red button could not close the window.
 */
export async function onWindowCloseRequested(cb: () => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  return getCurrentWebviewWindow().onCloseRequested(() => {
    try {
      cb()
    } catch (e) {
      console.error('[Orca] window close cleanup failed:', e)
    }
  })
}

/** Quit the entire desktop app (all windows) after killing PTYs / shells. */
export async function quitApp(): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('exit_app')
    return
  }
  try {
    window.close()
  } catch {
    /* noop */
  }
}

/**
 * Close **this** webview window only (standard macOS red traffic light / ⌘W).
 * Other project windows stay open. Use {@link quitApp} for File → Quit / ⌘Q.
 */
export async function closeCurrentWindow(): Promise<void> {
  if (!isTauri()) {
    try {
      window.close()
    } catch {
      /* noop */
    }
    return
  }
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  await getCurrentWebviewWindow().close()
}

/** Open a new app window (welcome screen with recent / new folder / open folder). Tauri: extra webview; browser: new tab. */
export async function openNewAppWindow(): Promise<void> {
  if (!isTauri()) {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('welcome', '1')
      window.open(u.toString(), '_blank', 'noopener,noreferrer')
    } catch (e) {
      console.warn('[Tauri] openNewAppWindow fallback failed:', e)
    }
    return
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const label = `project-${Date.now()}`
  const u = new URL(window.location.href)
  u.searchParams.set('welcome', '1')
  new WebviewWindow(label, {
    url: u.toString(),
    title: 'Orca Coder',
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    center: true,
  })
}

function browserPreviewLabel(tileId: string): string {
  return `orca-browser-${tileId}`
}

export interface BrowserPreviewWindowOptions {
  tileId: string
  url: string
  title?: string | null
}

async function getBrowserPreviewWindow(tileId: string) {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  return WebviewWindow.getByLabel(browserPreviewLabel(tileId))
}

export async function openBrowserPreviewWindow(opts: BrowserPreviewWindowOptions): Promise<void> {
  if (!isTauri()) return
  const normalizedUrl = opts.url.trim()
  if (!normalizedUrl) throw new Error('Browser preview URL is required')
  const existing = await getBrowserPreviewWindow(opts.tileId)
  if (existing) {
    await existing.setFocus()
    return
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const label = browserPreviewLabel(opts.tileId)
  new WebviewWindow(label, {
    url: normalizedUrl,
    title: opts.title?.trim() || 'Orca Preview',
    width: 1024,
    height: 768,
    minWidth: 700,
    minHeight: 500,
    resizable: true,
  })
}

export async function focusBrowserPreview(tileId: string): Promise<void> {
  if (!isTauri()) return
  const existing = await getBrowserPreviewWindow(tileId)
  if (!existing) return
  await existing.setFocus()
}

export async function closeBrowserPreview(tileId: string): Promise<void> {
  if (!isTauri()) return
  const existing = await getBrowserPreviewWindow(tileId)
  if (!existing) return
  await existing.destroy()
}

export async function navigateBrowserPreview(tileId: string, url: string): Promise<void> {
  if (!isTauri()) return
  const normalizedUrl = url.trim()
  if (!normalizedUrl) throw new Error('Browser preview URL is required')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke<void>('browser_webview_navigate', {
    label: browserPreviewLabel(tileId),
    url: normalizedUrl,
  })
}

export async function openBrowserDevTools(tileId: string): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke<void>('browser_webview_open_devtools', {
    label: browserPreviewLabel(tileId),
  })
}

export async function closeBrowserDevTools(tileId: string): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke<void>('browser_webview_close_devtools', {
    label: browserPreviewLabel(tileId),
  })
}

export async function onBrowserPreviewDestroyed(
  tileId: string,
  cb: () => void
): Promise<() => void> {
  if (!isTauri()) return () => {}
  const existing = await getBrowserPreviewWindow(tileId)
  if (!existing) return () => {}
  return existing.once('tauri://destroyed', () => {
    try {
      cb()
    } catch (e) {
      console.warn('[Tauri] browser preview destroy callback failed:', e)
    }
  })
}

export async function minimizeWindow(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    await getCurrentWebviewWindow().minimize()
  }
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    await getCurrentWebviewWindow().toggleMaximize()
  }
}

export async function getResourceUsage(): Promise<ResourceUsage | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ResourceUsage>('get_resource_usage')
  }

  // Browser fallback: surface JS heap if available.
  const mem = (performance as Performance & {
    memory?: { usedJSHeapSize: number }
  }).memory
  if (!mem || typeof mem.usedJSHeapSize !== 'number') return null
  const rssMb = mem.usedJSHeapSize / (1024 * 1024)
  return {
    pid: 0,
    rss_kb: Math.round((rssMb * 1024)),
    rss_mb: rssMb,
  }
}

export async function getGitChangelogSnapshot(): Promise<GitChangelogSnapshot | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<GitChangelogSnapshot>('get_git_changelog_snapshot')
  }
  return null
}

export interface GhCliResult {
  exit_code: number
  stdout: string
  stderr: string
}

/** Result of `probe_hermes_cli` — camelCase from Rust serde. */
export interface HermesCliProbeResult {
  installed: boolean
  versionLine: string | null
  stderrOrError: string | null
}

/**
 * Run `hermes --version` via Tauri (no shell). Returns null in web preview; on failure returns a structured error.
 */
export async function probeHermesCli(): Promise<HermesCliProbeResult | null> {
  if (!isTauri()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<HermesCliProbeResult>('probe_hermes_cli')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      installed: false,
      versionLine: null,
      stderrOrError: `probe_hermes_cli failed: ${msg}`,
    }
  }
}

/**
 * Run GitHub CLI (`gh`) with argv only — no shell. Tauri-only; cwd is the open workspace.
 */
export async function runGhCli(args: string[]): Promise<GhCliResult | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<GhCliResult>('run_gh_cli', { args })
}

export interface GitWorktreeAddResult {
  ok: boolean
  path: string
  branch: string
  stdout: string
  stderr: string
}

/**
 * Create a git worktree under the open workspace (e.g. `.worktrees/agent-1`). Desktop only; requires a git repo.
 */
export async function gitWorktreeAdd(
  relativePath: string,
  branchName?: string | null
): Promise<GitWorktreeAddResult | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<GitWorktreeAddResult>('git_worktree_add', {
    relativePath,
    branchName: branchName ?? null,
  })
}

/** `git worktree list` stdout from the workspace root. */
export async function gitWorktreeList(): Promise<string | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('git_worktree_list')
}

/** Remove a worktree by workspace-relative path. */
export async function gitWorktreeRemove(relativePath: string, force = false): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke<void>('git_worktree_remove', { relativePath, force })
}

export interface GitMergeBranchResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** Merge a branch into the current branch at the workspace root. */
export async function gitMergeBranch(branch: string): Promise<GitMergeBranchResult | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<GitMergeBranchResult>('git_merge_branch', { branch })
}

/** Copy orca.md / CLAUDE.md / .env from repo root into a worktree when missing. */
export async function gitWorktreeSeedDotfiles(relativeWorktree: string): Promise<string[] | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string[]>('git_worktree_seed_dotfiles', { relativeWorktree })
}

/** Symlink heavy dirs from repo root into worktree (Unix). */
export async function gitWorktreeSymlinkHeavyDirs(relativeWorktree: string): Promise<string[] | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string[]>('git_worktree_symlink_heavy_dirs', { relativeWorktree })
}

/** Open a workspace-relative path in the system default app (e.g. HTML in the default browser). Tauri only. */
export async function openWorkspaceRelativePath(relativePath: string): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke<void>('open_workspace_relative_path', { relativePath })
}

/**
 * macOS: opens Terminal and runs `pi` so you can type `/login` and complete Pi OAuth.
 * Other OS: throws with a short manual instruction (Pi OAuth is interactive).
 */
export async function openPiCliInTerminal(): Promise<void> {
  if (!isTauri()) {
    throw new Error('Open a terminal, run pi, then /login (desktop app only for Terminal shortcut).')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke<void>('open_pi_cli_in_terminal')
}

/** Open an external URL with the OS default handler. Tauri uses native open; browser uses window.open. */
export async function openExternalUrl(url: string): Promise<void> {
  const trimmed = url.trim()
  if (!trimmed) return
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<void>('open_external_url', { url: trimmed })
    return
  }
  window.open(trimmed, '_blank', 'noopener,noreferrer')
}

/** Create a temp directory for 1-shot generation (Tauri: OS temp; browser: workspace-relative folder). */
export async function createTempProject(name: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string>('create_temp_project', { name })
  }
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'project'
  const folder = `oneshot-temp-${Date.now()}-${safe}`
  await writeFile(`${folder}/.oneshot-marker`, 'Orca Coder 1-shot workspace\n')
  return folder
}

/** Copy a directory tree to a new path (destination must not exist). Tauri only. */
export async function copyProject(src: string, dest: string): Promise<void> {
  if (!isTauri()) {
    throw new Error('Saving a copy requires the desktop app (Tauri).')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('copy_project', { src, dest })
}

/** Delete a 1-shot temp folder under OS temp. Tauri only. */
export async function deleteTempProject(path: string): Promise<void> {
  if (!isTauri()) {
    console.warn('[1-shot] deleteTempProject skipped in browser')
    return
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('delete_temp_project', { path })
}

/** Absolute OS temp directory path (desktop only). */
export async function oneshotTempRootPath(): Promise<string | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('oneshot_temp_root_path')
}

/** Paths of `agent-canvas-oneshot-*` folders under OS temp (desktop only). */
export async function listOneshotTempProjects(): Promise<string[]> {
  if (!isTauri()) return []
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string[]>('list_oneshot_temp_projects')
}

/** Open the OS temp folder in Finder / Explorer (desktop only). */
export async function openOneshotTempInFileManager(): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<void>('open_oneshot_temp_in_file_manager')
}

/** Delete every leftover `agent-canvas-oneshot-*` folder under OS temp. Returns count removed. */
export async function deleteAllOneshotTempProjects(): Promise<number> {
  if (!isTauri()) return 0
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<number>('delete_all_oneshot_temp_projects')
}

/** Obsidian desktop vault registry from `obsidian.json` (Tauri only). */
export interface ObsidianVaultEntry {
  id: string
  path: string
  name: string
  pathExists: boolean
}

export interface ObsidianVaultsSnapshot {
  obsidianAppInstalled: boolean
  configFileFound: boolean
  configPath: string | null
  vaults: ObsidianVaultEntry[]
}

export async function obsidianVaultsSnapshot(): Promise<ObsidianVaultsSnapshot | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<ObsidianVaultsSnapshot>('obsidian_vaults_snapshot')
}

/** Tool-result compression: native Rust pipeline in Tauri (`skinnytools_filter`). Browser dev: no-op. */
export async function filterToolResultForContext(content: string): Promise<string> {
  if (!isTauri()) return content
  if (content.length === 0) return content
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('skinnytools_filter', { input: content })
  } catch (e) {
    console.warn('[skinnytools] filter failed, using raw tool output:', e)
    return content
  }
}

/**
 * Check if a TCP port is available (nothing listening).
 * Uses a quick fetch probe with aggressive timeout — if connection refused or times out, port is likely free.
 */
export async function checkPortAvailable(port: number): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 200)
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      method: 'HEAD',
      signal: controller.signal,
      mode: 'no-cors',
    })
    // Got a response — something is listening
    clearTimeout(timeout)
    return false
  } catch (e) {
    clearTimeout(timeout)
    // Connection refused, timeout, or network error = port likely free
    // AbortError from timeout or TypeError from connection refused both mean "not listening"
    if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) {
      return true
    }
    // Other errors: assume available (safer to try than skip)
    return true
  }
}

// Utility to check if running in Tauri
export { isTauri }

// ─────────────────────────────────────────────────────────────────────────────
// agent-browser CLI integration
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentBrowserRunOptions {
  sessionName?: string
  timeout?: number
}

export interface AgentBrowserResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number
}

const AGENT_BROWSER_INSTALL_HINT =
  'Install the CLI: npm install -g agent-browser && agent-browser install'

export function isAgentBrowserCliMissingErrorMessage(message: string): boolean {
  return (
    /not found on PATH|agent-browser CLI not found/i.test(message) ||
    /command not found(?::\s*agent-browser)?/i.test(message) ||
    /spawn\s+agent-browser\s+ENOENT/i.test(message) ||
    /No such file or directory:\s*(?:['\"])?(?:agent-browser(?![-\w])|[^\n\r]*\/agent-browser(?![-\w]))(?:['\"])?/i.test(message)
  )
}

export function isAgentBrowserSessionTransportErrorMessage(message: string): boolean {
  return /\/tmp\/agent-browser-h_[^/]+\/_stdout_(open|snapshot)\b/i.test(message)
}

export function isAgentBrowserPageClosedErrorMessage(message: string): boolean {
  return /target page, context or browser has been closed|target page.*has been closed|execution context was destroyed/i.test(
    message
  )
}

export function isAgentBrowserTransientErrorMessage(message: string): boolean {
  return (
    isAgentBrowserSessionTransportErrorMessage(message) ||
    isAgentBrowserPageClosedErrorMessage(message)
  )
}

export function withAgentBrowserCliInstallHint(message: string): string {
  const trimmed = message.trim()
  if (isAgentBrowserTransientErrorMessage(trimmed)) {
    return `${trimmed}. Agent-browser session became unstable (transient browser/session race). Retry the browser action; if it repeats, run browser_open again to create a fresh session.`
  }
  if (!isAgentBrowserCliMissingErrorMessage(trimmed)) return trimmed
  if (/npm install -g agent-browser/i.test(trimmed)) return trimmed
  return `${trimmed}. ${AGENT_BROWSER_INSTALL_HINT}`
}

/**
 * Fast preflight used by UI/tools before navigation commands.
 * Throws with install guidance when CLI is not installed.
 */
export async function ensureAgentBrowserCliInstalled(): Promise<void> {
  await runAgentBrowser(['--version'])
}

/**
 * Run an agent-browser CLI command and return stdout.
 * Requires the Tauri desktop app with the run_agent_browser command enabled.
 */
export async function runAgentBrowser(
  args: string[],
  opts?: AgentBrowserRunOptions
): Promise<string> {
  // #region agent log
  debugTerminalBridgeLog('H10', 'runAgentBrowser:entry', {
    argsCount: args.length,
    hasSessionName: Boolean(opts?.sessionName),
    tauriRuntime: isTauri(),
  })
  // #endregion
  if (!isTauri()) {
    // #region agent log
    debugTerminalBridgeLog('H10', 'runAgentBrowser:not_tauri', {
      argsCount: args.length,
      hasSessionName: Boolean(opts?.sessionName),
    })
    // #endregion
    throw new Error('agent-browser requires the Orca desktop app')
  }

  const sessionArgs = opts?.sessionName ? ['--session', opts.sessionName] : []
  const fullArgs = [...sessionArgs, ...args]

  const { invoke } = await import('@tauri-apps/api/core')
  const maxAttempts = opts?.sessionName ? 2 : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let result: AgentBrowserResult
    // #region agent log
    debugTerminalBridgeLog('H10', 'runAgentBrowser:before_invoke', {
      fullArgsCount: fullArgs.length,
      firstArg: fullArgs[0] ?? null,
      attempt,
      maxAttempts,
    })
    // #endregion
    try {
      result = await invoke<AgentBrowserResult>('run_agent_browser', { args: fullArgs })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // #region agent log
      debugTerminalBridgeLog('H10', 'runAgentBrowser:invoke_error', {
        fullArgsCount: fullArgs.length,
        firstArg: fullArgs[0] ?? null,
        attempt,
        maxAttempts,
        error: msg,
      })
      // #endregion
      if (/run_agent_browser/i.test(msg) && /not found/i.test(msg)) {
        throw new Error(
          'Agent browser backend is missing from this desktop build (run_agent_browser). Rebuild/update the Orca desktop app from a revision that includes the agent-browser Tauri command.'
        )
      }
      const hinted = withAgentBrowserCliInstallHint(msg)
      if (attempt < maxAttempts && isAgentBrowserTransientErrorMessage(msg)) {
        continue
      }
      throw new Error(hinted)
    }
    // #region agent log
    debugTerminalBridgeLog('H10', 'runAgentBrowser:after_invoke', {
      ok: result.ok,
      code: result.code,
      attempt,
      maxAttempts,
      stderrHead: result.stderr.slice(0, 220),
    })
    // #endregion

    if (!result.ok || result.code !== 0) {
      const stderr = result.stderr.trim()
      const fallback = `agent-browser exited with code ${result.code}`
      const errorMsg = withAgentBrowserCliInstallHint(stderr || fallback)
      if (attempt < maxAttempts && isAgentBrowserTransientErrorMessage(stderr || fallback)) {
        continue
      }
      throw new Error(errorMsg)
    }

    return result.stdout
  }

  throw new Error('agent-browser failed after retry')
}

/**
 * Get the WebSocket stream port for an agent-browser session.
 */
export async function getAgentBrowserStreamPort(sessionName: string): Promise<number> {
  const result = await runAgentBrowser(['stream', 'status', '--json'], { sessionName })
  try {
    const status = JSON.parse(result) as { data?: { port?: number } }
    return status.data?.port ?? 0
  } catch {
    return 0
  }
}

export function isAgentBrowserStreamingAlreadyEnabledError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /streaming is already enabled for this session/i.test(message)
}

interface EnsureAgentBrowserSessionDeps {
  enableStreaming: (sessionName: string) => Promise<void>
  getStreamPort: (sessionName: string) => Promise<number>
}

export async function ensureAgentBrowserSessionWithDeps(
  sessionName: string,
  deps: EnsureAgentBrowserSessionDeps
): Promise<{ port: number }> {
  const existingPort = await deps.getStreamPort(sessionName)
  if (existingPort) {
    return { port: existingPort }
  }

  try {
    await deps.enableStreaming(sessionName)
  } catch (error) {
    if (!isAgentBrowserStreamingAlreadyEnabledError(error)) {
      throw error
    }
  }

  const port = await deps.getStreamPort(sessionName)
  if (!port) {
    throw new Error('Failed to get agent-browser stream port')
  }

  return { port }
}

/**
 * Ensure an agent-browser session is running with streaming enabled.
 * Returns the WebSocket port for viewport streaming.
 */
export async function ensureAgentBrowserSession(sessionName: string): Promise<{ port: number }> {
  return ensureAgentBrowserSessionWithDeps(sessionName, {
    enableStreaming: async (name) => {
      await runAgentBrowser(['stream', 'enable'], { sessionName: name })
    },
    getStreamPort: getAgentBrowserStreamPort,
  })
}

/**
 * Close an agent-browser session.
 */
export async function closeAgentBrowserSession(sessionName: string): Promise<void> {
  try {
    await runAgentBrowser(['close'], { sessionName })
  } catch {
    // Ignore errors when closing (session may already be closed)
  }
}

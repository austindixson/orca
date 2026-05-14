import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as tauri from '../lib/tauri'
import { addRecentProject } from '../lib/recentProjects'
import { useToastStore } from './toastStore'
import { detectWorkspaceContextFromPaths } from '../lib/layout/workspaceContext'
import {
  loadCanvasStateFromWorkspaceFile,
  saveCanvasStateBeforeWorkspaceSwitch,
} from '../lib/canvasStatePersistence'
import { useCanvasStore } from './canvasStore'
import { runAfterWorkspaceOpen } from '../lib/vault/bootstrapCentralBrain'
import { resetOrcaSessionId } from '../lib/persistence/orcaSessionId'
import {
  clearConversationSessionKeyOverride,
  pinOrchestratorWorkspaceKeyForSession,
  setConversationSessionKeyOverride,
} from '../lib/persistence/sessionPersistence'
import { flushTasksForWorkspaceAndClearPending } from '../lib/persistence/taskPersistence'

export type SetWorkspaceRootOptions = {
  /** When resuming an incomplete session, pins conversation storage to this ~/.orca sessions folder. */
  resumeSessionId?: string | null
  /**
   * `follow-workspace`: new folder gets a fresh per-workspace orchestrator session (and optional resume id).
   * `preserve` (default): do not rotate session keys — used by 1-shot and other internal `rootPath` moves.
   */
  orchestratorSessionPolicy?: 'follow-workspace' | 'preserve'
}

async function handoffWorkspacePersistence(prevRootPath: string): Promise<void> {
  await flushTasksForWorkspaceAndClearPending(prevRootPath)
}

function applyOrchestratorHandoffForUserWorkspaceOpen(opts?: SetWorkspaceRootOptions): void {
  if (opts?.orchestratorSessionPolicy !== 'follow-workspace') return
  pinOrchestratorWorkspaceKeyForSession(null)
  if (opts.resumeSessionId?.trim()) {
    setConversationSessionKeyOverride(opts.resumeSessionId.trim())
  } else {
    clearConversationSessionKeyOverride()
    resetOrcaSessionId()
  }
}

function applyOpenFolderOrchestratorHandoff(
  pickedPath: string,
  findResumeSessionId?: (absolutePath: string) => string | null | undefined
): void {
  pinOrchestratorWorkspaceKeyForSession(null)
  const rid = findResumeSessionId?.(pickedPath)?.trim()
  if (rid) {
    setConversationSessionKeyOverride(rid)
  } else {
    clearConversationSessionKeyOverride()
    resetOrcaSessionId()
  }
}

/** Default sidebar (file tree) width when the user has not dragged the resize handle (same as resize minimum, 180px). */
const DEFAULT_SIDEBAR_WIDTH = 180

function workspacePersistStorageName(): string {
  if (typeof window === 'undefined') return 'workspace-storage'
  const label = (window as unknown as { __AC_WINDOW_LABEL__?: string }).__AC_WINDOW_LABEL__
  if (!label || label === 'browser' || label === 'main') return 'workspace-storage'
  return `workspace-storage-${label}`
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
  isExpanded?: boolean
  isLoading?: boolean
}

interface WorkspaceState {
  rootPath: string
  rootName: string
  files: FileEntry[]
  expandedPaths: Set<string>
  selectedPath: string | null
  isLoading: boolean
  error: string | null
  sidebarWidth: number
  /** After the user drags the resize handle, we keep their width; until then, expand uses 25% of viewport. */
  sidebarWidthUserSized: boolean
  orchestratorPanelWidth: number
  sidebarCollapsed: boolean
  activePanel:
    | 'modules'
    | 'explorer'
    | 'timeline'
    | 'search'
    | 'tasks'
    | 'tests'
    | 'agents'
    | 'hermesTelemetry'
    | 'brain'
    | 'gateway'
    | 'orchestrator'
  /** When true, orchestrator module actions bring/pan active tiles into view automatically. */
  orchestratorAutoFocus: boolean
  /**
   * Temporary override used by 1-shot clarify: keep the orchestrator itself in view and suppress
   * normal module auto-focus until the user answers or skips the questions.
   */
  orchestratorClarifyFocusLock: boolean
  /** Persisted folder-collapse memory for Hermes Lead mode file branches. */
  hermesLeadCollapsedFolderIds: Set<string>
  /** In explorer: % of the tree/tasks split area given to the file tree (15–85). Default 50. */
  explorerTreeSplitPercent: number
  /**
   * Timestamp (ms) of last successful workspace open. Retained for recency ordering and debug; no
   * longer drives auto-load on app start (the welcome screen is always the entry point).
   */
  workspaceOpenedAt: number
  /**
   * Tauri only: false until `bootstrapWorkspaceAfterHydration` finishes so the file tree does not
   * call `loadDirectory` before Zustand rehydration is complete.
   */
  workspaceBootstrapDone: boolean
  /** Tauri: default Obsidian vault folder path (absolute) for one-click open from Obsidian brain. */
  defaultObsidianVaultPath: string | null

  /**
   * Opens the system folder picker; returns true if a folder was chosen and opened.
   * Optional resolver maps the picked absolute path to a resume session id (welcome / recents).
   */
  openFolder: (
    findResumeSessionId?: (absolutePath: string) => string | null | undefined
  ) => Promise<boolean>
  setRootPath: (path: string, opts?: SetWorkspaceRootOptions) => Promise<void>
  loadDirectory: (path: string) => Promise<void>
  toggleDirectory: (path: string) => void
  selectFile: (path: string) => void
  setSidebarWidth: (width: number) => void
  setOrchestratorPanelWidth: (width: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  /** Open the sidebar from icon-only; applies minimum width until the user has resized. */
  expandSidebar: () => void
  toggleSidebar: () => void
  setActivePanel: (
    panel:
      | 'modules'
      | 'explorer'
      | 'timeline'
      | 'search'
      | 'tasks'
      | 'tests'
      | 'agents'
      | 'hermesTelemetry'
      | 'brain'
      | 'gateway'
      | 'orchestrator'
  ) => void
  setOrchestratorAutoFocus: (enabled: boolean) => void
  setOrchestratorClarifyFocusLock: (locked: boolean) => void
  setHermesLeadCollapsedFolderIds: (ids: Iterable<string>) => void
  toggleHermesLeadCollapsedFolderId: (id: string) => void
  setExplorerTreeSplitPercent: (percent: number) => void
  refreshFiles: () => Promise<void>
  /** Reload listings + expand ancestors so new/changed files appear in the tree (orchestrator writes). */
  syncExplorerAfterWrite: (relativePath: string) => Promise<void>
  /** After a file is deleted, clear selection if needed and refresh affected tree nodes. */
  syncExplorerAfterDelete: (relativePath: string) => Promise<void>
  /** Create an empty folder inside `parentPath`, then open it as the workspace. */
  createEmptyProjectInParent: (parentPath: string, folderName: string) => Promise<void>
  setDefaultObsidianVaultPath: (path: string | null) => void
  /**
   * Save current canvas, clear tiles, reset workspace UI to defaults, and show the welcome screen
   * (native **File → Close Folder**).
   */
  returnToWelcome: () => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      rootPath: '.',
      rootName: 'Workspace',
      files: [],
      expandedPaths: new Set<string>(),
      selectedPath: null,
      isLoading: false,
      error: null,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      sidebarWidthUserSized: false,
      orchestratorPanelWidth: 420,
      sidebarCollapsed: true,
      activePanel: 'explorer',
      orchestratorAutoFocus: true,
      orchestratorClarifyFocusLock: false,
      hermesLeadCollapsedFolderIds: new Set<string>(),
      explorerTreeSplitPercent: 50,
      workspaceOpenedAt: 0,
      workspaceBootstrapDone: !tauri.isTauri(),
      defaultObsidianVaultPath: null,

      openFolder: async (findResumeSessionId) => {
        try {
          console.log('[Workspace] Opening folder dialog...')
          const result = await tauri.openFolderDialog()
          console.log('[Workspace] Dialog result:', result)

          if (result) {
            useToastStore.getState().beginWorkspaceOpenNotificationSuppression()
            try {
              applyOpenFolderOrchestratorHandoff(result.path, findResumeSessionId)
              const prevRoot = get().rootPath
              await handoffWorkspacePersistence(prevRoot)
              await saveCanvasStateBeforeWorkspaceSwitch(prevRoot)
              console.log('[Workspace] Setting workspace to:', result.path)
              await tauri.setWorkspace(result.path)
              const openedAt = Date.now()
              set({
                rootPath: result.path,
                rootName: result.name,
                isLoading: true,
                error: null,
                workspaceOpenedAt: openedAt,
              })
              addRecentProject(result.path, result.name)
              console.log('[Workspace] Loading directory...')
              await get().loadDirectory('.')
              console.log('[Workspace] Directory loaded')
              await loadCanvasStateFromWorkspaceFile(result.path)
              useToastStore.getState().scheduleEndWorkspaceOpenNotificationSuppression()
              void runAfterWorkspaceOpen()
              return true
            } catch (error) {
              useToastStore.getState().endWorkspaceOpenNotificationSuppressionNow()
              console.error('[Workspace] Error opening folder:', error)
              set({ error: error instanceof Error ? error.message : 'Failed to open folder' })
              return false
            }
          }
          console.log('[Workspace] Dialog cancelled')
          return false
        } catch (error) {
          console.error('[Workspace] Error opening folder:', error)
          set({ error: error instanceof Error ? error.message : 'Failed to open folder' })
          return false
        }
      },

      setRootPath: async (path: string, opts?: SetWorkspaceRootOptions) => {
        useToastStore.getState().beginWorkspaceOpenNotificationSuppression()
        try {
          applyOrchestratorHandoffForUserWorkspaceOpen(opts)
          const prevRoot = get().rootPath
          await handoffWorkspacePersistence(prevRoot)
          await saveCanvasStateBeforeWorkspaceSwitch(prevRoot)
          const result = await tauri.setWorkspace(path)
          set({
            rootPath: result.path,
            rootName: result.name,
            isLoading: true,
            error: null,
            workspaceOpenedAt: Date.now(),
          })
          addRecentProject(result.path, result.name)
          await get().loadDirectory('.')
          await loadCanvasStateFromWorkspaceFile(result.path)
          useToastStore.getState().scheduleEndWorkspaceOpenNotificationSuppression()
          void runAfterWorkspaceOpen()
        } catch (error) {
          useToastStore.getState().endWorkspaceOpenNotificationSuppressionNow()
          set({ error: 'Failed to set workspace' })
        }
      },

      createEmptyProjectInParent: async (parentPath: string, folderName: string) => {
        const name = folderName.trim().replace(/[/\\?*:|"<>]/g, '')
        if (!name) {
          set({ error: 'Enter a valid folder name' })
          throw new Error('Enter a valid folder name')
        }
        const sep = parentPath.includes('\\') ? '\\' : '/'
        const childPath = `${parentPath.replace(/[/\\]+$/, '')}${sep}${name}`
        try {
          useToastStore.getState().beginWorkspaceOpenNotificationSuppression()
          pinOrchestratorWorkspaceKeyForSession(null)
          clearConversationSessionKeyOverride()
          resetOrcaSessionId()
          const prevRoot = get().rootPath
          await handoffWorkspacePersistence(prevRoot)
          await saveCanvasStateBeforeWorkspaceSwitch(prevRoot)
          await tauri.setWorkspace(parentPath)
          await tauri.createDirectory(name)
          const result = await tauri.setWorkspace(childPath)
          set({
            rootPath: result.path,
            rootName: result.name,
            isLoading: true,
            error: null,
            workspaceOpenedAt: Date.now(),
          })
          addRecentProject(result.path, result.name)
          await get().loadDirectory('.')
          await loadCanvasStateFromWorkspaceFile(result.path)
          useToastStore.getState().scheduleEndWorkspaceOpenNotificationSuppression()
          void runAfterWorkspaceOpen()
        } catch (error) {
          useToastStore.getState().endWorkspaceOpenNotificationSuppressionNow()
          const msg = error instanceof Error ? error.message : 'Failed to create project folder'
          set({ error: msg })
          throw error instanceof Error ? error : new Error(msg)
        }
      },

      loadDirectory: async (path: string) => {
        try {
          set({ isLoading: true, error: null })

          // Rust resolves "." against per-window workspace; after restart only Zustand is restored.
          // Sync the backend before listing the repo root so the tree matches rootName/rootPath.
          if (path === '.') {
            const { rootPath } = get()
            if (rootPath && rootPath !== '.') {
              try {
                await tauri.setWorkspace(rootPath)
              } catch (e) {
                const msg = e instanceof Error ? e.message : 'Failed to sync workspace'
                set({ error: msg, isLoading: false })
                return
              }
            }
          }

          const entries = await tauri.readDirectory(path)
          
          const sortedFiles: FileEntry[] = entries.map(e => ({
            name: e.name,
            path: e.path,
            isDirectory: e.is_directory,
          }))

          if (path === '.') {
            set({ files: sortedFiles, isLoading: false })
            try {
              const paths = sortedFiles.map((f) => f.path.replace(/\\/g, '/'))
              const ctx = detectWorkspaceContextFromPaths(paths)
              useCanvasStore.getState().setWorkspaceContext(ctx)
            } catch {
              /* ignore */
            }
          } else {
            const { files } = get()
            const updateChildren = (entries: FileEntry[]): FileEntry[] => {
              return entries.map(entry => {
                if (entry.path === path) {
                  return { ...entry, children: sortedFiles, isLoading: false }
                }
                if (entry.children) {
                  return { ...entry, children: updateChildren(entry.children) }
                }
                return entry
              })
            }
            set({ files: updateChildren(files), isLoading: false })
          }
        } catch (error) {
          set({ error: 'Failed to load directory', isLoading: false })
        }
      },

      toggleDirectory: (path: string) => {
        const { expandedPaths, loadDirectory, files } = get()
        const newExpanded = new Set(expandedPaths)
        
        if (newExpanded.has(path)) {
          newExpanded.delete(path)
        } else {
          newExpanded.add(path)
          
          const findEntry = (entries: FileEntry[]): FileEntry | null => {
            for (const entry of entries) {
              if (entry.path === path) return entry
              if (entry.children) {
                const found = findEntry(entry.children)
                if (found) return found
              }
            }
            return null
          }
          
          const entry = findEntry(files)
          if (entry && !entry.children) {
            loadDirectory(path)
          }
        }
        
        set({ expandedPaths: newExpanded })
      },

      selectFile: (path: string) => {
        set({ selectedPath: path })
      },

      setSidebarWidth: (width: number) => {
        const w = Math.max(180, Math.min(500, width))
        set({ sidebarWidth: w, sidebarWidthUserSized: true })
      },

      setOrchestratorPanelWidth: (width: number) => {
        set({ orchestratorPanelWidth: Math.max(320, Math.min(760, width)) })
      },

      setSidebarCollapsed: (collapsed: boolean) => {
        if (collapsed) {
          set({ sidebarCollapsed: true })
          return
        }
        const s = get()
        let w = s.sidebarWidth
        if (!s.sidebarWidthUserSized && typeof window !== 'undefined') {
          w = DEFAULT_SIDEBAR_WIDTH
        }
        set({ sidebarCollapsed: false, sidebarWidth: w })
      },

      expandSidebar: () => {
        const s = get()
        if (!s.sidebarCollapsed) return
        let w = s.sidebarWidth
        if (!s.sidebarWidthUserSized && typeof window !== 'undefined') {
          w = DEFAULT_SIDEBAR_WIDTH
        }
        set({ sidebarCollapsed: false, sidebarWidth: w })
      },

      toggleSidebar: () => {
        set((state) => {
          if (state.sidebarCollapsed) {
            let w = state.sidebarWidth
            if (!state.sidebarWidthUserSized && typeof window !== 'undefined') {
              w = DEFAULT_SIDEBAR_WIDTH
            }
            return { sidebarCollapsed: false, sidebarWidth: w }
          }
          return { sidebarCollapsed: true }
        })
      },

      setActivePanel: (panel) => {
        set({ activePanel: panel })
      },

      setOrchestratorAutoFocus: (enabled) => {
        set({ orchestratorAutoFocus: enabled })
        if (enabled) {
          queueMicrotask(() => {
            void import('../lib/orchestrator/revealOrchestratorTile').then((m) =>
              m.revealOrchestratorOnAutoFocusEnabled()
            )
          })
        }
      },

      setOrchestratorClarifyFocusLock: (locked) => {
        set({ orchestratorClarifyFocusLock: locked })
      },

      setHermesLeadCollapsedFolderIds: (ids) => {
        set({ hermesLeadCollapsedFolderIds: new Set(Array.from(ids).filter((id) => !!id?.trim())) })
      },

      toggleHermesLeadCollapsedFolderId: (id) => {
        const trimmed = id.trim()
        if (!trimmed) return
        set((state) => {
          const next = new Set(state.hermesLeadCollapsedFolderIds)
          if (next.has(trimmed)) next.delete(trimmed)
          else next.add(trimmed)
          return { hermesLeadCollapsedFolderIds: next }
        })
      },

      setExplorerTreeSplitPercent: (percent) => {
        set({ explorerTreeSplitPercent: Math.max(15, Math.min(85, Math.round(percent))) })
      },

      refreshFiles: async () => {
        const { loadDirectory } = get()
        await loadDirectory('.')
      },

      syncExplorerAfterWrite: async (relativePath: string) => {
        const normalized = relativePath
          .replace(/\\/g, '/')
          .replace(/^\.\//, '')
          .replace(/^\/+/, '')
        const parts = normalized.split('/').filter(Boolean)
        if (parts.length === 0) return

        const { expandedPaths, loadDirectory } = get()
        const nextExpanded = new Set(expandedPaths)

        if (parts.length > 1) {
          for (let i = 1; i < parts.length; i++) {
            nextExpanded.add(parts.slice(0, i).join('/'))
          }
        }

        const ws = get()
        let nextW = ws.sidebarWidth
        if (!ws.sidebarWidthUserSized && typeof window !== 'undefined') {
          nextW = DEFAULT_SIDEBAR_WIDTH
        }
        set({
          expandedPaths: nextExpanded,
          selectedPath: normalized,
          activePanel: 'explorer',
          sidebarCollapsed: false,
          sidebarWidth: nextW,
        })

        await loadDirectory('.')
        if (parts.length <= 1) return

        for (let i = 1; i < parts.length; i++) {
          const dirPath = parts.slice(0, i).join('/')
          await loadDirectory(dirPath)
        }
      },

      setDefaultObsidianVaultPath: (path: string | null) => {
        set({ defaultObsidianVaultPath: path?.trim() || null })
      },

      returnToWelcome: async () => {
        try {
          const prevRoot = get().rootPath
          pinOrchestratorWorkspaceKeyForSession(null)
          clearConversationSessionKeyOverride()
          resetOrcaSessionId()
          await handoffWorkspacePersistence(prevRoot)
          await saveCanvasStateBeforeWorkspaceSwitch(prevRoot)
          useCanvasStore.getState().clearAllTiles()
          set({
            rootPath: '.',
            rootName: 'Workspace',
            files: [],
            expandedPaths: new Set<string>(),
            selectedPath: null,
            error: null,
            isLoading: false,
            workspaceOpenedAt: 0,
          })
          try {
            const u = new URL(window.location.href)
            u.searchParams.set('welcome', '1')
            window.history.replaceState({}, '', u.toString())
          } catch {
            /* noop */
          }
          window.dispatchEvent(new CustomEvent('orca-open-welcome'))
        } catch (e) {
          console.error('[Workspace] returnToWelcome:', e)
        }
      },

      syncExplorerAfterDelete: async (relativePath: string) => {
        const normalized = relativePath
          .replace(/\\/g, '/')
          .replace(/^\.\//, '')
          .replace(/^\/+/, '')
        const parts = normalized.split('/').filter(Boolean)
        if (parts.length === 0) return

        const { selectedPath, loadDirectory } = get()
        if (selectedPath === normalized) {
          set({ selectedPath: null })
        }

        await loadDirectory('.')
        if (parts.length <= 1) return

        for (let i = 1; i < parts.length; i++) {
          const dirPath = parts.slice(0, i).join('/')
          await loadDirectory(dirPath)
        }
      },
    }),
    {
      name: workspacePersistStorageName(),
      partialize: (state) => ({
        rootPath: state.rootPath,
        rootName: state.rootName,
        sidebarWidth: state.sidebarWidth,
        sidebarWidthUserSized: state.sidebarWidthUserSized,
        orchestratorPanelWidth: state.orchestratorPanelWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        orchestratorAutoFocus: state.orchestratorAutoFocus,
        explorerTreeSplitPercent: state.explorerTreeSplitPercent,
        hermesLeadCollapsedFolderIds: Array.from(state.hermesLeadCollapsedFolderIds),
        expandedPaths: Array.from(state.expandedPaths),
        workspaceOpenedAt: state.workspaceOpenedAt,
        defaultObsidianVaultPath: state.defaultObsidianVaultPath,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && Array.isArray(state.expandedPaths)) {
          state.expandedPaths = new Set(state.expandedPaths as unknown as string[])
        }
        if (state && Array.isArray(state.hermesLeadCollapsedFolderIds)) {
          state.hermesLeadCollapsedFolderIds = new Set(
            (state.hermesLeadCollapsedFolderIds as unknown as string[]).filter((id) => typeof id === 'string' && !!id.trim())
          )
        }
        if (state && !(state.hermesLeadCollapsedFolderIds instanceof Set)) {
          state.hermesLeadCollapsedFolderIds = new Set<string>()
        }
        if (state && typeof state.explorerTreeSplitPercent !== 'number') {
          state.explorerTreeSplitPercent = 50
        }
        if (state && typeof state.orchestratorAutoFocus !== 'boolean') {
          state.orchestratorAutoFocus = true
        }
        if (state && typeof state.workspaceOpenedAt !== 'number') {
          state.workspaceOpenedAt = 0
        }
        if (state && state.defaultObsidianVaultPath != null && typeof state.defaultObsidianVaultPath !== 'string') {
          state.defaultObsidianVaultPath = null
        }
        if (state && typeof state.sidebarWidthUserSized !== 'boolean') {
          // Pre–userSized field: any saved width was intentional.
          state.sidebarWidthUserSized = true
        }
      },
    }
  )
)

/**
 * Bootstrap marker — previously this auto-loaded the most recently opened folder on app start
 * (adopting global recents, then validating the persisted `rootPath` against Rust, with fallbacks).
 *
 * That behaviour was removed: users now always land on the welcome screen (`ProjectWelcomeScreen`)
 * and pick a project / resume a session explicitly. This function only flips
 * `workspaceBootstrapDone` so downstream consumers (e.g. `FileExplorer`) know it is safe to call
 * `loadDirectory('.')` once a workspace is actually set by the user.
 *
 * We also clear any stale in-memory directory listings so the sidebar does not flash content from
 * a previous run before the user chooses a project.
 */
export async function bootstrapWorkspaceAfterHydration(): Promise<void> {
  if (typeof window === 'undefined' || !tauri.isTauri()) {
    useWorkspaceStore.setState({ workspaceBootstrapDone: true })
    return
  }

  useWorkspaceStore.setState({
    files: [],
    selectedPath: null,
    isLoading: false,
    error: null,
    workspaceBootstrapDone: true,
  })
}

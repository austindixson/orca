import { useCanvasStore } from '../../store/canvasStore'
import type { OrchestratorTileRevealHint } from '../../store/orchestratorActivityStore'
import type { AgentWriteStreamMeta } from './agentWriteStream'
import { revealOrchestratorTile } from './revealOrchestratorTile'

const MAX_TOOL_LOG = 48

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  try {
    if (name === 'write_file' || name === 'read_file' || name === 'delete_file')
      return String(args.path ?? '')
    if (name === 'list_directory') return String(args.path ?? '.')
    if (name === 'open_workspace') return String(args.path ?? '')
    if (name === 'canvas_create_tile') return `${args.type ?? ''}`
    if (name === 'canvas_update_tile') return String(args.tile_id ?? '')
    if (name === 'canvas_list_modules') return ''
    if (name === 'run_shell_command') {
      const cmd = String(args.command ?? '').trim()
      if (cmd) return cmd.length > 72 ? `${cmd.slice(0, 72)}…` : cmd
      return ''
    }
  } catch {
    /* ignore */
  }
  return ''
}

/**
 * Legacy: find or create an **agent** tile as an on-canvas tool log. The main orchestrator UI is the
 * bottom bar — this is optional and not invoked by default.
 */
export function ensureOrchestratorAgentTile(): string {
  const { tiles, addTile, updateTile } = useCanvasStore.getState()
  for (const t of tiles.values()) {
    if (t.type === 'agent' && t.meta?.orchestratorAnchor === true) {
      return t.id
    }
  }
  const id = addTile('agent')
  updateTile(id, {
    title: 'Orchestrator',
    meta: {
      orchestratorAnchor: true,
      orchestratorToolLog: [] as string[],
    },
  })
  revealOrchestratorTile(id)
  return id
}

/**
 * Append a line to the orchestrator agent tile log and optionally reveal it.
 */
export function recordOrchestratorToolOnModule(
  orchestratorTileId: string | null,
  toolName: string,
  args: Record<string, unknown>
): void {
  if (!orchestratorTileId) return
  const tile = useCanvasStore.getState().tiles.get(orchestratorTileId)
  /** Agent anchor (legacy) or compact orchestrator status tile — both store the tool tail in meta. */
  if (!tile || (tile.type !== 'agent' && tile.type !== 'orchestrator')) return

  const summary = summarizeArgs(toolName, args)
  const line = `${new Date().toLocaleTimeString(undefined, { hour12: false })}  ${toolName}${summary ? `  ${summary}` : ''}`
  const prev = Array.isArray(tile.meta?.orchestratorToolLog)
    ? ([...(tile.meta.orchestratorToolLog as string[])] as string[])
    : []
  prev.push(line)
  const orchestratorToolLog = prev.slice(-MAX_TOOL_LOG)

  useCanvasStore.getState().updateTile(orchestratorTileId, {
    meta: {
      ...tile.meta,
      orchestratorToolLog,
      lastOrchestratorTool: toolName,
    },
  })
  /** Do not call `revealOrchestratorTile` here — it would steal auto-focus from the module being edited and break hub→module link highlighting. */
}

export type EditorScrollToRange = { startLine: number; endLine: number }

/** Orchestrator-driven UX on editor tiles (read line scan, write line flash). */
export type EditorAgentReadScan = {
  lineCount: number
  token: number
  /** Inclusive 1-based range — when set, the editor animates only this band (not a full-file sweep). */
  startLine?: number
  endLine?: number
}
export type EditorAgentWriteFlash = { startLine: number; endLine: number; token: number }

export type EnsureEditorModuleOptions = {
  scrollToRange?: EditorScrollToRange
  agentReadScan?: EditorAgentReadScan
  agentWriteFlash?: EditorAgentWriteFlash
  agentWriteStream?: AgentWriteStreamMeta
}

function mergeFileMeta(
  prev: Record<string, unknown> | undefined,
  relPath: string,
  options?: EnsureEditorModuleOptions
): Record<string, unknown> {
  const scrollToRange = options?.scrollToRange
  const pathChanged =
    !prev || typeof prev.file !== 'string' || prev.file !== relPath
  /** Only bump when the path changes or orchestrator wrote (scroll hint) — not on every `read_file` / refocus. EditorTile reloads on `fileVersion`; spurious bumps cancelled debounced auto-save and re-read stale disk over the buffer. */
  const bumpVersion = pathChanged || scrollToRange != null
  const prevVer =
    typeof prev?.fileVersion === 'number' ? prev.fileVersion : undefined
  const next: Record<string, unknown> = {
    ...prev,
    file: relPath,
    fileVersion: bumpVersion ? Date.now() : (prevVer ?? Date.now()),
  }
  if (scrollToRange) {
    next.scrollToRange = scrollToRange
  } else {
    delete next.scrollToRange
  }
  if (options?.agentReadScan) {
    next.agentReadScan = options.agentReadScan
  } else {
    delete next.agentReadScan
  }
  if (options?.agentWriteFlash) {
    next.agentWriteFlash = options.agentWriteFlash
  } else {
    delete next.agentWriteFlash
  }
  if (options?.agentWriteStream) {
    next.agentWriteStream = options.agentWriteStream
  } else {
    delete next.agentWriteStream
  }
  return next
}

/**
 * Find or create an **editor** tile for a workspace-relative path. When `orchestratorTileId` is set,
 * ties the editor to an optional on-canvas agent hub; otherwise the bottom-bar orchestrator only updates files.
 *
 * Pass `scrollToRange` after a write so the editor can scroll to the changed lines (full file coordinates).
 */
export function ensureEditorModuleForPath(
  orchestratorTileId: string | null,
  relPath: string,
  hint?: OrchestratorTileRevealHint,
  options?: EnsureEditorModuleOptions
): string {
  const { tiles, addTile, updateTile } = useCanvasStore.getState()
  const title = relPath.split(/[/\\]/).pop() ?? relPath

  const applySessionMeta = (base: Record<string, unknown>) => {
    const meta: Record<string, unknown> = { ...base }
    if (orchestratorTileId) {
      meta.orchestratorBound = true
      meta.orchestratorTileId = orchestratorTileId
    } else {
      meta.orchestratorBound = false
      delete meta.orchestratorTileId
    }
    return meta
  }

  for (const t of tiles.values()) {
    if (t.type !== 'editor') continue
    const sameFile = typeof t.meta?.file === 'string' && t.meta.file === relPath
    if (sameFile) {
      updateTile(t.id, {
        title,
        meta: applySessionMeta(mergeFileMeta(t.meta, relPath, options)),
      })
      revealOrchestratorTile(t.id, hint, orchestratorTileId)
      return t.id
    }
  }

  if (orchestratorTileId) {
    for (const t of tiles.values()) {
      if (t.type !== 'editor') continue
      const sameSession =
        t.meta?.orchestratorBound === true && t.meta?.orchestratorTileId === orchestratorTileId
      if (sameSession) {
        updateTile(t.id, {
          title,
          meta: applySessionMeta(mergeFileMeta(t.meta, relPath, options)),
        })
        revealOrchestratorTile(t.id, hint, orchestratorTileId)
        return t.id
      }
    }
  }

  const id = addTile('editor')
  updateTile(id, {
    title,
    meta: applySessionMeta(mergeFileMeta(undefined, relPath, options)),
  })
  revealOrchestratorTile(id, hint, orchestratorTileId)
  return id
}

/** Find an already-open editor tile for a workspace-relative path (never creates a new tile). */
export function findExistingEditorModuleForPath(relPath: string): string | null {
  const { tiles } = useCanvasStore.getState()
  for (const t of tiles.values()) {
    if (t.type !== 'editor') continue
    if (typeof t.meta?.file === 'string' && t.meta.file === relPath) return t.id
  }
  return null
}

import { nanoid } from 'nanoid'
import type { TileData, TileType } from '../../store/canvasStore'
import { DELEGATED_AGENT_TILE_SIZE, useCanvasStore } from '../../store/canvasStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { inferEditorLanguageFromPath, truncateForDiffMeta } from '../inferEditorLanguage'
import {
  findExistingEditorModuleForPath,
  recordOrchestratorToolOnModule,
} from './orchestratorModuleBindings'
import { revealOrchestratorTile } from './revealOrchestratorTile'
import * as tauri from '../tauri'
import { emitRefreshChangelog, emitRefreshResearch } from '../uiEvents'
import { useResearchSessionStore } from '../../store/researchSessionStore'
import { lineRangeForTextChange } from '../lineRangeForTextChange'
import { roughLineDiffStats } from '../writePreviewSnippet'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { glitterVerbForAgentSpawn } from './orchestratorShimmerVerbs'
import { ensureAgentTeamTile } from './ensureAgentTeamTile'
import { ensureGroupChatTile } from './ensureGroupChatTile'
import { useGroupChatStore, type GroupChatMessageKind } from '../../store/groupChatStore'
import { parseMentions } from '../groupChat/parseMentions'
import { startSubAgentRun } from './subAgentRunner'
import { useTodoStore } from '../../store/todoStore'
import { getDefaultSessionId } from '../persistence/sessionPersistence'
import { getMaxConcurrentSubAgentsFromSettings } from './orchestratorZaiLimits'
import { hierarchySpawn } from '../layout/hierarchySpawn'
import type { DiffReviewFileMeta } from './diffReviewTypes'
import { upsertDiffReviewSessionMeta } from './orchestratorDiffReview'
import { performWebSearch } from './webSearch'
import { useSettingsStore } from '../../store/settingsStore'
import { invokeHermesTool } from '../hermes/hermesServerTools'
import { useTerminalDiagnosticsStore } from '../../store/terminalDiagnosticsStore'
import {
  applySafetyMode,
  scanShellCommandForDanger,
  scanWorkspacePathForSensitivity,
} from './orchestratorSafetyGuard'
import { assertSafeWorkspacePath } from '../harness/permissionEnforcer'
import { applyToolResultBudget, maxResultCharsForTool } from '../harness/toolResultBudget'
import { getTerminalTailLinesSync } from '../persistence/terminalPersistence'
import { useTerminalCommandState } from '../../store/terminalCommandState'
import { terminalMetaCommandShouldBlockDuplicate } from './terminalCommandDuplicateGuard'
import { normalizeNonInteractiveShellInput } from '../terminal/nonInteractiveCommands'
import { classifyShellCommand } from '../terminal/shellRouter'
import { validateBashForMode } from '../harness/bashValidation'
import { throwIfAborted } from './abortable'
import { mergeReviewQueueSnapshot } from '../harness/mergeReviewerPipeline'
import { runPostToolUseHooks, runPreToolUseHooks } from '../harness/hooksRegistry'
import {
  parseWorkspaceMemoryScopes,
  searchWorkspaceMemoryMarkdown,
  type WorkspaceMemoryScopeId,
} from '../vault/searchWorkspaceMemory'
import { maybeScheduleMemPalaceScanAfterMarkdownWrite } from '../vault/vaultBrainMirror'
import { sanitizeHermesApiKeyForStorage } from '../hermes/hermesApiKey'
import { runHermesOrchestratorSetupDiagnose } from '../hermes/hermesOrchestratorSetupHelper'
import { getTasksPersistenceKey } from '../persistence/taskPersistence'
import {
  AMBIGUOUS_AGENT_BROWSER_TILE,
  NO_AGENT_BROWSER_TILE,
  resolveAgentBrowserTileForTools,
} from './agentBrowserTileResolve'
import {
  coerceBrowserLocalUrlToLatestTerminal,
  normalizeAndValidateAgentBrowserUrl,
} from '../agentBrowser/agentBrowserUrlPolicy'
import { navigateAgentBrowserTile } from '../agentBrowser/navigateAgentBrowserTile'
import { parseSubtasks } from './parseSubtasks'
import { computePresetLayout, getViewportLayoutRect, sortTilesForLayout } from '../layoutPresets'

function harnessSafetyMode(): 'off' | 'warn' | 'block' {
  return useSettingsStore.getState().harnessSafetyMode ?? 'warn'
}

function findTodoIdByLinkedText(linked: string): string | undefined {
  const q = linked.trim()
  if (!q) return undefined
  const tasks = useTodoStore.getState().tasks
  const exact = tasks.find((t) => t.text.trim() === q)
  if (exact) return exact.id
  return tasks.find((t) => t.text.includes(q))?.id
}

const RECENT_SUB_AGENT_REUSE_WINDOW_MS = 30_000
export const MAX_SUBTASKS_PER_AGENT = 3

/**
 * Default delegation UX: keep worker state in Agent Team + group chat and avoid rendering
 * one heavy canvas tile per default sub-agent (GPU/overdraw reduction).
 */
export function shouldHideDelegatedSubAgentTile(runner: 'default' | 'hermes'): boolean {
  return runner === 'default'
}

let delegatedSpawnScatterTimer: number | null = null
let delegatedSpawnScatterRaf: number | null = null

function scheduleDelegatedSpawnScatter(delayMs = 140): void {
  if (typeof window === 'undefined') return
  if (delegatedSpawnScatterTimer != null) {
    window.clearTimeout(delegatedSpawnScatterTimer)
  }
  delegatedSpawnScatterTimer = window.setTimeout(() => {
    delegatedSpawnScatterTimer = null
    runDelegatedSpawnScatterAnimation()
  }, Math.max(0, delayMs))
}

function runDelegatedSpawnScatterAnimation(durationMs = 260): void {
  if (typeof window === 'undefined') return
  const canvas = useCanvasStore.getState()
  if (canvas.smartCollapse || canvas.smartCollapsePicking || canvas.missionScatterPickMode) return
  const viewport = getViewportLayoutRect(canvas.pan, canvas.zoom)
  if (!viewport) return
  const visibleTiles = Array.from(canvas.tiles.values()).filter((tile) => {
    const meta = tile.meta as Record<string, unknown> | undefined
    return meta?.suppressCanvasRender !== true
  })
  if (visibleTiles.length < 2) return
  const sorted = sortTilesForLayout(visibleTiles)
  const targetLayout = computePresetLayout('scatter', sorted, viewport)
  if (targetLayout.length === 0) return

  const startRects = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (const tile of visibleTiles) {
    startRects.set(tile.id, { x: tile.x, y: tile.y, w: tile.w, h: tile.h })
  }
  if (delegatedSpawnScatterRaf != null) {
    window.cancelAnimationFrame(delegatedSpawnScatterRaf)
    delegatedSpawnScatterRaf = null
  }
  const startTs = performance.now()
  const dur = Math.max(120, durationMs)

  const step = (now: number) => {
    const t = Math.min(1, (now - startTs) / dur)
    const ease = 1 - (1 - t) * (1 - t)
    const updates = targetLayout.map((next) => {
      const from = startRects.get(next.id) ?? next
      return {
        id: next.id,
        x: from.x + (next.x - from.x) * ease,
        y: from.y + (next.y - from.y) * ease,
        w: from.w + (next.w - from.w) * ease,
        h: from.h + (next.h - from.h) * ease,
      }
    })
    useCanvasStore.getState().applyTilesLayout(updates)
    if (t < 1) {
      delegatedSpawnScatterRaf = window.requestAnimationFrame(step)
    } else {
      delegatedSpawnScatterRaf = null
      // Final snap prevents sub-pixel drift.
      useCanvasStore.getState().applyTilesLayout(targetLayout)
    }
  }

  delegatedSpawnScatterRaf = window.requestAnimationFrame(step)
}

export function validateSubAgentTaskScope(task: string):
  | { ok: true; subtasks: string[] }
  | { ok: false; subtasks: string[]; batches: string[][] } {
  const subtasks = parseSubtasks(task)
  if (subtasks.length <= MAX_SUBTASKS_PER_AGENT) return { ok: true, subtasks }
  const batches: string[][] = []
  for (let i = 0; i < subtasks.length; i += MAX_SUBTASKS_PER_AGENT) {
    batches.push(subtasks.slice(i, i + MAX_SUBTASKS_PER_AGENT))
  }
  return { ok: false, subtasks, batches }
}

function normalizeSubAgentIdentityPart(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function findReusableSubAgentTileId(params: {
  displayName: string
  role: string
  task: string
  /** Optional runner scope for dedupe (e.g. 'hermes' workers don't collide with 'default' workers of the same label). */
  runner?: string
  now?: number
}): { tileId: string; reason: 'active' | 'recent' } | null {
  const now = params.now ?? Date.now()
  const displayName = normalizeSubAgentIdentityPart(params.displayName)
  const role = normalizeSubAgentIdentityPart(params.role)
  const task = normalizeSubAgentIdentityPart(params.task)
  const runner = normalizeSubAgentIdentityPart(params.runner ?? 'default') || 'default'
  if (!displayName || !role || !task) return null

  const members = Object.values(useAgentTeamStore.getState().membersByTileId)
  for (const member of members) {
    if (normalizeSubAgentIdentityPart(member.displayName) !== displayName) continue
    if (normalizeSubAgentIdentityPart(member.role) !== role) continue
    if (normalizeSubAgentIdentityPart(member.delegatedTask ?? '') !== task) continue
    const tile = useCanvasStore.getState().tiles.get(member.tileId)
    const tileMeta =
      tile?.meta && typeof tile.meta === 'object' ? (tile.meta as Record<string, unknown>) : null
    const tileRunner = normalizeSubAgentIdentityPart(
      typeof tileMeta?.runner === 'string' ? tileMeta.runner : 'default'
    ) || 'default'
    if (tileRunner !== runner) continue
    if (member.status === 'working') {
      return { tileId: member.tileId, reason: 'active' }
    }
    if (
      member.status === 'done' &&
      now - (member.statusUpdatedAt || 0) <= RECENT_SUB_AGENT_REUSE_WINDOW_MS
    ) {
      return { tileId: member.tileId, reason: 'recent' }
    }
  }
  return null
}

export interface OrchestratorToolContext {
  orchestratorTileId: string | null
  /** Active workspace root snapshot for this run (absolute). */
  workspaceRoot?: string | null
  /** Monotonic orchestrator session run id (for grouping in Research tile). */
  runGeneration?: number
  /** When tools run inside a sub-agent tile, attribution for Research tile. */
  subAgentTileId?: string
  /**
   * Orchestrator session id used to scope Teams + Group Chat messages. When
   * absent, tools that need a session id fall back to `'default-session'`.
   */
  sessionId?: string
  /**
   * When set, `web_search` updates this Research tile row (pre-created by the tool batch)
   * instead of appending a new entry.
   */
  webSearchResearchEntryId?: string | null
  /**
   * Orchestrator run abort signal. Long-running tools (currently
   * `wait_for_sub_agent`) observe this so the parent's Stop button / nested
   * handoff cancellation tears them down cleanly.
   */
  signal?: AbortSignal
  /**
   * Optional log sink for long-running tools (stale-wait advisories). Wired
   * from the orchestrator tool batch `onLog`.
   */
  onLog?: (line: string) => void
}

/**
 * Sub-agents with an isolated git worktree store `isolatedWorktreeRelative` on the agent tile.
 * File tools pass workspace-relative paths; we prefix with that segment so reads/writes hit the
 * worktree checkout instead of the main working tree.
 */
export function resolvePathForOrchestratorTool(
  context: OrchestratorToolContext,
  relativePath: string
): { resolved: string; worktreeRelative: string | null } {
  const trimmed = relativePath.trim()
  const effective = trimmed || '.'
  const absoluteLike = effective.startsWith('/') || /^[A-Za-z]:[\\/]/.test(effective)

  const subId = context.subAgentTileId
  if (!subId) {
    return { resolved: effective === '.' ? '.' : effective, worktreeRelative: null }
  }

  const tile = useCanvasStore.getState().tiles.get(subId)
  const meta =
    tile?.meta && typeof tile.meta === 'object' ? (tile.meta as Record<string, unknown>) : null
  const wtRaw = meta?.isolatedWorktreeRelative
  const wt =
    typeof wtRaw === 'string' ? wtRaw.trim().replace(/^[/\\]+/, '').replace(/[/\\]+$/, '') : ''
  if (!wt) {
    return { resolved: effective === '.' ? '.' : effective, worktreeRelative: null }
  }

  if (effective === '.' || effective === '') {
    return { resolved: wt, worktreeRelative: wt }
  }
  // Preserve absolute paths so downstream workspace validators reject them explicitly.
  if (absoluteLike) {
    return { resolved: effective, worktreeRelative: wt }
  }
  const withoutDotPrefix = effective.replace(/^\.([/\\]|$)/, '')
  return { resolved: `${wt}/${withoutDotPrefix}`.replace(/[/\\]+/g, '/'), worktreeRelative: wt }
}

const TILE_TYPES = new Set<TileType>([
  'terminal',
  'editor',
  'browser',
  'agent_browser',
  'github',
  'diff',
  'todo',
  'agent',
  'agent_team',
  'changelog',
  'orchestrator',
  'benchmark',
  'remotion',
  'openrouter_usage',
  'toolbox',
  'research',
  'reasoning',
  'project_status',
  'telemetry',
  'hermes_bridge',
  'hermes_agent',
  'telegram_onboard',
  'native_gateway',
])

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const WEB_PREVIEW_EXTENSIONS = new Set([
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'vue',
  'svelte',
])

/** Orca-managed web preview tile (scoped per workspace); do not reuse arbitrary user browser tiles. */
const ORCA_WEB_PREVIEW_ROLE = 'orca-web-preview' as const

function shouldBumpPreviewReloadForOrcaWebPreview(
  tile: TileData,
  workspaceKey: string
): boolean {
  if (tile.type !== 'browser') return false
  if (tile.meta?.source !== 'orchestrator-auto') return false
  if (tile.meta?.previewRole !== ORCA_WEB_PREVIEW_ROLE) return false
  return tile.meta?.workspaceRootKey === workspaceKey
}

function fileExtension(path: string): string {
  const parts = path.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

function findFirstTileIdByType(type: TileType): string | null {
  for (const [id, t] of useCanvasStore.getState().tiles) {
    if (t.type === type) return id
  }
  return null
}

/**
 * Replace orchestrator prompt placeholders with the actual workspace root path.
 * Prevents terminal commands like `cd "<Workspace root>"` from executing literally.
 */
function resolveActiveWorkspaceRoot(context?: OrchestratorToolContext): string | null {
  const fromContext = typeof context?.workspaceRoot === 'string' ? context.workspaceRoot.trim() : ''
  if (fromContext && fromContext !== '.') return fromContext
  const root = useWorkspaceStore.getState().rootPath
  if (!root || root === '.') return null
  return root
}

function expandWorkspaceRootPlaceholder(command: string, context?: OrchestratorToolContext): string {
  const raw = command.trim()
  if (!raw) return command
  const root = resolveActiveWorkspaceRoot(context)
  if (!root) return command
  return raw.replace(/<workspace root>/gi, root)
}

function normalizeAbsoluteForCompare(path: string): string {
  const raw = path.trim().replace(/\\/g, '/')
  if (!raw) return ''
  const noTrailing = raw.replace(/\/+$/, '')
  return noTrailing.length === 2 && /^[A-Za-z]:$/.test(noTrailing)
    ? `${noTrailing}/`
    : noTrailing
}

function absoluteWithinAllowedRoots(absPath: string, allowedRoots: string[]): boolean {
  const candidate = normalizeAbsoluteForCompare(absPath)
  if (!candidate) return false
  for (const root of allowedRoots) {
    const normRoot = normalizeAbsoluteForCompare(root)
    if (!normRoot) continue
    if (candidate === normRoot) return true
    if (candidate.startsWith(`${normRoot}/`)) return true
  }
  return false
}

function stripShellPathToken(raw: string): string {
  let t = raw.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim()
  }
  return t
}

function extractCdTargets(command: string): string[] {
  const out: string[] = []
  const re = /(?:^|[;&|]\s*)cd\s+((?:"[^"]*"|'[^']*'|[^;&|])+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command)) !== null) {
    const target = stripShellPathToken(m[1] ?? '')
    if (target) out.push(target)
  }
  return out
}

export function enforceRunShellWorkspaceScope(
  command: string,
  allowedRoots: string[]
): { ok: true } | { ok: false; error: string } {
  const roots = allowedRoots.map((r) => normalizeAbsoluteForCompare(r)).filter(Boolean)
  if (roots.length === 0) return { ok: true }
  const cdTargets = extractCdTargets(command)
  for (const rawTarget of cdTargets) {
    const target = rawTarget.trim()
    if (!target) continue
    if (target === '-' || target === '.') continue
    if (target.startsWith('~')) {
      return { ok: false, error: `run_shell_command out-of-scope cd blocked: ${target}` }
    }
    if (/^[A-Za-z]:[\\/]/.test(target) || target.startsWith('/')) {
      if (!absoluteWithinAllowedRoots(target, roots)) {
        return { ok: false, error: `run_shell_command out-of-scope cd blocked: ${target}` }
      }
      continue
    }
    if (/(^|[/\\])\.\.([/\\]|$)/.test(target)) {
      return { ok: false, error: `run_shell_command parent traversal blocked in cd target: ${target}` }
    }
  }
  return { ok: true }
}

/**
 * `npx serve` silently falls back to a random free port when requested port is busy.
 * Force explicit failure instead, so orchestrator can recover deterministically.
 */
function enforceServeNoPortSwitching(command: string): string {
  const raw = command.trim()
  if (!raw) return command
  const looksLikeServe =
    /\bnpx\b[\s\S]*\bserve\b/i.test(raw) || /\bserve\b[\s\S]*\s-l\s+\d+/i.test(raw)
  if (!looksLikeServe) return command
  if (/\b--no-port-switching\b/i.test(raw)) return command
  return `${raw} --no-port-switching`
}

export type ShellRecoveryBranch = {
  /** Stable classifier key so evaluators/UI can reason about branching behavior. */
  classification:
    | 'timeout'
    | 'git_not_repo'
    | 'git_no_remote'
    | 'git_auth'
    | 'command_not_found'
    | 'permission_denied'
    | 'network'
    | 'unknown'
  rationale: string
  next_checks: string[]
  fallback_steps: string[]
  verify_steps: string[]
}

export type PathMutationRecoveryBranch = {
  classification:
    | 'path_out_of_scope'
    | 'sensitive_path_blocked'
    | 'permission_denied'
    | 'target_missing'
    | 'unknown'
  rationale: string
  next_checks: string[]
  fallback_steps: string[]
  verify_steps: string[]
}

export function buildPathMutationRecoveryBranch(params: {
  tool: 'write_file' | 'delete_file'
  path: string
  error?: string
  safetyBlocked?: boolean
}): PathMutationRecoveryBranch {
  const err = String(params.error ?? '').trim()
  const errLower = err.toLowerCase()

  if (/outside workspace|path traversal|absolute path/.test(errLower)) {
    return {
      classification: 'path_out_of_scope',
      rationale: 'Requested file path is outside the allowed workspace scope.',
      next_checks: [
        'Resolve active workspace root and compare with requested path.',
        'Normalize to a workspace-relative path before mutating.',
      ],
      fallback_steps: [
        'Re-run mutation with a safe workspace-relative path.',
        'If cross-workspace change is intended, explicitly switch workspace first.',
      ],
      verify_steps: ['Confirm resulting path resolves under active workspace root.'],
    }
  }

  if (params.safetyBlocked || /blocked by harness safety|secrets|credentials|sensitive/i.test(errLower)) {
    return {
      classification: 'sensitive_path_blocked',
      rationale: 'Mutation was blocked by sensitive-path safety policy.',
      next_checks: [
        'Inspect target path for secret-bearing segments (.env/.ssh/credentials/secret).',
        'Validate whether write/delete is truly required for this sensitive file.',
      ],
      fallback_steps: [
        'Use a non-sensitive path or masked/template file for intermediary edits.',
        'If sensitive mutation is required, request explicit confirmation/policy override path.',
      ],
      verify_steps: ['Confirm target path and resulting file content avoid secret exposure risk.'],
    }
  }

  if (/permission denied|operation not permitted|eacces|eprem/.test(errLower)) {
    return {
      classification: 'permission_denied',
      rationale: 'Filesystem mutation failed due to permission constraints.',
      next_checks: ['Inspect file/dir ownership and write/delete permissions for target path.'],
      fallback_steps: [
        'Apply least-privilege permission fix or choose writable workspace subpath.',
        'Retry mutation only after permission probe passes.',
      ],
      verify_steps: ['Confirm mutation succeeds and file metadata is as expected.'],
    }
  }

  if (/no such file|not found|enoent/.test(errLower)) {
    return {
      classification: 'target_missing',
      rationale: 'Target file/path does not exist in current workspace state.',
      next_checks: ['List/read parent directory to confirm expected target path.'],
      fallback_steps: [
        'For writes: create parent path or use intended existing file path.',
        'For deletes: treat as idempotent no-op when absence is acceptable.',
      ],
      verify_steps: ['Verify file presence/absence now matches intended end state.'],
    }
  }

  return {
    classification: 'unknown',
    rationale: 'Mutation failed; branch to targeted diagnosis before retry.',
    next_checks: ['Capture exact path + error text and run a focused filesystem probe.'],
    fallback_steps: ['Apply one deterministic remediation branch based on probe result.'],
    verify_steps: ['Re-run a narrow verification check for the intended file state.'],
  }
}

/**
 * Error-first recovery helper:
 * treat shell failures as structured routing signals (not dead-end failure text).
 */
export function buildShellRecoveryBranch(params: {
  command: string
  exitCode: number
  stderr?: string
  timedOut?: boolean
}): ShellRecoveryBranch | null {
  const command = params.command.trim()
  const stderr = String(params.stderr ?? '').trim()
  const stderrLower = stderr.toLowerCase()

  if (!params.timedOut && params.exitCode === 0) return null

  const defaultBranch: ShellRecoveryBranch = {
    classification: 'unknown',
    rationale: 'Non-zero exit code indicates this path failed; branch to targeted diagnosis before retrying.',
    next_checks: [
      'Capture preflight state for the failing domain (paths/auth/repo/tool availability).',
      'Use one focused probe to confirm the root cause before mutating state.',
    ],
    fallback_steps: [
      'Apply one deterministic remediation branch that matches the diagnosed cause.',
      'Do not retry the same failing command unchanged.',
    ],
    verify_steps: [
      'Re-run the relevant preflight check.',
      'Confirm end-state artifacts for the user goal (not just command success).',
    ],
  }

  if (params.timedOut) {
    return {
      classification: 'timeout',
      rationale: 'Command timed out; likely long-running or stuck. Branch to timeout remediation instead of blind retry.',
      next_checks: [
        'Inspect partial stdout/stderr to identify the last successful sub-step.',
        'Decide whether this command belongs in a long-running terminal tile session.',
      ],
      fallback_steps: [
        'Retry with an explicit longer timeout only if progress was evident.',
        'Otherwise split into bounded sub-commands or move to terminal tile workflow.',
      ],
      verify_steps: [
        'Confirm the intended artifact exists (file/process/commit) before continuing.',
      ],
    }
  }

  if (/not a git repository/.test(stderrLower) || (params.exitCode === 128 && /git/.test(command))) {
    return {
      classification: 'git_not_repo',
      rationale: 'Git command failed because current path is not an initialized repository.',
      next_checks: [
        'Preflight: git rev-parse --is-inside-work-tree',
        'Confirm .git presence in current/parent path and inspect .gitignore before first commit.',
      ],
      fallback_steps: [
        'Initialize repo (git init -b main), then stage and commit baseline changes.',
        'Only after repo exists, branch to remote/auth checks for push.',
      ],
      verify_steps: [
        'Verify commit SHA exists and git status is clean or expected.',
        'Verify remote URL/tracking state if push was the task goal.',
      ],
    }
  }

  if (
    /no configured push destination/.test(stderrLower) ||
    /does not appear to be a git repository/.test(stderrLower) ||
    /no such remote/.test(stderrLower)
  ) {
    return {
      classification: 'git_no_remote',
      rationale: 'Push path failed because remote configuration is missing/invalid.',
      next_checks: ['Run git remote -v and confirm expected origin target.'],
      fallback_steps: [
        'If origin exists, fix URL and retry push.',
        'If origin missing, create/set origin (or gh repo create --push when appropriate).',
      ],
      verify_steps: ['Confirm git remote -v and upstream tracking after remediation.'],
    }
  }

  if (
    /permission denied \(publickey\)/.test(stderrLower) ||
    /authentication failed/.test(stderrLower) ||
    /could not read username/.test(stderrLower)
  ) {
    return {
      classification: 'git_auth',
      rationale: 'Remote authentication failed; branch to credential remediation.',
      next_checks: ['Run gh auth status (or provider auth probe) before retrying push/pull.'],
      fallback_steps: [
        'Re-authenticate or switch to a valid credential path (SSH key/token).',
        'Retry the original git action only after auth probe succeeds.',
      ],
      verify_steps: ['Verify remote operation succeeds and remote URL is reachable.'],
    }
  }

  if (params.exitCode === 127 || /command not found/.test(stderrLower)) {
    return {
      classification: 'command_not_found',
      rationale: 'Shell command is unavailable in current environment/path.',
      next_checks: ['Probe command availability (which/command -v) and PATH context.'],
      fallback_steps: [
        'Install required dependency or use project-supported alternative command.',
        'Re-run only the missing command preflight before full workflow retry.',
      ],
      verify_steps: ['Confirm command -v <tool> succeeds and target sub-step completes.'],
    }
  }

  if (/permission denied/.test(stderrLower) || params.exitCode === 126) {
    return {
      classification: 'permission_denied',
      rationale: 'Execution failed due to permission constraints.',
      next_checks: ['Inspect file/directory ownership and executable permissions for target path.'],
      fallback_steps: [
        'Apply least-privilege permission fix (chmod/chown/path relocation as appropriate).',
        'Avoid broad privileged reruns without confirming root cause.',
      ],
      verify_steps: ['Re-run the blocked sub-step and confirm expected artifact/state change.'],
    }
  }

  if (
    /could not resolve host/.test(stderrLower) ||
    /connection timed out/.test(stderrLower) ||
    /temporary failure in name resolution/.test(stderrLower)
  ) {
    return {
      classification: 'network',
      rationale: 'Network/DNS failure detected; branch to connectivity remediation.',
      next_checks: ['Probe connectivity to target host and verify DNS resolution.'],
      fallback_steps: [
        'Retry with bounded backoff only after connectivity probe passes.',
        'If still failing, switch to offline/local fallback path when possible.',
      ],
      verify_steps: ['Confirm network probe and original operation both succeed.'],
    }
  }

  return defaultBranch
}

function commandWithArgvForSafety(meta: Record<string, unknown>): string {
  const command = typeof meta.command === 'string' ? meta.command : ''
  const argv =
    Array.isArray(meta.command_argv) && meta.command_argv.every((x) => typeof x === 'string')
      ? (meta.command_argv as string[])
      : null
  if (!argv || argv.length === 0) return command
  return argv.join(' ')
}

function normalizeTerminalMetaCommand(
  meta: Record<string, unknown>
): Record<string, unknown> {
  const cmd = typeof meta.command === 'string' ? meta.command : ''
  const argv =
    Array.isArray(meta.command_argv) && meta.command_argv.every((x) => typeof x === 'string')
      ? (meta.command_argv as string[])
      : undefined
  if (!cmd.trim() && (!argv || argv.length === 0)) return meta
  const normalized = normalizeNonInteractiveShellInput({ command: cmd, argv })
  return {
    ...meta,
    command: normalized.command,
    ...(normalized.argv ? { command_argv: normalized.argv } : {}),
  }
}

function ensureDiffTile(sourceSessionTileId: string | null): string {
  const existingId = findFirstTileIdByType('diff')
  if (existingId) return existingId
  const id = useCanvasStore.getState().addTileIntelligent('diff')
  useCanvasStore.getState().updateTile(id, {
    title: 'Changes',
    meta: { source: 'orchestrator-auto' },
  })
  revealOrchestratorTile(id, { label: 'Comparing changes…', effect: 'shimmer' }, sourceSessionTileId)
  return id
}

type WebPreviewOptions = {
  /** Optional browser tile title (e.g. "Architecture" for ARCHITECTURE.html). */
  previewTitle?: string
  /** Absolute file path to preview in the browser tile. */
  previewFilePath?: string
}

function findManagedWebPreviewTileId(workspaceKey: string): string | null {
  for (const [id, t] of useCanvasStore.getState().tiles) {
    if (t.type !== 'browser') continue
    if (t.meta?.source !== 'orchestrator-auto') continue
    if (t.meta?.previewRole !== ORCA_WEB_PREVIEW_ROLE) continue
    if (t.meta?.workspaceRootKey !== workspaceKey) continue
    return id
  }
  return null
}

/**
 * Legacy auto-preview tiles had `source: orchestrator-auto` but no workspace scope, or were
 * upgraded to `agent_browser`. Normalise them to plain `browser` tiles with workspace scope.
 */
function upgradeLegacyOrchestratorPreviewTile(workspaceKey: string): string | null {
  for (const [id, t] of useCanvasStore.getState().tiles) {
    if (t.type !== 'browser' && t.type !== 'agent_browser') continue
    if (t.meta?.source !== 'orchestrator-auto') continue
    if (t.meta?.previewRole && t.meta?.workspaceRootKey) continue
    useCanvasStore.getState().updateTile(id, {
      type: 'browser',
      meta: {
        ...(t.meta as Record<string, unknown>),
        previewRole: ORCA_WEB_PREVIEW_ROLE,
        workspaceRootKey: workspaceKey,
      },
    })
    return id
  }
  return null
}

function ensureBrowserTileForWebPreview(
  sourceSessionTileId: string | null,
  opts?: WebPreviewOptions
): string {
  const previewTitle = opts?.previewTitle?.trim()
  const previewFilePath = opts?.previewFilePath?.trim()
  const workspaceKey = getTasksPersistenceKey(useWorkspaceStore.getState().rootPath)

  let existingId = findManagedWebPreviewTileId(workspaceKey)
  if (!existingId) {
    existingId = upgradeLegacyOrchestratorPreviewTile(workspaceKey)
  }

  if (existingId) {
    const existing = useCanvasStore.getState().tiles.get(existingId)
    if (existing) {
      const update: Record<string, unknown> = {}
      if (previewTitle) update.title = previewTitle
      const meta: Record<string, unknown> = {
        ...((existing.meta as Record<string, unknown>) ?? {}),
        source: 'orchestrator-auto',
        previewRole: ORCA_WEB_PREVIEW_ROLE,
        workspaceRootKey: workspaceKey,
      }
      if (previewFilePath) meta.previewFilePath = previewFilePath
      update.meta = meta
      useCanvasStore.getState().updateTile(existingId, update as any)
    }
    revealOrchestratorTile(
      existingId,
      {
        label: previewTitle ? 'Opening preview…' : 'Refreshing preview…',
        effect: 'pulse',
      },
      sourceSessionTileId
    )
    return existingId
  }
  const id = useCanvasStore.getState().addTileIntelligent('browser')
  useCanvasStore.getState().updateTile(id, {
    title: previewTitle ?? 'Preview',
    meta: {
      source: 'orchestrator-auto',
      previewRole: ORCA_WEB_PREVIEW_ROLE,
      workspaceRootKey: workspaceKey,
      ...(previewFilePath ? { previewFilePath } : {}),
    },
  })
  revealOrchestratorTile(id, { label: 'Opening preview…', effect: 'pulse' }, sourceSessionTileId, { preferFit: true })
  return id
}

function jsonErr(message: string, extras?: Record<string, unknown>) {
  return JSON.stringify({ ok: false, error: message, ...(extras ?? {}) })
}

function jsonOk(payload: Record<string, unknown>) {
  return JSON.stringify({ ok: true, ...payload })
}

type HermesMemoryAction = 'add' | 'replace' | 'remove'
type HermesMemoryTarget = 'memory' | 'user'

function coerceHermesMemoryAction(v: unknown): HermesMemoryAction | null {
  const t = String(v ?? '')
  if (t === 'add' || t === 'replace' || t === 'remove') return t
  return null
}

function coerceHermesMemoryTarget(v: unknown): HermesMemoryTarget | null {
  const t = String(v ?? '')
  if (t === 'memory' || t === 'user') return t
  return null
}

function applyHermesMemoryMutation(params: {
  existing: string
  action: HermesMemoryAction
  content?: string
  oldText?: string
}): { ok: true; next: string; changed: boolean } | { ok: false; error: string } {
  const existing = params.existing
  const action = params.action
  const content = (params.content ?? '').trim()
  const oldText = (params.oldText ?? '').trim()

  if (action === 'add') {
    if (!content) return { ok: false, error: 'content required for action=add' }
    const entry = content.startsWith('-') ? content : `- ${content}`
    const next = existing.trim()
      ? `${existing.replace(/\s+$/, '')}\n${entry}\n`
      : `${entry}\n`
    return { ok: true, next, changed: next !== existing }
  }

  if (!oldText) {
    return { ok: false, error: 'old_text required for action=replace/remove' }
  }
  const idx = existing.indexOf(oldText)
  if (idx < 0) {
    return { ok: false, error: 'old_text not found in target memory file' }
  }

  if (action === 'replace') {
    if (!content) return { ok: false, error: 'content required for action=replace' }
    const next = `${existing.slice(0, idx)}${content}${existing.slice(idx + oldText.length)}`
    return { ok: true, next, changed: next !== existing }
  }

  const next = `${existing.slice(0, idx)}${existing.slice(idx + oldText.length)}`
  return { ok: true, next, changed: next !== existing }
}

function messageForAgentBrowserTileResolveFailure(error: string): string {
  if (error === NO_AGENT_BROWSER_TILE) {
    return 'No agent_browser tile found. Call browser_open first (or pass tile_id from a prior browser_open).'
  }
  if (error === AMBIGUOUS_AGENT_BROWSER_TILE) {
    return 'Multiple agent_browser tiles exist; pass tile_id from browser_open for the session you want.'
  }
  return error
}

const HERMES_NATIVE_BROWSER_TOOL_EQUIVALENTS: Record<string, string> = {
  browser_navigate: 'browser_open',
  browser_type: 'browser_fill',
  browser_console: 'browser_snapshot / browser_get_text',
  browser_get_images: 'browser_screenshot',
  browser_back: 'browser_click (Back button) or browser_open(previous_url)',
}

export function isHermesNativeBrowserToolName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(HERMES_NATIVE_BROWSER_TOOL_EQUIVALENTS, name)
}

export function shouldBlockHermesNativeBrowserToolForCurrentLeadProfile(): boolean {
  return useSettingsStore.getState().leadProfile !== 'hermes'
}

export function hermesNativeBrowserToolPolicyMessage(name: string): string {
  const replacement = HERMES_NATIVE_BROWSER_TOOL_EQUIVALENTS[name]
  const replacementLine = replacement ? ` Use Orca tile browser tool: ${replacement}.` : ''
  return (
    `Tool policy: "${name}" is a Hermes-native browser API tool and is disabled when lead profile is default.` +
    ` Switch to Hermes Lead mode to keep Hermes native tools end-to-end.` +
    `${replacementLine} Default profile path starts with browser_open(url) and continues with browser_snapshot/browser_click/browser_fill/browser_press/browser_scroll/browser_wait/browser_get_text.`
  )
}

// Dreaming/world-model browser preflight was decommissioned for Orca harness reliability scope.
// Browser tools now execute directly without dream-state coupling.

function emitDebugLog(
  runId: string,
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  fetch('http://127.0.0.1:7696/ingest/d871edbc-ff39-4d74-96b8-887cea450cfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'eaa681' },
    body: JSON.stringify({
      sessionId: 'eaa681',
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}

/** Only these tools drive hub→module link animation (auto-focus / reveal). */
function toolCountsForHubLinkAnimation(name: string, args: Record<string, unknown>): boolean {
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'canvas_create_tile':
    case 'spawn_sub_agent':
    case 'chat_with_hermes_tile':
      return true
    case 'canvas_update_tile':
      return args.remove !== true
    case 'record_benchmark_session':
      return true
    default:
      return false
  }
}

export function requiresAgentBrowserCliPreflight(name: string): boolean {
  switch (name) {
    case 'browser_snapshot':
    case 'browser_click':
    case 'browser_fill':
    case 'browser_press':
    case 'browser_screenshot':
    case 'browser_scroll':
    case 'browser_wait':
    case 'browser_get_text':
      return true
    default:
      return false
  }
}

export async function executeOrchestratorTool(
  name: string,
  rawArgs: string,
  context: OrchestratorToolContext = { orchestratorTileId: null }
): Promise<string> {
  let args: Record<string, unknown>
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
  } catch {
    return jsonErr('Invalid JSON in tool arguments')
  }

  const orchId = context.orchestratorTileId

  if (isHermesNativeBrowserToolName(name) && shouldBlockHermesNativeBrowserToolForCurrentLeadProfile()) {
    const message = hermesNativeBrowserToolPolicyMessage(name)
    recordOrchestratorToolOnModule(orchId, name, {
      blocked: true,
      reason: 'hermes_native_browser_tool',
      lead_profile: useSettingsStore.getState().leadProfile,
    })
    return jsonErr(message)
  }

  await runPreToolUseHooks({ toolName: name, argsJson: rawArgs })

  /** New tool replaces previous agent attention hint (avoid stale tile focus). */
  useOrchestratorActivityStore.getState().setAgentTileFocus(null)

  const countHubLink = toolCountsForHubLinkAnimation(name, args)
  if (countHubLink) {
    useOrchestratorActivityStore.getState().incrementSessionToolDepth(orchId)
  }
  let toolResult: string
  try {
    toolResult = await (async (): Promise<string> => {
      try {
        if (requiresAgentBrowserCliPreflight(name)) {
          if (!tauri.isTauri()) {
            return jsonErr('agent-browser requires the Orca desktop app')
          }
          try {
            await tauri.ensureAgentBrowserCliInstalled()
          } catch (e) {
            return jsonErr(e instanceof Error ? e.message : String(e))
          }
        }

        switch (name) {
      case 'read_file': {
        const rawPath = String(args.path ?? '')
        if (!rawPath) return jsonErr('path required')
        const { resolved: path } = resolvePathForOrchestratorTool(context, rawPath)
        try {
          assertSafeWorkspacePath(path)
        } catch (e) {
          return jsonErr(e instanceof Error ? e.message : String(e))
        }
        const content = await tauri.readFile(path)
        const base = path.split(/[/\\]/).pop() ?? path
        const lineCount = Math.max(1, content.split('\n').length)
        const scanToken = Date.now()

        const num = (v: unknown): number | undefined => {
          if (v === undefined || v === null) return undefined
          const n = Number(v)
          return Number.isFinite(n) ? n : undefined
        }
        const clampLine = (n: number) => Math.min(Math.max(1, Math.floor(n)), lineCount)
        /** Default read animation viewport when the model omits a range — avoids sweeping huge files. */
        const VIEWPORT_LINES = 80
        /** Hard cap on how many lines the sweep animates (inclusive span). */
        const MAX_READ_ANIM_SPAN = 200

        const startArg = num(args.start_line) ?? num(args.startLine)
        const endArg = num(args.end_line) ?? num(args.endLine)
        const offsetArg = num(args.offset)
        const limitArg = num(args.limit)

        let startLine = 1
        let endLine = Math.min(lineCount, VIEWPORT_LINES)

        if (startArg != null && endArg != null) {
          startLine = clampLine(startArg)
          endLine = clampLine(endArg)
          if (endLine < startLine) endLine = startLine
        } else if (offsetArg != null && limitArg != null) {
          startLine = clampLine(offsetArg)
          const lim = Math.max(1, Math.floor(limitArg))
          endLine = Math.min(lineCount, startLine + lim - 1)
        } else if (offsetArg != null) {
          startLine = clampLine(offsetArg)
          endLine = Math.min(lineCount, startLine + VIEWPORT_LINES - 1)
        } else if (lineCount > VIEWPORT_LINES) {
          startLine = 1
          endLine = VIEWPORT_LINES
        } else {
          startLine = 1
          endLine = lineCount
        }

        if (endLine - startLine + 1 > MAX_READ_ANIM_SPAN) {
          endLine = startLine + MAX_READ_ANIM_SPAN - 1
        }

        const existingEditorId = findExistingEditorModuleForPath(path)
        if (existingEditorId) {
          useCanvasStore.getState().updateTile(existingEditorId, {
            meta: {
              ...useCanvasStore.getState().tiles.get(existingEditorId)?.meta,
              file: path,
              agentReadScan: {
                lineCount,
                token: scanToken,
                startLine,
                endLine,
              },
            },
          })
          revealOrchestratorTile(
            existingEditorId,
            {
              label: `Reading ${base}`,
              effect: 'pulse',
            },
            orchId
          )
          useOrchestratorActivityStore.getState().setAgentTileFocus({
            tileId: existingEditorId,
            tileType: 'editor',
            action: 'reading',
            progress: 0,
            detail: `${startLine}–${endLine}`,
          })
        }
        recordOrchestratorToolOnModule(orchId, name, args)
        const budgeted = applyToolResultBudget(
          'read_file',
          content,
          maxResultCharsForTool('read_file')
        )
        return jsonOk({
          path,
          requested_path: rawPath,
          content: budgeted.text,
          truncated: budgeted.truncated,
        })
      }
      case 'write_file': {
        const rawPath = String(args.path ?? '')
        const hasContentArg = typeof args.content === 'string'
        const hasBodyArg = typeof (args as Record<string, unknown>).body === 'string'
        if (!hasContentArg && !hasBodyArg) {
          return jsonErr('write_file requires content (body is accepted for compatibility)')
        }
        const content = hasContentArg
          ? String(args.content)
          : String((args as Record<string, unknown>).body)
        if (!rawPath) return jsonErr('path required')
        const { resolved: path } = resolvePathForOrchestratorTool(context, rawPath)
        try {
          assertSafeWorkspacePath(path)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return jsonErr(msg, {
            error_as_data: true,
            remediation_required: true,
            recovery_branch: buildPathMutationRecoveryBranch({
              tool: 'write_file',
              path,
              error: msg,
            }),
          })
        }
        {
          const mode = harnessSafetyMode()
          if (mode !== 'off') {
            const sens = scanWorkspacePathForSensitivity(path)
            const gate = applySafetyMode(mode, sens)
            if (!gate.allow) {
              const message = gate.message ?? 'blocked'
              return jsonErr(message, {
                error_as_data: true,
                remediation_required: true,
                recovery_branch: buildPathMutationRecoveryBranch({
                  tool: 'write_file',
                  path,
                  error: message,
                  safetyBlocked: true,
                }),
              })
            }
          }
        }
        let previous = ''
        let hadPrevious = false
        try {
          previous = await tauri.readFile(path)
          hadPrevious = true
        } catch {
          previous = ''
        }
        const lang = inferEditorLanguageFromPath(path)
        const base = path.split(/[/\\]/).pop() ?? path
        const { added, removed } = roughLineDiffStats(previous, content)
        const previewId = useOrchestratorActivityStore.getState().pushWritePreview({
          path,
          fileName: base,
          language: lang,
          added,
          removed,
          previous,
          next: content,
        })
        try {
          await tauri.writeFile(path, content)
          useOrchestratorActivityStore.getState().patchWritePreview(previewId, { done: true })
          if (useOrchestratorActivityStore.getState().autoAcceptOrchestratorDiffs) {
            useOrchestratorActivityStore.getState().removeWritePreview(previewId)
          }
        } catch (e) {
          useOrchestratorActivityStore.getState().patchWritePreview(previewId, { done: false })
          const msg = e instanceof Error ? e.message : String(e)
          return jsonErr(msg, {
            error_as_data: true,
            remediation_required: true,
            recovery_branch: buildPathMutationRecoveryBranch({
              tool: 'write_file',
              path,
              error: msg,
            }),
          })
        }
        emitRefreshChangelog({ reason: 'file-written', sourceTileId: orchId ?? undefined })
        await useWorkspaceStore.getState().syncExplorerAfterWrite(path)
        const o = truncateForDiffMeta(previous)
        const m = truncateForDiffMeta(content)
        const diffScrollTo = lineRangeForTextChange(o.text, m.text)
        const diffTileId = ensureDiffTile(orchId)
        const diffTile = useCanvasStore.getState().tiles.get(diffTileId)
        if (diffTile) {
          const reviewEntry: DiffReviewFileMeta = {
            path,
            fileName: base,
            language: lang,
            original: o.text,
            modified: m.text,
            truncated: o.truncated || m.truncated,
            added,
            removed,
          }
          useCanvasStore.getState().updateTile(diffTileId, {
            meta: upsertDiffReviewSessionMeta(diffTile.meta, reviewEntry, diffScrollTo),
          })
          revealOrchestratorTile(
            diffTileId,
            {
              label: 'Comparing changes…',
              effect: 'shimmer',
            },
            orchId
          )
        }

        if (WEB_PREVIEW_EXTENSIONS.has(fileExtension(path))) {
          const ext = fileExtension(path)
          let webPreviewOpts: WebPreviewOptions | undefined
          if (ext === 'html' || ext === 'htm') {
            const base = path.split(/[/\\]/).pop() ?? path
            const rootPath = useWorkspaceStore.getState().rootPath
            const absPath = rootPath ? `${rootPath}/${path}` : path
            webPreviewOpts = { previewFilePath: absPath }
            if (/^ARCHITECTURE\.html$/i.test(base)) {
              webPreviewOpts.previewTitle = 'Architecture'
            }
          }
          ensureBrowserTileForWebPreview(orchId, webPreviewOpts)
        }

        const st = useCanvasStore.getState()
        const previewWorkspaceKey = getTasksPersistenceKey(
          useWorkspaceStore.getState().rootPath
        )
        for (const [browserId, bt] of st.tiles) {
          if (!shouldBumpPreviewReloadForOrcaWebPreview(bt, previewWorkspaceKey)) continue
          const prevGen =
            typeof bt.meta?.previewReloadGeneration === 'number'
              ? bt.meta.previewReloadGeneration
              : 0
          st.updateTile(browserId, {
            meta: {
              ...bt.meta,
              previewReloadGeneration: prevGen + 1,
            },
          })
        }
        useOrchestratorActivityStore.getState().setAgentTileFocus({
          tileId: diffTileId,
          tileType: 'diff',
          action: 'writing',
          progress: 0,
          detail: base,
        })
        recordOrchestratorToolOnModule(orchId, name, args)
        maybeScheduleMemPalaceScanAfterMarkdownWrite(path)
        return jsonOk({
          path,
          requested_path: rawPath,
          bytes: content.length,
          had_previous: hadPrevious,
          previous_bytes: previous.length,
          language: lang,
          note:
            'Diff tile is auto-created/updated on writes. For web files, a workspace-scoped Orca preview browser tile is created if missing (set its URL to your dev server; use find_available_port and a local server such as python3 -m http.server — never assume 5173/3000 are free). Only that managed preview tile reloads on each web write.',
        })
      }
      case 'delete_file': {
        const rawPath = String(args.path ?? '')
        if (!rawPath) return jsonErr('path required')
        const { resolved: path } = resolvePathForOrchestratorTool(context, rawPath)
        try {
          assertSafeWorkspacePath(path)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return jsonErr(msg, {
            error_as_data: true,
            remediation_required: true,
            recovery_branch: buildPathMutationRecoveryBranch({
              tool: 'delete_file',
              path,
              error: msg,
            }),
          })
        }
        {
          const mode = harnessSafetyMode()
          if (mode !== 'off') {
            const sens = scanWorkspacePathForSensitivity(path)
            const gate = applySafetyMode(mode, sens)
            if (!gate.allow) {
              const message = gate.message ?? 'blocked'
              return jsonErr(message, {
                error_as_data: true,
                remediation_required: true,
                recovery_branch: buildPathMutationRecoveryBranch({
                  tool: 'delete_file',
                  path,
                  error: message,
                  safetyBlocked: true,
                }),
              })
            }
          }
        }
        try {
          await tauri.deletePath(path)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return jsonErr(msg, {
            error_as_data: true,
            remediation_required: true,
            recovery_branch: buildPathMutationRecoveryBranch({
              tool: 'delete_file',
              path,
              error: msg,
            }),
          })
        }
        await useWorkspaceStore.getState().syncExplorerAfterDelete(path)
        recordOrchestratorToolOnModule(orchId, name, args)
        return jsonOk({ path, requested_path: rawPath, deleted: true })
      }
      case 'list_directory': {
        const rawPath = String(args.path ?? '.')
        const { resolved: path } = resolvePathForOrchestratorTool(context, rawPath)
        try {
          if (path !== '.' && path.trim() !== '') assertSafeWorkspacePath(path)
        } catch (e) {
          return jsonErr(e instanceof Error ? e.message : String(e))
        }
        const entries = await tauri.readDirectory(path)
        const maxEntries = 800
        const truncated = entries.length > maxEntries
        const slice = truncated ? entries.slice(0, maxEntries) : entries
        recordOrchestratorToolOnModule(orchId, name, args)
        return jsonOk({
          path,
          requested_path: rawPath,
          entries: slice,
          ...(truncated
            ? { truncated: true, total_entries: entries.length, note: 'Listing truncated to 800 entries.' }
            : {}),
        })
      }
      case 'workspace_grep': {
        const pattern = String(args.pattern ?? '').trim()
        if (!pattern) return jsonErr('pattern required')
        const rawPath = String(args.path ?? '.')
        const { resolved: subPath } = resolvePathForOrchestratorTool(context, rawPath)
        try {
          if (subPath !== '.' && subPath.trim() !== '') assertSafeWorkspacePath(subPath)
        } catch (e) {
          return jsonErr(e instanceof Error ? e.message : String(e))
        }
        const maxM =
          typeof args.max_matches === 'number' && Number.isFinite(args.max_matches)
            ? Math.min(2_000, Math.max(1, Math.floor(args.max_matches)))
            : undefined
        const glob = typeof args.glob === 'string' && args.glob.trim() ? String(args.glob).trim() : undefined
        try {
          const r = await tauri.workspaceGrep({
            path: subPath,
            pattern,
            fixed_string: args.fixed_string === true,
            case_insensitive: args.case_insensitive === true,
            glob,
            max_matches: maxM,
          })
          recordOrchestratorToolOnModule(orchId, name, args)
          const raw = JSON.stringify({ ok: true, ...r })
          return applyToolResultBudget('workspace_grep', raw, maxResultCharsForTool('workspace_grep'))
            .text
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return jsonErr(`workspace_grep failed: ${msg}`)
        }
      }
      case 'web_search': {
        const query = String(args.query ?? '').trim()
        const patchId = context.webSearchResearchEntryId ?? null
        if (!query) {
          if (patchId) {
            useResearchSessionStore.getState().patchEntry(patchId, {
              ok: false,
              error: 'query required',
              status: 'done',
            })
            emitRefreshResearch()
          }
          return jsonErr('query required')
        }
        const num =
          typeof args.num_results === 'number' && Number.isFinite(args.num_results)
            ? Math.min(12, Math.max(1, Math.floor(args.num_results)))
            : 5
        try {
          const result = await performWebSearch(query, num)
          recordOrchestratorToolOnModule(orchId, name, args)
          if (patchId) {
            useResearchSessionStore.getState().patchEntry(patchId, {
              query: result.query,
              ok: true,
              abstract: result.abstract,
              source: result.source,
              related: result.related,
              status: 'done',
              runGeneration: context.runGeneration,
              subAgentTileId: context.subAgentTileId,
            })
          } else {
            useResearchSessionStore.getState().appendEntry({
              kind: 'web_search',
              query: result.query,
              ok: true,
              abstract: result.abstract,
              source: result.source,
              related: result.related,
              runGeneration: context.runGeneration,
              subAgentTileId: context.subAgentTileId,
            })
          }
          emitRefreshResearch()
          return jsonOk({
            query: result.query,
            abstract: result.abstract,
            source: result.source,
            related: result.related,
            note: 'Summaries are from DuckDuckGo instant answers; verify critical facts independently.',
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (patchId) {
            useResearchSessionStore.getState().patchEntry(patchId, {
              ok: false,
              error: msg,
              status: 'done',
            })
          } else {
            useResearchSessionStore.getState().appendEntry({
              kind: 'web_search',
              query,
              ok: false,
              error: msg,
              runGeneration: context.runGeneration,
              subAgentTileId: context.subAgentTileId,
            })
          }
          emitRefreshResearch()
          return jsonErr(`web_search failed: ${msg}`)
        }
      }
      case 'open_workspace': {
        const path = String(args.path ?? '').trim()
        if (!path) {
          return jsonErr('path required — absolute path to the folder (e.g. /Users/you/Desktop/MyProject)')
        }
        await useWorkspaceStore.getState().setRootPath(path, { orchestratorSessionPolicy: 'follow-workspace' })
        const st = useWorkspaceStore.getState()
        if (st.error) {
          return jsonErr(st.error)
        }
        useWorkspaceStore.setState({
          expandedPaths: new Set(),
          selectedPath: null,
          activePanel: 'explorer',
        })
        recordOrchestratorToolOnModule(orchId, name, args)
        return jsonOk({
          rootPath: st.rootPath,
          rootName: st.rootName,
          verifiedAccessible: true,
          nextStep: "Use list_directory('.') to inspect root files (or spawn_sub_agent to verify in lead-delegation mode).",
          note: 'Left sidebar (Canvas Explorer) now shows this folder. Do not use a browser tile for this.',
        })
      }
      case 'find_available_port': {
        const DEFAULT_PREFERRED = [5173, 3000, 8080, 8000, 4000, 4173, 3001]
        const preferred =
          Array.isArray(args.preferred_ports) &&
          args.preferred_ports.every((p: unknown) => typeof p === 'number')
            ? (args.preferred_ports as number[])
            : DEFAULT_PREFERRED
        const fallbackStart =
          typeof args.fallback_range_start === 'number' ? args.fallback_range_start : 8100

        const checkPort = async (port: number): Promise<boolean> => {
          try {
            const res = await fetch(`http://127.0.0.1:${port}`, {
              method: 'HEAD',
              signal: AbortSignal.timeout(150),
            })
            // If we get any response, something is listening
            void res
            return false
          } catch {
            // Connection refused or timeout = port likely free
            // But we need a more reliable check — try TCP connect via server
          }
          // Use Tauri/server to do a proper TCP check
          try {
            const result = await tauri.checkPortAvailable(port)
            return result
          } catch {
            // Fallback: assume available if check fails (server might not support it yet)
            return true
          }
        }

        // Try preferred ports first
        for (const port of preferred) {
          if (await checkPort(port)) {
            recordOrchestratorToolOnModule(orchId, name, args)
            return jsonOk({
              port,
              source: 'preferred',
              note: `Port ${port} is available. Use this in your terminal command (e.g. -p ${port}) and browser tile URL (http://localhost:${port}).`,
            })
          }
        }

        // Fallback range scan
        for (let i = 0; i < 50; i++) {
          const port = fallbackStart + i
          if (await checkPort(port)) {
            recordOrchestratorToolOnModule(orchId, name, args)
            return jsonOk({
              port,
              source: 'fallback_range',
              tried_preferred: preferred,
              note: `All preferred ports were in use. Port ${port} is available. Use this in your terminal command and browser tile URL.`,
            })
          }
        }

        return jsonErr(
          `No available port found. Tried: ${preferred.join(', ')} and range ${fallbackStart}-${fallbackStart + 49}. Kill existing dev servers or specify different ports.`
        )
      }
      case 'canvas_list_modules': {
        const tiles = useCanvasStore.getState().tiles
        const diagnosticsStore = useTerminalDiagnosticsStore.getState()
        const modules = Array.from(tiles.values()).map((t) => {
          const cmdSnap = t.type === 'terminal' ? useTerminalCommandState.getState().getTileSnapshot(t.id) : undefined
          return {
            id: t.id,
            type: t.type,
            title: t.title,
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            zIndex: t.zIndex,
            tileStatus: t.tileStatus ?? 'idle',
            meta: t.meta,
            terminal_state:
              t.type === 'terminal' && cmdSnap
                ? {
                    active_command: cmdSnap.active,
                    last_command: cmdSnap.lastCommand,
                    recent_commands: cmdSnap.history.slice(0, 3),
                  }
                : undefined,
            health:
              t.type === 'terminal'
                ? {
                    status: t.tileStatus ?? 'idle',
                    connectionState:
                      typeof t.meta?.terminalConnectionState === 'string' ? t.meta.terminalConnectionState : 'unknown',
                    sessionId: typeof t.meta?.sessionId === 'string' ? t.meta.sessionId : null,
                    sessionFreshnessMs:
                      typeof t.meta?.terminalConnectionStateAt === 'number'
                        ? Math.max(0, Date.now() - t.meta.terminalConnectionStateAt)
                        : null,
                    lastDiagnostic: diagnosticsStore.latestForTile(t.id),
                  }
                : undefined,
          }
        })
        const summary = modules
          .map((m) => `- [${m.type}] ${m.title} (${m.id}) at (${Math.round(m.x)},${Math.round(m.y)})`)
          .join('\n')
        const tileIds = new Set(modules.map((m) => m.id))
        const terminal_diagnostics = diagnosticsStore.snapshotForTileIds(tileIds).sort((a, b) => b.ts - a.ts)
        const terminal_warnings = terminal_diagnostics.filter((w) => w.severity === 'warning')
        const hermesLocalNoAuth = terminal_warnings.some((w) => w.hermes_local_dev_no_auth === true)
        recordOrchestratorToolOnModule(orchId, name, args)
        return jsonOk({
          count: modules.length,
          modules,
          summary: summary || '(no tiles on canvas)',
          terminal_diagnostics,
          terminal_warnings,
          terminal_warnings_note:
            terminal_warnings.length > 0
              ? hermesLocalNoAuth
                ? 'Hermes gateway reported no API_SERVER_KEY (normal local dev). Call configure_hermes_api with api_key "" so Orca falls back to ~/.hermes/.env (or sends no Bearer). Add hermes_agent tile if missing. Do not invent an API key.'
                : 'PTY output matched warning heuristics (e.g. Hermes gateway). Use remediation text; call configure_hermes_api with api_key "" to force the `~/.hermes/.env` fallback if the UI has a stale key.'
              : '(none)',
        })
      }
      case 'read_terminal_output': {
        const tileId = String(args.tile_id ?? '').trim()
        if (!tileId) return jsonErr('tile_id required (terminal tile id from canvas_list_modules)')
        const tile = useCanvasStore.getState().tiles.get(tileId)
        if (!tile) return jsonErr(`no tile with id ${tileId}`)
        if (tile.type !== 'terminal') return jsonErr('tile_id must refer to a terminal tile')
        const sessionId =
          tile.meta && typeof tile.meta === 'object' && typeof (tile.meta as { sessionId?: string }).sessionId === 'string'
            ? (tile.meta as { sessionId: string }).sessionId.trim()
            : ''
        if (!sessionId) {
          return jsonErr(
            'terminal has no PTY session id yet (still connecting or stale tile). Wait for output, call canvas_list_modules again, then retry.'
          )
        }
        const maxLines = Math.min(2000, Math.max(20, Number(args.max_lines) || 400))
        const lines = getTerminalTailLinesSync(sessionId, maxLines)
        const rawText = lines.join('\n')
        const budgeted = applyToolResultBudget(
          'read_terminal_output',
          rawText,
          maxResultCharsForTool('read_terminal_output')
        )
        recordOrchestratorToolOnModule(orchId, name, args)
        return jsonOk({
          tile_id: tileId,
          title: tile.title,
          session_id: sessionId,
          line_count: lines.length,
          text: budgeted.text,
          truncated: budgeted.truncated,
        })
      }
      case 'get_last_terminal_command': {
        const tileId = String(args.tile_id ?? '').trim()
        if (!tileId) return jsonErr('tile_id required')
        const tile = useCanvasStore.getState().tiles.get(tileId)
        if (!tile) return jsonErr(`no tile with id ${tileId}`)
        if (tile.type !== 'terminal') return jsonErr('tile_id must refer to a terminal tile')
        const snap = useTerminalCommandState.getState().getTileSnapshot(tileId)
        recordOrchestratorToolOnModule(orchId, name, args)
        return jsonOk({
          tile_id: tileId,
          title: tile.title,
          active_command: snap?.active ?? null,
          last_command: snap?.lastCommand ?? null,
          recent_commands: snap?.history?.slice(0, 5) ?? [],
        })
      }
      case 'wait_for_terminal_command': {
        const tileId = String(args.tile_id ?? '').trim()
        if (!tileId) return jsonErr('tile_id required')
        const tile = useCanvasStore.getState().tiles.get(tileId)
        if (!tile) return jsonErr(`no tile with id ${tileId}`)
        if (tile.type !== 'terminal') return jsonErr('tile_id must refer to a terminal tile')
        const timeoutMs = Math.min(300_000, Math.max(1000, Number(args.timeout_ms) || 60_000))
        const wait = await useTerminalCommandState.getState().waitUntilCommandCompletes(tileId, timeoutMs, context.signal)
        recordOrchestratorToolOnModule(orchId, name, args)
        return jsonOk({
          tile_id: tileId,
          title: tile.title,
          timed_out: wait.timedOut,
          active_command: wait.active,
          last_completed: wait.record,
          note: wait.timedOut
            ? 'Command still running or no Orca-wrapped completion marker observed before timeout. Use read_terminal_output or increase timeout_ms.'
            : 'Last wrapped command finished (see last_completed).',
        })
      }
      case 'run_shell_command': {
        const rawCmd = String(args.command ?? '').trim()
        if (!rawCmd) {
          return jsonErr('Provide non-empty `command`.')
        }
        if (!tauri.isTauri()) {
          return jsonErr(
            'run_shell_command requires the Orca desktop app. On web, use a terminal tile (canvas_create_tile / canvas_update_tile with meta.command).'
          )
        }
        throwIfAborted(context.signal)
        const expanded = expandWorkspaceRootPlaceholder(rawCmd, context)
        const normalized = normalizeNonInteractiveShellInput({
          command: expanded,
          // command_argv is accepted for compatibility hints only; command string is authoritative.
          argv: undefined,
        })
        const effectiveCommand = normalized.command
        const pathResolution = resolvePathForOrchestratorTool(context, '.')
        const scopedWorktreeRelative = pathResolution.worktreeRelative?.trim() || undefined
        const settings = useSettingsStore.getState()
        const bashCheck = validateBashForMode(
          effectiveCommand,
          settings.harnessTerminalReadOnlyBash ? 'read_only' : 'read_write'
        )
        if (!bashCheck.allow) {
          return jsonErr(bashCheck.reason ?? 'Command blocked in current bash mode')
        }
        const scanTarget =
          normalized.argv && normalized.argv.length > 0
            ? normalized.argv.join(' ')
            : effectiveCommand
        const scan = scanShellCommandForDanger(scanTarget)
        const safety = applySafetyMode(harnessSafetyMode(), scan)
        if (!safety.allow) {
          return jsonErr(safety.message ?? 'Harness safety blocked this command')
        }
        const workspaceRootAbs = resolveActiveWorkspaceRoot(context)
        const allowedRoots = [workspaceRootAbs].filter((v): v is string => typeof v === 'string' && v.length > 0)
        if (workspaceRootAbs && scopedWorktreeRelative) {
          allowedRoots.push(`${workspaceRootAbs.replace(/[/\\]+$/, '')}/${scopedWorktreeRelative}`)
        }
        const scopeCheck = enforceRunShellWorkspaceScope(effectiveCommand, allowedRoots)
        if (!scopeCheck.ok) {
          return jsonErr(scopeCheck.error)
        }
        const cwdRelativeRaw =
          typeof args.cwd_relative === 'string' ? args.cwd_relative.trim() : ''
        const cwdRelative = cwdRelativeRaw || scopedWorktreeRelative || undefined
        if (cwdRelative) {
          try {
            assertSafeWorkspacePath(cwdRelative)
          } catch (e) {
            return jsonErr(e instanceof Error ? e.message : String(e))
          }
        }
        const timeoutMs = Math.min(600_000, Math.max(1_000, Number(args.timeout_ms) || 120_000))
        const route = classifyShellCommand(effectiveCommand)
        const result = await tauri.runWorkspaceShellCommand({
          command: effectiveCommand,
          timeoutMs,
          cwdRelative,
        })
        recordOrchestratorToolOnModule(orchId, name, args)
        const recoveryBranch = buildShellRecoveryBranch({
          command: effectiveCommand,
          exitCode: result.exit_code,
          stderr: result.stderr,
          timedOut: result.timed_out,
        })
        const payload: Record<string, unknown> = {
          exit_code: result.exit_code,
          stdout: result.stdout,
          stderr: result.stderr,
          timed_out: result.timed_out,
          ok: !result.timed_out && result.exit_code === 0,
          routing_hint: route.hint,
          routing_note: route.reason,
          ...(cwdRelative ? { cwd_relative_effective: cwdRelative } : {}),
          ...(recoveryBranch
            ? {
                error_as_data: true,
                remediation_required: true,
                remediation_note:
                  'Branch by exit_code/stderr. Do not retry unchanged command; follow recovery_branch checks and verify_steps.',
                recovery_branch: recoveryBranch,
              }
            : {}),
        }
        if (normalized.notes.length > 0) {
          payload.normalization_notes = normalized.notes
        }
        if (result.stdout_truncated || result.stderr_truncated) {
          payload.output_truncated = true
          payload.output_truncation = {
            stdout_truncated: result.stdout_truncated,
            stderr_truncated: result.stderr_truncated,
          }
        }
        if (route.hint === 'terminal_pty') {
          payload.note =
            'This command pattern usually needs a long-running terminal tile (dev server / watch / TUI). Prefer a terminal tile next time unless you intentionally ran a bounded check.'
        }
        const cap = maxResultCharsForTool('run_shell_command')
        let text = jsonOk(payload)
        if (text.length <= cap) return text

        const shellPayload: Record<string, unknown> = { ...payload }
        const baseline = jsonOk({
          ...shellPayload,
          stdout: '',
          stderr: '',
        }).length
        const room = Math.max(512, cap - baseline - 128)
        const stdoutValue = typeof shellPayload.stdout === 'string' ? (shellPayload.stdout as string) : ''
        const stderrValue = typeof shellPayload.stderr === 'string' ? (shellPayload.stderr as string) : ''
        const totalLen = stdoutValue.length + stderrValue.length
        const stdoutBudget =
          totalLen > 0
            ? Math.max(128, Math.floor((room * stdoutValue.length) / totalLen))
            : Math.floor(room / 2)
        const stderrBudget = Math.max(128, room - stdoutBudget)
        const truncateField = (key: 'stdout' | 'stderr', fieldBudget: number) => {
          const value = typeof shellPayload[key] === 'string' ? (shellPayload[key] as string) : ''
          if (value.length > fieldBudget) {
            shellPayload[key] = `${value.slice(0, fieldBudget)}\n... [truncated by run_shell_command budget]`
            shellPayload[`${key}_budget_truncated`] = true
          }
        }
        truncateField('stdout', stdoutBudget)
        truncateField('stderr', stderrBudget)

        text = jsonOk(shellPayload)
        if (text.length > cap) {
          shellPayload.stdout = '[truncated]'
          shellPayload.stderr = '[truncated]'
          shellPayload.stdout_budget_truncated = true
          shellPayload.stderr_budget_truncated = true
          shellPayload.budget_note = `Result exceeded ${cap} chars; stdout/stderr were reduced to preserve valid JSON.`
          text = jsonOk(shellPayload)
        }
        return text
      }
      case 'canvas_create_tile': {
        const type = args.type as string
        if (
          type === 'hermes_agent' &&
          useSettingsStore.getState().showHermesAgentTile !== true
        ) {
          return jsonErr(
            'Hermes agent tiles are off in Settings → Agent → Hermes (Show Hermes agent tile). Enable there to create Hermes modules, or use type "agent" for standard agent tiles.'
          )
        }
        if (!TILE_TYPES.has(type as TileType)) {
          return jsonErr(`type must be one of: ${[...TILE_TYPES].join(', ')}`)
        }
        const parsedMetaFromArg = (() => {
          if (args.meta !== undefined && typeof args.meta === 'object' && args.meta !== null) {
            return args.meta as Record<string, unknown>
          }
          if (typeof args.meta === 'string' && args.meta.trim()) {
            try {
              const parsed = JSON.parse(args.meta) as unknown
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                // #region agent log
                emitDebugLog(
                  'hermes-meta-coercion',
                  'H11',
                  'executeTools.ts:970',
                  'Coerced string meta JSON for canvas_create_tile',
                  { type: type, title: typeof args.title === 'string' ? args.title : null }
                )
                // #endregion
                return parsed as Record<string, unknown>
              }
            } catch {
              // #region agent log
              emitDebugLog(
                'hermes-meta-coercion',
                'H11',
                'executeTools.ts:982',
                'Failed to parse string meta JSON for canvas_create_tile',
                { type: type, metaPreview: args.meta.slice(0, 180) }
              )
              // #endregion
            }
          }
          return undefined
        })()

        // GitHub tiles require Tauri desktop app - provide helpful alternatives for web users
        if (type === 'github' && !tauri.isTauri()) {
          const meta = parsedMetaFromArg ?? {}
          const ghCommand = typeof meta.ghArgs === 'string' ? meta.ghArgs : 'repo list'
          return jsonErr(
            `GitHub CLI tiles require the desktop app. On web, use the terminal or run: gh ${ghCommand}`
          )
        }

        const x = args.x !== undefined ? Number(args.x) : undefined
        const y = args.y !== undefined ? Number(args.y) : undefined
        const pos =
          x !== undefined && y !== undefined && !Number.isNaN(x) && !Number.isNaN(y)
            ? { x, y }
            : undefined
        const title = args.title !== undefined ? String(args.title) : undefined
        const meta = parsedMetaFromArg
        let reuseManagedBrowserTileId: string | null = null
        if (type === 'browser') {
          const requestedUrl =
            meta && typeof meta.url === 'string' && meta.url.trim()
              ? meta.url.trim()
              : meta && typeof meta.initialUrl === 'string' && meta.initialUrl.trim()
                ? meta.initialUrl.trim()
                : ''
          const url = coerceBrowserLocalUrlToLatestTerminal(requestedUrl)
          if (meta && url && url !== requestedUrl) {
            meta.url = url
            delete meta.initialUrl
          }
          // #region agent log
          emitDebugLog('browser-tile-url', 'H9', 'executeTools.ts:1042', 'Browser tile create request parsed', {
            hasMeta: !!meta,
            hasUrl: !!url,
            title: title ?? null,
            urlPreview: url ? url.slice(0, 120) : null,
          })
          // #endregion
          if (!url) {
            return jsonErr(
              'Browser tiles require an explicit meta.url or meta.initialUrl. Orca does not auto-launch or guess a URL — start the target server first, then pass a real URL (e.g. http://localhost:<port> after find_available_port, or an https:// page).'
            )
          }
          const parsedUrl = (() => {
            try {
              return new URL(url)
            } catch {
              return null
            }
          })()
          const host = (() => {
            try {
              return parsedUrl?.hostname.toLowerCase().replace(/\.$/, '') ?? ''
            } catch {
              return ''
            }
          })()
          if (host === 'example.com' || host.endsWith('.example.com')) {
            return jsonErr(
              'Browser tile URL cannot be example.com (placeholder). Set meta.url to the real app or docs URL after the server is running.'
            )
          }
          const isLoopbackHost =
            host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
          if (parsedUrl && isLoopbackHost && typeof window !== 'undefined') {
            const appUrl = (() => {
              try {
                return new URL(window.location.href)
              } catch {
                return null
              }
            })()
            if (appUrl) {
              const appHost = appUrl.hostname.toLowerCase().replace(/\.$/, '')
              const appIsLoopback =
                appHost === 'localhost' ||
                appHost === '127.0.0.1' ||
                appHost === '::1' ||
                appHost === '[::1]'
              const parsedPort = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80')
              const appPort = appUrl.port || (appUrl.protocol === 'https:' ? '443' : '80')
              if (appIsLoopback && parsedPort === appPort) {
                return jsonErr(
                  `Browser preview URL points at Orca's own app origin (port ${appPort}). Choose a different preview port via find_available_port and run your project dev server there.`
                )
              }
            }
          }
          // Browser tile requests are now routed to agent_browser tiles,
          // so we intentionally skip legacy managed-browser reuse here.
        }
        if (meta && typeof meta.command === 'string' && meta.command) {
          meta.command = enforceServeNoPortSwitching(
            expandWorkspaceRootPlaceholder(meta.command)
          )
          const normalizedMeta = normalizeTerminalMetaCommand(meta)
          meta.command = String(normalizedMeta.command ?? meta.command)
          if (Array.isArray(normalizedMeta.command_argv)) {
            meta.command_argv = normalizedMeta.command_argv
          }
          const mode = harnessSafetyMode()
          const scan = scanShellCommandForDanger(commandWithArgvForSafety(meta))
          const gate = applySafetyMode(mode, scan)
          if (!gate.allow) return jsonErr(gate.message ?? 'blocked')
        }
        if (type === 'browser' && reuseManagedBrowserTileId) {
          const workspaceKey = getTasksPersistenceKey(useWorkspaceStore.getState().rootPath)
          const existing = useCanvasStore.getState().tiles.get(reuseManagedBrowserTileId)
          useCanvasStore.getState().updateTile(reuseManagedBrowserTileId, {
            title: title ?? existing?.title,
            meta: {
              ...(existing?.meta ?? {}),
              ...(meta ?? {}),
              source: 'orchestrator-auto',
              previewRole: ORCA_WEB_PREVIEW_ROLE,
              workspaceRootKey: workspaceKey,
            },
          })
          revealOrchestratorTile(
            reuseManagedBrowserTileId,
            {
              label: 'Refreshing preview…',
              effect: 'pulse',
            },
            orchId
          )
          recordOrchestratorToolOnModule(orchId, name, {
            ...args,
            tile_id: reuseManagedBrowserTileId,
            reused_existing_preview: true,
          })
          return jsonOk({
            tile_id: reuseManagedBrowserTileId,
            type: 'browser',
            title: title ?? existing?.title ?? null,
            reused_existing_preview: true,
          })
        }
        let validatedCreateUrl: string | null = null
        if (type === 'agent_browser' && tauri.isTauri()) {
          const rawRequestedUrl =
            meta && typeof meta.currentUrl === 'string' && meta.currentUrl.trim()
              ? meta.currentUrl.trim()
              : meta && typeof meta.url === 'string' && meta.url.trim()
                ? meta.url.trim()
                : meta && typeof meta.initialUrl === 'string' && meta.initialUrl.trim()
                  ? meta.initialUrl.trim()
                  : ''
          if (rawRequestedUrl) {
            try {
              validatedCreateUrl = normalizeAndValidateAgentBrowserUrl(rawRequestedUrl)
            } catch (e) {
              return jsonErr(
                `Failed to open URL in agent browser: ${e instanceof Error ? e.message : String(e)}`
              )
            }
          }
        }
        const id = pos
          ? useCanvasStore.getState().addTile(type as TileType, pos, { title, meta })
          : useCanvasStore.getState().addTileIntelligent(type as TileType, undefined, {
              title,
              meta,
            })
        if (type === 'agent') {
          useOrchestratorActivityStore.getState().setVerb(glitterVerbForAgentSpawn(id))
        }
        if (type === 'agent_browser' && tauri.isTauri()) {
          if (validatedCreateUrl) {
            try {
              const { snapshot } = await navigateAgentBrowserTile(id, validatedCreateUrl)
              recordOrchestratorToolOnModule(orchId, name, {
                ...args,
                tile_id: id,

                navigated_url: validatedCreateUrl,
                snapshot_length: snapshot.length,
              })
              revealOrchestratorTile(
                id,
                {
                  label: `Opening ${type}…`,
                  effect: 'pulse',
                },
                orchId
              )
              return jsonOk({
                tile_id: id,
                type,
                title: title ?? null,

                url: validatedCreateUrl,
              })
            } catch (e) {
              return jsonErr(
                `Failed to open URL in agent browser: ${e instanceof Error ? e.message : String(e)}`
              )
            }
          }
        }
        revealOrchestratorTile(
          id,
          {
            label: `Opening ${type}…`,
            effect: 'pulse',
          },
          orchId
        )
        recordOrchestratorToolOnModule(orchId, name, {
          ...args,
          tile_id: id,
          aliased_from: type === 'browser' ? 'browser' : undefined,
        })
        return jsonOk({
          tile_id: id,
          type,
          title: title ?? null,
          aliased_from: type === 'browser' ? 'browser' : undefined,
        })
      }
      case 'canvas_update_tile': {
        const tileId = String(args.tile_id ?? args.id ?? '').trim()
        if (!tileId) return jsonErr('tile_id required (id is also accepted for compatibility)')
        if (args.remove === true) {
          useCanvasStore.getState().removeTile(tileId)
          recordOrchestratorToolOnModule(orchId, name, args)
          return jsonOk({ removed: tileId })
        }
        const patch: Record<string, unknown> = {}
        if (typeof args.title === 'string') patch.title = args.title
        if (typeof args.x === 'number') patch.x = args.x
        if (typeof args.y === 'number') patch.y = args.y
        if (typeof args.w === 'number') patch.w = args.w
        if (typeof args.h === 'number') patch.h = args.h
        const incomingMeta = (() => {
          if (args.meta !== undefined && typeof args.meta === 'object' && args.meta !== null) {
            return args.meta as Record<string, unknown>
          }
          if (typeof args.meta === 'string' && args.meta.trim()) {
            try {
              const parsed = JSON.parse(args.meta) as unknown
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                // #region agent log
                emitDebugLog(
                  'hermes-meta-coercion',
                  'H11',
                  'executeTools.ts:1076',
                  'Coerced string meta JSON for canvas_update_tile',
                  { tileId }
                )
                // #endregion
                return parsed as Record<string, unknown>
              }
            } catch {
              // #region agent log
              emitDebugLog(
                'hermes-meta-coercion',
                'H11',
                'executeTools.ts:1088',
                'Failed to parse string meta JSON for canvas_update_tile',
                { tileId, metaPreview: args.meta.slice(0, 180) }
              )
              // #endregion
            }
          }
          return undefined
        })()
        if (incomingMeta) {
          const cur = useCanvasStore.getState().tiles.get(tileId)
          const incoming = incomingMeta
          if (cur?.type === 'browser') {
            const hasIncomingUrl = typeof incoming.url === 'string'
            const hasIncomingInitialUrl = typeof incoming.initialUrl === 'string'
            const requestedIncomingUrl =
              hasIncomingUrl && String(incoming.url).trim()
                ? String(incoming.url).trim()
                : hasIncomingInitialUrl && String(incoming.initialUrl).trim()
                  ? String(incoming.initialUrl).trim()
                  : ''
            const incomingUrl = coerceBrowserLocalUrlToLatestTerminal(requestedIncomingUrl)
            if (incomingUrl && incomingUrl !== requestedIncomingUrl) {
              incoming.url = incomingUrl
              delete incoming.initialUrl
            }
            if ((hasIncomingUrl || hasIncomingInitialUrl) && !incomingUrl) {
              return jsonErr('Browser tile updates require a non-empty meta.url or meta.initialUrl.')
            }
            if (incomingUrl) {
              const parsedIncomingUrl = (() => {
                try {
                  return new URL(incomingUrl)
                } catch {
                  return null
                }
              })()
              const host = parsedIncomingUrl?.hostname.toLowerCase().replace(/\.$/, '') ?? ''
              if (host === 'example.com' || host.endsWith('.example.com')) {
                return jsonErr(
                  'Browser tile URL cannot be example.com (placeholder). Set meta.url to the real app or docs URL after the server is running.'
                )
              }
              const isLoopbackHost =
                host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
              if (parsedIncomingUrl && isLoopbackHost && typeof window !== 'undefined') {
                const appUrl = (() => {
                  try {
                    return new URL(window.location.href)
                  } catch {
                    return null
                  }
                })()
                if (appUrl) {
                  const appHost = appUrl.hostname.toLowerCase().replace(/\.$/, '')
                  const appIsLoopback =
                    appHost === 'localhost' ||
                    appHost === '127.0.0.1' ||
                    appHost === '::1' ||
                    appHost === '[::1]'
                  const incomingPort =
                    parsedIncomingUrl.port || (parsedIncomingUrl.protocol === 'https:' ? '443' : '80')
                  const appPort = appUrl.port || (appUrl.protocol === 'https:' ? '443' : '80')
                  if (appIsLoopback && incomingPort === appPort) {
                    return jsonErr(
                      `Browser preview URL points at Orca's own app origin (port ${appPort}). Choose a different preview port via find_available_port and run your project dev server there.`
                    )
                  }
                }
              }
            }
          }
          if (cur?.type === 'agent_browser' && incoming) {
            const hasIncomingCurrentUrl = typeof incoming.currentUrl === 'string'
            const hasIncomingUrl = typeof incoming.url === 'string'
            const hasIncomingInitialUrl = typeof incoming.initialUrl === 'string'
            const rawRequested =
              hasIncomingCurrentUrl && String(incoming.currentUrl).trim()
                ? String(incoming.currentUrl).trim()
                : hasIncomingUrl && String(incoming.url).trim()
                  ? String(incoming.url).trim()
                : hasIncomingInitialUrl && String(incoming.initialUrl).trim()
                  ? String(incoming.initialUrl).trim()
                  : ''
            if ((hasIncomingCurrentUrl || hasIncomingUrl || hasIncomingInitialUrl) && !rawRequested) {
              return jsonErr('Agent browser updates require a non-empty currentUrl/url/initialUrl.')
            }
            if (rawRequested) {
              let incomingUrl = rawRequested
              try {
                incomingUrl = normalizeAndValidateAgentBrowserUrl(rawRequested)
              } catch (e) {
                return jsonErr(e instanceof Error ? e.message : String(e))
              }
              incoming.currentUrl = incomingUrl
              delete incoming.url
              delete incoming.initialUrl
            }
          }
          const merged: Record<string, unknown> = { ...cur?.meta, ...incoming }
          if (
            typeof incoming.command === 'string' &&
            incoming.command.trim() &&
            !Object.prototype.hasOwnProperty.call(incoming, 'command_argv')
          ) {
            delete merged.command_argv
          }
          patch.meta = merged
        }
        if (patch.meta && typeof (patch.meta as Record<string, unknown>).command === 'string') {
          const expanded = enforceServeNoPortSwitching(
            expandWorkspaceRootPlaceholder(
            String((patch.meta as Record<string, unknown>).command)
            )
          )
          ;(patch.meta as Record<string, unknown>).command = expanded
          const normalizedMeta = normalizeTerminalMetaCommand(patch.meta as Record<string, unknown>)
          patch.meta = normalizedMeta
          const cmd = commandWithArgvForSafety(patch.meta as Record<string, unknown>)
          const mode = harnessSafetyMode()
          if (cmd) {
            const scan = scanShellCommandForDanger(cmd)
            const gate = applySafetyMode(mode, scan)
            if (!gate.allow) return jsonErr(gate.message ?? 'blocked')
          }
        }
        const curForDup = useCanvasStore.getState().tiles.get(tileId)
        const prevMetaForRollback = curForDup?.meta
        if (
          curForDup?.type === 'terminal' &&
          patch.meta &&
          typeof (patch.meta as Record<string, unknown>).command === 'string' &&
          String((patch.meta as Record<string, unknown>).command).trim()
        ) {
          const cmdDup = String((patch.meta as Record<string, unknown>).command)
          const dup = terminalMetaCommandShouldBlockDuplicate(tileId, cmdDup)
          if (dup.block) {
            return jsonErr(
              dup.message ??
                'duplicate_failed_command: use get_last_terminal_command and fix the failure before retrying.'
            )
          }
        }
        if (Object.keys(patch).length === 0) {
          return jsonErr('No updates provided (set remove, title, x, y, w, h, or meta)')
        }
        useCanvasStore.getState().updateTile(tileId, patch as Partial<TileData>)
        const updated = useCanvasStore.getState().tiles.get(tileId)
        if (updated?.type === 'browser' && patch.meta && typeof patch.meta === 'object') {
          const m = patch.meta as Record<string, unknown>
          const navigateUrl =
            typeof m.url === 'string' && m.url.trim()
              ? m.url.trim()
              : typeof m.initialUrl === 'string' && m.initialUrl.trim()
                ? m.initialUrl.trim()
                : ''
          if (navigateUrl) {
            void tauri.navigateBrowserPreview(tileId, navigateUrl).catch(() => {
              /* preview window may be closed; BrowserTile Open will use updated URL */
            })
            useOrchestratorActivityStore.getState().setAgentTileFocus({
              tileId,
              tileType: 'browser',
              action: 'navigating',
              progress: 0,
              detail: navigateUrl,
            })
          }
        }
        if (updated?.type === 'agent_browser' && patch.meta && typeof patch.meta === 'object') {
          const m = patch.meta as Record<string, unknown>
          const navigateUrl =
            typeof m.currentUrl === 'string' && m.currentUrl.trim()
              ? m.currentUrl.trim()
              : typeof m.url === 'string' && m.url.trim()
                ? m.url.trim()
                : typeof m.initialUrl === 'string' && m.initialUrl.trim()
                  ? m.initialUrl.trim()
                  : ''
          if (navigateUrl && tauri.isTauri()) {
            try {
              await navigateAgentBrowserTile(tileId, navigateUrl)
              useOrchestratorActivityStore.getState().setAgentTileFocus({
                tileId,
                tileType: 'agent_browser',
                action: 'navigating',
                progress: 0,
                detail: navigateUrl,
              })
            } catch (e) {
              if (prevMetaForRollback) {
                useCanvasStore.getState().updateTile(tileId, { meta: prevMetaForRollback })
              }
              return jsonErr(
                `Failed to update agent browser URL: ${e instanceof Error ? e.message : String(e)}`
              )
            }
          }
        }
        revealOrchestratorTile(tileId, { label: 'Updating module…', effect: 'pulse' }, orchId)
        recordOrchestratorToolOnModule(orchId, name, args)
        return jsonOk({ updated: tileId, patch })
      }
      case 'create_project_skill': {
        const rawSlug = String(args.skill_slug ?? '').trim().toLowerCase()
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(rawSlug)) {
          return jsonErr(
            'skill_slug must be 1–64 chars: start with a letter or digit, then a–z, 0–9, ., _, -'
          )
        }
        const description = String(args.description ?? '').trim()
        if (!description) return jsonErr('description required')
        const bodyMarkdown = String(args.body_markdown ?? '').trim()
        if (!bodyMarkdown) return jsonErr('body_markdown required')
        const version = String(args.version ?? '1.0.0').trim() || '1.0.0'
        const title =
          String(args.title ?? '').trim() ||
          rawSlug
            .split(/[-._]+/)
            .filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')
        const installTarget = String(args.install_target ?? 'cursor').toLowerCase()
        if (!['cursor', 'claude', 'both'].includes(installTarget)) {
          return jsonErr('install_target must be cursor, claude, or both')
        }

        const safeDesc = description.replace(/\s+/g, ' ').trim().slice(0, 450)
        const fm = [
          '---',
          `name: ${JSON.stringify(rawSlug)}`,
          `description: ${JSON.stringify(safeDesc)}`,
          `version: ${JSON.stringify(version)}`,
          'source: agent-canvas-orchestrator',
          '---',
          '',
        ].join('\n')
        const h1 = `# ${title.replace(/^#+\s*/, '').split('\n')[0]}`
        const fullMarkdown = `${fm}${h1}\n\n${bodyMarkdown}\n`

        const relativePaths: string[] = []
        if (installTarget === 'cursor' || installTarget === 'both') {
          relativePaths.push(`.cursor/skills/${rawSlug}/SKILL.md`)
        }
        if (installTarget === 'claude' || installTarget === 'both') {
          relativePaths.push(`.claude/skills/${rawSlug}/SKILL.md`)
        }

        const written: string[] = []
        for (const rel of relativePaths) {
          const parent = rel.slice(0, rel.lastIndexOf('/'))
          await tauri.createDirectory(parent)
          const inner = await executeOrchestratorTool(
            'write_file',
            JSON.stringify({ path: rel, content: fullMarkdown }),
            { ...context, subAgentTileId: undefined }
          )
          const parsed = JSON.parse(inner) as { ok?: boolean; error?: string }
          if (parsed.ok !== true) {
            return inner
          }
          written.push(rel)
        }
        recordOrchestratorToolOnModule(orchId, name, {
          ...args,
          paths: written,
        })
        return jsonOk({
          paths: written,
          skill_slug: rawSlug,
          slash_command: `/${rawSlug}`,
          note:
            'Skill installed. Default `/slug` uses diet (progressive) load: frontmatter + a short body preview; user or agent can use `read_file` for the full file. Use `/slug full` to inline the entire SKILL.md, or set `mcp_diet: false` in frontmatter to always inline.',
        })
      }
      case 'spawn_sub_agent': {
        const runId = 'subagent-hang'
        const maxSubAgents = getMaxConcurrentSubAgentsFromSettings()
        const hermesLeadActive = useSettingsStore.getState().leadProfile === 'hermes'
        const hermesAutoRunnerEnabled = useSettingsStore.getState().hermesAutoRunnerForSubAgents === true
        const displayNameRaw = String(args.display_name ?? '').trim()
        const roleRaw = String(args.role ?? '').trim()
        const taskRaw = String(args.task ?? '').trim()
        const hermesHintRegex = /\bhermes\b/i
        const inferredHermesIntent =
          hermesHintRegex.test(taskRaw) ||
          hermesHintRegex.test(displayNameRaw) ||
          hermesHintRegex.test(roleRaw)
        const runnerRaw = typeof args.runner === 'string' ? args.runner.trim().toLowerCase() : ''
        const autoHermesRunner = !runnerRaw && hermesAutoRunnerEnabled && inferredHermesIntent
        const runner: 'default' | 'hermes' =
          runnerRaw === 'hermes' || autoHermesRunner ? 'hermes' : 'default'
        const defaultDisplayName = runner === 'hermes' ? 'Hermes' : 'Agent'
        const defaultRole = runner === 'hermes' ? 'Hermes gateway worker' : 'Worker'
        const displayNameBase = String(args.display_name ?? defaultDisplayName).trim() || defaultDisplayName
        const roleBase = String(args.role ?? defaultRole).trim() || defaultRole
        const displayName = displayNameBase
        const role = roleBase
        const task = String(args.task ?? '').trim()
        if (!task) return jsonErr('task required')
        const taskScope = validateSubAgentTaskScope(task)
        if (!taskScope.ok) {
          const batchesPreview = taskScope.batches
            .map((batch, idx) => `${idx + 1}) ${batch.join(' | ')}`)
            .join(' ; ')
          return jsonErr(
            `Delegation rule: max ${MAX_SUBTASKS_PER_AGENT} explicit tasks per sub-agent. Received ${taskScope.subtasks.length}. Split this into ${taskScope.batches.length} spawn_sub_agent calls (one per batch). Suggested batches: ${batchesPreview}`
          )
        }

        if (!hermesLeadActive) {
          const reusable = findReusableSubAgentTileId({ displayName, role, task, runner })
          if (reusable) {
            const note =
              reusable.reason === 'active'
                ? 'Identical sub-agent task is already running; reused the existing agent tile instead of spawning another one.'
                : 'Identical sub-agent task just finished; reused the recent agent tile instead of spawning a duplicate run.'
            recordOrchestratorToolOnModule(orchId, name, {
              ...args,
              tile_id: reusable.tileId,
              deduped: true,
              dedupe_reason: reusable.reason,
            })
            revealOrchestratorTile(
              reusable.tileId,
              { label: `${displayName} (${reusable.reason === 'active' ? 'already running' : 'recent result'})`, effect: 'pulse' },
              orchId
            )
            return jsonOk({
              tile_id: reusable.tileId,
              display_name: displayName,
              role,
              reused: true,
              note,
            })
          }
        }
        if (useAgentTeamStore.getState().countWorkingSubAgents() >= maxSubAgents) {
          return jsonErr(
            `Maximum ${maxSubAgents} concurrent sub-agents. Wait for one to finish, stop one from its tile, or use the Agent team tracker.`
          )
        }
        const x = args.x !== undefined ? Number(args.x) : undefined
        const y = args.y !== undefined ? Number(args.y) : undefined
        let pos: { x: number; y: number } | undefined =
          x !== undefined && y !== undefined && !Number.isNaN(x) && !Number.isNaN(y)
            ? { x, y }
            : undefined
        // Delegated sub-agents ship with chat collapsed by default (only trace
        // chips + task progress visible), so give them a compact footprint.
        const delegatedAgentSizeOpts = {
          w: DELEGATED_AGENT_TILE_SIZE.w,
          h: DELEGATED_AGENT_TILE_SIZE.h,
        }
        // Hierarchy-aware spawn: if a parent agent tile is visible on the
        // canvas and the LLM didn't pick explicit coords, fan out children on
        // a radial arc around the parent so team members cluster around
        // their lead instead of colliding on the same spot. Still passed
        // through `findNonOverlappingPosition` inside `addTile`.
        if (!pos && context.subAgentTileId) {
          const parentTile = useCanvasStore.getState().tiles.get(context.subAgentTileId)
          if (
            parentTile &&
            (parentTile.type === 'agent' || parentTile.type === 'hermes_agent')
          ) {
            const siblings = Array.from(useCanvasStore.getState().tiles.values()).filter(
              (t) =>
                (t.type === 'agent' || t.type === 'hermes_agent') &&
                t.spawnedByTileId === context.subAgentTileId
            )
            pos = hierarchySpawn({
              parent: parentTile,
              newW: delegatedAgentSizeOpts.w,
              newH: delegatedAgentSizeOpts.h,
              siblingIndex: siblings.length,
            })
          }
        }
        if (hermesLeadActive) {
          const hermesTileId = pos
            ? useCanvasStore.getState().addTile('hermes_agent', pos, delegatedAgentSizeOpts)
            : useCanvasStore.getState().addTileIntelligent('hermes_agent', undefined, delegatedAgentSizeOpts)
          const taskId = nanoid()
          const parentAgentTileId =
            context.subAgentTileId && context.subAgentTileId !== hermesTileId
              ? context.subAgentTileId
              : null
          useCanvasStore.getState().updateTile(hermesTileId, {
            title: displayName,
            meta: {
              subAgentDelegated: true,
              subAgentRole: role,
              delegatedTask: task,
              taskId,
              hermesTileDisplayName: displayName,
              ...(orchId ? { parentOrchestratorTileId: orchId } : {}),
              ...(parentAgentTileId ? { parentAgentTileId } : {}),
            },
            tileStatus: 'working',
            spawnedByTileId: parentAgentTileId ?? orchId ?? undefined,
          })
          useAgentTeamStore.getState().registerMember({
            tileId: hermesTileId,
            displayName,
            role,
            delegatedTask: task,
            currentTask: 'Sending to Hermes…',
            status: 'working',
            parentTileId: parentAgentTileId ?? undefined,
            lastDeliveredSeq:
              useGroupChatStore.getState().seqBySession[getDefaultSessionId()] ?? 0,
          })
          ensureAgentTeamTile()
          revealOrchestratorTile(
            hermesTileId,
            { label: `${displayName} (Hermes)…`, effect: 'pulse' },
            orchId
          )
          recordOrchestratorToolOnModule(orchId, name, { ...args, tile_id: hermesTileId, task_id: taskId })
          const linkedRawHermes = args.linked_task_text
          if (typeof linkedRawHermes === 'string' && linkedRawHermes.trim()) {
            const linkedTodoIdHermes = findTodoIdByLinkedText(linkedRawHermes.trim())
            if (linkedTodoIdHermes) {
              useTodoStore.getState().patchTask(linkedTodoIdHermes, {
                status: 'in_progress',
                assignedAgentName: displayName,
              })
            }
          }
          return jsonOk({
            tile_id: hermesTileId,
            display_name: displayName,
            role,
            runner: 'hermes',
            hermes_tile: true,
            note: `Hermes agent tile opened; Hermes will handle the task end-to-end (and may recruit its own runners). Handoff posts back to this orchestrator when done. Use wait_for_sub_agent({ tile_id: "${hermesTileId}" }) to block on the reply.`,
          })
        }
        const hideDelegatedWorkerTile = shouldHideDelegatedSubAgentTile(runner)
        const id = pos
          ? useCanvasStore.getState().addTile('agent', pos, delegatedAgentSizeOpts)
          : useCanvasStore.getState().addTileIntelligent('agent', undefined, delegatedAgentSizeOpts)
        // When the spawner is itself a sub-agent (nested delegation — e.g. a
        // Hermes worker calling `spawn_sub_agent` with `runner:"hermes"` to
        // recruit its own helpers), record its tile id as `parentAgentTileId`
        // so the child's handoff can be mirrored back into the parent's log
        // (otherwise handoffs only ever bubble up to the lead session).
        const parentAgentTileId =
          context.subAgentTileId && context.subAgentTileId !== id
            ? context.subAgentTileId
            : null
        useCanvasStore.getState().updateTile(id, {
          title: displayName,
          meta: {
            subAgentDelegated: true,
            subAgentRole: role,
            delegatedTask: task,
            runner,
            suppressCanvasRender: hideDelegatedWorkerTile,
            delegatedWorkerHidden: hideDelegatedWorkerTile,
            ...(orchId ? { parentOrchestratorTileId: orchId } : {}),
            ...(parentAgentTileId ? { parentAgentTileId } : {}),
          },
          tileStatus: 'working',
          spawnedByTileId: parentAgentTileId ?? orchId ?? undefined,
        })
        useOrchestratorActivityStore.getState().setVerb(glitterVerbForAgentSpawn(id))
        if (!hideDelegatedWorkerTile) {
          revealOrchestratorTile(
            id,
            { label: `${displayName} (sub-agent)…`, effect: 'pulse' },
            orchId
          )
        }
        useAgentTeamStore.getState().registerMember({
          tileId: id,
          displayName,
          role,
          delegatedTask: task,
          currentTask: 'Starting…',
          status: 'working',
          parentTileId: parentAgentTileId ?? undefined,
          lastDeliveredSeq:
            useGroupChatStore.getState().seqBySession[getDefaultSessionId()] ?? 0,
        })
        recordOrchestratorToolOnModule(orchId, name, { ...args, tile_id: id })
        ensureAgentTeamTile()
        if (!hideDelegatedWorkerTile) {
          scheduleDelegatedSpawnScatter()
        }
        let linkedTodoId: string | undefined
        const linkedRaw = args.linked_task_text
        if (linkedRaw !== undefined && linkedRaw !== null) {
          const linkedText = String(linkedRaw).trim()
          if (linkedText) {
            linkedTodoId = findTodoIdByLinkedText(linkedText)
            if (linkedTodoId) {
              useTodoStore.getState().patchTask(linkedTodoId, {
                status: 'in_progress',
                assignedAgentName: displayName,
              })
            }
          }
        }
        const tc = args.task_complexity
        const taskComplexity =
          tc === 'simple' || tc === 'complex' || tc === 'auto' ? tc : undefined
        startSubAgentRun({
          tileId: id,
          displayName,
          role,
          task,
          linkedTodoId,
          taskComplexity,
          runner,
        })
        // #region agent log
        emitDebugLog(runId, 'H2', 'executeTools.ts:1461', 'Sub-agent spawned and run started', {
          tileId: id,
          displayName,
          role,
          runner,
          parentAgentTileId: parentAgentTileId ?? null,
          linkedTodoId: linkedTodoId ?? null,
          taskPreview: task.slice(0, 120),
        })
        // #endregion
        return jsonOk({
          tile_id: id,
          display_name: displayName,
          role,
          note: hideDelegatedWorkerTile
            ? `Sub-agent run started in team-only mode (worker tile hidden from canvas to reduce UI/GPU load). Track progress in Agent team + Agent group chat. Max ${maxSubAgents} concurrent workers. Use \`wait_for_sub_agent({ tile_id: "${id}" })\` to synchronously consume output.`
            : `Sub-agent run started on a new agent tile (one tile per spawn; max ${maxSubAgents} concurrent). When it finishes, a handoff is appended to the orchestrator log and session. Open the Agent team tile for a live roster; logs stream on the worker tile. To synchronously consume its output call \`wait_for_sub_agent({ tile_id: "${id}" })\`.`,
        })
      }
      case 'post_team_message': {
        const body = String(args.body ?? '').trim()
        if (!body) return jsonErr('body required')
        const sessionIdForMsg =
          typeof context.sessionId === 'string' && context.sessionId.length > 0
            ? context.sessionId
            : getDefaultSessionId()
        // Sender identity:
        //   - sub-agent → tile id from context.subAgentTileId
        //   - lead orchestrator → orchId
        const senderTileId = context.subAgentTileId ?? orchId ?? null
        const senderMember = senderTileId
          ? useAgentTeamStore.getState().membersByTileId[senderTileId]
          : undefined
        const senderName = senderMember?.displayName ?? (senderTileId === orchId ? 'Lead orchestrator' : 'Agent')

        const explicitTo = typeof args.to === 'string' ? args.to.trim() : ''
        let fullBody = body
        if (explicitTo && !body.includes(`@${explicitTo}`)) {
          fullBody = `@${explicitTo} ${body}`
        }
        const mentions = parseMentions(fullBody, {
          agentTeamStore: useAgentTeamStore.getState(),
          senderTileId: senderTileId ?? undefined,
        })
        const kindRaw = typeof args.kind === 'string' ? args.kind.trim().toLowerCase() : ''
        const allowedKinds = new Set(['say', 'ask', 'ack', 'update', 'handoff', 'blocker', 'result'])
        const kind = allowedKinds.has(kindRaw) ? (kindRaw as GroupChatMessageKind) : 'say'
        const correlationId = typeof args.correlation_id === 'string' && args.correlation_id.trim().length > 0
          ? args.correlation_id.trim()
          : undefined
        const chatStore = useGroupChatStore.getState()
        const posted = chatStore.postMessage({
          sessionId: sessionIdForMsg,
          senderTileId: senderTileId ?? undefined,
          senderName,
          body: fullBody,
          mentions,
          kind,
          correlationId,
          provenance: {
            source: senderTileId ? 'sub_agent' : 'orchestrator',
            trust: 'trusted',
          },
        })
        if (context.subAgentTileId) {
          ensureGroupChatTile({ createIfMissing: true, focus: true })
        }
        return jsonOk({
          posted: true,
          message_id: posted.id,
          seq: posted.seq,
          thread_id: posted.threadId ?? null,
          sender_name: senderName,
          mention_count: mentions.length,
          kind,
          deduped: posted.deduped === true,
        })
      }
      case 'poll_team_messages': {
        const sessionIdForPoll =
          typeof context.sessionId === 'string' && context.sessionId.length > 0
            ? context.sessionId
            : getDefaultSessionId()
        const sinceSeqRaw = Number(args.since_seq ?? 0)
        const sinceSeq = Number.isFinite(sinceSeqRaw) && sinceSeqRaw >= 0 ? Math.floor(sinceSeqRaw) : 0
        const threadId = typeof args.thread_id === 'string' && args.thread_id.trim().length > 0
          ? args.thread_id.trim()
          : undefined
        const limitRaw = Number(args.limit ?? 50)
        const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50))
        const chatStore = useGroupChatStore.getState()
        const all = chatStore.listSince(sessionIdForPoll, sinceSeq, threadId)
        const slice = all.slice(0, limit)
        return jsonOk({
          messages: slice.map((m) => ({
            id: m.id,
            seq: m.seq,
            kind: m.kind,
            sender_name: m.senderName,
            sender_tile_id: m.senderTileId ?? null,
            body: m.body,
            thread_id: m.threadId ?? null,
            reply_to: m.replyTo ?? null,
            correlation_id: m.correlationId ?? null,
            created_at: m.createdAt,
            provenance: m.provenance,
            mentions: m.mentions,
          })),
          has_more: all.length > slice.length,
          next_since_seq: slice.length > 0 ? slice[slice.length - 1].seq : sinceSeq,
        })
      }
      case 'reply_to_team_message': {
        const replyTo = typeof args.reply_to === 'string' ? args.reply_to.trim() : ''
        if (!replyTo) return jsonErr('reply_to required')
        const body = String(args.body ?? '').trim()
        if (!body) return jsonErr('body required')
        const sessionIdForReply =
          typeof context.sessionId === 'string' && context.sessionId.length > 0
            ? context.sessionId
            : getDefaultSessionId()
        const chatStore = useGroupChatStore.getState()
        const parent = chatStore.getMessageById(sessionIdForReply, replyTo)
        if (!parent) {
          return jsonErr(
            `no message ${replyTo} in this session — use poll_team_messages to list ids`
          )
        }
        const senderTileId = context.subAgentTileId ?? orchId ?? null
        const senderMember = senderTileId
          ? useAgentTeamStore.getState().membersByTileId[senderTileId]
          : undefined
        const senderName = senderMember?.displayName ?? (senderTileId === orchId ? 'Lead orchestrator' : 'Agent')
        const kindRaw = typeof args.kind === 'string' ? args.kind.trim().toLowerCase() : ''
        const allowedKinds = new Set(['say', 'ask', 'ack', 'update', 'handoff', 'blocker', 'result'])
        const kind: GroupChatMessageKind = allowedKinds.has(kindRaw)
          ? (kindRaw as GroupChatMessageKind)
          : parent.kind === 'ask'
            ? 'ack'
            : 'say'
        const mentions = parseMentions(body, {
          agentTeamStore: useAgentTeamStore.getState(),
          senderTileId: senderTileId ?? undefined,
        })
        const posted = chatStore.postMessage({
          sessionId: sessionIdForReply,
          senderTileId: senderTileId ?? undefined,
          senderName,
          body,
          mentions,
          kind,
          replyTo: parent.id,
          correlationId: parent.correlationId,
          provenance: {
            source: senderTileId ? 'sub_agent' : 'orchestrator',
            trust: 'trusted',
          },
        })
        if (context.subAgentTileId) {
          ensureGroupChatTile({ createIfMissing: true, focus: true })
        }
        return jsonOk({
          posted: true,
          message_id: posted.id,
          seq: posted.seq,
          thread_id: posted.threadId ?? null,
          reply_to: parent.id,
          kind,
          deduped: posted.deduped === true,
        })
      }
      case 'chat_with_hermes_tile': {
        if (useSettingsStore.getState().showHermesAgentTile !== true) {
          return jsonErr(
            'Hermes agent tiles are off in Settings → Agent → Hermes (Show Hermes agent tile). Enable there to use this tool, or use spawn_sub_agent with a standard worker for multi-agent work.'
          )
        }
        if (!orchId) return jsonErr('orchestrator tile context required (open the orchestrator module)')
        const prompt = String(args.prompt ?? '').trim()
        if (!prompt) return jsonErr('prompt required')
        const reuse = args.reuse !== false
        const displayName = String(args.display_name ?? 'Hermes').trim() || 'Hermes'
        const parentAgentTileId =
          context.subAgentTileId && context.subAgentTileId.trim() ? context.subAgentTileId : null
        const existingRaw = args.tile_id != null ? String(args.tile_id).trim() : ''
        let tileId: string
        if (existingRaw && reuse) {
          const t = useCanvasStore.getState().tiles.get(existingRaw)
          if (!t) return jsonErr(`no tile with id ${existingRaw}`)
          if (t.type !== 'hermes_agent') {
            return jsonErr('tile_id must refer to a hermes_agent tile')
          }
          tileId = existingRaw
        } else {
          tileId = useCanvasStore.getState().addTileIntelligent('hermes_agent', undefined, {
            title: displayName,
            meta: { parentOrchestratorTileId: orchId },
          })
        }
        const taskId = nanoid()
        const prev = useCanvasStore.getState().tiles.get(tileId)
        const prevMeta =
          prev?.meta && typeof prev.meta === 'object' ? { ...(prev.meta as Record<string, unknown>) } : {}
        useCanvasStore.getState().updateTile(tileId, {
          title: displayName,
          meta: {
            ...prevMeta,
            parentOrchestratorTileId: orchId,
            ...(parentAgentTileId ? { parentAgentTileId } : {}),
            delegatedTask: prompt,
            taskId,
            hermesTileDisplayName: displayName,
          },
          tileStatus: 'working',
          spawnedByTileId: parentAgentTileId ?? orchId,
        })
        useAgentTeamStore.getState().registerMember({
          tileId,
          displayName,
          role: 'Hermes chat',
          delegatedTask: prompt,
          currentTask: 'Sending to Hermes…',
          status: 'working',
          ...(parentAgentTileId ? { parentTileId: parentAgentTileId } : {}),
        })
        ensureAgentTeamTile()
        revealOrchestratorTile(
          tileId,
          { label: `${displayName} (Hermes chat)…`, effect: 'pulse' },
          orchId
        )
        recordOrchestratorToolOnModule(orchId, name, { ...args, tile_id: tileId, task_id: taskId })
        return jsonOk({
          tile_id: tileId,
          task_id: taskId,
          note:
            'Hermes chat tile will send the prompt over HTTP and post a sub-agent handoff when the reply finishes. For headless Hermes workers with full tools, use spawn_sub_agent with runner:"hermes" instead.',
        })
      }
      case 'wait_for_sub_agent': {
        const runId = 'subagent-hang'
        const tileId = String(args.tile_id ?? '').trim()
        if (!tileId) return jsonErr('tile_id required')
        const member0 = useAgentTeamStore.getState().membersByTileId[tileId]
        if (!member0) {
          // #region agent log
          emitDebugLog(runId, 'H1', 'executeTools.ts:1726', 'wait_for_sub_agent unknown tile', {
            tileId,
          })
          // #endregion
          return jsonErr(
            `No sub-agent found for tile_id="${tileId}". Use the tile_id returned by your earlier spawn_sub_agent call.`
          )
        }
        const terminal = (status: string): boolean =>
          status === 'done' ||
          status === 'error' ||
          status === 'idle' ||
          status === 'needs_review'
        const waitOutcomeForStatus = (
          status: string
        ): 'done' | 'error' | 'cancelled' => {
          if (status === 'done' || status === 'needs_review') return 'done'
          if (status === 'error') return 'error'
          return 'cancelled'
        }
        const summarizeMember = (m: {
          status: string
          lastSummary?: string
          error?: string
          displayName: string
          role: string
        }): string => {
          const outcome =
            m.status === 'done' || m.status === 'needs_review'
              ? 'done'
              : m.status === 'error'
                ? 'error'
                : m.status === 'idle'
                  ? 'cancelled'
                  : 'unknown'
          return jsonOk({
            tile_id: tileId,
            display_name: m.displayName,
            role: m.role,
            outcome,
            summary: m.lastSummary ?? null,
            error: m.error ?? null,
          })
        }
        if (terminal(member0.status)) {
          // #region agent log
          emitDebugLog(runId, 'H4', 'executeTools.ts:1757', 'wait_for_sub_agent immediate terminal member', {
            tileId,
            status: member0.status,
            hasSummary: !!member0.lastSummary,
          })
          // #endregion
          return summarizeMember(member0)
        }
        const requestedTimeout =
          typeof args.timeout_ms === 'number' && Number.isFinite(args.timeout_ms)
            ? Math.max(1000, Math.min(1_800_000, Math.floor(args.timeout_ms as number)))
            : 600_000
        const parentSignal = context.signal
        // If the orchestrator Stop was already pressed before we started
        // waiting, bail out immediately — never block on a doomed await.
        if (parentSignal?.aborted) {
          // #region agent log
          emitDebugLog(runId, 'H4', 'executeTools.ts:1770', 'wait_for_sub_agent parent already aborted', {
            tileId,
            requestedTimeout,
          })
          // #endregion
          return jsonOk({
            tile_id: tileId,
            display_name: member0.displayName,
            role: member0.role,
            outcome: 'cancelled',
            summary: null,
            error: 'Parent run aborted before wait resolved.',
          })
        }
        const outcomeRaw = await new Promise<'done' | 'error' | 'cancelled' | 'timeout'>(
          (resolve) => {
            let settled = false
            const waitStartedAt = Date.now()
            const STALE_WAIT_FIRST_LOG_MS = 90_000
            const STALE_WAIT_REPEAT_MS = 120_000
            let lastWaitNudgeAt = 0
            let waitNudgeTimer: ReturnType<typeof setInterval> | null = null
            let timeoutHandle: ReturnType<typeof setTimeout> | undefined
            const clearWaitNudge = () => {
              if (waitNudgeTimer != null) {
                clearInterval(waitNudgeTimer)
                waitNudgeTimer = null
              }
            }
            const finish = (v: 'done' | 'error' | 'cancelled' | 'timeout') => {
              if (settled) return
              settled = true
              clearWaitNudge()
              if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
              parentSignal?.removeEventListener('abort', onAbort)
              unsubscribe()
              resolve(v)
            }
            const unsubscribe = useAgentTeamStore.subscribe((state) => {
              const m = state.membersByTileId[tileId]
              if (!m || !terminal(m.status)) return
              finish(waitOutcomeForStatus(m.status))
            })
            const onAbort = () => finish('cancelled')
            parentSignal?.addEventListener('abort', onAbort, { once: true })
            timeoutHandle = setTimeout(() => finish('timeout'), requestedTimeout)
            waitNudgeTimer = setInterval(() => {
              if (settled) return
              const elapsed = Date.now() - waitStartedAt
              if (elapsed >= requestedTimeout) {
                finish('timeout')
                return
              }
              if (elapsed < STALE_WAIT_FIRST_LOG_MS) return
              const now = Date.now()
              if (lastWaitNudgeAt === 0) {
                lastWaitNudgeAt = now
                context.onLog?.(
                  `[wait_for_sub_agent] Still waiting on ${member0.displayName} (tile ${tileId.slice(0, 8)}…) — ${Math.round(elapsed / 1000)}s / ${Math.round(requestedTimeout / 1000)}s timeout. Use Stop to cancel if stuck.`
                )
                return
              }
              if (now - lastWaitNudgeAt >= STALE_WAIT_REPEAT_MS) {
                lastWaitNudgeAt = now
                context.onLog?.(
                  `[wait_for_sub_agent] Still waiting — ${Math.round(elapsed / 1000)}s elapsed (sub-agent may be slow or blocked).`
                )
              }
            }, 25_000)
            // Re-check synchronously in case the worker finished between the
            // initial read and `subscribe()` attaching (thin but real race).
            const m1 = useAgentTeamStore.getState().membersByTileId[tileId]
            if (m1 && terminal(m1.status)) {
              finish(waitOutcomeForStatus(m1.status))
            }
          }
        )
        const memberFinal =
          useAgentTeamStore.getState().membersByTileId[tileId] ?? member0
        // #region agent log
        emitDebugLog(runId, 'H4', 'executeTools.ts:1820', 'wait_for_sub_agent resolved', {
          tileId,
          outcome: outcomeRaw,
          finalStatus: memberFinal.status,
          hasSummary: !!memberFinal.lastSummary,
          hasError: !!memberFinal.error,
        })
        // #endregion
        return jsonOk({
          tile_id: tileId,
          display_name: memberFinal.displayName,
          role: memberFinal.role,
          outcome: outcomeRaw,
          summary: memberFinal.lastSummary ?? null,
          error:
            outcomeRaw === 'timeout'
              ? `wait_for_sub_agent timed out after ${requestedTimeout}ms; the sub-agent may still be running and will post its handoff to your log when it finishes.`
              : (memberFinal.error ?? null),
        })
      }
      case 'record_benchmark_session': {
        const raw = String(args.results_json ?? '').trim()
        if (!raw) return jsonErr('results_json required')
        let parsed: unknown
        try {
          parsed = JSON.parse(raw) as unknown
        } catch {
          return jsonErr('results_json must be valid JSON')
        }
        const title = String(args.title ?? 'Benchmark').trim() || 'Benchmark'
        const summary = String(args.summary ?? '').trim()
        const relJson = '.agent-canvas/benchmarks/latest.json'
        const relHtml = '.agent-canvas/benchmarks/latest-report.html'
        await tauri.writeFile(relJson, JSON.stringify(parsed, null, 2))
        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>
body{font-family:ui-sans-serif,system-ui;background:#0b0d10;color:#e8eaed;margin:0;padding:1.5rem;line-height:1.5}
h1{font-size:1.25rem;font-weight:600;color:#34d399}
pre{background:#111827;padding:1rem;border-radius:8px;overflow:auto;font-size:12px}
</style></head><body><h1>${escapeHtml(title)}</h1>${summary ? `<p>${escapeHtml(summary)}</p>` : ''}<pre>${escapeHtml(JSON.stringify(parsed, null, 2))}</pre></body></html>`
        await tauri.writeFile(relHtml, html)

        const bx = args.x !== undefined ? Number(args.x) : undefined
        const by = args.y !== undefined ? Number(args.y) : undefined
        const pos =
          bx !== undefined && by !== undefined && !Number.isNaN(bx) && !Number.isNaN(by)
            ? { x: bx, y: by }
            : undefined
        const benchId = pos
          ? useCanvasStore.getState().addTile('benchmark', pos)
          : useCanvasStore.getState().addTileIntelligent('benchmark')
        useCanvasStore.getState().updateTile(benchId, {
          title,
          meta: {
            benchmarkResults: parsed,
            summary,
            reportRelativePath: relHtml,
            source: 'orchestrator-benchmark',
          },
          tileStatus: 'done',
        })
        revealOrchestratorTile(benchId, { label: 'Benchmark…', effect: 'pulse' }, orchId)

        const tileIds: string[] = [benchId]
        if (args.open_docs_browser_tile === true) {
          const bid = useCanvasStore.getState().addTileIntelligent('browser')
          useCanvasStore.getState().updateTile(bid, {
            title: 'Remotion · docs',
            meta: {
              url: 'https://www.remotion.dev/docs',
              source: 'orchestrator-benchmark',
            },
          })
          revealOrchestratorTile(bid, { label: 'Docs…', effect: 'scan' }, orchId)
          tileIds.push(bid)
        }
        if (args.open_remotion_tile === true) {
          const rid = useCanvasStore.getState().addTileIntelligent('remotion')
          useCanvasStore.getState().updateTile(rid, {
            title: 'Remotion studio',
            meta: { studioUrl: 'http://localhost:3000' },
          })
          revealOrchestratorTile(rid, { label: 'Remotion…', effect: 'pulse' }, orchId)
          tileIds.push(rid)
        }
        recordOrchestratorToolOnModule(orchId, name, { ...args, tile_ids: tileIds })
        return jsonOk({
          benchmark_tile_id: benchId,
          tile_ids: tileIds,
          report_json: relJson,
          report_html: relHtml,
          note:
            'Benchmark module shows parsed JSON; HTML report written for the system browser. Visual Explainer templates live under docs/skills/visual-explainer (see NATIVE_INTEGRATIONS.md).',
        })
      }
      case 'memory': {
        if (!tauri.isTauri()) {
          return jsonErr('memory tool requires Orca desktop (Tauri)')
        }
        const action = coerceHermesMemoryAction(args.action)
        if (!action) return jsonErr('action must be one of: add, replace, remove')
        const target = coerceHermesMemoryTarget(args.target)
        if (!target) return jsonErr('target must be one of: memory, user')

        const relative = target === 'memory' ? 'MEMORY.md' : 'USER.md'
        const prior = (await tauri.readOrcaDataFile(relative)) ?? ''
        const applied = applyHermesMemoryMutation({
          existing: prior,
          action,
          content: typeof args.content === 'string' ? args.content : undefined,
          oldText: typeof args.old_text === 'string' ? args.old_text : undefined,
        })
        if (!applied.ok) return jsonErr(applied.error)
        if (applied.changed) {
          await tauri.writeOrcaDataFile(relative, applied.next)
        }
        recordOrchestratorToolOnModule(orchId, name, {
          action,
          target,
          changed: applied.changed,
        })
        return jsonOk({
          action,
          target,
          path: `~/.orca/${relative}`,
          changed: applied.changed,
          note:
            target === 'memory'
              ? 'Durable memory updated. This file is injected via long-term memory settings when enabled.'
              : 'User profile memory updated. This file is injected via USER.md profile settings when enabled.',
        })
      }
      case 'session_search': {
        const query = String(args.query ?? '').trim()
        const lim = Math.min(20, Math.max(1, Number(args.limit ?? 5) || 5))
        const roleFilter = String(args.role_filter ?? '').trim()
        if (!query) {
          if (!tauri.isTauri()) {
            return jsonOk({
              mode: 'browse',
              sessions: [],
              note: 'Recent-session browse requires Orca desktop persistence. Provide query for indexed recall.',
            })
          }
          try {
            const { invoke } = await import('@tauri-apps/api/core')
            const rows = (await invoke<Array<{ sessionId: string; updatedAtMs?: number; workspaceRoot?: string | null }>>(
              'orca_list_incomplete_sessions'
            )) as Array<{ sessionId: string; updatedAtMs?: number; workspaceRoot?: string | null }> | null
            const sessions = (rows ?? []).slice(0, lim).map((r) => ({
              session_id: r.sessionId,
              updated_at_ms: r.updatedAtMs ?? null,
              workspace_root: r.workspaceRoot ?? null,
            }))
            recordOrchestratorToolOnModule(orchId, name, { mode: 'browse', count: sessions.length })
            return jsonOk({
              mode: 'browse',
              sessions,
              note:
                'Browse mode currently lists resumable recent sessions (incomplete). For full transcript recall across sessions, pass query.',
            })
          } catch (e) {
            return jsonErr(e instanceof Error ? e.message : String(e))
          }
        }

        const filterSession =
          args.session_id !== undefined && args.session_id !== null
            ? String(args.session_id).trim()
            : undefined
        const { searchSessionsFts } = await import('../persistence/sessionPersistence')
        const rows = await searchSessionsFts(query, lim)
        const filtered = filterSession ? rows.filter((r) => r.sessionId === filterSession) : rows
        recordOrchestratorToolOnModule(orchId, name, {
          query,
          limit: lim,
          role_filter: roleFilter || null,
          session_id: filterSession ?? null,
        })
        return jsonOk({
          query,
          role_filter: roleFilter || null,
          note:
            'score combines FTS BM25 relevance with a tiny recency bump (higher = ranked better). role_filter is currently informational only.',
          results: filtered.map((r) => ({
            session_id: r.sessionId,
            message_index: r.messageIndex,
            content: r.content.slice(0, 2000),
            score: r.score,
          })),
        })
      }
      case 'recall_session_history': {
        const query = String(args.query ?? '').trim()
        if (!query) return jsonErr('query required')
        const max = Math.min(20, Math.max(1, Number(args.max_results ?? 5)))
        const filterSession =
          args.session_id !== undefined && args.session_id !== null
            ? String(args.session_id).trim()
            : undefined
        const { searchSessionsFts } = await import('../persistence/sessionPersistence')
        const rows = await searchSessionsFts(query, max)
        const filtered = filterSession
          ? rows.filter((r) => r.sessionId === filterSession)
          : rows
        recordOrchestratorToolOnModule(orchId, name, args)
        return jsonOk({
          query,
          note:
            'score combines FTS BM25 relevance with a tiny recency bump (higher = ranked better).',
          results: filtered.map((r) => ({
            session_id: r.sessionId,
            message_index: r.messageIndex,
            content: r.content.slice(0, 2000),
            score: r.score,
          })),
        })
      }
      case 'search_workspace_memory':
      case 'search_project_wiki': {
        const query = String(args.query ?? '').trim()
        if (!query) return jsonErr('query required')
        const maxHits = Math.min(48, Math.max(1, Number(args.max_results ?? 24)))
        const scopes: WorkspaceMemoryScopeId[] =
          name === 'search_project_wiki'
            ? ['wiki', 'orca_brain']
            : parseWorkspaceMemoryScopes(args.scopes) ?? ['wiki', 'orca_brain', 'orca_chat']
        const { hits, scanned_files } = await searchWorkspaceMemoryMarkdown(query, maxHits, scopes)
        let mergedHits = hits
        let extraCentral = 0
        if (tauri.isTauri() && useSettingsStore.getState().centralBrainEnabled) {
          const { searchCentralVaultMarkdown } = await import('../vault/searchCentralVault')
          const room = Math.max(0, maxHits - hits.length)
          if (room > 0) {
            const c = await searchCentralVaultMarkdown(query, room)
            mergedHits = [
              ...hits,
              ...c.hits.map((h) => ({ path: h.path, snippet: h.snippet, scope: 'central' as const })),
            ]
            extraCentral = c.scanned_files
          }
        }
        recordOrchestratorToolOnModule(orchId, name, args)
        const budgetName = name === 'search_project_wiki' ? 'search_project_wiki' : 'search_workspace_memory'
        const payload = {
          query,
          scopes:
            name === 'search_project_wiki' ? (['wiki', 'orca_brain'] as const) : scopes,
          scanned_markdown_candidates: scanned_files + extraCentral,
          hits: mergedHits.map((h) => ({
            path: h.path,
            snippet: h.snippet,
            scope: 'scope' in h ? (h as { scope?: string }).scope : undefined,
          })),
          note:
            'Searches workspace `wiki/**`, `Orca/brain/**`, and `Orca/chat/**` (when included). With Settings → Agent data → **Central brain** enabled (Tauri), also searches the iCloud central vault (`central:…` paths). For raw orchestrator chat FTS use `recall_session_history`.',
        }
        const raw = JSON.stringify({ ok: true, ...payload })
        return applyToolResultBudget(budgetName, raw, maxResultCharsForTool(budgetName)).text
      }
      case 'search_central_playbooks': {
        const query = String(args.query ?? '').trim()
        if (!query) return jsonErr('query required')
        const maxHits = Math.min(48, Math.max(1, Number(args.max_results ?? 24)))
        const { searchCentralPlaybooksMarkdown } = await import('../vault/searchCentralVault')
        const { hits, scanned_files } = await searchCentralPlaybooksMarkdown(query, maxHits)
        recordOrchestratorToolOnModule(orchId, name, args)
        const payload = {
          query,
          scanned_markdown_candidates: scanned_files,
          hits: hits.map((h) => ({ path: h.path, snippet: h.snippet })),
          note:
            'Searches `playbooks/**/*.md` in the central Obsidian vault (account notes for Vercel, Stripe, etc.). Requires Central brain + Tauri.',
        }
        const raw = JSON.stringify({ ok: true, ...payload })
        return applyToolResultBudget(
          'search_central_playbooks',
          raw,
          maxResultCharsForTool('search_central_playbooks')
        ).text
      }
      case 'run_auto_fix':
      case 'run_auto_fix_batch':
      case 'get_console_errors':
      case 'get_network_failures':
      case 'get_inspect_summary':
      case 'search_console':
      case 'search_network':
      case 'get_detected_issues':
      case 'export_inspect_data': {
        recordOrchestratorToolOnModule(orchId, name, args)
        return jsonErr(
          'Inspect/auto-fix tile tooling has been removed. Use the browser preview DevTools directly.'
        )
      }
      case 'query_codebase_graph': {
        const question = String(args.question ?? '').trim()
        const path = 'GRAPH_REPORT.md'
        try {
          assertSafeWorkspacePath(path)
        } catch (e) {
          return jsonErr(e instanceof Error ? e.message : String(e))
        }
        try {
          const content = await tauri.readFile(path)
          const budgeted = applyToolResultBudget(
            'read_file',
            content,
            maxResultCharsForTool('read_file')
          )
          recordOrchestratorToolOnModule(orchId, name, { ...args, found: true })
          return jsonOk({
            path,
            question: question || null,
            report_excerpt: budgeted.text,
            truncated: budgeted.truncated,
            note: 'Excerpt from GRAPH_REPORT.md (graphify / knowledge-graph export).',
          })
        } catch {
          recordOrchestratorToolOnModule(orchId, name, { ...args, found: false })
          return jsonOk({
            path,
            question: question || null,
            report_excerpt: null,
            note: 'GRAPH_REPORT.md not in workspace. Run graphify or add the report at the repo root.',
          })
        }
      }
      case 'fetch_dev_telemetry_snapshot': {
        const lim = Math.min(80, Math.max(1, Number(args.limit) || 30))
        try {
          const { fetchTelemetryHealth, fetchTelemetryEvents } = await import('../devTelemetryApi')
          const [health, evPack] = await Promise.all([
            fetchTelemetryHealth(),
            fetchTelemetryEvents({ limit: lim }),
          ])
          recordOrchestratorToolOnModule(orchId, name, { ...args, eventCount: evPack.events?.length ?? 0 })
          return jsonOk({
            health,
            recent_events: evPack.events ?? [],
            stats: evPack.stats,
            note: 'Dev telemetry (localhost or VITE_DEV_TELEMETRY_URL). Empty if server offline.',
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          recordOrchestratorToolOnModule(orchId, name, { ...args, error: msg })
          return jsonOk({
            error: msg,
            recent_events: [] as unknown[],
            note: 'Telemetry unreachable. Start `npm run dev:telemetry:node` or set the API URL.',
          })
        }
      }
      case 'list_merge_review_tickets': {
        const tickets = mergeReviewQueueSnapshot()
        recordOrchestratorToolOnModule(orchId, name, { count: tickets.length })
        return jsonOk({
          tickets: tickets.map((t) => ({
            id: t.id,
            agent_tile_id: t.agentTileId,
            status: t.status,
            notes_preview: t.notes.slice(0, 2000),
          })),
          note: 'Filled when sub-agents complete. Approve/reject in the Agents sidebar (Merge review).',
        })
      }
      case 'configure_hermes_api': {
        const hasKey = args.api_key !== undefined
        const hasBase = args.api_base_url !== undefined
        const hasModel = args.model !== undefined
        if (!hasKey && !hasBase && !hasModel) {
          return jsonErr('Provide at least one of: api_key, api_base_url, model')
        }
        const s = useSettingsStore.getState()
        if (hasKey) s.setHermesApiKey(sanitizeHermesApiKeyForStorage(args.api_key))
        if (hasBase) s.setHermesApiBaseUrl(String(args.api_base_url))
        if (hasModel) s.setHermesModel(String(args.model))
        const after = useSettingsStore.getState()
        recordOrchestratorToolOnModule(orchId, name, {
          applied: { api_key: hasKey, api_base_url: hasBase, model: hasModel },
        })
        return jsonOk({
          applied: {
            api_key: hasKey,
            api_base_url: hasBase,
            model: hasModel,
          },
          hermes_api_base_url: after.hermesApiBaseUrl,
          hermes_model: after.hermesModel,
          note: 'Hermes settings updated (same as Settings → Integrations). Empty api_key means Orca auto-reads `API_SERVER_KEY` from `~/.hermes/.env` (Tauri); paste a value only to override. api_key value is not echoed.',
        })
      }
      case 'diagnose_hermes_setup': {
        const md = await runHermesOrchestratorSetupDiagnose(context.signal)
        recordOrchestratorToolOnModule(orchId, name, {})
        return applyToolResultBudget(name, md).text
      }
      case 'hermes_kb_search':
      case 'hermes_web_search':
      case 'hermes_skill': {
        // Route all `hermes_*` tools through the gateway's
        // `POST /v1/tools/{name}/invoke` endpoint. Mapping from our orchestrator
        // tool name → Hermes server tool name is 1:1 for these three; the input
        // shape is `{ query, top_k }` / `{ query, max_results }` / `{ name, input }`
        // which matches the descriptors exposed under `/v1/tools`.
        const s = useSettingsStore.getState()
        const base = s.hermesApiBaseUrl
        const key = s.hermesApiKey
        const toolInput: Record<string, unknown> = {}
        if (name === 'hermes_kb_search') {
          if (typeof args.query === 'string') toolInput.query = args.query
          if (typeof args.top_k === 'number') toolInput.top_k = args.top_k
        } else if (name === 'hermes_web_search') {
          if (typeof args.query === 'string') toolInput.query = args.query
          if (typeof args.max_results === 'number') toolInput.max_results = args.max_results
        } else {
          // hermes_skill — invoke the named skill, passing `input` through
          // transparently so the server schema wins over ours.
          if (typeof args.name === 'string') toolInput.name = args.name
          if (args.input && typeof args.input === 'object') toolInput.input = args.input
        }
        const res = await invokeHermesTool(base, key || undefined, name, toolInput)
        recordOrchestratorToolOnModule(orchId, name, {
          status: res.status,
          ok: res.ok,
        })
        if (!res.ok) {
          return jsonErr(
            `Hermes ${name} failed (status ${res.status || 'network'}): ${res.text.slice(0, 400)}`
          )
        }
        // Prefer the parsed JSON body if the gateway returned one — keeps the
        // orchestrator's token budget predictable vs. raw string blobs.
        return jsonOk({
          status: res.status,
          result: res.json ?? res.text,
        })
      }

      // ─────────────────────────────────────────────────────────────────────────────
      // Agent Browser automation tools
      // ─────────────────────────────────────────────────────────────────────────────
      case 'browser_open': {
        if (!tauri.isTauri()) {
          return jsonErr('agent-browser requires the Orca desktop app')
        }
        const rawUrl = typeof args.url === 'string' ? args.url.trim() : ''
        if (!rawUrl) {
          return jsonErr('browser_open requires a url parameter')
        }
        try {
          await tauri.ensureAgentBrowserCliInstalled()
        } catch (e) {
          return jsonErr(e instanceof Error ? e.message : String(e))
        }
        let url = rawUrl
        try {
          url = normalizeAndValidateAgentBrowserUrl(rawUrl)
        } catch (e) {
          return jsonErr(e instanceof Error ? e.message : String(e))
        }

        let tileId = typeof args.tile_id === 'string' ? args.tile_id.trim() : null

        if (tileId) {
          const explicit = useCanvasStore.getState().tiles.get(tileId)
          if (!explicit) return jsonErr(`No tile found for tile_id "${tileId}"`)
          if (explicit.type !== 'agent_browser') {
            return jsonErr('browser_open tile_id must reference an agent_browser tile')
          }
        } else {
          const resolved = resolveAgentBrowserTileForTools(useCanvasStore.getState().tiles, args)
          if (resolved.ok) {
            tileId = resolved.tile.id
          } else if (resolved.error === NO_AGENT_BROWSER_TILE) {
            tileId = useCanvasStore.getState().addTileIntelligent('agent_browser')
            const sessionName = `orca-${tileId.slice(0, 6)}`
            useCanvasStore.getState().updateTile(tileId, {
              title: 'Agent Browser',
              meta: { sessionName },
            })
            revealOrchestratorTile(tileId, { label: 'Opening browser…', effect: 'pulse' }, orchId)
          } else {
            return jsonErr(messageForAgentBrowserTileResolveFailure(resolved.error))
          }
        }

        const openTileMeta = tileId
          ? ((useCanvasStore.getState().tiles.get(tileId)?.meta ?? {}) as Record<string, unknown>)
          : {}
        const openPreSnapshot =
          typeof openTileMeta.lastSnapshot === 'string' ? openTileMeta.lastSnapshot : undefined
        try {
          const { snapshot } = await navigateAgentBrowserTile(tileId, url)
          const st = useCanvasStore.getState()
          const latest = st.tiles.get(tileId)
          const latestMeta = { ...((latest?.meta ?? openTileMeta) as Record<string, unknown>) }
          if (openPreSnapshot) {
            latestMeta.lastSnapshot = openPreSnapshot
            st.updateTile(tileId, { meta: latestMeta })
          }
          recordOrchestratorToolOnModule(orchId, name, { url, tileId })
          return jsonOk({ success: true, url, tile_id: tileId, snapshot })
        } catch (e) {
          return jsonErr(`browser_open failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      case 'browser_snapshot': {
        if (!tauri.isTauri()) {
          return jsonErr('agent-browser requires the Orca desktop app')
        }
        const resolved = resolveAgentBrowserTileForTools(useCanvasStore.getState().tiles, args)
        if (!resolved.ok) {
          return jsonErr(messageForAgentBrowserTileResolveFailure(resolved.error))
        }
        const tile = resolved.tile

        const tileMeta = tile.meta as Record<string, unknown>
        const sessionName = tileMeta?.sessionName as string
        if (!sessionName) {
          return jsonErr(
            'Agent browser session not initialized (missing sessionName on tile). Run browser_open again or recreate the agent_browser tile.'
          )
        }

        try {
          const flagArgs: string[] = []
          if (args.interactive_only !== false) flagArgs.push('-i')
          if (args.compact !== false) flagArgs.push('-c')

          const result = await tauri.runAgentBrowser(['snapshot', ...flagArgs, '--json'], { sessionName })
          let snapshot = ''
          try {
            const parsed = JSON.parse(result) as { data?: { snapshot?: string } }
            snapshot = parsed.data?.snapshot ?? result
          } catch {
            snapshot = result
          }

          const previousSnapshot = typeof tileMeta?.lastSnapshot === 'string' ? tileMeta.lastSnapshot : undefined
          useCanvasStore.getState().updateTile(tile.id, {
            meta: {
              ...tileMeta,
              ...(previousSnapshot ? { dreamPreviousSnapshot: previousSnapshot } : {}),
              lastSnapshot: snapshot,
            },
          })

          recordOrchestratorToolOnModule(orchId, name, { tileId: tile.id })
          return jsonOk({ success: true, snapshot })
        } catch (e) {
          return jsonErr(`browser_snapshot failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      case 'browser_click': {
        if (!tauri.isTauri()) {
          return jsonErr('agent-browser requires the Orca desktop app')
        }
        const selector = typeof args.selector === 'string' ? args.selector.trim() : ''
        if (!selector) {
          return jsonErr('browser_click requires a selector parameter')
        }

        const resolved = resolveAgentBrowserTileForTools(useCanvasStore.getState().tiles, args)
        if (!resolved.ok) {
          return jsonErr(messageForAgentBrowserTileResolveFailure(resolved.error))
        }
        const tile = resolved.tile

        const tileMeta = tile.meta as Record<string, unknown>
        const sessionName = tileMeta?.sessionName as string
        if (!sessionName) {
          return jsonErr(
            'Agent browser session not initialized (missing sessionName on tile). Run browser_open again or recreate the agent_browser tile.'
          )
        }

        // Best-effort: resolve element box for a non-blocking pointer story on the tile (click is not awaited here).
        void (async () => {
          try {
            const boxResult = await tauri.runAgentBrowser(['get', 'box', selector, '--json'], { sessionName })
            const box = JSON.parse(boxResult) as {
              success?: boolean
              data?: { x: number; y: number; width: number; height: number }
            }
            if (!box.success || !box.data) return
            const targetX = box.data.x + box.data.width / 2
            const targetY = box.data.y + box.data.height / 2
            const st = useCanvasStore.getState()
            const t = st.tiles.get(tile.id)
            if (!t) return
            const m = { ...(t.meta as Record<string, unknown>) }
            m.agentBrowserPresentation = { targetX, targetY, requestId: nanoid() }
            st.updateTile(tile.id, { meta: m })
          } catch {
            /* best-effort visual */
          }
        })()

        try {
          await tauri.runAgentBrowser(['click', selector], { sessionName })

          // Get updated snapshot after click
          const snapshotResult = await tauri.runAgentBrowser(['snapshot', '-i', '--json'], { sessionName })
          let snapshot = ''
          try {
            const parsed = JSON.parse(snapshotResult) as { data?: { snapshot?: string } }
            snapshot = parsed.data?.snapshot ?? snapshotResult
          } catch {
            snapshot = snapshotResult
          }

          const st = useCanvasStore.getState()
          const latest = st.tiles.get(tile.id)
          const merged = { ...((latest?.meta ?? tileMeta) as Record<string, unknown>) }
          merged.lastSnapshot = snapshot
          st.updateTile(tile.id, { meta: merged })

          recordOrchestratorToolOnModule(orchId, name, { selector, tileId: tile.id })
          return jsonOk({ success: true, clicked: selector, snapshot })
        } catch (e) {
          return jsonErr(`browser_click failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      case 'browser_fill': {
        if (!tauri.isTauri()) {
          return jsonErr('agent-browser requires the Orca desktop app')
        }
        const selector = typeof args.selector === 'string' ? args.selector.trim() : ''
        const text = typeof args.text === 'string' ? args.text : ''
        if (!selector) {
          return jsonErr('browser_fill requires a selector parameter')
        }

        const resolved = resolveAgentBrowserTileForTools(useCanvasStore.getState().tiles, args)
        if (!resolved.ok) {
          return jsonErr(messageForAgentBrowserTileResolveFailure(resolved.error))
        }
        const tile = resolved.tile

        const tileMeta = tile.meta as Record<string, unknown>
        const sessionName = tileMeta?.sessionName as string
        if (!sessionName) {
          return jsonErr(
            'Agent browser session not initialized (missing sessionName on tile). Run browser_open again or recreate the agent_browser tile.'
          )
        }

        try {
          await tauri.runAgentBrowser(['fill', selector, text], { sessionName })

          const st = useCanvasStore.getState()
          const latest = st.tiles.get(tile.id)
          const merged = { ...((latest?.meta ?? tileMeta) as Record<string, unknown>) }
          st.updateTile(tile.id, { meta: merged })

          recordOrchestratorToolOnModule(orchId, name, { selector, tileId: tile.id })
          return jsonOk({ success: true, filled: selector, text })
        } catch (e) {
          return jsonErr(`browser_fill failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      case 'browser_press': {
        if (!tauri.isTauri()) {
          return jsonErr('agent-browser requires the Orca desktop app')
        }
        const key = typeof args.key === 'string' ? args.key.trim() : ''
        if (!key) {
          return jsonErr('browser_press requires a key parameter')
        }

        const resolved = resolveAgentBrowserTileForTools(useCanvasStore.getState().tiles, args)
        if (!resolved.ok) {
          return jsonErr(messageForAgentBrowserTileResolveFailure(resolved.error))
        }
        const tile = resolved.tile

        const tileMeta = tile.meta as Record<string, unknown>
        const sessionName = tileMeta?.sessionName as string
        if (!sessionName) {
          return jsonErr(
            'Agent browser session not initialized (missing sessionName on tile). Run browser_open again or recreate the agent_browser tile.'
          )
        }

        try {
          await tauri.runAgentBrowser(['press', key], { sessionName })

          const st = useCanvasStore.getState()
          const latest = st.tiles.get(tile.id)
          const merged = { ...((latest?.meta ?? tileMeta) as Record<string, unknown>) }
          st.updateTile(tile.id, { meta: merged })

          recordOrchestratorToolOnModule(orchId, name, { key, tileId: tile.id })
          return jsonOk({ success: true, pressed: key })
        } catch (e) {
          return jsonErr(`browser_press failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      case 'browser_screenshot': {
        if (!tauri.isTauri()) {
          return jsonErr('agent-browser requires the Orca desktop app')
        }

        const resolved = resolveAgentBrowserTileForTools(useCanvasStore.getState().tiles, args)
        if (!resolved.ok) {
          return jsonErr(messageForAgentBrowserTileResolveFailure(resolved.error))
        }
        const tile = resolved.tile

        const tileMeta = tile.meta as Record<string, unknown>
        const sessionName = tileMeta?.sessionName as string
        if (!sessionName) {
          return jsonErr(
            'Agent browser session not initialized (missing sessionName on tile). Run browser_open again or recreate the agent_browser tile.'
          )
        }

        try {
          const screenshotArgs: string[] = ['screenshot']
          if (args.annotate === true) screenshotArgs.push('--annotate')
          if (typeof args.path === 'string') {
            const absPath = `${useWorkspaceStore.getState().rootPath}/${args.path}`
            screenshotArgs.push('--output', absPath)
          }
          screenshotArgs.push('--json')

          const result = await tauri.runAgentBrowser(screenshotArgs, { sessionName })
          let path = ''
          try {
            const parsed = JSON.parse(result) as { data?: { path?: string } }
            path = parsed.data?.path ?? ''
          } catch {
            // Use raw result
          }

          recordOrchestratorToolOnModule(orchId, name, { tileId: tile.id, path })
          return jsonOk({ success: true, path: path || 'Screenshot captured' })
        } catch (e) {
          return jsonErr(`browser_screenshot failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      case 'browser_scroll': {
        if (!tauri.isTauri()) {
          return jsonErr('agent-browser requires the Orca desktop app')
        }
        const direction = typeof args.direction === 'string' ? args.direction.trim() : ''
        const pixels = typeof args.pixels === 'number' ? args.pixels : 500
        if (!direction || !['up', 'down', 'left', 'right'].includes(direction)) {
          return jsonErr('browser_scroll requires direction: up, down, left, or right')
        }

        const resolved = resolveAgentBrowserTileForTools(useCanvasStore.getState().tiles, args)
        if (!resolved.ok) {
          return jsonErr(messageForAgentBrowserTileResolveFailure(resolved.error))
        }
        const tile = resolved.tile

        const tileMeta = tile.meta as Record<string, unknown>
        const sessionName = tileMeta?.sessionName as string
        if (!sessionName) {
          return jsonErr(
            'Agent browser session not initialized (missing sessionName on tile). Run browser_open again or recreate the agent_browser tile.'
          )
        }

        try {
          await tauri.runAgentBrowser(['scroll', direction, String(pixels)], { sessionName })

          recordOrchestratorToolOnModule(orchId, name, { direction, pixels, tileId: tile.id })
          return jsonOk({ success: true, scrolled: direction, pixels })
        } catch (e) {
          return jsonErr(`browser_scroll failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      case 'browser_wait': {
        if (!tauri.isTauri()) {
          return jsonErr('agent-browser requires the Orca desktop app')
        }
        const selector = typeof args.selector === 'string' ? args.selector.trim() : ''
        const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : 5000
        if (!selector) {
          return jsonErr('browser_wait requires a selector parameter')
        }

        const resolved = resolveAgentBrowserTileForTools(useCanvasStore.getState().tiles, args)
        if (!resolved.ok) {
          return jsonErr(messageForAgentBrowserTileResolveFailure(resolved.error))
        }
        const tile = resolved.tile

        const tileMeta = tile.meta as Record<string, unknown>
        const sessionName = tileMeta?.sessionName as string
        if (!sessionName) {
          return jsonErr(
            'Agent browser session not initialized (missing sessionName on tile). Run browser_open again or recreate the agent_browser tile.'
          )
        }

        try {
          await tauri.runAgentBrowser(['wait', selector, '--timeout', String(timeoutMs)], { sessionName })

          recordOrchestratorToolOnModule(orchId, name, { selector, tileId: tile.id })
          return jsonOk({ success: true, waited_for: selector })
        } catch (e) {
          return jsonErr(`browser_wait failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      case 'browser_get_text': {
        if (!tauri.isTauri()) {
          return jsonErr('agent-browser requires the Orca desktop app')
        }
        const selector = typeof args.selector === 'string' ? args.selector.trim() : ''
        if (!selector) {
          return jsonErr('browser_get_text requires a selector parameter')
        }

        const resolved = resolveAgentBrowserTileForTools(useCanvasStore.getState().tiles, args)
        if (!resolved.ok) {
          return jsonErr(messageForAgentBrowserTileResolveFailure(resolved.error))
        }
        const tile = resolved.tile

        const tileMeta = tile.meta as Record<string, unknown>
        const sessionName = tileMeta?.sessionName as string
        if (!sessionName) {
          return jsonErr(
            'Agent browser session not initialized (missing sessionName on tile). Run browser_open again or recreate the agent_browser tile.'
          )
        }

        try {
          const result = await tauri.runAgentBrowser(['get', 'text', selector, '--json'], { sessionName })
          let text = ''
          try {
            const parsed = JSON.parse(result) as { data?: { text?: string } }
            text = parsed.data?.text ?? result
          } catch {
            text = result
          }

          recordOrchestratorToolOnModule(orchId, name, { selector, tileId: tile.id })
          return jsonOk({ success: true, selector, text })
        } catch (e) {
          return jsonErr(`browser_get_text failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      case 'browser_close': {
        if (!tauri.isTauri()) {
          return jsonErr('agent-browser requires the Orca desktop app')
        }

        const resolved = resolveAgentBrowserTileForTools(useCanvasStore.getState().tiles, args)
        if (!resolved.ok) {
          if (resolved.error === NO_AGENT_BROWSER_TILE) {
            return jsonOk({ success: true, message: 'No agent browser session to close' })
          }
          return jsonErr(messageForAgentBrowserTileResolveFailure(resolved.error))
        }
        const tile = resolved.tile

        const tileMeta = tile.meta as Record<string, unknown>
        const sessionName = tileMeta?.sessionName as string

        try {
          if (sessionName) {
            await tauri.closeAgentBrowserSession(sessionName)
          }
          useCanvasStore.getState().removeTile(tile.id)

          recordOrchestratorToolOnModule(orchId, name, { tileId: tile.id })
          return jsonOk({ success: true, message: 'Browser session closed' })
        } catch (e) {
          return jsonErr(`browser_close failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      default:
        return jsonErr(`Unknown tool: ${name}`)
    }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return jsonErr(msg)
      }
    })()
  } finally {
    if (countHubLink) {
      useOrchestratorActivityStore.getState().decrementSessionToolDepth(orchId)
    }
  }
  await runPostToolUseHooks({ toolName: name, argsJson: rawArgs, resultJson: toolResult })
  return toolResult
}

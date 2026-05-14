/**
 * Isolated git worktrees for sub-agents — Tauri runs `git worktree` from the workspace root.
 * Browser dev: use `suggestedWorktreeCommands` for manual shell steps.
 */

import { nanoid } from 'nanoid'
import * as tauri from '../tauri'

export type WorktreePlan = {
  agentId: string
  branchName: string
  relativePath: string
}

/** Manual CLI when `gitWorktreeAdd` is unavailable (web dev or no git). */
export function suggestedWorktreeCommands(plan: WorktreePlan): string[] {
  return [
    `git worktree add ${plan.relativePath} -b ${plan.branchName}`,
    `# Tools should resolve paths under ${plan.relativePath} for agent ${plan.agentId}`,
  ]
}

const DEFAULT_PREFIX = '.orca/worktrees'

/**
 * Create a worktree under `.orca/worktrees/<short-id>` with branch `orca/agent-<short-id>`.
 * Returns absolute path + branch on success; null if not in Tauri or command failed (caller should log).
 */
export async function createIsolatedWorktreeForAgent(agentId?: string): Promise<{
  absolutePath: string
  branch: string
  relativePath: string
} | null> {
  const id = (agentId ?? nanoid(8)).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || nanoid(8)
  const relativePath = `${DEFAULT_PREFIX}/${id}`
  const branchName = `orca/agent-${id}`

  const res = await tauri.gitWorktreeAdd(relativePath, branchName)
  if (!res?.ok) return null
  void tauri.gitWorktreeSeedDotfiles(relativePath).catch(() => {})
  void tauri.gitWorktreeSymlinkHeavyDirs(relativePath).catch(() => {})
  return {
    absolutePath: res.path,
    branch: res.branch,
    relativePath,
  }
}

export async function listWorktrees(): Promise<string | null> {
  return tauri.gitWorktreeList()
}

export async function removeWorktreeByRelativePath(relativePath: string, force = false): Promise<void> {
  await tauri.gitWorktreeRemove(relativePath, force)
}

/** Matches Tauri `OrcaSessionMeta` (`serde(rename_all = "camelCase")`). */
export type OrcaIncompleteSession = {
  sessionId: string
  incomplete: boolean
  updatedAtMs: number
  workspaceRoot?: string | null
  progressPercent?: number
  currentTaskNumber?: number
  completedTaskCount?: number
  totalTaskCount?: number
}

export function formatSessionUpdatedAt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'time unknown'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return 'time unknown'
  return d.toLocaleString()
}

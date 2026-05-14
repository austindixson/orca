export const AGENT_BROWSER_BASE_TITLE = 'Agent Browser'
export const AGENT_BROWSER_ERROR_TITLE = 'Agent Browser · Error'

export function buildAgentBrowserErrorSubtitle(message: string, maxLen: number = 140): string {
  const trimmed = String(message ?? '').trim()
  if (!trimmed) return 'Error'
  return `Error: ${trimmed}`.slice(0, Math.max(16, maxLen))
}

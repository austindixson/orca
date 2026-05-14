/**
 * Per-tool and per-turn result size limits; large payloads get truncated with a note.
 */

export const DEFAULT_MAX_TOOL_RESULT_CHARS = 80_000
export const MAX_TOOL_RESULT_CHARS_HARD = 200_000

const persistedLarge = new Map<string, string>()

function safeToolOutputFilename(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
}

/** Fire-and-forget: full payload under ~/.orca/tool-outputs/ for post-mortem / recall. */
function queuePersistOrcaToolOutput(key: string, fullText: string): void {
  const name = safeToolOutputFilename(key)
  const relative = `tool-outputs/${name}.txt`
  void (async () => {
    try {
      const { isTauri } = await import('../tauri')
      if (!isTauri()) return
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('orca_write_file', { relative, content: fullText })
    } catch {
      /* disk optional */
    }
  })()
}

export function persistLargeToolResultPreview(key: string, fullText: string, maxPreview = 4000): string {
  persistedLarge.set(key, fullText)
  queuePersistOrcaToolOutput(key, fullText)
  const head = fullText.slice(0, maxPreview)
  const tail = fullText.length > maxPreview ? `\n… truncated, ${fullText.length} chars total (key: ${key})` : ''
  return head + tail
}

export function applyToolResultBudget(
  toolName: string,
  text: string,
  maxChars: number = DEFAULT_MAX_TOOL_RESULT_CHARS
): { text: string; truncated: boolean; originalChars: number } {
  const originalChars = text.length
  if (originalChars <= maxChars) {
    return { text, truncated: false, originalChars }
  }
  const key = `tool_${toolName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const preview = persistLargeToolResultPreview(key, text, Math.min(8000, maxChars - 200))
  return {
    text:
      preview +
      `\n\n[Result budget] Output truncated from ${originalChars} to ~${maxChars} chars. Full payload: in-memory key "${key}"; on desktop also ~/.orca/tool-outputs/${safeToolOutputFilename(key)}.txt`,
    truncated: true,
    originalChars,
  }
}

export function maxResultCharsForTool(name: string): number {
  switch (name) {
    case 'read_file':
      return 120_000
    case 'read_terminal_output':
    case 'get_last_terminal_command':
    case 'wait_for_terminal_command':
      return 100_000
    case 'search_workspace_memory':
    case 'search_project_wiki':
      return 60_000
    case 'search_central_playbooks':
      return 60_000
    case 'list_directory':
      return 50_000
    case 'workspace_grep':
      return 100_000
    case 'run_terminal_cmd':
    case 'bash':
    case 'run_shell_command':
      return 120_000
    default:
      return DEFAULT_MAX_TOOL_RESULT_CHARS
  }
}

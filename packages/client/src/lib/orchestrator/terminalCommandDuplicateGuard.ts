import { useTerminalCommandState } from '../../store/terminalCommandState'

function normalizeCmd(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

/**
 * Block immediate orchestrator retries of the same command after a non-zero exit,
 * within a short window (see plan: ENOENT / npm retry storms).
 */
export function terminalMetaCommandShouldBlockDuplicate(
  tileId: string,
  userCmd: string
): { block: boolean; message?: string } {
  const last = useTerminalCommandState.getState().getTileSnapshot(tileId)?.lastCommand
  if (!last || last.exitCode === 0) return { block: false }
  if (normalizeCmd(last.cmd) !== normalizeCmd(userCmd)) return { block: false }
  if (Date.now() - last.endedAt > 60_000) return { block: false }
  return {
    block: true,
    message:
      'duplicate_failed_command: this command just failed (<60s). Call get_last_terminal_command or read_terminal_output, fix the root cause (paths, scaffolding, flags), then retry — do not re-run blindly.',
  }
}

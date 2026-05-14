/**
 * Bash / shell command classification for read-only mode and destructive warnings.
 * Complements `orchestratorSafetyGuard.ts`.
 */

const READ_ONLY_BLOCK = [
  /\brm\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bdd\b/i,
  /\bmkfs\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+commit\b/i,
  /\bgit\s+merge\b/i,
  /\bgit\s+rebase\b/i,
  /\bgit\s+checkout\b/i,
  /\bgit\s+switch\b/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+stash\s+pop\b/i,
  /\bpnpm\s+publish\b/i,
  /\bnpm\s+publish\b/i,
]

const DESTRUCTIVE_WARN = [/\brm\s+-rf\b/i, /DROP\s+TABLE/i, /truncate\s+table/i, /DELETE\s+FROM/i]

export function readOnlyBashWouldMutate(command: string): boolean {
  const c = command.trim()
  if (!c) return false
  return READ_ONLY_BLOCK.some((re) => re.test(c))
}

export function destructiveCommandNeedsWarning(command: string): boolean {
  return DESTRUCTIVE_WARN.some((re) => re.test(command))
}

export function validateBashForMode(
  command: string,
  mode: 'read_write' | 'read_only'
): { allow: boolean; reason?: string } {
  if (mode === 'read_only' && readOnlyBashWouldMutate(command)) {
    return { allow: false, reason: 'Command appears to mutate state; read-only bash mode is enabled' }
  }
  return { allow: true }
}

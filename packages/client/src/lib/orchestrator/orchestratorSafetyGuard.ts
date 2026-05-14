/**
 * Dangerous-operation hints for workspace tools (not a syscall sandbox).
 * Modes: off | warn (annotate JSON) | block (reject with ok:false).
 */

export type HarnessSafetyMode = 'off' | 'warn' | 'block'

const DANGEROUS_SHELL_PATTERNS: Array<{ re: RegExp; id: string }> = [
  { re: /\brm\s+(-[rfR]+\s*)+/i, id: 'destructive_rm_rf' },
  { re: /\brm\s+.*\*{2,}/i, id: 'destructive_rm_glob' },
  { re: /mkfs\.|dd\s+if=/i, id: 'disk_destroy' },
  { re: />\s*\/dev\/sd/i, id: 'raw_disk_write' },
  { re: /git\s+push\s+.*--force/i, id: 'git_force_push' },
  { re: /git\s+reset\s+--hard/i, id: 'git_reset_hard' },
  { re: /\bdrop\s+table\b/i, id: 'sql_drop_table' },
  { re: /\btruncate\s+table\b/i, id: 'sql_truncate' },
  { re: /curl\s+.*\|\s*(?:ba)?sh/i, id: 'pipe_to_shell' },
  { re: /wget\s+.*\|\s*(?:ba)?sh/i, id: 'wget_pipe_shell' },
  { re: /chmod\s+[-+]?\s*[rwx]*777/i, id: 'chmod_world' },
]

const INTERACTIVE_SHELL_PATTERNS: Array<{ re: RegExp; id: string; message: string }> = [
  { re: /\b(read\s+-p|select\s+.+\sin|fzf)\b/i, id: 'interactive_prompt_builtin', message: 'Interactive shell prompt detected (read/select/fzf).' },
  { re: /\b(vim|vi|nano|less|more|man|top|htop|watch)\b/i, id: 'interactive_tui', message: 'Interactive TUI command detected (vim/nano/less/man/top/etc).' },
  { re: /\bsudo\b/i, id: 'interactive_sudo', message: 'sudo may require an interactive password prompt.' },
]

const SENSITIVE_PATH_SEGMENTS = [
  /(^|[\\/])\.env($|[\\/])/i,
  /\.env\./i,
  /^\.ssh\b/i,
  /id_rsa/i,
  /\.pem$/i,
  /credentials/i,
  /secret/i,
]

export interface SafetyScanResult {
  blocked: boolean
  warnings: string[]
  matchedIds: string[]
}

function matchShellPatterns(text: string): string[] {
  const ids: string[] = []
  for (const { re, id } of DANGEROUS_SHELL_PATTERNS) {
    if (re.test(text)) ids.push(id)
  }
  return ids
}

export function scanShellCommandForDanger(cmd: string): SafetyScanResult {
  const warnings: string[] = []
  const matchedIds = matchShellPatterns(cmd)
  let blocked = false
  for (const id of matchedIds) {
    warnings.push(`Potentially dangerous shell pattern: ${id}`)
  }
  for (const { re, id, message } of INTERACTIVE_SHELL_PATTERNS) {
    if (re.test(cmd)) {
      matchedIds.push(id)
      warnings.push(message)
      blocked = true
    }
  }

  // Strict rule: create-vite must explicitly disable interactivity.
  const looksLikeCreateVite = /\bcreate-vite(?:@[\w.-]+)?\b/i.test(cmd)
  if (looksLikeCreateVite && !/(^|\s)--no-interactive(\s|$)/i.test(cmd)) {
    matchedIds.push('interactive_create_vite_missing_no_interactive')
    warnings.push('create-vite requires --no-interactive for orchestrator-run terminal commands.')
    blocked = true
  }

  const looksLikeCreateNextApp = /\bcreate-next-app(?:@[\w.-]+)?\b/i.test(cmd)
  if (looksLikeCreateNextApp && !/(^|\s)--yes(\s|$)/i.test(cmd)) {
    matchedIds.push('interactive_create_next_app_missing_yes')
    warnings.push('create-next-app requires --yes for orchestrator-run terminal commands.')
    blocked = true
  }

  const looksLikeNpmCreate = /\bnpm\s+create\b/i.test(cmd)
  if (looksLikeNpmCreate && !/(^|\s)--yes(\s|$)/i.test(cmd)) {
    matchedIds.push('interactive_npm_create_missing_yes')
    warnings.push('npm create requires --yes for orchestrator-run terminal commands.')
    blocked = true
  }
  const looksLikeNpmCreateVite = /\bnpm\s+create\b/i.test(cmd) && /\bvite(?:@[\w.-]+)?\b/i.test(cmd)
  if (looksLikeNpmCreateVite && !/(^|\s)--no-interactive(\s|$)/i.test(cmd)) {
    matchedIds.push('interactive_npm_create_vite_missing_no_interactive')
    warnings.push('npm create vite requires --no-interactive for orchestrator-run terminal commands.')
    blocked = true
  }

  const looksLikeNpmInit = /\bnpm\s+init\b/i.test(cmd)
  if (looksLikeNpmInit && !/(^|\s)(-y|--yes)(\s|$)/i.test(cmd)) {
    matchedIds.push('interactive_npm_init_missing_yes')
    warnings.push('npm init requires -y/--yes for orchestrator-run terminal commands.')
    blocked = true
  }

  return {
    blocked,
    warnings,
    matchedIds,
  }
}

export function scanWorkspacePathForSensitivity(path: string): SafetyScanResult {
  const norm = path.replace(/\\/g, '/').trim()
  const warnings: string[] = []
  const matchedIds: string[] = []
  for (const re of SENSITIVE_PATH_SEGMENTS) {
    if (re.test(norm)) {
      matchedIds.push('sensitive_path')
      warnings.push(`Path may contain secrets or credentials: ${norm}`)
      break
    }
  }
  return { blocked: false, warnings, matchedIds }
}

export function applySafetyMode(
  mode: HarnessSafetyMode,
  scan: SafetyScanResult
): { allow: boolean; message?: string } {
  if (scan.blocked) {
    return {
      allow: false,
      message: `Blocked interactive command: ${scan.warnings.join(' | ')}`,
    }
  }
  if (mode === 'off' || scan.matchedIds.length === 0) {
    return { allow: true }
  }
  if (mode === 'block') {
    return {
      allow: false,
      message: `Blocked by harness safety: ${scan.warnings.join(' | ')}`,
    }
  }
  return { allow: true }
}

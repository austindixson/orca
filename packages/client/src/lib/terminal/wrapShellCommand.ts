/**
 * Wrap orchestrator-issued shell commands with OSC-133 markers and a plain-text
 * exit footer so the PTY stream can be parsed for per-command exit codes.
 */

/** zsh/bash-safe single-quoted string */
export function shellQuoteZsh(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/** Join argv with zsh-style quoting (avoids glob expansion on tokens like @/*). */
export function shellQuoteArgvZsh(argv: string[]): string {
  return argv.map(shellQuoteZsh).join(' ')
}

export type WrapOrcaShellInput = {
  /** Raw command as sent today (e.g. `cd /x && npm run dev`). */
  command: string
  /** When set, builds the inner command from argv instead of `command` (preferred for npx/npm with globs). */
  argv?: string[]
}

/**
 * `create-next-app .` derives the npm package name from the cwd basename. Uppercase
 * folders (e.g. OrcaPortal) fail npm validation — seed a minimal package.json with a
 * lowercase legal name when none exists yet.
 */
export function isCreateNextAppInPlaceArgv(argv: string[]): boolean {
  if (argv.length === 0) return false
  const hasTool = argv.some((a) => /^create-next-app(@[\w.-]*)?$/.test(a))
  if (!hasTool) return false
  return argv.some((a) => a === '.' || a === './')
}

function looksLikeCreateNextAppInPlaceCommand(cmd: string): boolean {
  const t = cmd.trim()
  if (!/create-next-app(@[\w.-]*)?/i.test(t)) return false
  return /\s\.\s/.test(t) || /\s\.\s*($|&&|\||;)/.test(t)
}

/** Shell snippet: run before create-next-app in `.` when package.json is missing. */
const CREATE_NEXT_APP_PKG_JSON_SEED =
  'test -f package.json || { ' +
  '_n="$(basename "$PWD" | tr \'[:upper:]\' \'[:lower:]\' | sed -e \'s/[^a-z0-9._-]/-/g\' -e \'s/^-*//\' -e \'s/^[^a-z]*//\' | cut -c1-214)"; ' +
  '_n="${_n:-app}"; ' +
  'printf \'%s\\n\' "{\"name\":\"$_n\",\"private\":true,\"version\":\"0.0.0\"}" > package.json; ' +
  '}'

/**
 * Returns a subshell one-liner ending with newline — ready for PTY write.
 * Uses OSC 133 C/D when supported, plus `__ORCA_EXIT__` as a fallback parse target.
 */
export function wrapOrcaShellCommand(input: WrapOrcaShellInput): string {
  let inner: string
  if (input.argv && input.argv.length > 0) {
    inner = isCreateNextAppInPlaceArgv(input.argv)
      ? `${CREATE_NEXT_APP_PKG_JSON_SEED}; ${shellQuoteArgvZsh(input.argv)}`
      : shellQuoteArgvZsh(input.argv)
  } else {
    inner = input.command.trim()
    inner = inner.replace(/\n+$/g, '')
    if (looksLikeCreateNextAppInPlaceCommand(inner)) {
      inner = `${CREATE_NEXT_APP_PKG_JSON_SEED}; ${inner}`
    }
  }

  // Use $'...' for printf so \033 is a single ESC in bash/zsh.
  return `( set +e; printf $'\\033]133;C\\007'; ${inner}; ec=$?; printf $'\\033]133;D;%s\\007' "$ec"; echo "__ORCA_EXIT__:$ec:$(date +%s)"; exit $ec )\n`
}

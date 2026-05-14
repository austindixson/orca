/**
 * Heuristics for when to use one-shot `run_shell_command` (subprocess) vs a terminal tile (PTY).
 * Models should still follow tool descriptions; this supports docs, tests, and optional UI hints.
 */

export type ShellRouteHint = 'subprocess' | 'terminal_pty'

/** Patterns that usually need a long-lived TTY (dev servers, watch, TUIs). */
const PTY_PREFERRED: RegExp[] = [
  /\b(npm|pnpm|yarn|bun)\s+run\s+(dev|start|serve)\b/i,
  /\bnext\s+dev\b/i,
  /\bnuxt\s+dev\b/i,
  /\bvite\b(?!\s+build\b)/i,
  /\bwebpack\s+.*--watch\b/i,
  /\btsc\s+.*--watch\b/i,
  /\b--watch\b/i,
  /\bwatch\b/i,
  /\btail\s+-f\b/i,
  /\bjest\s+.*--watch\b/i,
  /\bplaywright\s+test\s+.*--ui\b/i,
  /\bssh\b/i,
  /\bdocker\s+(run|compose)\b.*\b(-it|--interactive)\b/i,
  /\bpython\b.*-m\s+http\.server\b/i,
  /\bserve\s+.*-l\b/i,
]

export function classifyShellCommand(command: string): { hint: ShellRouteHint; reason: string } {
  const c = command.trim()
  if (!c) {
    return { hint: 'subprocess', reason: 'empty command' }
  }
  for (const re of PTY_PREFERRED) {
    if (re.test(c)) {
      return { hint: 'terminal_pty', reason: `matched ${re.source.slice(0, 80)}` }
    }
  }
  return {
    hint: 'subprocess',
    reason: 'no long-running dev/watch/TUI pattern; prefer run_shell_command for bounded installs/builds/tests',
  }
}

/** Short block for orchestrator / system prompt (markdown). */
export const SHELL_ROUTING_PROMPT_SNIPPET = `### Shell routing (reduce PTY load)
- **\`run_shell_command\`** — one-shot subprocess in the workspace (no PTY). Use for **bounded** non-interactive work: \`npm ci\`, \`pnpm install --frozen-lockfile\`, \`git status\`, \`cargo test\`, \`pytest\`, short builds. Prefer it over creating or updating a **terminal** tile when you only need exit code + stdout/stderr.
- **Terminal tile** — use for **long‑running** processes (\`npm run dev\`, Vite/Next dev servers, \`--watch\`, tail -f, TUIs, anything that stays open). Those need a PTY and live output in the canvas.
- If unsure, use \`run_shell_command\` for one-off installs and checks; open a terminal tile when the process must **keep running** for the user to see.`

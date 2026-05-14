export interface NormalizeShellInput {
  command: string
  argv?: string[]
}

export interface NormalizeShellResult {
  command: string
  argv?: string[]
  changed: boolean
  notes: string[]
}

function hasAnyFlag(tokens: string[], flags: string[]): boolean {
  return tokens.some((t) => flags.includes(t))
}

function normalizeArgv(argv: string[]): { argv: string[]; changed: boolean; notes: string[] } {
  let out = argv.slice()
  const notes: string[] = []
  const hasToken = (re: RegExp) => out.some((t) => re.test(t))

  if (hasToken(/^create-vite(?:@[\w.-]+)?$/i) && !hasAnyFlag(out, ['--no-interactive'])) {
    out = [...out, '--no-interactive']
    notes.push('Added --no-interactive for create-vite')
  }

  if (hasToken(/^create-next-app(?:@[\w.-]+)?$/i) && !hasAnyFlag(out, ['--yes'])) {
    out = [...out, '--yes']
    notes.push('Added --yes for create-next-app')
  }

  if (out[0] === 'npm' && out[1] === 'create' && !hasAnyFlag(out, ['--yes'])) {
    out = [...out, '--yes']
    notes.push('Added --yes for npm create')
  }
  if (out[0] === 'npm' && out[1] === 'create' && out.some((t) => /^vite(?:@[\w.-]+)?$/i.test(t)) && !hasAnyFlag(out, ['--no-interactive'])) {
    const dashDashIdx = out.indexOf('--')
    if (dashDashIdx >= 0) {
      out = [...out, '--no-interactive']
    } else {
      out = [...out, '--', '--no-interactive']
    }
    notes.push('Added --no-interactive for npm create vite')
  }

  if (out[0] === 'npm' && out[1] === 'init' && !hasAnyFlag(out, ['-y', '--yes'])) {
    out = [...out, '-y']
    notes.push('Added -y for npm init')
  }

  return { argv: out, changed: notes.length > 0, notes }
}

function normalizeCommandSegments(command: string): { command: string; changed: boolean; notes: string[] } {
  const parts = command.split(/(\s*(?:&&|\|\||;)\s*)/g)
  const notes: string[] = []
  const updated = parts.map((part, idx) => {
    // Separator chunks are every other item due split capture.
    if (idx % 2 === 1) return part
    let segment = part

    if (/\bcreate-vite(?:@[\w.-]+)?\b/i.test(segment) && !/(^|\s)--no-interactive(\s|$)/i.test(segment)) {
      segment = `${segment.trimEnd()} --no-interactive`
      notes.push('Added --no-interactive for create-vite')
    }

    if (/\bcreate-next-app(?:@[\w.-]+)?\b/i.test(segment) && !/(^|\s)--yes(\s|$)/i.test(segment)) {
      segment = `${segment.trimEnd()} --yes`
      notes.push('Added --yes for create-next-app')
    }

    if (/\bnpm\s+create\b/i.test(segment) && !/(^|\s)--yes(\s|$)/i.test(segment)) {
      segment = `${segment.trimEnd()} --yes`
      notes.push('Added --yes for npm create')
    }

    if (
      /\bnpm\s+create\b/i.test(segment) &&
      /\bvite(?:@[\w.-]+)?\b/i.test(segment) &&
      !/(^|\s)--no-interactive(\s|$)/i.test(segment)
    ) {
      if (/\s--\s/.test(segment)) {
        segment = `${segment.trimEnd()} --no-interactive`
      } else {
        segment = `${segment.trimEnd()} -- --no-interactive`
      }
      notes.push('Added --no-interactive for npm create vite')
    }

    if (/\bnpm\s+init\b/i.test(segment) && !/(^|\s)(-y|--yes)(\s|$)/i.test(segment)) {
      segment = `${segment.trimEnd()} -y`
      notes.push('Added -y for npm init')
    }

    return segment
  })
  return { command: updated.join(''), changed: notes.length > 0, notes }
}

export function normalizeNonInteractiveShellInput(input: NormalizeShellInput): NormalizeShellResult {
  const cmd = input.command ?? ''
  let command = cmd
  let argv = input.argv
  let changed = false
  const notes: string[] = []

  if (Array.isArray(argv) && argv.length > 0) {
    const n = normalizeArgv(argv)
    argv = n.argv
    changed = changed || n.changed
    notes.push(...n.notes)
  } else if (command.trim()) {
    const n = normalizeCommandSegments(command)
    command = n.command
    changed = changed || n.changed
    notes.push(...n.notes)
  }

  return { command, ...(argv ? { argv } : {}), changed, notes }
}

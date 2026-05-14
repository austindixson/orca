/**
 * Bounty hunters must prove terminal outcomes — not just claim success.
 */

export function parseExplicitTerminalFailure(summary: string): boolean {
  if (!/status\s*[:=]\s*['"]failed['"]/i.test(summary)) return false
  return /exit_code\s*[:=]\s*-?\d+/i.test(summary)
}

export function parseTerminalVerifiedBlock(
  summary: string
): { tile_id: string; exit_code: number } | null {
  const lower = summary.toLowerCase()
  const key = 'terminal_verified'
  const idx = lower.indexOf(key)
  if (idx < 0) return null
  const sub = summary.slice(idx)
  const brace = sub.indexOf('{')
  if (brace < 0) return null
  let depth = 0
  let end = -1
  for (let i = brace; i < sub.length; i++) {
    const c = sub[i]
    if (c === '{') depth++
    if (c === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end < 0) return null
  try {
    const j = JSON.parse(sub.slice(brace, end)) as { tile_id?: unknown; exit_code?: unknown }
    if (typeof j.tile_id === 'string' && typeof j.exit_code === 'number') {
      return { tile_id: j.tile_id, exit_code: j.exit_code }
    }
  } catch {
    /* */
  }
  return null
}

export function bountyHunterTerminalReplyIsVerified(summary: string): boolean {
  if (parseExplicitTerminalFailure(summary)) return true
  const tv = parseTerminalVerifiedBlock(summary)
  return tv !== null && tv.exit_code === 0
}

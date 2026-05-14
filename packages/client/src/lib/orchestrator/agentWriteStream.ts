/**
 * Typewriter-style reveal for orchestrator `write_file`: diff hunks + prefs.
 */

export const WRITE_STREAM_MAX_CHARS = 50_000
export const WRITE_STREAM_DEFAULT_CPS = 1000
export const WRITE_STREAM_DEFAULT_BUDGET_MS = 900

export type WriteHunk = {
  /** Start offset in the **original** `previous` string (before any hunk is applied). */
  startOffset: number
  oldLength: number
  replacement: string
}

export type AgentWriteStreamMeta = {
  token: number
  previous: string
  next: string
  hunks: WriteHunk[]
  cps: number
  budgetMs: number
  /** Applied after streaming completes (new token) so line flash runs once. */
  deferredWriteFlash?: { startLine: number; endLine: number }
}

export type ShouldAnimateWritePrefs = {
  agentWriteStreamEnabled: boolean
  orchestratorAutoFocus: boolean
  reducedMotion: boolean
}

/** 0-based line index → character offset in text produced by `lines.join('\n')` (same as `split('\n')`). */
export function lineStartOffset(lines: string[], lineIdx: number): number {
  if (lineIdx <= 0) return 0
  if (lineIdx >= lines.length) {
    let off = 0
    for (let i = 0; i < lines.length; i++) {
      off += lines[i].length + (i < lines.length - 1 ? 1 : 0)
    }
    return off
  }
  let off = 0
  for (let i = 0; i < lineIdx; i++) {
    off += lines[i].length + 1
  }
  return off
}

type LcsOp =
  | { t: 'eq'; ol: number; nl: number }
  | { t: 'd'; ol: number; line: string }
  | { t: 'i'; nl: number; line: string }

function buildLcsOps(a: string[], b: string[]): LcsOp[] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const ops: LcsOp[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ t: 'eq', ol: i - 1, nl: j - 1 })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ t: 'i', nl: j - 1, line: b[j - 1] })
      j--
    } else if (i > 0) {
      ops.push({ t: 'd', ol: i - 1, line: a[i - 1] })
      i--
    } else {
      ops.push({ t: 'i', nl: j - 1, line: b[j - 1] })
      j--
    }
  }
  ops.reverse()
  return ops
}

/**
 * Line-based diff → sequential replace hunks in **original** `previous` coordinates.
 * Applying hunks in order with cumulative delta yields `next`.
 */
export function computeWriteHunks(previous: string, next: string): WriteHunk[] {
  if (previous === next) return []
  const a = previous.split('\n')
  const b = next.split('\n')
  const ops = buildLcsOps(a, b)
  const hunks: WriteHunk[] = []
  let oi = 0
  /** Next line index in `a` we have not consumed (0-based). */
  let oldLine = 0

  while (oi < ops.length) {
    const op = ops[oi]
    if (op.t === 'eq') {
      oldLine = op.ol + 1
      oi++
      continue
    }

    const dels: number[] = []
    const ins: { nl: number; line: string }[] = []
    while (oi < ops.length && ops[oi].t !== 'eq') {
      const o = ops[oi]
      if (o.t === 'd') dels.push(o.ol)
      if (o.t === 'i') ins.push({ nl: o.nl, line: o.line })
      oi++
    }

    let startOffset: number
    let oldLength: number
    if (dels.length > 0) {
      const o0 = Math.min(...dels)
      const o1 = Math.max(...dels) + 1
      startOffset = lineStartOffset(a, o0)
      oldLength = lineStartOffset(a, o1) - startOffset
      oldLine = o1
    } else {
      startOffset = lineStartOffset(a, oldLine)
      oldLength = 0
    }

    let replacement: string
    if (ins.length > 0) {
      const n0 = Math.min(...ins.map((x) => x.nl))
      const n1 = Math.max(...ins.map((x) => x.nl)) + 1
      replacement = next.slice(lineStartOffset(b, n0), lineStartOffset(b, n1))
    } else {
      replacement = ''
    }

    hunks.push({ startOffset, oldLength, replacement })
  }

  if (hunks.length === 0 && previous !== next) {
    return [{ startOffset: 0, oldLength: previous.length, replacement: next }]
  }
  return hunks
}

/**
 * Parse tile `meta.agentWriteStream` for the editor typewriter effect.
 * Returns null if the payload is missing, malformed, or degenerate (would skip disk load and show blank).
 */
export function parseAgentWriteStreamMeta(
  meta: Record<string, unknown> | undefined
): AgentWriteStreamMeta | null {
  const r = meta?.agentWriteStream
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (!('previous' in o) || typeof o.previous !== 'string') return null
  if (!('next' in o) || typeof o.next !== 'string') return null
  const previous = o.previous
  const next = o.next
  const token = Number(o.token)
  const cps = Number(o.cps)
  const budgetMs = Number(o.budgetMs)
  const hunksRaw = o.hunks
  if (!Number.isFinite(token) || !Array.isArray(hunksRaw)) return null
  const hunks = hunksRaw
    .map((h) => {
      if (!h || typeof h !== 'object') return null
      const x = h as Record<string, unknown>
      const startOffset = Number(x.startOffset)
      const oldLength = Number(x.oldLength)
      const replacement = typeof x.replacement === 'string' ? x.replacement : ''
      if (!Number.isFinite(startOffset) || !Number.isFinite(oldLength)) return null
      return { startOffset, oldLength, replacement }
    })
    .filter((x): x is WriteHunk => x != null)

  /** Empty snapshot + no hunks would skip disk read and leave the editor blank. */
  if (previous === '' && next === '' && hunks.length === 0) return null
  /**
   * No-op diff (bad persisted meta). Real writes always differ when `shouldAnimateWrite` is true;
   * rejecting avoids skipping disk hydration for stale tile state.
   */
  if (previous === next && hunks.length === 0) return null

  const dw = o.deferredWriteFlash
  let deferredWriteFlash: { startLine: number; endLine: number } | undefined
  if (dw && typeof dw === 'object') {
    const d = dw as Record<string, unknown>
    const sl = Number(d.startLine)
    const el = Number(d.endLine)
    if (Number.isFinite(sl) && Number.isFinite(el)) deferredWriteFlash = { startLine: sl, endLine: el }
  }
  return {
    token,
    previous,
    next,
    hunks,
    cps: Number.isFinite(cps) && cps > 0 ? cps : WRITE_STREAM_DEFAULT_CPS,
    budgetMs: Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : WRITE_STREAM_DEFAULT_BUDGET_MS,
    deferredWriteFlash,
  }
}

export function shouldAnimateWrite(
  previous: string,
  next: string,
  prefs: ShouldAnimateWritePrefs
): boolean {
  if (!prefs.agentWriteStreamEnabled) return false
  if (!prefs.orchestratorAutoFocus) return false
  if (prefs.reducedMotion) return false
  if (next.length > WRITE_STREAM_MAX_CHARS) return false
  if (previous === next) return false
  return true
}

/**
 * Apply hunks in order with offset adjustment; returns final string (should equal `next`).
 */
export function applyWriteHunks(previous: string, hunks: WriteHunk[]): string {
  let s = previous
  let delta = 0
  for (const h of hunks) {
    const start = h.startOffset + delta
    s = s.slice(0, start) + h.replacement + s.slice(start + h.oldLength)
    delta += h.replacement.length - h.oldLength
  }
  return s
}

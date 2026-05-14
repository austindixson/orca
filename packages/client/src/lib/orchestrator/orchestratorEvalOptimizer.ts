/**
 * @deprecated Test-only JSON parser — the post-run eval–optimizer critic was removed.
 * @see parseEvalOptimizerJson in orchestratorEvalOptimizer.test.ts
 */

export interface EvalOptimizerParseResult {
  pass: boolean
  score: number
  critique: string
  revised_reply: string | null
}

export function parseEvalOptimizerJson(raw: string): EvalOptimizerParseResult | null {
  const t = raw.trim()
  if (!t) return null
  const unfenced = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  const pass = o.pass === true
  const score = typeof o.score === 'number' && Number.isFinite(o.score) ? Math.max(1, Math.min(10, o.score)) : 5
  const critique = typeof o.critique === 'string' ? o.critique : ''
  const rr = o.revised_reply
  const revised_reply =
    rr === null || rr === undefined ? null : typeof rr === 'string' ? rr : null
  return { pass, score, critique, revised_reply }
}

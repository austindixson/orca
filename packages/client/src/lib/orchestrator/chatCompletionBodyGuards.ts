/**
 * Guards for JSON bodies returned on HTTP 2xx from chat/completions-shaped endpoints.
 * Native non–Chat Completions APIs are adapted elsewhere (see completionAdapters.ts).
 */

/**
 * Some gateways return HTTP 200 with a JSON body like `{ "error": { "message": "..." } }`
 * and no `choices`. Fail fast with a clear error instead of surfacing as "missing choices[0]" later.
 */
export function throwIfProviderErrorObjectWithoutChoices(parsed: unknown, httpStatus: number): void {
  if (!parsed || typeof parsed !== 'object') return
  const o = parsed as Record<string, unknown>
  if (Array.isArray(o.choices) && o.choices.length > 0) return
  const err = o.error
  if (err === undefined || err === null) return
  let msg: string
  if (typeof err === 'string') {
    msg = err
  } else if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    msg =
      typeof e.message === 'string'
        ? e.message
        : typeof e.code === 'string'
          ? `${e.code}: ${JSON.stringify(err)}`
          : JSON.stringify(err)
  } else {
    msg = String(err)
  }
  throw new Error(`Chat completion: provider error in response body (HTTP ${httpStatus}): ${msg}`)
}

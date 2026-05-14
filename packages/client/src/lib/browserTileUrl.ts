/**
 * Canonicalize loopback URLs for the in-app browser tile.
 *
 * Policy for `http(s)://127.0.0.1` / `http(s)://localhost` (any port):
 * **Use the same hostname as the Orca shell window** (`window.location.hostname`).
 *
 * Rationale: dev servers often send `X-Frame-Options: SAMEORIGIN` (or CSP `frame-ancestors`).
 * The framed page’s origin must match the **parent document’s** origin. If the shell loads from
 * `http://127.0.0.1:5173` but the iframe uses `http://localhost:5173`, the browser treats them
 * as different origins and blocks the embed — producing a blank iframe and a false “blocked”
 * state. Aligning loopback spelling fixes local preview without changing target apps’ headers.
 *
 * When the shell is not on loopback (e.g. some production builds), loopback URLs are left as-is.
 *
 * For non-loopback URLs this is a no-op. For `file://` / other schemes this is a no-op.
 */
export function normalizeLoopbackUrlForShell(url: string): string {
  if (typeof window === 'undefined') return url
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return url

    const parent = window.location.hostname
    if (parent === '127.0.0.1' || parent === 'localhost') {
      u.hostname = parent
    }
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Normalize user-entered Browser tile URLs into fully-qualified absolute URLs.
 *
 * Rules:
 * - `google.com` -> `https://google.com`
 * - `localhost:5173` / `127.0.0.1:3000` -> `http://...`
 * - already-schemed URLs are preserved
 */
export function normalizeBrowserTileInputUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) return trimmed
  if (/^(about:|data:|file:|mailto:|tel:)/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`

  const localHostLike =
    /^localhost(?::\d+)?(?:[/?#].*)?$/i.test(trimmed) ||
    /^127\.0\.0\.1(?::\d+)?(?:[/?#].*)?$/i.test(trimmed) ||
    /^\[::1\](?::\d+)?(?:[/?#].*)?$/i.test(trimmed)
  if (localHostLike) return `http://${trimmed}`

  const likelyDomain = /^[^\s/]+\.[^\s/]+(?:[/?#].*)?$/.test(trimmed)
  if (likelyDomain) return `https://${trimmed}`

  return trimmed
}

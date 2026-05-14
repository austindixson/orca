/**
 * Convert an absolute filesystem path to a workspace-relative path (forward slashes).
 * Returns `null` if the file is not under `rootPath`.
 */
export function absolutePathToWorkspaceRelative(
  absolute: string,
  rootPath: string
): string | null {
  if (!rootPath || rootPath === '.') return null
  const a = absolute.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (a.length < r.length) return null
  const lowerA = a.toLowerCase()
  const lowerR = r.toLowerCase()
  if (lowerA === lowerR) return ''
  const prefix = `${lowerR}/`
  if (!lowerA.startsWith(prefix)) return null
  return a.slice(r.length + 1).replace(/\\/g, '/')
}

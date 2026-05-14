/**
 * Client-side workspace path validation (defense in depth; Tauri also enforces in Rust).
 * Align with `src-tauri/src/workspace_paths.rs`.
 */

export const MAX_READ_BYTES = 1_048_576
export const MAX_WRITE_BYTES = 2_097_152

/** Normalize relative path; reject `..` and absolute paths. */
export function normalizeRelativeWorkspacePath(raw: string): { ok: true; path: string } | { ok: false; error: string } {
  const t = raw.trim()
  if (!t) return { ok: false, error: 'path is empty' }
  if (t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t)) {
    return { ok: false, error: 'path must be relative to workspace root, not absolute' }
  }
  const parts = t.replace(/\\/g, '/').split('/').filter((p) => p.length > 0)
  for (const p of parts) {
    if (p === '..') {
      return { ok: false, error: 'path must not contain parent directory segments (..)' }
    }
  }
  return { ok: true, path: parts.join('/') }
}

export function assertSafeWorkspacePath(path: string): string {
  const n = normalizeRelativeWorkspacePath(path)
  if (!n.ok) throw new Error(n.error)
  return n.path
}

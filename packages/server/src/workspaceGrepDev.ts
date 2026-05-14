/**
 * Web dev (companion server) implementation of `workspace_grep` — best-effort parity
 * with the Tauri command: skips `.git` / `node_modules` / `target`, no full gitignore.
 */
import { lstat, readdir, readFile } from 'fs/promises'
import { join, relative, resolve, sep } from 'path'
import { minimatch } from 'minimatch'

const MAX_FILE_BYTES = 1_048_576
const MAX_LINE_CHARS = 800
const MAX_SCANNED_FILES = 200_000
const MAX_MATCHES_CAP = 2_000

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  '.next',
  'coverage',
])

export type GrepMatch = { path: string; line: number; text: string }

export type WorkspaceGrepResult = {
  matches: GrepMatch[]
  truncated: boolean
  scanned_files: number
  match_count: number
  note: string | null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compileSearchRe(
  pattern: string,
  fixedString: boolean,
  caseInsensitive: boolean
): RegExp {
  const src = fixedString ? escapeRegExp(pattern) : pattern
  return new RegExp(src, caseInsensitive ? 'i' : '')
}

/** Async generator: file paths under `root` (absolute), relative to `workspaceRoot` with `/` seps. */
async function* walkFiles(root: string, workspaceRoot: string): AsyncGenerator<string> {
  let count = 0
  const stack: string[] = [root]
  while (stack.length) {
    if (count >= MAX_SCANNED_FILES) return
    const dir = stack.pop()!
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (count >= MAX_SCANNED_FILES) return
      const name = String(e.name)
      if (name.startsWith('.')) continue
      const p = join(dir, name)
      if (e.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name)) continue
        stack.push(p)
      } else if (e.isFile()) {
        try {
          const st = await lstat(p)
          if (st.size > MAX_FILE_BYTES) continue
        } catch {
          continue
        }
        const rel = relative(workspaceRoot, p)
        if (rel.startsWith('..')) continue
        count++
        yield rel.split(sep).join('/')
      }
    }
  }
}

function sniffBinaryHead(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192)
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

async function grepFileLines(
  absPath: string,
  re: RegExp,
  relPath: string
): Promise<GrepMatch[]> {
  const buf = await readFile(absPath)
  if (sniffBinaryHead(buf)) return []
  const text = buf.toString('utf8')
  if (text.includes('\0')) return []
  const out: GrepMatch[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (re.test(line)) {
      const t =
        [...line].length > MAX_LINE_CHARS
          ? [...line].slice(0, MAX_LINE_CHARS).join('') + '…'
          : line
      out.push({ path: relPath, line: i + 1, text: t })
    }
  }
  return out
}

export async function workspaceGrepDev(options: {
  workspaceRoot: string
  subPath: string
  pattern: string
  fixedString: boolean
  caseInsensitive: boolean
  glob: string | null
  maxMatches: number
}): Promise<WorkspaceGrepResult> {
  const {
    workspaceRoot,
    subPath,
    pattern,
    fixedString,
    caseInsensitive,
    glob,
    maxMatches,
  } = options
  if (!pattern.trim()) {
    throw new Error('pattern required')
  }
  const maxM = Math.min(Math.max(1, maxMatches), MAX_MATCHES_CAP)
  const re = compileSearchRe(pattern.trim(), fixedString, caseInsensitive)
  const wsR = resolve(workspaceRoot)
  const start = resolve(wsR, subPath === '' || subPath === '.' ? '.' : subPath)
  if (!start.startsWith(wsR)) {
    throw new Error('path escapes workspace')
  }
  const stStart = await lstat(start)
  if (!stStart.isDirectory()) {
    throw new Error('path must be a directory')
  }

  const matches: GrepMatch[] = []
  let scanned = 0
  let truncated = false
  const globStr = glob?.trim() || null

  for await (const rel of walkFiles(start, workspaceRoot)) {
    if (matches.length >= maxM) {
      truncated = true
      break
    }
    if (globStr) {
      if (!minimatch(rel, globStr, { dot: true, matchBase: false })) continue
    }
    const abs = join(workspaceRoot, rel)
    scanned++
    const chunk = await grepFileLines(abs, re, rel)
    for (const m of chunk) {
      if (matches.length >= maxM) {
        truncated = true
        break
      }
      matches.push(m)
    }
    if (truncated) break
  }

  return {
    matches,
    truncated,
    scanned_files: scanned,
    match_count: matches.length,
    note: truncated
      ? 'Stopped early: max_matches, max scanned files, or file limit. Narrow `path`/`glob` or raise `max_matches`. (Web dev: .gitignore not fully applied; large dirs like `node_modules` are skipped by name.)'
      : null,
  }
}

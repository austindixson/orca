/** Monaco / diff language id from a relative file path. */
export function inferEditorLanguageFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  const ext = base.includes('.') ? base.split('.').pop()?.toLowerCase() ?? '' : ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',
    md: 'markdown',
    mdx: 'markdown',
    rs: 'rust',
    py: 'python',
    go: 'go',
    toml: 'toml',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    svg: 'xml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
  }
  return map[ext] ?? 'plaintext'
}

const DIFF_META_MAX_CHARS = 400_000

export function truncateForDiffMeta(s: string): { text: string; truncated: boolean } {
  if (s.length <= DIFF_META_MAX_CHARS) return { text: s, truncated: false }
  return { text: s.slice(0, DIFF_META_MAX_CHARS), truncated: true }
}

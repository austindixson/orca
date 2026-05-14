import type { TileType } from '../../store/canvasStore'

/**
 * Coarse project classification for layout (anchor + zone preferences).
 */
export type WorkspaceContext =
  | 'web-frontend'
  | 'web-fullstack'
  | 'backend-api'
  | 'data-science'
  | 'general'

export interface LayoutStrategy {
  /** Preferred tile type to treat as the large center anchor when auto-detect is on. */
  anchorTileType: TileType | null
  /** Fraction of viewport used for anchor width/height (when creating anchor). */
  anchorViewportRatio: number
}

const DEFAULT_RATIO = 0.6

/**
 * Collect relative paths from a nested file tree (workspace explorer).
 */
export function collectRelativePathsFromTree(
  entries: Array<{ path: string; isDirectory: boolean; children?: unknown[] }>,
  out: string[] = []
): string[] {
  for (const e of entries) {
    out.push(e.path.replace(/\\/g, '/'))
    if (e.isDirectory && Array.isArray(e.children)) {
      collectRelativePathsFromTree(
        e.children as Array<{ path: string; isDirectory: boolean; children?: unknown[] }>,
        out
      )
    }
  }
  return out
}

/**
 * Detect workspace kind from a flat list of project-relative paths (lowercase-safe).
 */
export function detectWorkspaceContextFromPaths(relativePaths: string[]): WorkspaceContext {
  const norm = relativePaths.map((p) => p.replace(/\\/g, '/').toLowerCase())
  const any = (pred: (p: string) => boolean) => norm.some(pred)
  const fileName = (p: string) => p.split('/').pop() ?? p

  const hasPackageJson = any((p) => fileName(p) === 'package.json')
  const hasCargo = any((p) => fileName(p) === 'cargo.toml')
  const hasGoMod = any((p) => fileName(p) === 'go.mod')
  const hasPyProject = any((p) => fileName(p) === 'pyproject.toml' || fileName(p) === 'requirements.txt')
  const hasNotebook = any((p) => p.endsWith('.ipynb'))
  const hasSql = any((p) => p.endsWith('.sql'))

  const webHints =
    any((p) => p.includes('vite.config')) ||
    any((p) => p.includes('next.config')) ||
    any((p) => p.includes('webpack.config')) ||
    any((p) => p.includes('nuxt.config')) ||
    any((p) => p.includes('svelte.config')) ||
    any((p) => p.endsWith('/index.html')) ||
    any((p) => p === 'index.html')

  const serverHints =
    any((p) => p.includes('/server/')) ||
    any((p) => p.includes('/api/')) ||
    any((p) => p.includes('dockerfile')) ||
    any((p) => fileName(p) === 'docker-compose.yml')

  if (hasNotebook || (hasPyProject && (hasSql || hasNotebook))) {
    return 'data-science'
  }

  if (hasCargo || hasGoMod || (hasPyProject && !hasPackageJson && !webHints)) {
    return 'backend-api'
  }

  if (hasPackageJson && webHints) {
    if (serverHints) return 'web-fullstack'
    return 'web-frontend'
  }

  if (hasPackageJson) {
    return 'web-fullstack'
  }

  return 'general'
}

export function getLayoutStrategyForContext(
  context: WorkspaceContext,
  anchorRatio: number
): LayoutStrategy {
  const r = Number.isFinite(anchorRatio) ? Math.min(0.85, Math.max(0.45, anchorRatio)) : DEFAULT_RATIO

  switch (context) {
    case 'web-frontend':
    case 'web-fullstack':
      return { anchorTileType: 'browser', anchorViewportRatio: r }
    case 'backend-api':
      return { anchorTileType: 'terminal', anchorViewportRatio: r }
    case 'data-science':
      return { anchorTileType: 'editor', anchorViewportRatio: r }
    default:
      return { anchorTileType: null, anchorViewportRatio: r }
  }
}

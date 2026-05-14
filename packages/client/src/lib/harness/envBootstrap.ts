/**
 * Environment snapshot injected on spawn_sub_agent to save exploratory turns.
 */

import * as tauri from '../tauri'

/** Lockfiles / manifests at repo root → suggested bootstrap (non-exhaustive). */
const ROOT_DEP_SIGNALS: Record<string, { stack: string; hint: string }> = {
  'package-lock.json': { stack: 'Node (npm)', hint: 'npm ci' },
  'npm-shrinkwrap.json': { stack: 'Node (npm)', hint: 'npm ci' },
  'yarn.lock': { stack: 'Node (Yarn)', hint: 'yarn install --immutable (or yarn install for Classic)' },
  'pnpm-lock.yaml': { stack: 'Node (pnpm)', hint: 'pnpm install --frozen-lockfile' },
  'bun.lockb': { stack: 'Node (Bun)', hint: 'bun install' },
  'bun.lock': { stack: 'Node (Bun)', hint: 'bun install' },
  'Cargo.toml': { stack: 'Rust', hint: 'cargo fetch or cargo build' },
  'go.mod': { stack: 'Go', hint: 'go mod download' },
  'go.work': { stack: 'Go', hint: 'go work sync' },
  'pyproject.toml': { stack: 'Python', hint: 'uv sync, or poetry install, or pip install -e .' },
  'requirements.txt': { stack: 'Python', hint: 'pip install -r requirements.txt' },
  'Pipfile': { stack: 'Python', hint: 'pipenv install --deploy' },
  'Gemfile': { stack: 'Ruby', hint: 'bundle install' },
  'composer.json': { stack: 'PHP', hint: 'composer install --no-interaction' },
  'mix.exs': { stack: 'Elixir', hint: 'mix deps.get' },
  'pom.xml': { stack: 'Java (Maven)', hint: 'mvn -q -DskipTests dependency:go-offline' },
  'build.gradle': { stack: 'Java (Gradle)', hint: './gradlew dependencies (or build)' },
  'build.gradle.kts': { stack: 'Java (Gradle)', hint: './gradlew dependencies (or build)' },
  'flake.nix': { stack: 'Nix', hint: 'nix develop or nix-shell' },
}

const MONOREPO_MARKERS = new Set([
  'pnpm-workspace.yaml',
  'lerna.json',
  'nx.json',
  'turbo.json',
  'rush.json',
])

function collectDependencySignalsFromFilenames(filenames: string[]): string[] {
  const set = new Set(filenames)
  const lines: string[] = []

  for (const [file, meta] of Object.entries(ROOT_DEP_SIGNALS)) {
    if (set.has(file)) {
      lines.push(`${meta.stack}: \`${file}\` → ${meta.hint}`)
    }
  }

  const hasNodeLock =
    set.has('package-lock.json') ||
    set.has('npm-shrinkwrap.json') ||
    set.has('yarn.lock') ||
    set.has('pnpm-lock.yaml') ||
    set.has('bun.lockb') ||
    set.has('bun.lock')

  if (set.has('package.json') && !hasNodeLock) {
    lines.push(
      'Node: `package.json` present without a standard lockfile at root — run `npm install` or your package manager of choice; commit a lockfile when appropriate.'
    )
  }

  for (const m of MONOREPO_MARKERS) {
    if (set.has(m)) {
      lines.push(
        `Monorepo marker: \`${m}\` — run install from the repo root first; follow README for workspace/bootstrap order.`
      )
      break
    }
  }

  return lines
}

export async function buildEnvironmentSnapshotForPrompt(workspaceRoot: string): Promise<string> {
  const lines: string[] = ['[Environment Snapshot]']
  lines.push(`workspace_root: ${workspaceRoot}`)

  try {
    const ws = await tauri.getWorkspace()
    if (ws?.path) lines.push(`active_workspace: ${ws.path}`)
  } catch {
    /* ignore */
  }

  try {
    const entries = await tauri.readDirectory(workspaceRoot)
    const names = entries.filter((e) => !e.is_directory).map((e) => e.name)
    const depLines = collectDependencySignalsFromFilenames(names)
    if (depLines.length > 0) {
      lines.push('')
      lines.push('[Dependency signals at workspace root]')
      lines.push(
        'Bootstrap before builds/tests/dev servers: run the install commands implied below (non-interactive), or follow README if order matters.'
      )
      for (const d of depLines) {
        lines.push(`- ${d}`)
      }
    }
  } catch {
    /* optional — workspace may be unreadable in edge cases */
  }

  if (typeof navigator !== 'undefined' && 'hardwareConcurrency' in navigator) {
    lines.push(`hardware_concurrency: ${navigator.hardwareConcurrency}`)
  }
  if (typeof performance !== 'undefined' && 'memory' in performance) {
    const m = (performance as Performance & { memory?: { jsHeapSizeLimit?: number } }).memory
    if (m?.jsHeapSizeLimit) {
      lines.push(`approx_heap_limit_bytes: ${m.jsHeapSizeLimit}`)
    }
  }

  lines.push(
    'hint: Prefer targeted read_file / list_directory under packages/ or src/ instead of listing the whole repo.'
  )
  return lines.join('\n')
}

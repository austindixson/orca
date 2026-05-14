import type { TileType } from '../store/canvasStore'

/** One-sentence hover text for each module type (Add tile menu, sidebar, tile chrome). */
export const TILE_TYPE_DESCRIPTION: Record<TileType, string> = {
  terminal: 'Run shell commands and scripts in your project with a full interactive terminal.',
  editor: 'Open and edit source files with syntax highlighting tied to the workspace.',
  browser: 'Browse the web locally and drive QA flows from the canvas.',
  agent_browser: 'AI-driven browser automation with visible cursor tracking and live viewport.',
  github: 'Use the GitHub CLI and repo workflows without leaving Orca.',
  diff: 'Review diffs and proposed changes before you commit or merge.',
  todo: 'Track tasks and checklist items alongside your work.',
  agent: 'Chat with an AI coding agent that can run tools on your workspace.',
  agent_team: 'Coordinate multiple agent roles and delegate work across tiles.',
  agent_group_chat: 'Shared agent-to-agent chat and canvased mentions for your session.',
  changelog: 'View and edit changelog-style notes for your project.',
  orchestrator: 'Plan and run multi-step orchestration with canvas tools.',
  benchmark: 'Record benchmark sessions and compare runs on the canvas.',
  remotion: 'Author and preview Remotion video compositions.',
  openrouter_usage: 'Monitor OpenRouter API usage and spend for your keys.',
  toolbox: 'Quick access to bundled utilities and helper actions.',
  research: 'Collect research notes and references next to your code.',
  reasoning: 'Inspect model reasoning traces and intermediate thinking steps.',
  project_status: 'See a high-level snapshot of project health and status.',
  telemetry: 'Stream Hermes and in-app telemetry for debugging integrations.',
  hermes_bridge: 'Bridge an external Hermes session to Orca canvas tool execution.',
  hermes_agent: 'Run a Hermes-style agent loop with Orca executing tools.',
  telegram_onboard: 'Connect Telegram and finish bot onboarding from the canvas.',
  native_gateway: 'Use the native messaging gateway for external chat bridges.',
  bug_bounty: 'Track bug bounty or security research notes in one place.',
}

export function tileTypeDescription(type: TileType): string {
  return TILE_TYPE_DESCRIPTION[type]
}

/**
 * When `showHermesAgentTile` is false (Settings → Agent → Hermes), hide the Hermes agent tile from
 * add-tile menus and strip Hermes tile tools from the orchestrator. Existing `hermes_agent` tiles on the canvas are unchanged.
 */
export function filterCanvasTileOptionsForHermesSetting<T extends { type: TileType }>(
  options: T[],
  showHermesAgentTile: boolean
): T[] {
  if (showHermesAgentTile) return options
  return options.filter((o) => o.type !== 'hermes_agent')
}

/**
 * Tiles spawned from the +Tiles menu / title bar / canvas context menu get
 * `meta.fromAddTileMenu` so Agent tiles can open chat expanded; orchestrator-spawned
 * workers keep chat collapsed by default.
 */
export function metaForTileSpawnFromAddMenu(type: TileType): Record<string, unknown> | undefined {
  if (type === 'agent' || type === 'hermes_agent') {
    return { fromAddTileMenu: true }
  }
  return undefined
}

/** How to order entries in the “Add tile” menu (+ toolbar, etc.). */
export type TileAddSortMode = 'default' | 'alpha' | 'category' | 'color'

export const TILE_ADD_SORT_STORAGE_KEY = 'orca.addTileSortMode'

/** All canvas module types with UI labels, icons, and ⌘1–⌘6 shortcuts (see FocusOverlay). */
export const CANVAS_TILE_OPTIONS: {
  type: TileType
  label: string
  icon: string
  colorClass: string
  shortcut: string
  /** Bucket for “Color” sort — same family sorts together (accent order). */
  paletteGroup: string
}[] = [
  { type: 'agent', label: 'Agent', icon: '⚡', colorClass: 'text-accent-teal', shortcut: '⌘1', paletteGroup: 'teal' },
  {
    type: 'agent_team',
    label: 'Agent team',
    icon: '◎',
    colorClass: 'text-cyan-300',
    shortcut: '—',
    paletteGroup: 'cyan',
  },
  { type: 'terminal', label: 'Terminal', icon: '▸', colorClass: 'text-accent-teal', shortcut: '⌘2', paletteGroup: 'teal' },
  { type: 'browser', label: 'Browser', icon: '◎', colorClass: 'text-accent-purple', shortcut: '⌘3', paletteGroup: 'purple' },
  {
    type: 'agent_browser',
    label: 'Agent Browser',
    icon: '🌐',
    colorClass: 'text-cyan-400',
    shortcut: '—',
    paletteGroup: 'cyan',
  },
  { type: 'github', label: 'GitHub (gh)', icon: '⌁', colorClass: 'text-sky-400', shortcut: '—', paletteGroup: 'sky' },
  { type: 'todo', label: 'Todo', icon: '☐', colorClass: 'text-accent-pink', shortcut: '⌘4', paletteGroup: 'pink' },
  { type: 'editor', label: 'Editor', icon: '{ }', colorClass: 'text-accent-blue', shortcut: '⌘5', paletteGroup: 'blue' },
  { type: 'diff', label: 'Diff Review', icon: '±', colorClass: 'text-accent-orange', shortcut: '⌘6', paletteGroup: 'orange' },
  { type: 'changelog', label: 'Changelog', icon: '⧉', colorClass: 'text-emerald-300', shortcut: '—', paletteGroup: 'emerald' },
  { type: 'benchmark', label: 'Benchmark', icon: '▤', colorClass: 'text-amber-300', shortcut: '—', paletteGroup: 'amber' },
  { type: 'remotion', label: 'Remotion', icon: '▶', colorClass: 'text-fuchsia-300', shortcut: '—', paletteGroup: 'fuchsia' },
  {
    type: 'openrouter_usage',
    label: 'OpenRouter usage',
    icon: '◈',
    colorClass: 'text-indigo-300',
    shortcut: '—',
    paletteGroup: 'indigo',
  },
  {
    type: 'toolbox',
    label: 'Toolbox',
    icon: '⎔',
    colorClass: 'text-lime-300',
    shortcut: '—',
    paletteGroup: 'lime',
  },
  {
    type: 'research',
    label: 'Research',
    icon: '⌕',
    colorClass: 'text-indigo-400',
    shortcut: '—',
    paletteGroup: 'indigo',
  },
  {
    type: 'reasoning',
    label: 'Thinking · Trace',
    icon: '◎',
    colorClass: 'text-violet-400',
    shortcut: '—',
    paletteGroup: 'violet',
  },
  {
    type: 'project_status',
    label: 'Project status',
    icon: '◆',
    colorClass: 'text-emerald-400',
    shortcut: '—',
    paletteGroup: 'emerald',
  },
  {
    type: 'telemetry',
    label: 'Telemetry',
    icon: '◉',
    colorClass: 'text-sky-400',
    shortcut: '—',
    paletteGroup: 'sky',
  },
  {
    type: 'hermes_bridge',
    label: 'Hermes bridge',
    icon: '⎘',
    colorClass: 'text-cyan-400',
    shortcut: '—',
    paletteGroup: 'cyan',
  },
  {
    type: 'hermes_agent',
    label: 'Hermes agent',
    icon: '⚡',
    colorClass: 'text-teal-300',
    shortcut: '—',
    paletteGroup: 'teal',
  },
  {
    type: 'telegram_onboard',
    label: 'Telegram onboard',
    icon: '✈',
    colorClass: 'text-[#ff6b4a]',
    shortcut: '—',
    paletteGroup: 'coral',
  },
  {
    type: 'native_gateway',
    label: 'Native gateway',
    icon: '⎔',
    colorClass: 'text-emerald-300',
    shortcut: '—',
    paletteGroup: 'emerald',
  },
]

const CATALOG_ORDER = new Map<TileType, number>(
  CANVAS_TILE_OPTIONS.map((o, i) => [o.type, i])
)

/** Sort visible tile rows for the add-tile picker (flat list). */
export function sortTileOptionsForAddMenu(
  visible: (typeof CANVAS_TILE_OPTIONS)[number][],
  mode: TileAddSortMode
): (typeof CANVAS_TILE_OPTIONS)[number][] {
  const out = [...visible]
  if (mode === 'default') {
    out.sort((a, b) => (CATALOG_ORDER.get(a.type) ?? 0) - (CATALOG_ORDER.get(b.type) ?? 0))
    return out
  }
  if (mode === 'alpha') {
    out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    return out
  }
  if (mode === 'color') {
    out.sort((a, b) => {
      const pg = a.paletteGroup.localeCompare(b.paletteGroup, undefined, { sensitivity: 'base' })
      if (pg !== 0) return pg
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    })
    return out
  }
  // category: flat A–Z within picker when not using grouped UI
  out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  return out
}

/** Group visible tiles by catalog domain (Agents, Workspace, …) for “Category” sort. */
export function groupVisibleTilesByMenuCategory(
  visible: (typeof CANVAS_TILE_OPTIONS)[number][]
): { id: string; label: string; options: (typeof CANVAS_TILE_OPTIONS)[number][] }[] {
  const byType = new Map(visible.map((o) => [o.type, o]))
  return CANVAS_TILE_MENU_GROUPS.map((g) => {
    const options = g.types
      .map((t) => byType.get(t))
      .filter((o): o is (typeof CANVAS_TILE_OPTIONS)[number] => o != null)
    const sorted = [...options].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    )
    return { id: g.id, label: g.label, options: sorted }
  }).filter((s) => s.options.length > 0)
}

/** Right-click canvas menu: “Add tile” flyouts grouped by domain (every type appears once). */
export const CANVAS_TILE_MENU_GROUPS: {
  id: string
  label: string
  types: readonly TileType[]
}[] = [
  {
    id: 'agents',
    label: 'Agents & team',
    types: ['agent', 'agent_team', 'hermes_agent', 'hermes_bridge'],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    types: ['terminal', 'editor', 'diff', 'todo', 'github'],
  },
  {
    id: 'preview',
    label: 'Preview & media',
    types: ['browser', 'agent_browser', 'remotion', 'benchmark', 'changelog'],
  },
  {
    id: 'project',
    label: 'Project & telemetry',
    types: ['project_status', 'telemetry', 'openrouter_usage', 'reasoning', 'research', 'toolbox'],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    types: ['telegram_onboard', 'native_gateway'],
  },
]

export function tileMenuOption(type: TileType) {
  return CANVAS_TILE_OPTIONS.find((o) => o.type === type)
}

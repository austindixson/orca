import { getHomeDir, getWorkspace, readDirectory, readFile } from './tauri'

export function joinWorkspacePath(root: string, relative: string): string {
  const a = root.replace(/[/\\]+$/, '')
  const b = relative.replace(/^[/\\]+/, '').replace(/\\/g, '/')
  return `${a}/${b}`
}

/** Max depth when walking `~/.claude/plugins/cache/...` for nested `skills/<slug>/SKILL.md`. */
const PLUGINS_CACHE_MAX_DEPTH = 14

/**
 * Collect absolute paths to `.../skills/<skillName>/SKILL.md` anywhere under a plugin cache root
 * (e.g. `~/.claude/plugins/cache/claude-plugins-official/.../skills/frontend-design/SKILL.md`).
 */
async function collectSkillMdUnderPluginsCache(
  cacheRoot: string,
  skillName: string
): Promise<string[]> {
  const paths: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > PLUGINS_CACHE_MAX_DEPTH) return
    let entries
    try {
      entries = await readDirectory(dir)
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.is_directory) continue
      if (e.name === 'skills') {
        paths.push(joinWorkspacePath(dir, `skills/${skillName}/SKILL.md`))
      } else {
        await walk(joinWorkspacePath(dir, e.name), depth + 1)
      }
    }
  }
  try {
    await walk(cacheRoot, 0)
  } catch {
    return []
  }
  return paths
}

export interface ResolvedSkillCommand {
  activated: boolean
  skillName?: string
  promptText: string
  sourcePath?: string
  error?: string
}

/** Max body chars inlined in “diet” mode (progressive disclosure). */
const SKILL_DIET_BODY_PREVIEW_MAX = 4_000
/** Max chars when inlining full SKILL.md (legacy / explicit full load). */
const SKILL_FULL_INJECT_MAX = 120_000

function parseSlashSkill(input: string): { skillName: string; remainder: string } | null {
  const trimmed = input.trim()
  const match = trimmed.match(/^\/([A-Za-z0-9._-]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  return {
    skillName: match[1],
    remainder: (match[2] || '').trim(),
  }
}

/**
 * Workspace folder for skill discovery: Tauri `get_workspace`, else persisted `rootPath` (browser dev).
 */
export async function getWorkspaceRootForSkills(): Promise<string | null> {
  const ws = await getWorkspace()
  if (ws?.path) return ws.path
  if (typeof window === 'undefined') return null
  try {
    const { useWorkspaceStore } = await import('../store/workspaceStore')
    const rp = useWorkspaceStore.getState().rootPath
    if (rp && rp !== '.') return rp
  } catch {
    /* ignore */
  }
  return null
}

async function candidateSkillPaths(skillName: string): Promise<string[]> {
  const paths: string[] = []
  const wsPath = await getWorkspaceRootForSkills()
  if (wsPath) {
    paths.push(joinWorkspacePath(wsPath, `.cursor/skills/${skillName}/SKILL.md`))
    paths.push(joinWorkspacePath(wsPath, `.claude/skills/${skillName}/SKILL.md`))
    paths.push(joinWorkspacePath(wsPath, `.claude/${skillName}/SKILL.md`))
    paths.push(joinWorkspacePath(wsPath, `.openclaw/skills/${skillName}/SKILL.md`))
  }
  const home = await getHomeDir()
  if (home) {
    paths.push(joinWorkspacePath(home, `.cursor/skills/${skillName}/SKILL.md`))
    paths.push(joinWorkspacePath(home, `.claude/skills/${skillName}/SKILL.md`))
    paths.push(joinWorkspacePath(home, `.claude/${skillName}/SKILL.md`))
    paths.push(joinWorkspacePath(home, `.openclaw/skills/${skillName}/SKILL.md`))
    paths.push(joinWorkspacePath(home, `.cursor/skills-cursor/${skillName}/SKILL.md`))
    paths.push(
      joinWorkspacePath(
        home,
        `.claude/skills/${skillName}/openclaw-skill/${skillName}/SKILL.md`
      )
    )
  }

  /** Claude Code / Cursor plugin skills: `.../plugins/cache/.../skills/<slug>/SKILL.md` */
  for (const base of [wsPath, home].filter(Boolean) as string[]) {
    for (const cacheRel of ['.claude/plugins/cache', '.cursor/plugins/cache']) {
      const found = await collectSkillMdUnderPluginsCache(
        joinWorkspacePath(base, cacheRel),
        skillName
      )
      paths.push(...found)
    }
  }

  return paths
}

/** True when user asks for full skill text, e.g. `/foo full …` or `/foo --full …`. */
function wantsFullSkillFromRemainder(remainder: string): boolean {
  const t = remainder.trim()
  if (!t) return false
  const first = t.split(/\s+/)[0]?.toLowerCase()
  return first === '--full' || first === 'full' || first === '--no-diet'
}

function stripFullLoadFlag(remainder: string): string {
  const t = remainder.trim()
  const words = t.split(/\s+/)
  if (words.length === 0) return ''
  const first = words[0]?.toLowerCase()
  if (first === '--full' || first === 'full' || first === '--no-diet') {
    return words.slice(1).join(' ').trim()
  }
  return remainder
}

/** Simple YAML frontmatter parser for SKILL.md (scalars + `key: |` blocks). */
function parseYamlScalarBlock(yaml: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = yaml.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!m) {
      i++
      continue
    }
    const key = m[1]
    let val = m[2]
    if (val === '|' || val === '>') {
      i++
      const parts: string[] = []
      while (i < lines.length) {
        const l = lines[i]
        if (/^[A-Za-z0-9_-]+:/.test(l)) break
        parts.push(l)
        i++
      }
      out[key] = parts.join('\n').trimEnd()
      continue
    }
    out[key] = val
    i++
  }
  return out
}

export function parseSkillMarkdown(raw: string): { frontmatter: Record<string, string>; body: string } {
  const s = raw.replace(/^\uFEFF/, '')
  if (!s.startsWith('---')) {
    return { frontmatter: {}, body: s }
  }
  const rest = s.slice(3)
  const endMatch = rest.match(/\n---\s*\r?\n/)
  if (!endMatch || endMatch.index === undefined) {
    return { frontmatter: {}, body: s }
  }
  const yamlBlock = rest.slice(0, endMatch.index).trim()
  const body = rest.slice(endMatch.index + endMatch[0].length)
  return { frontmatter: parseYamlScalarBlock(yamlBlock), body }
}

function frontmatterWantsFullInject(fm: Record<string, string>): boolean {
  const d = fm.mcp_diet?.toLowerCase().trim()
  if (d === 'false' || d === '0' || d === 'no') return true
  const load = fm.load?.toLowerCase().trim()
  if (load === 'full') return true
  return false
}

/** Prefer SKILL.md copies with richer YAML / body when the same slug exists in multiple roots. */
function scoreSkillFrontmatter(fm: Record<string, string>, body: string): number {
  let score = 0
  const keys = Object.keys(fm).filter((k) => (fm[k] ?? '').trim())
  score += keys.length * 8
  for (const k of keys) {
    score += Math.min(120, (fm[k] ?? '').length)
  }
  if ((fm.description ?? '').trim()) score += 50
  if ((fm.name ?? '').trim()) score += 12
  if ((fm.version ?? '').trim()) score += 10
  if ((fm.mcp_diet ?? '').trim()) score += 6
  if ((fm.load ?? '').trim()) score += 6
  const bodyTrim = body.trim()
  if (bodyTrim.length > 0) score += Math.min(80, Math.floor(bodyTrim.length / 40))
  return score
}

function buildFullSkillPrompt(params: {
  skillName: string
  path: string
  safeContent: string
  userRemainder: string
}): string {
  const userLine = params.userRemainder.trim()
    ? `User request:\n${params.userRemainder}`
    : `User request:\nExecute the /${params.skillName} workflow for the current task.`

  return [
    `You must apply the following skill guidance for this request.`,
    `Skill trigger: /${params.skillName}`,
    `Skill source: ${params.path}`,
    '',
    '=== SKILL.md (full inline) ===',
    params.safeContent,
    '=== END SKILL.md ===',
    '',
    userLine,
  ].join('\n')
}

/**
 * Diet / progressive-disclosure load (aligned with “diet MCP” ideas: small surface area in context,
 * pull full detail via read_file only when needed).
 */
function buildDietSkillPrompt(params: {
  skillName: string
  pathForTools: string
  description: string
  bodyPreview: string
  userRemainder: string
}): string {
  const userLine = params.userRemainder.trim()
    ? `User request:\n${params.userRemainder}`
    : `User request:\nExecute the /${params.skillName} workflow for the current task.`

  const truncatedNote =
    params.bodyPreview.length >= SKILL_DIET_BODY_PREVIEW_MAX ? '\n… [preview truncated]' : ''
  const previewBlock = `${params.bodyPreview.trim() || '(empty body)'}${truncatedNote}`

  return [
    '## Skill (diet load — progressive disclosure)',
    'Same idea as diet MCP: keep orchestrator context small; use **read_file** on the skill path when you need the full SKILL.md (long examples, scripts, or sections not shown below).',
    '',
    `- **Trigger:** /${params.skillName}`,
    `- **Skill file (read_file when needed):** ${params.pathForTools}`,
    '',
    '### When to apply (from SKILL.md frontmatter)',
    params.description.trim() || '(No description in frontmatter — open the file to see intent.)',
    '',
    '### Body preview (truncated; not a substitute for the full file when detail matters)',
    '```md',
    previewBlock,
    '```',
    '',
    userLine,
  ].join('\n')
}

export async function resolveSkillCommandPrompt(input: string): Promise<ResolvedSkillCommand> {
  const parsed = parseSlashSkill(input)
  if (!parsed) {
    return { activated: false, promptText: input }
  }

  const { skillName, remainder } = parsed
  const userRemainder = stripFullLoadFlag(remainder)
  const forceFull = wantsFullSkillFromRemainder(remainder)

  const paths = await candidateSkillPaths(skillName)
  const loaded: { path: string; content: string; score: number }[] = []
  for (const p of paths) {
    try {
      const content = await readFile(p)
      if (!content.trim()) continue
      const { frontmatter, body } = parseSkillMarkdown(content)
      const score = scoreSkillFrontmatter(frontmatter, body)
      loaded.push({ path: p, content, score })
    } catch {
      /* try next path */
    }
  }

  if (loaded.length === 0) {
    return {
      activated: false,
      promptText: input,
      error: `Skill not found for /${skillName}. Checked .cursor, .claude, and .openclaw skill directories.`,
    }
  }

  loaded.sort((a, b) => b.score - a.score || b.content.length - a.content.length)
  const { path: p, content } = loaded[0]

  const { frontmatter, body } = parseSkillMarkdown(content)
  const useFullInject = forceFull || frontmatterWantsFullInject(frontmatter)

  if (useFullInject) {
    const safeContent =
      content.length > SKILL_FULL_INJECT_MAX
        ? `${content.slice(0, SKILL_FULL_INJECT_MAX)}\n\n[Skill truncated]`
        : content
    const promptText = buildFullSkillPrompt({
      skillName,
      path: p,
      safeContent,
      userRemainder,
    })
    return {
      activated: true,
      skillName,
      promptText,
      sourcePath: p,
    }
  }

  const description =
    (frontmatter.description || frontmatter.name || '').trim() ||
    body.slice(0, 400).trim() + (body.length > 400 ? '…' : '')
  const previewSource = body.trim() ? body : content
  const bodyPreview = previewSource.slice(0, SKILL_DIET_BODY_PREVIEW_MAX)

  const promptText = buildDietSkillPrompt({
    skillName,
    pathForTools: p,
    description,
    bodyPreview,
    userRemainder,
  })
  return {
    activated: true,
    skillName,
    promptText,
    sourcePath: p,
  }
}

/** Slash palette row (skills from SKILL.md dirs, commands from `.cursor/commands` + `.claude/commands` + defaults). */
export interface SlashMenuItem {
  kind: 'skill' | 'command'
  id: string
  name: string
  description: string
}

/**
 * Filter slash menu items while typing after `/` — **prefix match on `name` only**
 * so e.g. `d` does not match `code-review` (which contains `d` in "code").
 */
export function filterSlashMenuByQuery(items: SlashMenuItem[], q: string): SlashMenuItem[] {
  const t = q.trim().toLowerCase()
  if (!t) return items
  return items.filter((x) => x.name.toLowerCase().startsWith(t))
}

const DEFAULT_SLASH_COMMANDS: SlashMenuItem[] = [
  {
    kind: 'command',
    id: 'builtin:skill-create',
    name: 'skill-create',
    description: 'Scaffold a project SKILL.md under .cursor/skills or .claude/skills (orchestrator create_project_skill).',
  },
  {
    kind: 'command',
    id: 'builtin:code-review',
    name: 'code-review',
    description: 'Ask for a focused code review pass on the current workspace.',
  },
  {
    kind: 'command',
    id: 'builtin:apply-worktree',
    name: 'apply-worktree',
    description: 'Summarize applying worktree changes back to main.',
  },
]

function pickRicherSkillCandidate(
  a: { item: SlashMenuItem; score: number },
  b: { item: SlashMenuItem; score: number }
): { item: SlashMenuItem; score: number } {
  if (b.score > a.score) return b
  if (a.score > b.score) return a
  if (b.item.description.length > a.item.description.length) return b
  if (a.item.description.length > b.item.description.length) return a
  return a
}

async function describeCommandMarkdownFile(path: string): Promise<string> {
  try {
    const c = await readFile(path)
    const { frontmatter, body } = parseSkillMarkdown(c)
    const d = (frontmatter.description || '').trim()
    if (d) return d.length > 200 ? `${d.slice(0, 120)}…` : d
    const first = body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('```'))
    return (first || '').replace(/^#\s*/, '').slice(0, 120)
  } catch {
    return 'Command'
  }
}

async function skillMenuItemFromDir(
  skillMdPath: string,
  skillName: string
): Promise<{ item: SlashMenuItem; score: number } | null> {
  try {
    const content = await readFile(skillMdPath)
    if (!content.trim()) return null
    const { frontmatter, body } = parseSkillMarkdown(content)
    const desc =
      (frontmatter.description || frontmatter.name || '').trim() ||
      body.slice(0, 200).trim().replace(/\s+/g, ' ')
    const score = scoreSkillFrontmatter(frontmatter, body)
    return {
      item: {
        kind: 'skill',
        id: `skill:${skillName}`,
        name: skillName,
        description: desc || '(no description)',
      },
      score,
    }
  } catch {
    return null
  }
}

async function listSkillsInFolder(
  skillsRoot: string
): Promise<Array<{ item: SlashMenuItem; score: number }>> {
  const out: Array<{ item: SlashMenuItem; score: number }> = []
  try {
    const entries = await readDirectory(skillsRoot)
    for (const e of entries) {
      if (!e.is_directory) continue
      const skillMd = joinWorkspacePath(skillsRoot, `${e.name}/SKILL.md`)
      const row = await skillMenuItemFromDir(skillMd, e.name)
      if (row) out.push(row)
    }
  } catch {
    return []
  }
  return out
}

/** Enumerate every `.../skills/<slug>/SKILL.md` under a plugin cache tree (for slash palette). */
async function listSkillsFromPluginsCacheTree(
  cacheRoot: string
): Promise<Array<{ item: SlashMenuItem; score: number }>> {
  const out: Array<{ item: SlashMenuItem; score: number }> = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > PLUGINS_CACHE_MAX_DEPTH) return
    let entries
    try {
      entries = await readDirectory(dir)
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.is_directory) continue
      if (e.name === 'skills') {
        const skillsDir = joinWorkspacePath(dir, e.name)
        let sub
        try {
          sub = await readDirectory(skillsDir)
        } catch {
          continue
        }
        for (const child of sub) {
          if (!child.is_directory) continue
          const skillMd = joinWorkspacePath(skillsDir, `${child.name}/SKILL.md`)
          const row = await skillMenuItemFromDir(skillMd, child.name)
          if (row) out.push(row)
        }
      } else {
        await walk(joinWorkspacePath(dir, e.name), depth + 1)
      }
    }
  }
  try {
    await walk(cacheRoot, 0)
  } catch {
    return []
  }
  return out
}

/** Project slash commands: Cursor-style `.cursor/commands` and Claude Code `.claude/commands`. */
async function listProjectCommandsFromWorkspace(wsPath: string): Promise<SlashMenuItem[]> {
  const byName = new Map<string, SlashMenuItem>()
  for (const rel of ['.cursor/commands', '.claude/commands']) {
    const cmdRoot = joinWorkspacePath(wsPath, rel)
    try {
      const entries = await readDirectory(cmdRoot)
      for (const e of entries) {
        if (!e.name.toLowerCase().endsWith('.md')) continue
        const name = e.name.replace(/\.md$/i, '')
        const desc = await describeCommandMarkdownFile(e.path)
        const item: SlashMenuItem = { kind: 'command', id: `cmd:${name}`, name, description: desc }
        const prev = byName.get(name)
        if (!prev || desc.length > prev.description.length) byName.set(name, item)
      }
    } catch {
      /* dir missing */
    }
  }
  return [...byName.values()]
}

/**
 * Discover skills from workspace + home: `.cursor/skills`, `.claude/skills`, skills as direct
 * children of `.claude/<slug>/SKILL.md` (Claude Code layout without a `skills/` segment),
 * `.openclaw/skills`, `~/.cursor/skills-cursor`, etc., plus nested plugin caches under
 * `.claude/plugins/cache` and `.cursor/plugins/cache` (`.../skills/<slug>/SKILL.md`).
 * Duplicate slugs: keep the copy with **richer** YAML/body metadata.
 */
export async function discoverSlashMenuItems(): Promise<{
  skills: SlashMenuItem[]
  commands: SlashMenuItem[]
}> {
  const skillsMap = new Map<string, { item: SlashMenuItem; score: number }>()
  const wsPath = await getWorkspaceRootForSkills()
  if (wsPath) {
    const roots = [
      joinWorkspacePath(wsPath, '.cursor/skills'),
      joinWorkspacePath(wsPath, '.claude/skills'),
      joinWorkspacePath(wsPath, '.claude'),
      joinWorkspacePath(wsPath, '.openclaw/skills'),
    ]
    for (const r of roots) {
      const found = await listSkillsInFolder(r)
      for (const cand of found) {
        const name = cand.item.name
        const prev = skillsMap.get(name)
        if (!prev) skillsMap.set(name, cand)
        else skillsMap.set(name, pickRicherSkillCandidate(prev, cand))
      }
    }
  }

  const home = await getHomeDir()
  if (home) {
    const homeRoots = [
      joinWorkspacePath(home, '.cursor/skills'),
      joinWorkspacePath(home, '.claude/skills'),
      joinWorkspacePath(home, '.claude'),
      joinWorkspacePath(home, '.openclaw/skills'),
      joinWorkspacePath(home, '.cursor/skills-cursor'),
    ]
    for (const r of homeRoots) {
      const found = await listSkillsInFolder(r)
      for (const cand of found) {
        const name = cand.item.name
        const prev = skillsMap.get(name)
        if (!prev) skillsMap.set(name, cand)
        else skillsMap.set(name, pickRicherSkillCandidate(prev, cand))
      }
    }
  }

  /** Claude / Cursor plugin installs: nested `plugins/cache/.../skills/<slug>/SKILL.md`. */
  for (const base of [wsPath, home].filter(Boolean) as string[]) {
    for (const cacheRel of ['.claude/plugins/cache', '.cursor/plugins/cache']) {
      const found = await listSkillsFromPluginsCacheTree(joinWorkspacePath(base, cacheRel))
      for (const cand of found) {
        const name = cand.item.name
        const prev = skillsMap.get(name)
        if (!prev) skillsMap.set(name, cand)
        else skillsMap.set(name, pickRicherSkillCandidate(prev, cand))
      }
    }
  }

  const skills = [...skillsMap.values()]
    .map((x) => x.item)
    .sort((a, b) => a.name.localeCompare(b.name))

  const commands: SlashMenuItem[] = []
  if (wsPath) {
    commands.push(...(await listProjectCommandsFromWorkspace(wsPath)))
  }
  const cmdNames = new Set(commands.map((c) => c.name))
  for (const b of DEFAULT_SLASH_COMMANDS) {
    if (!cmdNames.has(b.name)) {
      commands.push(b)
      cmdNames.add(b.name)
    }
  }
  commands.sort((a, b) => a.name.localeCompare(b.name))

  return { skills, commands }
}

/** Limits for orchestrator/sub-agent system-prompt injection (token budget). */
const ORCH_SKILLS_CATALOG_MAX_SKILLS = 70
const ORCH_SKILLS_CATALOG_MAX_COMMANDS = 40
const ORCH_SKILLS_CATALOG_MAX_DESC = 160
const ORCH_SKILLS_CATALOG_MAX_TOTAL = 14_000

/**
 * Builds a compact markdown block listing discovered skills and slash commands for the orchestrator
 * (main agent and sub-agents). Models use this to pick relevant skills and `read_file` the matching SKILL.md.
 */
export function formatInstalledSkillsCatalogForOrchestrator(
  skills: SlashMenuItem[],
  commands: SlashMenuItem[]
): string {
  if (skills.length === 0 && commands.length === 0) return ''

  const trimDesc = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim()
    if (t.length <= ORCH_SKILLS_CATALOG_MAX_DESC) return t
    return `${t.slice(0, ORCH_SKILLS_CATALOG_MAX_DESC - 1)}…`
  }

  const skillLines = skills
    .slice(0, ORCH_SKILLS_CATALOG_MAX_SKILLS)
    .map((s) => `- \`/${s.name}\` — ${trimDesc(s.description)}`)
  const cmdLines = commands
    .slice(0, ORCH_SKILLS_CATALOG_MAX_COMMANDS)
    .map((c) => `- \`/${c.name}\` — ${trimDesc(c.description)}`)

  let body = `### Installed skills & slash commands
When a skill clearly fits your task, **load it with \`read_file\`** (do not guess the body from this list alone). **Skip** skills that do not match—this catalog is for routing, not mandatory reading.

**Where SKILL.md lives:** try workspace \`.cursor/skills/<slug>/SKILL.md\`, \`.claude/skills/<slug>/SKILL.md\`, \`.claude/<slug>/SKILL.md\` (direct under \`.claude\`), and \`.openclaw/skills/\`; then the same under the user home directory. Plugin installs also expose \`…/.cursor/plugins/cache/\` and \`…/.claude/plugins/cache/\` with nested \`skills/<slug>/SKILL.md\` — use \`list_directory\` from the workspace root if needed to locate a plugin skill. **create_project_skill** can add new skills for later runs.

`

  if (skillLines.length) {
    body += `**Skills:**\n${skillLines.join('\n')}\n\n`
  }
  if (cmdLines.length) {
    body += `**Slash commands** (project \`.cursor/commands\`, \`.claude/commands\`, or built-ins):\n${cmdLines.join('\n')}\n`
  }

  if (body.length > ORCH_SKILLS_CATALOG_MAX_TOTAL) {
    return `${body.slice(0, ORCH_SKILLS_CATALOG_MAX_TOTAL - 24)}…\n\n_(Catalog truncated.)_`
  }
  return body.trimEnd()
}

/** Async wrapper: discovers skills/commands from workspace, home, and plugin caches. */
export async function loadInstalledSkillsCatalogForOrchestrator(): Promise<string> {
  try {
    const { skills, commands } = await discoverSlashMenuItems()
    return formatInstalledSkillsCatalogForOrchestrator(skills, commands)
  } catch {
    return ''
  }
}

type SlashTokenMatch = { filter: string; tokenStart: number } | null

/** Slash command token matcher for current line at cursor. */
function matchSlashTokenAtCursor(value: string, cursorPos: number): SlashTokenMatch {
  const before = value.slice(0, cursorPos)
  const line = before.split('\n').pop() ?? ''
  // Trigger only at line start or after whitespace/bracket-like boundaries.
  // Prevents false positives in URLs/paths/words like `https://x.dev/` or `foo/`.
  const m = line.match(/(?:^|[\s([{])\/([\w.-]*)$/)
  if (!m) return null
  const filter = m[1] ?? ''
  const tokenStart = before.length - (`/${filter}`).length
  return { filter, tokenStart }
}

/** True when the cursor is immediately after a `/` command token on the current line (for slash palette). */
export function parseSlashMenuQuery(value: string, cursorPos: number): { active: boolean; filter: string } {
  const match = matchSlashTokenAtCursor(value, cursorPos)
  if (!match) return { active: false, filter: '' }
  return { active: true, filter: match.filter }
}

/** Replace `/partial` at cursor with `/name ` and return new value + caret position. */
export function replaceSlashTokenAtCursor(
  value: string,
  cursorPos: number,
  replacementName: string,
  trailingSpace = true
): { next: string; cursor: number } | null {
  const match = matchSlashTokenAtCursor(value, cursorPos)
  if (!match) return null
  const insert = `/${replacementName}${trailingSpace ? ' ' : ''}`
  const next = value.slice(0, match.tokenStart) + insert + value.slice(cursorPos)
  const cursor = match.tokenStart + insert.length
  return { next, cursor }
}

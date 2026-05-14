export interface HermesTileDesignerDraft {
  id: string
  componentKey: string
  title: string
  summary: string
  allowedTools: string[]
  permissions: {
    workspaceRead: boolean
    workspaceWrite: boolean
    network: boolean
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function toPascalCase(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('')
}

export function createHermesTileDesignerDraft(input: {
  name: string
  description: string
  requestedTools: string[]
}): HermesTileDesignerDraft {
  const title = input.name.trim() || 'Untitled Tile'
  const normalizedTools = Array.from(new Set(input.requestedTools.map((t) => t.trim()).filter(Boolean))).slice(0, 8)
  const slug = slugify(title) || 'untitled-tile'
  const componentStem = toPascalCase(title) || 'UntitledTile'
  return {
    id: `tile-${slug}`,
    componentKey: `${componentStem}Tile`,
    title,
    summary: input.description.trim() || `Hermes-authored tile: ${title}`,
    allowedTools: normalizedTools.length > 0 ? normalizedTools : ['read_file'],
    permissions: {
      workspaceRead: true,
      workspaceWrite: false,
      network: false,
    },
  }
}

export function validateHermesTileDesignerDraft(draft: HermesTileDesignerDraft): {
  ok: boolean
  errors: string[]
} {
  const errors: string[] = []
  if (!/^tile-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.id)) {
    errors.push('id must match /^tile-[a-z0-9-]+$/')
  }
  if (!/^[A-Z][A-Za-z0-9]*Tile$/.test(draft.componentKey)) {
    errors.push('componentKey must be PascalCase and end with Tile')
  }
  if (draft.title.trim().length < 3 || draft.title.trim().length > 60) {
    errors.push('title must be 3..60 characters')
  }
  if (draft.summary.trim().length < 8 || draft.summary.trim().length > 240) {
    errors.push('summary must be 8..240 characters')
  }
  if (!Array.isArray(draft.allowedTools) || draft.allowedTools.length === 0) {
    errors.push('at least one allowed tool is required')
  }
  if (draft.allowedTools.some((t) => !/^[a-z0-9_:-]+$/i.test(t))) {
    errors.push('allowedTools entries must be alphanumeric tool ids')
  }
  if (!draft.permissions.workspaceRead) {
    errors.push('workspaceRead permission is required')
  }
  if (draft.permissions.workspaceWrite && !draft.permissions.workspaceRead) {
    errors.push('workspaceWrite requires workspaceRead')
  }
  return { ok: errors.length === 0, errors }
}

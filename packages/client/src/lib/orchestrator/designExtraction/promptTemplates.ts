import type { DesignExtractionMode, ScopedExtractionType } from './schema'

export interface DesignExtractionPromptInput {
  mode: DesignExtractionMode
  scope?: ScopedExtractionType
  sourceDesign: string
  editRequest?: string
  additionalContext?: string
}

const FULL_SCHEMA_TEMPLATE = `{
  "version": 1,
  "mode": "full",
  "rationale": "short rationale",
  "data": {
    "overallDescription": "...",
    "visualStyle": ["..."],
    "colorPalette": ["..."],
    "composition": "...",
    "lighting": "...",
    "cameraAngle": "...",
    "perspective": "...",
    "weather": "...",
    "season": "...",
    "keyElements": ["..."],
    "negativeConstraints": ["..."]
  }
}`

const SCOPED_BASE_HEADER = `{
  "version": 1,
  "mode": "scoped",
  "rationale": "short rationale",
  "data": { "scope": "...", "...": "..." }
}`

function scopedSchemaTemplate(scope: ScopedExtractionType): string {
  if (scope === 'element_replacement') {
    return `{
  "version": 1,
  "mode": "scoped",
  "rationale": "short rationale",
  "data": {
    "scope": "element_replacement",
    "targetElement": "...",
    "replacementElement": "...",
    "preserve": ["..."]
  }
}`
  }

  if (scope === 'weather_season') {
    return `{
  "version": 1,
  "mode": "scoped",
  "rationale": "short rationale",
  "data": {
    "scope": "weather_season",
    "weather": "...",
    "season": "...",
    "preserve": ["..."]
  }
}`
  }

  if (scope === 'camera_angle_perspective') {
    return `{
  "version": 1,
  "mode": "scoped",
  "rationale": "short rationale",
  "data": {
    "scope": "camera_angle_perspective",
    "cameraAngle": "...",
    "perspective": "...",
    "preserve": ["..."]
  }
}`
  }

  return `{
  "version": 1,
  "mode": "scoped",
  "rationale": "short rationale",
  "data": {
    "scope": "additive_object",
    "objectDescription": "...",
    "placement": "...",
    "preserve": ["..."]
  }
}`
}

export function buildDesignExtractionSystemPrompt(input: {
  mode: DesignExtractionMode
  scope?: ScopedExtractionType
}): string {
  if (input.mode === 'full') {
    return [
      'You extract design intent from an image/design brief.',
      'Output ONLY strict JSON. No markdown fences. No extra keys. No commentary.',
      'Follow this exact schema:',
      FULL_SCHEMA_TEMPLATE,
      'Rules:',
      '- Use concise, literal values.',
      '- Keep rationale to one sentence.',
      '- Preserve uncertainty explicitly inside text fields instead of adding new keys.',
    ].join('\n')
  }

  const scope = input.scope ?? 'element_replacement'
  return [
    'You extract scoped design edits from an image/design brief.',
    'Output ONLY strict JSON. No markdown fences. No extra keys. No commentary.',
    `Scoped extraction type: ${scope}`,
    'General wrapper schema:',
    SCOPED_BASE_HEADER,
    'Exact schema for this scope:',
    scopedSchemaTemplate(scope),
    'Rules:',
    '- preserve should list visual attributes that must remain unchanged.',
    '- Keep rationale to one sentence.',
  ].join('\n')
}

export function buildDesignExtractionUserPrompt(input: DesignExtractionPromptInput): string {
  const lines = [
    `Mode: ${input.mode}`,
    `Source design description:\n${input.sourceDesign.trim()}`,
  ]

  if (input.mode === 'scoped') {
    lines.push(`Scope: ${input.scope ?? 'element_replacement'}`)
  }

  if (typeof input.editRequest === 'string' && input.editRequest.trim().length > 0) {
    lines.push(`Requested edit:\n${input.editRequest.trim()}`)
  }

  if (typeof input.additionalContext === 'string' && input.additionalContext.trim().length > 0) {
    lines.push(`Additional context:\n${input.additionalContext.trim()}`)
  }

  lines.push('Return strict JSON only.')
  return lines.join('\n\n')
}

export function buildDesignExtractionPrompts(input: DesignExtractionPromptInput): {
  systemPrompt: string
  userPrompt: string
} {
  return {
    systemPrompt: buildDesignExtractionSystemPrompt({ mode: input.mode, scope: input.scope }),
    userPrompt: buildDesignExtractionUserPrompt(input),
  }
}

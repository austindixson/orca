export const DESIGN_EXTRACTION_VERSION = 1 as const

export const DESIGN_EXTRACTION_MODES = ['full', 'scoped'] as const
export type DesignExtractionMode = (typeof DESIGN_EXTRACTION_MODES)[number]

export const SCOPED_EXTRACTION_TYPES = [
  'element_replacement',
  'weather_season',
  'camera_angle_perspective',
  'additive_object',
] as const
export type ScopedExtractionType = (typeof SCOPED_EXTRACTION_TYPES)[number]

export interface FullDesignExtractionData {
  overallDescription: string
  visualStyle: string[]
  colorPalette: string[]
  composition: string
  lighting: string
  cameraAngle: string
  perspective: string
  weather: string
  season: string
  keyElements: string[]
  negativeConstraints: string[]
}

export interface ElementReplacementExtractionData {
  scope: 'element_replacement'
  targetElement: string
  replacementElement: string
  preserve: string[]
}

export interface WeatherSeasonExtractionData {
  scope: 'weather_season'
  weather: string
  season: string
  preserve: string[]
}

export interface CameraAnglePerspectiveExtractionData {
  scope: 'camera_angle_perspective'
  cameraAngle: string
  perspective: string
  preserve: string[]
}

export interface AdditiveObjectExtractionData {
  scope: 'additive_object'
  objectDescription: string
  placement: string
  preserve: string[]
}

export type ScopedDesignExtractionData =
  | ElementReplacementExtractionData
  | WeatherSeasonExtractionData
  | CameraAnglePerspectiveExtractionData
  | AdditiveObjectExtractionData

export interface FullDesignExtractionResponse {
  version: typeof DESIGN_EXTRACTION_VERSION
  mode: 'full'
  rationale: string
  data: FullDesignExtractionData
}

export interface ScopedDesignExtractionResponse {
  version: typeof DESIGN_EXTRACTION_VERSION
  mode: 'scoped'
  rationale: string
  data: ScopedDesignExtractionData
}

export type DesignExtractionResponse = FullDesignExtractionResponse | ScopedDesignExtractionResponse

export interface ValidationIssue {
  path: string
  message: string
}

export type ValidationResult<T> =
  | {
      ok: true
      value: T
    }
  | {
      ok: false
      issues: ValidationIssue[]
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScopedExtractionType(value: unknown): value is ScopedExtractionType {
  return typeof value === 'string' && SCOPED_EXTRACTION_TYPES.includes(value as ScopedExtractionType)
}

function checkExactKeys(
  object: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  issues: ValidationIssue[]
): void {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, message: 'Unexpected key' })
    }
  }
}

function readRequiredString(
  object: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[]
): string {
  const value = object[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ path: `${path}.${key}`, message: 'Expected non-empty string' })
    return ''
  }
  return value.trim()
}

function readStringArray(
  object: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  options?: { minLength?: number }
): string[] {
  const value = object[key]
  if (!Array.isArray(value)) {
    issues.push({ path: `${path}.${key}`, message: 'Expected array of strings' })
    return []
  }

  const out: string[] = []
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i]
    if (typeof item !== 'string' || item.trim().length === 0) {
      issues.push({ path: `${path}.${key}[${i}]`, message: 'Expected non-empty string item' })
      continue
    }
    out.push(item.trim())
  }

  if (typeof options?.minLength === 'number' && out.length < options.minLength) {
    issues.push({ path: `${path}.${key}`, message: `Expected at least ${options.minLength} item(s)` })
  }

  return out
}

function validateFullData(data: unknown, issues: ValidationIssue[]): FullDesignExtractionData | null {
  if (!isRecord(data)) {
    issues.push({ path: 'data', message: 'Expected object' })
    return null
  }
  checkExactKeys(
    data,
    [
      'overallDescription',
      'visualStyle',
      'colorPalette',
      'composition',
      'lighting',
      'cameraAngle',
      'perspective',
      'weather',
      'season',
      'keyElements',
      'negativeConstraints',
    ],
    'data',
    issues
  )

  return {
    overallDescription: readRequiredString(data, 'overallDescription', 'data', issues),
    visualStyle: readStringArray(data, 'visualStyle', 'data', issues, { minLength: 1 }),
    colorPalette: readStringArray(data, 'colorPalette', 'data', issues, { minLength: 1 }),
    composition: readRequiredString(data, 'composition', 'data', issues),
    lighting: readRequiredString(data, 'lighting', 'data', issues),
    cameraAngle: readRequiredString(data, 'cameraAngle', 'data', issues),
    perspective: readRequiredString(data, 'perspective', 'data', issues),
    weather: readRequiredString(data, 'weather', 'data', issues),
    season: readRequiredString(data, 'season', 'data', issues),
    keyElements: readStringArray(data, 'keyElements', 'data', issues, { minLength: 1 }),
    negativeConstraints: readStringArray(data, 'negativeConstraints', 'data', issues),
  }
}

function validateScopedData(data: unknown, issues: ValidationIssue[]): ScopedDesignExtractionData | null {
  if (!isRecord(data)) {
    issues.push({ path: 'data', message: 'Expected object' })
    return null
  }
  const scopeRaw = data.scope
  if (!isScopedExtractionType(scopeRaw)) {
    issues.push({ path: 'data.scope', message: `Expected one of: ${SCOPED_EXTRACTION_TYPES.join(', ')}` })
    return null
  }
  const scope: ScopedExtractionType = scopeRaw

  if (scope === 'element_replacement') {
    checkExactKeys(data, ['scope', 'targetElement', 'replacementElement', 'preserve'], 'data', issues)
    return {
      scope,
      targetElement: readRequiredString(data, 'targetElement', 'data', issues),
      replacementElement: readRequiredString(data, 'replacementElement', 'data', issues),
      preserve: readStringArray(data, 'preserve', 'data', issues),
    }
  }

  if (scope === 'weather_season') {
    checkExactKeys(data, ['scope', 'weather', 'season', 'preserve'], 'data', issues)
    return {
      scope,
      weather: readRequiredString(data, 'weather', 'data', issues),
      season: readRequiredString(data, 'season', 'data', issues),
      preserve: readStringArray(data, 'preserve', 'data', issues),
    }
  }

  if (scope === 'camera_angle_perspective') {
    checkExactKeys(data, ['scope', 'cameraAngle', 'perspective', 'preserve'], 'data', issues)
    return {
      scope,
      cameraAngle: readRequiredString(data, 'cameraAngle', 'data', issues),
      perspective: readRequiredString(data, 'perspective', 'data', issues),
      preserve: readStringArray(data, 'preserve', 'data', issues),
    }
  }

  checkExactKeys(data, ['scope', 'objectDescription', 'placement', 'preserve'], 'data', issues)
  return {
    scope,
    objectDescription: readRequiredString(data, 'objectDescription', 'data', issues),
    placement: readRequiredString(data, 'placement', 'data', issues),
    preserve: readStringArray(data, 'preserve', 'data', issues),
  }
}

export function validateDesignExtractionResponse(input: unknown): ValidationResult<DesignExtractionResponse> {
  const issues: ValidationIssue[] = []
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '$', message: 'Expected object' }] }
  }

  checkExactKeys(input, ['version', 'mode', 'rationale', 'data'], '$', issues)

  if (input.version !== DESIGN_EXTRACTION_VERSION) {
    issues.push({
      path: '$.version',
      message: `Expected version ${DESIGN_EXTRACTION_VERSION}`,
    })
  }

  const mode = input.mode
  if (!DESIGN_EXTRACTION_MODES.includes(mode as DesignExtractionMode)) {
    issues.push({ path: '$.mode', message: `Expected one of: ${DESIGN_EXTRACTION_MODES.join(', ')}` })
    return { ok: false, issues }
  }

  const rationale = readRequiredString(input, 'rationale', '$', issues)

  if (mode === 'full') {
    const data = validateFullData(input.data, issues)
    if (issues.length > 0 || data == null) {
      return { ok: false, issues }
    }
    const value: FullDesignExtractionResponse = {
      version: DESIGN_EXTRACTION_VERSION,
      mode: 'full',
      rationale,
      data,
    }
    return { ok: true, value }
  }

  const data = validateScopedData(input.data, issues)
  if (issues.length > 0 || data == null) {
    return { ok: false, issues }
  }
  const value: ScopedDesignExtractionResponse = {
    version: DESIGN_EXTRACTION_VERSION,
    mode: 'scoped',
    rationale,
    data,
  }
  return { ok: true, value }
}

export function assertDesignExtractionResponse(input: unknown): DesignExtractionResponse {
  const validated = validateDesignExtractionResponse(input)
  if ('issues' in validated) {
    const message = validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
    throw new Error(`Invalid design extraction payload: ${message}`)
  }
  return validated.value
}

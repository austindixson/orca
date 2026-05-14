import {
  DESIGN_EXTRACTION_VERSION,
  type DesignExtractionMode,
  type ScopedExtractionType,
} from './schema'

interface RepairExpectation {
  mode: DesignExtractionMode
  scope?: ScopedExtractionType
}

export interface JsonNormalizationResult {
  parsed: unknown | null
  normalizedText: string
  didRepair: boolean
  attempts: string[]
  parseError?: string
}

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.replace(/^```[a-z0-9_-]*\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

function extractBalancedObject(raw: string): string {
  const start = raw.indexOf('{')
  if (start < 0) return raw

  let depth = 0
  let inString = false
  let escape = false
  let end = -1

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (char === '\\') {
        escape = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  if (end < 0) {
    const lastBrace = raw.lastIndexOf('}')
    if (lastBrace > start) {
      return raw.slice(start, lastBrace + 1)
    }
    return raw.slice(start)
  }

  return raw.slice(start, end + 1)
}

function repairLooseJsonSyntax(raw: string): string {
  return raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, content: string) => `"${content.replace(/"/g, '\\"')}"`)
    .replace(/,\s*([}\]])/g, '$1')
}

export function normalizeAndParseJson(raw: string): JsonNormalizationResult {
  const attempts: string[] = []
  const candidates: string[] = []

  const direct = raw.trim()
  candidates.push(direct)
  candidates.push(stripCodeFence(direct))
  candidates.push(extractBalancedObject(stripCodeFence(direct)))
  candidates.push(repairLooseJsonSyntax(extractBalancedObject(stripCodeFence(direct))))

  let lastCandidate = direct
  for (const candidate of candidates) {
    const normalized = candidate.trim()
    if (!normalized) continue
    attempts.push(normalized)
    lastCandidate = normalized
    const parsed = tryParse(normalized)
    if (parsed !== null) {
      return {
        parsed,
        normalizedText: normalized,
        didRepair: normalized !== direct,
        attempts,
      }
    }
  }

  return {
    parsed: null,
    normalizedText: lastCandidate,
    didRepair: true,
    attempts,
    parseError: 'Failed to parse JSON after normalization attempts',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function scopedDataFromLooseObject(scope: ScopedExtractionType, value: Record<string, unknown>) {
  if (scope === 'element_replacement') {
    return {
      scope,
      targetElement: typeof value.targetElement === 'string' ? value.targetElement : '',
      replacementElement: typeof value.replacementElement === 'string' ? value.replacementElement : '',
      preserve: toStringArray(value.preserve),
    }
  }

  if (scope === 'weather_season') {
    return {
      scope,
      weather: typeof value.weather === 'string' ? value.weather : '',
      season: typeof value.season === 'string' ? value.season : '',
      preserve: toStringArray(value.preserve),
    }
  }

  if (scope === 'camera_angle_perspective') {
    return {
      scope,
      cameraAngle: typeof value.cameraAngle === 'string' ? value.cameraAngle : '',
      perspective: typeof value.perspective === 'string' ? value.perspective : '',
      preserve: toStringArray(value.preserve),
    }
  }

  return {
    scope,
    objectDescription: typeof value.objectDescription === 'string' ? value.objectDescription : '',
    placement: typeof value.placement === 'string' ? value.placement : '',
    preserve: toStringArray(value.preserve),
  }
}

export function repairDesignExtractionShape(
  parsed: unknown,
  expectation: RepairExpectation
): unknown {
  if (!isRecord(parsed)) return parsed

  if (
    parsed.version === DESIGN_EXTRACTION_VERSION &&
    (parsed.mode === 'full' || parsed.mode === 'scoped') &&
    'data' in parsed
  ) {
    return parsed
  }

  const maybeResult = parsed.result
  if (isRecord(maybeResult)) {
    return repairDesignExtractionShape(maybeResult, expectation)
  }

  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : 'Repaired from non-canonical JSON shape.'

  if (expectation.mode === 'full') {
    return {
      version: DESIGN_EXTRACTION_VERSION,
      mode: 'full',
      rationale,
      data: parsed,
    }
  }

  const scoped = expectation.scope ?? 'element_replacement'
  if (isRecord(parsed.data)) {
    return {
      version: DESIGN_EXTRACTION_VERSION,
      mode: 'scoped',
      rationale,
      data: scopedDataFromLooseObject(scoped, parsed.data),
    }
  }

  return {
    version: DESIGN_EXTRACTION_VERSION,
    mode: 'scoped',
    rationale,
    data: scopedDataFromLooseObject(scoped, parsed),
  }
}

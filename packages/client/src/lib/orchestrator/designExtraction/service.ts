import { repairDesignExtractionShape, normalizeAndParseJson } from './normalizer'
import {
  assertDesignExtractionResponse,
  type DesignExtractionMode,
  type DesignExtractionResponse,
  type ScopedExtractionType,
} from './schema'
import { buildDesignExtractionPrompts } from './promptTemplates'

export interface DesignExtractionServiceRequest {
  mode: DesignExtractionMode
  scope?: ScopedExtractionType
  sourceDesign: string
  editRequest?: string
  additionalContext?: string
}

export interface DesignExtractionProvider {
  generate(input: {
    systemPrompt: string
    userPrompt: string
    temperature: number
    maxOutputTokens: number
  }): Promise<string>
}

export interface DesignExtractionServiceOptions {
  temperature?: number
  maxOutputTokens?: number
}

export interface DesignExtractionServiceResult {
  value: DesignExtractionResponse
  rawOutput: string
  normalizedOutput: string
  didRepair: boolean
}

export async function runDesignExtraction(
  request: DesignExtractionServiceRequest,
  provider: DesignExtractionProvider,
  options: DesignExtractionServiceOptions = {}
): Promise<DesignExtractionServiceResult> {
  const prompts = buildDesignExtractionPrompts(request)

  const rawOutput = await provider.generate({
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    temperature: options.temperature ?? 0,
    maxOutputTokens: options.maxOutputTokens ?? 900,
  })

  if (typeof rawOutput !== 'string' || rawOutput.trim().length === 0) {
    throw new Error('Design extraction provider returned empty output')
  }

  const normalized = normalizeAndParseJson(rawOutput)
  if (normalized.parsed == null) {
    throw new Error(
      `Design extraction JSON parse failed. ${normalized.parseError ?? 'Unknown parse error'}`
    )
  }

  const repairedShape = repairDesignExtractionShape(normalized.parsed, {
    mode: request.mode,
    scope: request.scope,
  })

  const value = assertDesignExtractionResponse(repairedShape)

  return {
    value,
    rawOutput,
    normalizedOutput: normalized.normalizedText,
    didRepair: normalized.didRepair || repairedShape !== normalized.parsed,
  }
}

export type HybridProviderType = 'hosted_api' | 'openai_compatible' | 'local_gateway'
export type HybridReasoningMode = 'auto' | 'fast' | 'expert' | 'heavy'

export interface HybridProviderModel {
  id: string
  displayName: string
  supportsTools: boolean
  contextWindowTokens: number
  reasoningModes: HybridReasoningMode[]
}

export interface HybridProvider {
  id: string
  displayName: string
  type: HybridProviderType
  enabled: boolean
  api: {
    baseUrl: string
    apiKeyRef: string
    timeoutMs: number
  }
  models: HybridProviderModel[]
  defaultModelId: string
}

export interface HybridRuntimeModePolicy {
  providerId: string
  modelId: string
  reasoningMode: HybridReasoningMode
  allowFallback: boolean
}

export interface HybridProviderConfig {
  version: string
  providers: HybridProvider[]
  runtimePolicies: {
    localOrchestrator: HybridRuntimeModePolicy
    hermesLead: HybridRuntimeModePolicy
  }
}

export interface HybridProviderConfigValidation {
  ok: boolean
  errors: string[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v != null && !Array.isArray(v)
}

export function validateHybridProviderConfig(input: unknown): HybridProviderConfigValidation {
  const errors: string[] = []
  if (!isRecord(input)) return { ok: false, errors: ['Config must be an object'] }

  const version = input.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    errors.push('version must be semver string (e.g. 1.0.0)')
  }

  const providers = input.providers
  if (!Array.isArray(providers) || providers.length === 0) {
    errors.push('providers must be a non-empty array')
  } else {
    for (const [idx, raw] of providers.entries()) {
      if (!isRecord(raw)) {
        errors.push(`providers[${idx}] must be an object`)
        continue
      }
      if (typeof raw.id !== 'string' || raw.id.trim() === '') errors.push(`providers[${idx}].id is required`)
      if (typeof raw.displayName !== 'string' || raw.displayName.trim() === '') {
        errors.push(`providers[${idx}].displayName is required`)
      }
      if (!['hosted_api', 'openai_compatible', 'local_gateway'].includes(String(raw.type ?? ''))) {
        errors.push(`providers[${idx}].type must be hosted_api | openai_compatible | local_gateway`)
      }
      if (typeof raw.enabled !== 'boolean') errors.push(`providers[${idx}].enabled must be boolean`)
      if (!isRecord(raw.api)) {
        errors.push(`providers[${idx}].api must be an object`)
      } else {
        if (typeof raw.api.baseUrl !== 'string' || raw.api.baseUrl.trim() === '') {
          errors.push(`providers[${idx}].api.baseUrl is required`)
        }
        if (typeof raw.api.apiKeyRef !== 'string' || raw.api.apiKeyRef.trim() === '') {
          errors.push(`providers[${idx}].api.apiKeyRef is required`)
        }
        if (typeof raw.api.timeoutMs !== 'number' || raw.api.timeoutMs < 1000) {
          errors.push(`providers[${idx}].api.timeoutMs must be >= 1000`)
        }
      }
      if (!Array.isArray(raw.models) || raw.models.length === 0) {
        errors.push(`providers[${idx}].models must be a non-empty array`)
      }
      if (typeof raw.defaultModelId !== 'string' || raw.defaultModelId.trim() === '') {
        errors.push(`providers[${idx}].defaultModelId is required`)
      }
    }
  }

  const runtimePolicies = input.runtimePolicies
  if (!isRecord(runtimePolicies)) {
    errors.push('runtimePolicies must be an object')
  } else {
    for (const mode of ['localOrchestrator', 'hermesLead'] as const) {
      const policy = runtimePolicies[mode]
      if (!isRecord(policy)) {
        errors.push(`runtimePolicies.${mode} must be an object`)
        continue
      }
      if (typeof policy.providerId !== 'string' || policy.providerId.trim() === '') {
        errors.push(`runtimePolicies.${mode}.providerId is required`)
      }
      if (typeof policy.modelId !== 'string' || policy.modelId.trim() === '') {
        errors.push(`runtimePolicies.${mode}.modelId is required`)
      }
      if (!['auto', 'fast', 'expert', 'heavy'].includes(String(policy.reasoningMode ?? ''))) {
        errors.push(`runtimePolicies.${mode}.reasoningMode must be auto|fast|expert|heavy`)
      }
      if (typeof policy.allowFallback !== 'boolean') {
        errors.push(`runtimePolicies.${mode}.allowFallback must be boolean`)
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

export function parseAndValidateHybridProviderConfig(jsonText: string):
  | { ok: true; value: HybridProviderConfig }
  | { ok: false; errors: string[] } {
  try {
    const parsed = JSON.parse(jsonText) as unknown
    const check = validateHybridProviderConfig(parsed)
    if (!check.ok) return { ok: false, errors: check.errors }
    return { ok: true, value: parsed as HybridProviderConfig }
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] }
  }
}

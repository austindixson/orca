import { useSettingsStore } from '../../store/settingsStore'

const SECRET_KEY_RE = /(api[-_]?key|token|secret|password|authorization|bearer|cookie)/i

function redactForTelemetry(value: unknown, parentKey?: string): unknown {
  if (parentKey && SECRET_KEY_RE.test(parentKey)) {
    if (typeof value === 'string') return value.trim() ? '<redacted>' : ''
    if (typeof value === 'boolean') return value
    if (value == null) return value
    return '<redacted>'
  }
  if (Array.isArray(value)) return value.map((item) => redactForTelemetry(item))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactForTelemetry(v, k)
    }
    return out
  }
  return value
}

/**
 * Minimal runtime settings context for telemetry exports.
 * Includes model routing and provider configuration while redacting secret fields.
 */
export function buildTelemetrySettingsSnapshot(): Record<string, unknown> {
  const s = useSettingsStore.getState()
  return redactForTelemetry({
    selectedModel: s.selectedModel,
    providers: s.providers,
    hermesApiBaseUrl: s.hermesApiBaseUrl,
    hermesModel: s.hermesModel,
    hermesApiKeyPresent: !!s.hermesApiKey?.trim(),
    orchestratorLeadDelegationOnly: s.orchestratorLeadDelegationOnly,
    hermesOrchestratorMode: s.hermesOrchestratorMode,
    hermesOrchestratorAutoDetect: s.hermesOrchestratorAutoDetect,
    leadProfile: s.leadProfile,
    subAgentSimpleModelId: s.subAgentSimpleModelId,
    subAgentComplexModelId: s.subAgentComplexModelId,
  }) as Record<string, unknown>
}

export function buildTelemetrySettingsJson(): string {
  return JSON.stringify(buildTelemetrySettingsSnapshot())
}

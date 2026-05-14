import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useState } from 'react'
import {
  useSettingsStore,
  PROVIDER_INFO,
  sortModelsForDisplay,
  normalizeHybridAuthProfiles,
  type Provider,
} from '../../../store/settingsStore'
import { ProviderSettingsPanel } from '../ProviderSettingsPanel'
import { SettingsAccordion, SettingsToggleRow } from '../settingsPrimitives'
import { SettingsPageHeader } from '../settingsLayout'
import { useCanvasBridgeExternalOrchestrator } from '../../../hooks/useCanvasBridgeExternalOrchestrator'
import { describePreflight } from '../../../lib/openrouterPreflight'
import {
  OPENROUTER_RATE_LIMIT_FALLBACK_MODEL_IDS,
  getOpenRouterRateLimitFallbackUntilMs,
} from '../../../lib/orchestrator/openrouterRateLimitFallback'
import {
  getOrchestratorToolReplyQuarantineUntilMs,
  isOrchestratorToolReplyQuarantined,
} from '../../../lib/orchestrator/orchestratorToolReplyHealth'

type ModelsSectionProps = {
  showKey: Record<Provider, boolean>
  setShowKey: Dispatch<SetStateAction<Record<Provider, boolean>>>
  localModelsBusy: boolean
  runLocalModelFetch: (which: 'both' | 'ollama' | 'llamacpp') => Promise<void>
}

export function ModelsSection({
  showKey,
  setShowKey,
  localModelsBusy,
  runLocalModelFetch,
}: ModelsSectionProps) {
  const providers = useSettingsStore((s) => s.providers)
  const selectedModel = useSettingsStore((s) => s.selectedModel)
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel)
  const getAvailableModels = useSettingsStore((s) => s.getAvailableModels)
  const subAgentSimpleModelId = useSettingsStore((s) => s.subAgentSimpleModelId)
  const subAgentComplexModelId = useSettingsStore((s) => s.subAgentComplexModelId)
  const setSubAgentSimpleModelId = useSettingsStore((s) => s.setSubAgentSimpleModelId)
  const setSubAgentComplexModelId = useSettingsStore((s) => s.setSubAgentComplexModelId)
  const hybridAuthProfiles = useSettingsStore((s) => s.hybridAuthProfiles)
  const setHybridAuthProfiles = useSettingsStore((s) => s.setHybridAuthProfiles)

  const openrouterRateLimitFallbackEnabled = useSettingsStore((s) => s.openrouterRateLimitFallbackEnabled)
  const openrouterRateLimitFallbackModelId = useSettingsStore((s) => s.openrouterRateLimitFallbackModelId)
  const openrouterRateLimitFallbackMinutes = useSettingsStore((s) => s.openrouterRateLimitFallbackMinutes)
  const setOpenrouterRateLimitFallbackEnabled = useSettingsStore(
    (s) => s.setOpenrouterRateLimitFallbackEnabled
  )
  const setOpenrouterRateLimitFallbackModelId = useSettingsStore(
    (s) => s.setOpenrouterRateLimitFallbackModelId
  )
  const setOpenrouterRateLimitFallbackMinutes = useSettingsStore(
    (s) => s.setOpenrouterRateLimitFallbackMinutes
  )

  const openSettingsToSection = useSettingsStore((s) => s.openSettingsToSection)
  const { modelsOrchestratorLocked } = useCanvasBridgeExternalOrchestrator()

  const [, setFallbackUiTick] = useState(0)
  useEffect(() => {
    if (!providers.openrouter.enabled || !openrouterRateLimitFallbackEnabled) return
    const id = window.setInterval(() => setFallbackUiTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [providers.openrouter.enabled, openrouterRateLimitFallbackEnabled])

  const [toolHealthUiTick, setToolHealthUiTick] = useState(0)
  const [hybridAuthProfilesJson, setHybridAuthProfilesJson] = useState(() =>
    JSON.stringify(hybridAuthProfiles, null, 2)
  )
  const [hybridAuthProfilesError, setHybridAuthProfilesError] = useState<string | null>(null)
  useEffect(() => {
    setHybridAuthProfilesJson(JSON.stringify(hybridAuthProfiles, null, 2))
  }, [hybridAuthProfiles])
  useEffect(() => {
    const id = window.setInterval(() => setToolHealthUiTick((n) => n + 1), 2000)
    return () => window.clearInterval(id)
  }, [])

  const lockClass = modelsOrchestratorLocked ? 'pointer-events-none opacity-45 saturate-[0.65]' : ''

  /** Keeps long model pickers from dominating the settings panel. */
  const scrollableModelListClass =
    'max-h-[min(45vh,26rem)] overflow-y-auto overscroll-y-contain pr-0.5 [scrollbar-gutter:stable]'

  const availableModels = sortModelsForDisplay(getAvailableModels())
  const orchestratorQuickPickValue =
    selectedModel && selectedModel.trim() && availableModels.some((m) => m.id === selectedModel)
      ? selectedModel
      : selectedModel?.trim()
        ? selectedModel
        : availableModels[0]?.id ?? ''
  const selectedModelConfig = availableModels.find((m) => m.id === orchestratorQuickPickValue)
  const toolReplyQuarantineUntil =
    selectedModelConfig &&
    isOrchestratorToolReplyQuarantined(selectedModelConfig.provider, selectedModelConfig.name)
      ? getOrchestratorToolReplyQuarantineUntilMs(selectedModelConfig.provider, selectedModelConfig.name)
      : null
  void toolHealthUiTick
  const toolCapableModels = availableModels.filter((m) => m.supportsTools !== false)
  const openrouterModels = availableModels.filter((m) => m.provider === 'openrouter')
  const openrouterKeySaved = Boolean((providers.openrouter.apiKey ?? '').trim())

  const openrouterPreflightResults = useSettingsStore((s) => s.openrouterPreflightResults)
  const runOpenRouterPreflight = useSettingsStore((s) => s.runOpenRouterPreflight)
  const selectedPreflight = (() => {
    const m = availableModels.find((x) => x.id === selectedModel)
    if (!m || m.provider !== 'openrouter') return null
    const r = openrouterPreflightResults[m.name]
    if (!r) return null
    return { model: m, result: r, desc: describePreflight(r) }
  })()

  const applyHybridAuthProfilesJson = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(hybridAuthProfilesJson)
    } catch {
      setHybridAuthProfilesError('Invalid JSON: expected an array of auth profile records.')
      return
    }
    if (!Array.isArray(parsed)) {
      setHybridAuthProfilesError('Expected an array of auth profile records.')
      return
    }
    const normalized = normalizeHybridAuthProfiles(parsed)
    if (normalized.length !== parsed.length) {
      setHybridAuthProfilesError(
        'One or more records were invalid and were not saved. Check lane-specific refs and required timestamps.'
      )
      return
    }
    setHybridAuthProfiles(normalized)
    setHybridAuthProfilesError(null)
  }

  return (
    <div className="space-y-5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <SettingsPageHeader
        title="Models & APIs"
        description="Connect providers and choose the default model. External orchestrator (Hermes bridge) options live under Agent → Hermes."
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-tile-border/80 bg-black/15 px-3 py-2">
        <p className="text-xs text-gray-500">
          {modelsOrchestratorLocked ? (
            <>
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-200">
                Locked
              </span>{' '}
              Provider keys and the default model stay dimmed while external orchestrator mode is active.{' '}
            </>
          ) : (
            <>API keys stay in this browser only. </>
          )}
          <button
            type="button"
            className="text-accent-teal/90 underline underline-offset-2 hover:text-accent-teal"
            onClick={() => openSettingsToSection('agent', { expandHermes: true })}
          >
            Agent → Hermes
          </button>{' '}
          for bridge and toggles.
        </p>
      </div>

      <div className={`rounded-xl border border-tile-border bg-black/15 p-4 ${lockClass}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <label
              htmlFor="models-orchestrator-quick-pick"
              className="block text-xs font-medium text-gray-300"
            >
              Default model (orchestrator)
            </label>
            <p className="text-[11px] leading-snug text-gray-500">
              This sets the main orchestrator model. Use <strong className="text-gray-400">Override All</strong> to
              copy it to sub-agent simple and complex routing. Does not change OpenRouter rate-limit fallback.
            </p>
            {availableModels.length > 0 ? (
              <select
                id="models-orchestrator-quick-pick"
                value={orchestratorQuickPickValue}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={modelsOrchestratorLocked}
                className="mt-2 w-full max-w-xl rounded-lg border border-tile-border bg-tile-bg px-3 py-2 text-sm text-white focus:border-accent-teal focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selectedModel &&
                selectedModel.trim() &&
                !availableModels.some((m) => m.id === selectedModel) ? (
                  <option value={selectedModel}>{selectedModel} (current)</option>
                ) : null}
                {availableModels.map((m) => (
                  <option key={`quick-pick-${m.id}`} value={m.id}>
                    {m.displayName} · {PROVIDER_INFO[m.provider].name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-2 text-xs text-amber-200/90">Enable a provider to choose a default orchestrator model.</p>
            )}
          </div>
          <button
            type="button"
            disabled={
              modelsOrchestratorLocked || availableModels.length === 0 || !selectedModel?.trim()
            }
            onClick={() => {
              const id = selectedModel?.trim()
              if (!id) return
              setSubAgentSimpleModelId(id)
              setSubAgentComplexModelId(id)
            }}
            className="shrink-0 rounded-lg border border-accent-teal/50 bg-accent-teal/15 px-4 py-2 text-sm font-medium text-accent-teal hover:bg-accent-teal/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Override All
          </button>
        </div>
      </div>

      {providers.openrouter.enabled && openrouterKeySaved ? (
        <div className={`space-y-4 rounded-xl border border-tile-border bg-black/10 p-4 ${lockClass}`}>
          <div>
            <h3 className="text-sm font-medium text-gray-200">OpenRouter</h3>
            <p className="mt-1 text-xs text-gray-500">
              Rate-limit fallback and primary model for OpenRouter. Add or rotate your key under{' '}
              <em>Providers &amp; keys</em> if this section is hidden.
            </p>
          </div>
          {toolReplyQuarantineUntil != null && toolReplyQuarantineUntil > Date.now() ? (
            <div className="rounded-lg border border-rose-500/35 bg-rose-950/25 px-3 py-2 text-xs text-rose-100/90">
              Default orchestrator model is temporarily quarantined after repeated empty tool replies (until{' '}
              {new Date(toolReplyQuarantineUntil).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
              ). Pick another model or rely on fallback below.
            </div>
          ) : null}
          {(() => {
            const until = getOpenRouterRateLimitFallbackUntilMs()
            if (until <= Date.now()) return null
            return (
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90">
                Fallback model active until{' '}
                {new Date(until).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </div>
            )
          })()}
          <div>
            <h4 className="text-xs font-medium text-gray-400">Rate limit fallback</h4>
            <p className="mt-1 text-xs text-gray-500">
              If the API returns HTTP 429 for your main model, Orca uses the fallback model for a short time. The
              same window is used when the model returns an empty tool reply (HTTP 200 but no tools/text).
            </p>
          </div>
          <SettingsToggleRow
            label="Use a temporary fallback on rate limit"
            hint="After a 429, requests use the fallback model for the duration you set. Your default model selection does not change."
            checked={openrouterRateLimitFallbackEnabled}
            onChange={setOpenrouterRateLimitFallbackEnabled}
          />
          <div>
            <label className="mb-1 block text-xs text-gray-500">Fallback model</label>
            {(() => {
              const fbId = openrouterRateLimitFallbackModelId.trim()
              const options: string[] = [...OPENROUTER_RATE_LIMIT_FALLBACK_MODEL_IDS]
              if (fbId && !options.includes(fbId)) options.push(fbId)
              return (
                <select
                  value={fbId || OPENROUTER_RATE_LIMIT_FALLBACK_MODEL_IDS[0]}
                  onChange={(e) => setOpenrouterRateLimitFallbackModelId(e.target.value)}
                  disabled={!openrouterRateLimitFallbackEnabled}
                  className="w-full rounded-lg border border-tile-border bg-tile-bg px-3 py-2 text-sm text-white focus:border-accent-teal focus:outline-none disabled:opacity-50"
                >
                  {options.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              )
            })()}
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">How long to use the fallback (minutes)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={openrouterRateLimitFallbackMinutes}
              disabled={!openrouterRateLimitFallbackEnabled}
              onChange={(e) => setOpenrouterRateLimitFallbackMinutes(Number(e.target.value))}
              className="w-full rounded-lg border border-tile-border bg-tile-bg px-3 py-2 text-sm text-white focus:border-accent-teal focus:outline-none disabled:opacity-50"
            />
          </div>

          {openrouterModels.length > 0 ? (
            <div className="border-t border-tile-border/60 pt-4">
              <label
                htmlFor="models-openrouter-primary-pick"
                className="mb-1 block text-xs font-medium text-gray-400"
              >
                OpenRouter model (orchestrator)
              </label>
              <p className="mb-2 text-[11px] leading-snug text-gray-500">
                Sets the default orchestrator model to this OpenRouter catalog entry. Other providers are unchanged.
              </p>
              <select
                id="models-openrouter-primary-pick"
                value={
                  selectedModelConfig?.provider === 'openrouter' ? orchestratorQuickPickValue : ''
                }
                onChange={(e) => {
                  const v = e.target.value
                  if (v) setSelectedModel(v)
                }}
                disabled={modelsOrchestratorLocked}
                className="w-full max-w-xl rounded-lg border border-tile-border bg-tile-bg px-3 py-2 text-sm text-white focus:border-accent-teal focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selectedModelConfig?.provider !== 'openrouter' ? (
                  <option value="">Select an OpenRouter model…</option>
                ) : null}
                {selectedModelConfig?.provider === 'openrouter' &&
                orchestratorQuickPickValue &&
                !openrouterModels.some((m) => m.id === orchestratorQuickPickValue) ? (
                  <option value={orchestratorQuickPickValue}>
                    {orchestratorQuickPickValue} (current)
                  </option>
                ) : null}
                {openrouterModels.map((m) => (
                  <option key={`or-primary-${m.id}`} value={m.id}>
                    {m.displayName} · {m.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="border-t border-tile-border/60 pt-4 text-xs text-amber-200/90">
              No OpenRouter models in the catalog yet — open <em>Providers &amp; keys</em> and refresh the OpenRouter
              model list.
            </p>
          )}
        </div>
      ) : null}

      <SettingsAccordion
        id="models-subagents-fallbacks"
        title="Sub-agents & fallbacks"
        description="Routing for delegated workers. OpenRouter rate-limit controls live above when OpenRouter is configured."
        defaultOpen
      >
        <div className={`space-y-5 ${lockClass}`}>
          <div className="rounded-xl border border-tile-border bg-black/15 p-4">
            <h3 className="text-sm font-medium text-gray-200">Sub-agents</h3>
            <p className="mt-1 text-xs text-gray-500">
              Routing for{' '}
              <code className="rounded bg-black/30 px-1 text-accent-teal/90">spawn_sub_agent</code> (simple vs
              complex tasks). Leave <em>Automatic</em> for defaults.
            </p>
            {toolCapableModels.length === 0 ? (
              <p className="mt-3 text-xs text-amber-200/90">
                Enable a provider with tool-capable models to customize sub-agent routing.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Simple tasks</label>
                  <select
                    value={subAgentSimpleModelId ?? ''}
                    onChange={(e) =>
                      setSubAgentSimpleModelId(e.target.value === '' ? null : e.target.value)
                    }
                    className="w-full rounded-lg border border-tile-border bg-tile-bg px-3 py-2 text-sm text-white focus:border-accent-teal focus:outline-none"
                  >
                    <option value="">Automatic (OpenRouter free when available)</option>
                    {toolCapableModels.map((m) => (
                      <option key={`sub-simple-${m.id}`} value={m.id}>
                        {m.displayName} · {PROVIDER_INFO[m.provider].name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Complex tasks</label>
                  <select
                    value={subAgentComplexModelId ?? ''}
                    onChange={(e) =>
                      setSubAgentComplexModelId(e.target.value === '' ? null : e.target.value)
                    }
                    className="w-full rounded-lg border border-tile-border bg-tile-bg px-3 py-2 text-sm text-white focus:border-accent-teal focus:outline-none"
                  >
                    <option value="">Same as main orchestrator model</option>
                    {toolCapableModels.map((m) => (
                      <option key={`sub-complex-${m.id}`} value={m.id}>
                        {m.displayName} · {PROVIDER_INFO[m.provider].name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="models-api-connections"
        title="Providers & keys"
        description="OpenAI, Anthropic, OpenRouter, Ollama, llama.cpp, and other backends."
        defaultOpen
      >
        <div className={lockClass}>
          <ProviderSettingsPanel
            showKey={showKey}
            setShowKey={setShowKey}
            localModelsBusy={localModelsBusy}
            runLocalModelFetch={runLocalModelFetch}
          />
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="models-auth-lanes"
        title="Hybrid auth lanes"
        description="Slice 5 auth profile records: OAuth refs, browser-session bundles, and hybrid router hints."
        defaultOpen={false}
      >
        <div className="space-y-3 rounded-xl border border-tile-border bg-black/15 p-4">
          <p className="text-xs text-gray-500">
            Store encrypted secret references only (for example <code className="rounded bg-black/30 px-1">secret://drive/token</code>). Each record requires{' '}
            <code className="rounded bg-black/30 px-1">id</code>, <code className="rounded bg-black/30 px-1">appId</code>, <code className="rounded bg-black/30 px-1">lane</code>,{' '}
            <code className="rounded bg-black/30 px-1">createdAt</code>, and <code className="rounded bg-black/30 px-1">updatedAt</code>.
          </p>
          <textarea
            value={hybridAuthProfilesJson}
            onChange={(e) => setHybridAuthProfilesJson(e.target.value)}
            className="min-h-[220px] w-full rounded-lg border border-tile-border bg-tile-bg px-3 py-2 font-mono text-xs text-gray-100 focus:border-accent-teal focus:outline-none"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Saved profiles: {hybridAuthProfiles.length}</span>
            <button
              type="button"
              onClick={applyHybridAuthProfilesJson}
              className="rounded-lg border border-accent-teal/50 bg-accent-teal/15 px-3 py-1.5 text-xs font-medium text-accent-teal hover:bg-accent-teal/25"
            >
              Validate + Save
            </button>
          </div>
          {hybridAuthProfilesError ? (
            <p className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {hybridAuthProfilesError}
            </p>
          ) : null}
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="models-default-orchestrator"
        title="Default orchestrator model"
        description="Main model for the orchestrator loop. Pick a tools-capable model when possible."
        defaultOpen
      >
        <div className={`space-y-4 ${lockClass}`}>
          {(providers.ollama.enabled || providers.llamacpp.enabled) && (
            <SettingsAccordion
              id="models-local-servers"
              title="Local models (Ollama / llama.cpp)"
              description="Refresh after starting local servers so pulled models appear in the list below."
              defaultOpen={false}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-tile-border bg-black/15 px-3 py-2">
                <p className="text-xs text-gray-500">
                  <strong className="text-gray-400">Local:</strong> refresh after{' '}
                  <code className="rounded bg-black/30 px-1">ollama serve</code> or{' '}
                  <code className="rounded bg-black/30 px-1">llama-server</code>.
                </p>
                <button
                  type="button"
                  disabled={localModelsBusy}
                  onClick={() => runLocalModelFetch('both')}
                  className="shrink-0 rounded-lg border border-tile-border bg-tile-bg px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-accent-teal/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {localModelsBusy ? 'Refreshing…' : 'Refresh local models'}
                </button>
              </div>
              {providers.ollama.enabled && (
                <p className="text-xs text-gray-500">
                  <strong className="text-gray-400">Ollama:</strong>{' '}
                  <code className="rounded bg-black/30 px-1">ollama pull &lt;model&gt;</code> then refresh.
                </p>
              )}
            </SettingsAccordion>
          )}

          {selectedPreflight && selectedPreflight.desc.tone === 'err' ? (
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[12px] leading-relaxed text-rose-100">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <strong className="font-semibold">Preflight failed for {selectedPreflight.model.displayName}.</strong>{' '}
                  {selectedPreflight.desc.long} Orca’s orchestrator loop needs tool calls — pick a different model.
                </div>
                <button
                  type="button"
                  onClick={() => void runOpenRouterPreflight(selectedPreflight.model.name, { force: true })}
                  className="shrink-0 rounded-md border border-rose-300/40 bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-100 transition-colors hover:bg-rose-500/30"
                >
                  Re-check
                </button>
              </div>
            </div>
          ) : null}

          {availableModels.length === 0 ? (
            <div className="rounded-lg border border-tile-border/80 bg-black/10 py-8 text-center text-gray-500">
              <p>No models available</p>
              <p className="mt-1 text-xs">Enable a provider above first.</p>
            </div>
          ) : (
            <div className={`space-y-2 ${scrollableModelListClass}`}>
              {availableModels.map((model) => {
                const providerInfo = PROVIDER_INFO[model.provider]
                const pre =
                  model.provider === 'openrouter'
                    ? openrouterPreflightResults[model.name]
                    : undefined
                const preDesc = describePreflight(pre)
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModel(model.id)}
                    className={`flex w-full items-center justify-between rounded-xl border p-4 transition-all ${
                      selectedModel === model.id
                        ? 'border-accent-teal bg-accent-teal/10'
                        : 'border-tile-border bg-black/15 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: providerInfo.color }} />
                      <div className="text-left">
                        <div className="text-sm font-medium text-gray-200">{model.displayName}</div>
                        <div className="text-xs text-gray-500">{providerInfo.name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {pre ? (
                        <span
                          data-tooltip={preDesc.long}
                          className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${
                            preDesc.tone === 'ok'
                              ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                              : preDesc.tone === 'warn'
                                ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                                : preDesc.tone === 'err'
                                  ? 'border-rose-400/40 bg-rose-500/15 text-rose-200'
                                  : 'border-white/15 text-gray-400'
                          }`}
                        >
                          {preDesc.short}
                        </span>
                      ) : null}
                      {selectedModel === model.id && (
                        <svg className="h-5 w-5 text-accent-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </SettingsAccordion>
    </div>
  )
}

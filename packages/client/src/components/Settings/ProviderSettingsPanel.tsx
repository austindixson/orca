import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  type Provider,
  OPENAI_CODEX_DEFAULT_MODEL_ID,
  PROVIDER_INFO,
  OPENROUTER_DEFAULT_BASE,
  XAI_DEFAULT_BASE,
  ZAI_DEFAULT_BASE,
  LLAMACPP_DEFAULT_BASE,
  MISTRAL_DEFAULT_BASE,
  GITHUB_COPILOT_DEFAULT_BASE,
  GOOGLE_VERTEX_OPENAI_DEFAULT_BASE,
  type ZaiPlanTier,
  isBuiltinOpenRouterModelSlug,
} from '../../store/settingsStore'
import { useSettingsStore } from '../../store/settingsStore'
import {
  getPiOAuthRegistryStatus,
  piOauthLoginAnthropic,
  piOauthLoginGoogleGeminiCli,
  piOauthLoginOpenaiCodex,
  type PiRegistryKeyStatus,
} from '../../lib/llmCredentials'
import { openPiCliInTerminal } from '../../lib/tauri'
import { DesktopOAuthSignInCard } from './DesktopOAuthSignInCard'
import { SettingsAccordion } from './settingsPrimitives'
import { describePreflight } from '../../lib/openrouterPreflight'

const GOOGLE_OPENAI_COMPAT_PLACEHOLDER = 'https://generativelanguage.googleapis.com/v1beta/openai'

/** Best-effort check for `vendor/model` or `vendor/model:tag` slugs. */
const OPENROUTER_SLUG_RE = /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i

function formatOpenRouterCatalogRelativeTime(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window || '__TAURI_IPC__' in window)
  )
}

function emitDebugLog(
  runId: string,
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  fetch('http://127.0.0.1:7696/ingest/d871edbc-ff39-4d74-96b8-887cea450cfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'eaa681' },
    body: JSON.stringify({
      sessionId: 'eaa681',
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}

const PROVIDER_GROUPS: {
  id: string
  title: string
  blurb: string
  providers: Provider[]
}[] = [
  {
    id: 'cloud',
    title: 'Cloud APIs',
    blurb:
      'First-party endpoints — keys you save here override environment variables; the desktop app can also use OAuth sessions from the sign-in area below.',
    providers: ['openai', 'openaiCodex', 'anthropic', 'google', 'xai'],
  },
  {
    id: 'gateways',
    title: 'Gateways & routing',
    blurb: 'Aggregate or regional APIs — one key, many models.',
    providers: ['openrouter', 'zai', 'hermes'],
  },
  {
    id: 'local',
    title: 'On-device',
    blurb: 'Runs on your machine — no cloud API key required.',
    providers: ['ollama', 'llamacpp'],
  },
  {
    id: 'enterprise-compat',
    title: 'Enterprise & compatible APIs',
    blurb:
      'OpenAI-compatible routes for Mistral, Azure OpenAI, GitHub Copilot, and Vertex, plus AWS Bedrock through the desktop shell.',
    providers: ['mistral', 'azureOpenai', 'githubCopilot', 'googleVertex', 'bedrock'],
  },
]

type ProviderSettingsPanelProps = {
  showKey: Record<Provider, boolean>
  setShowKey: Dispatch<SetStateAction<Record<Provider, boolean>>>
  localModelsBusy: boolean
  runLocalModelFetch: (which: 'both' | 'ollama' | 'llamacpp') => Promise<void>
}

export function ProviderSettingsPanel({
  showKey,
  setShowKey,
  localModelsBusy,
  runLocalModelFetch,
}: ProviderSettingsPanelProps) {
  const providers = useSettingsStore((s) => s.providers)
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig)
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel)
  const zaiPlanTier = useSettingsStore((s) => s.zaiPlanTier)
  const setZaiPlanTier = useSettingsStore((s) => s.setZaiPlanTier)
  const shellCredentialFlags = useSettingsStore((s) => s.shellCredentialFlags)
  const refreshShellCredentials = useSettingsStore((s) => s.refreshShellCredentials)
  const fetchOpenAiModels = useSettingsStore((s) => s.fetchOpenAiModels)
  const openAiCustomModelIds = useSettingsStore((s) => s.openaiCustomModelIds)
  const addOpenAiCustomModel = useSettingsStore((s) => s.addOpenAiCustomModel)
  const removeOpenAiCustomModel = useSettingsStore((s) => s.removeOpenAiCustomModel)
  const openrouterCustomModelIds = useSettingsStore((s) => s.openrouterCustomModelIds)
  const addOpenRouterCustomModel = useSettingsStore((s) => s.addOpenRouterCustomModel)
  const removeOpenRouterCustomModel = useSettingsStore((s) => s.removeOpenRouterCustomModel)
  const openrouterPreflightResults = useSettingsStore((s) => s.openrouterPreflightResults)
  const openrouterPreflightBusy = useSettingsStore((s) => s.openrouterPreflightBusy)
  const runOpenRouterPreflight = useSettingsStore((s) => s.runOpenRouterPreflight)
  const openrouterCatalog = useSettingsStore((s) => s.openrouterCatalog)
  const openrouterCatalogFetchedAt = useSettingsStore((s) => s.openrouterCatalogFetchedAt)
  const openrouterCatalogBusy = useSettingsStore((s) => s.openrouterCatalogBusy)
  const openrouterCatalogError = useSettingsStore((s) => s.openrouterCatalogError)
  const refreshOpenRouterCatalog = useSettingsStore((s) => s.refreshOpenRouterCatalog)
  const showSettings = useSettingsStore((s) => s.showSettings)
  const openSettingsToSection = useSettingsStore((s) => s.openSettingsToSection)
  const hermesApiBaseUrl = useSettingsStore((s) => s.hermesApiBaseUrl)
  const hermesModel = useSettingsStore((s) => s.hermesModel)

  const [piRegistry, setPiRegistry] = useState<PiRegistryKeyStatus[] | null>(null)
  const [piLoading, setPiLoading] = useState(false)
  const [piActionMsg, setPiActionMsg] = useState<string | null>(null)
  const [piTerminalBusy, setPiTerminalBusy] = useState(false)
  const [piOauthKind, setPiOauthKind] = useState<'anthropic' | 'openai' | 'google' | null>(null)
  const [openAiModelsBusy, setOpenAiModelsBusy] = useState(false)
  const [openAiCustomModelDraft, setOpenAiCustomModelDraft] = useState('')
  const [openRouterCatalogSearch, setOpenRouterCatalogSearch] = useState('')
  const [openRouterCustomDraft, setOpenRouterCustomDraft] = useState('')
  const [openRouterSlugHint, setOpenRouterSlugHint] = useState<string | null>(null)

  const openRouterCatalogFiltered = useMemo(() => {
    const q = openRouterCatalogSearch.trim().toLowerCase()
    if (!q) return openrouterCatalog
    return openrouterCatalog.filter(
      (e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    )
  }, [openrouterCatalog, openRouterCatalogSearch])

  const refreshOpenAiModels = useCallback(async () => {
    setOpenAiModelsBusy(true)
    try {
      await fetchOpenAiModels()
    } finally {
      setOpenAiModelsBusy(false)
    }
  }, [fetchOpenAiModels])

  const loadPiRegistry = useCallback(async () => {
    if (!isTauri()) {
      setPiRegistry(null)
      return
    }
    setPiLoading(true)
    try {
      const rows = await getPiOAuthRegistryStatus()
      setPiRegistry(rows)
      // #region agent log
      emitDebugLog('oauth-claude-auth-flow', 'H1', 'ProviderSettingsPanel.tsx:185', 'Pi auth registry refreshed', {
        anthropicPresent: !!rows?.find((r) => r.key === 'anthropic')?.present,
        openaiCodexPresent: !!rows?.find((r) => r.key === 'openai-codex')?.present,
        googleGeminiCliPresent: !!rows?.find((r) => r.key === 'google-gemini-cli')?.present,
        totalKeys: rows?.length ?? 0,
      })
      // #endregion
      await refreshShellCredentials()
    } catch {
      setPiRegistry(null)
    } finally {
      setPiLoading(false)
    }
  }, [refreshShellCredentials])

  useEffect(() => {
    if (!showSettings) return
    void refreshShellCredentials()
  }, [showSettings, refreshShellCredentials])

  useEffect(() => {
    if (!showSettings) return
    void loadPiRegistry()
  }, [showSettings, loadPiRegistry])

  useEffect(() => {
    if (!showSettings || !providers.openai.enabled) return
    void refreshOpenAiModels()
  }, [showSettings, providers.openai.enabled, providers.openai.apiKey, providers.openai.baseUrl, refreshOpenAiModels])

  // Fire preflight tool-use probes for every custom OpenRouter slug we don't
  // already have a fresh result for. Runs when the Settings pane opens or when
  // the OpenRouter credentials change — so flipping to a new key invalidates
  // stale auth results without the user having to click each chip.
  useEffect(() => {
    if (!showSettings) return
    if (!providers.openrouter.enabled) return
    const apiKey = providers.openrouter.apiKey?.trim()
    if (!apiKey) return
    for (const slug of openrouterCustomModelIds) {
      const cached = openrouterPreflightResults[slug]
      const stale = !cached || Date.now() - cached.checkedAt > 10 * 60 * 1000
      if (stale && !openrouterPreflightBusy[slug]) {
        void runOpenRouterPreflight(slug)
      }
    }
    // We intentionally omit openrouterPreflightBusy / Results from deps: they
    // change as probes resolve and would re-trigger this loop. Keying off the
    // slug list + credentials is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showSettings,
    providers.openrouter.enabled,
    providers.openrouter.apiKey,
    openrouterCustomModelIds,
    runOpenRouterPreflight,
  ])

  const PreflightBadge = ({
    slug,
    compact = false,
  }: {
    slug: string
    compact?: boolean
  }) => {
    const busy = !!openrouterPreflightBusy[slug]
    const result = openrouterPreflightResults[slug]
    const { tone, short, long } = describePreflight(result)
    const apiKey = providers.openrouter.apiKey?.trim()
    const toneClass =
      tone === 'ok'
        ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200'
        : tone === 'warn'
          ? 'border-amber-400/35 bg-amber-500/15 text-amber-200'
          : tone === 'err'
            ? 'border-rose-400/35 bg-rose-500/15 text-rose-200'
            : 'border-white/15 bg-white/[0.04] text-gray-400'
    const label = busy ? 'Checking…' : short
    return (
      <span
        data-tooltip={busy ? 'Probing OpenRouter for tool-use support…' : long}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 ${compact ? 'py-[1px] text-[9px]' : 'py-0.5 text-[10px]'} font-semibold ${toneClass}`}
      >
        {label}
        {!busy && apiKey ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              void runOpenRouterPreflight(slug, { force: true })
            }}
            data-tooltip="Re-run preflight"
            className="-mr-0.5 rounded-full px-1 text-[9px] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            ↻
          </button>
        ) : null}
      </span>
    )
  }

  const credentialHint = (p: Provider) => {
    const ui = !!(providers[p].apiKey && providers[p].apiKey.trim())
    const shell = !!shellCredentialFlags[p]
    if (ui) return { label: 'Stored key', tone: 'teal' as const }
    if (shell) return { label: 'Env / shell', tone: 'emerald' as const }
    if (PROVIDER_INFO[p].requiresKey) return { label: 'Needs key', tone: 'zinc' as const }
    return { label: 'Ready', tone: 'slate' as const }
  }

  const renderProviderFields = (provider: Provider) => {
    const info = PROVIDER_INFO[provider]
    const config = providers[provider]
    const hint = credentialHint(provider)

    return (
      <div
        key={provider}
        className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.05] to-transparent shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
      >
        <div
          className="absolute left-0 top-0 h-full w-1 rounded-l-2xl opacity-90"
          style={{ backgroundColor: info.color }}
          aria-hidden
        />
        <div className="pl-5 pr-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-['Syne',sans-serif] text-[15px] font-semibold tracking-tight text-gray-100">
                  {info.name}
                </h4>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                    hint.tone === 'teal'
                      ? 'bg-accent-teal/15 text-accent-teal'
                      : hint.tone === 'emerald'
                        ? 'bg-emerald-500/15 text-emerald-300/95'
                        : hint.tone === 'zinc'
                          ? 'bg-white/5 text-gray-500'
                          : 'bg-white/5 text-gray-400'
                  }`}
                >
                  {hint.label}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                {provider === 'openai' && (
                  <>
                    OpenAI Platform API provider. Use an <code className="text-gray-400">openai</code> API key for
                    standard OpenAI endpoints and for canvas orchestrator tool calling on Platform models.
                    ChatGPT/Codex OAuth is separate — use the <strong className="text-gray-400">OpenAI Codex</strong>{' '}
                    provider below and pick a Codex model in the orchestrator bar.
                  </>
                )}
                {provider === 'openaiCodex' && (
                  <>
                    ChatGPT Plus/Pro Codex backend via <code className="text-gray-400">openai-codex</code> OAuth.
                    Orca routes this provider to the ChatGPT Codex backend instead of the standard OpenAI Platform
                    API. Use the sign-in card above to connect; choose <strong className="text-gray-400">OpenAI Codex</strong>{' '}
                    models in the orchestrator bar for tool use. Do not expect Platform OAuth on the OpenAI provider to
                    run the same Codex tool path.
                  </>
                )}
                {provider === 'anthropic' && (
                  <>
                    Env <code className="text-gray-400">ANTHROPIC_OAUTH_TOKEN</code> or desktop Claude OAuth when the
                    field is empty. If you signed in with OAuth, clear any leftover characters in the key field
                    unless you are using a Console <code className="text-gray-400">sk-ant-api…</code> key.
                  </>
                )}
                {provider === 'google' && (
                  <>
                    Orchestrator uses Gemini’s OpenAI-compatible API. Env{' '}
                    <code className="text-gray-400">GEMINI_API_KEY</code> or{' '}
                    <code className="text-gray-400">GOOGLE_API_KEY</code>.
                  </>
                )}
                {provider === 'openrouter' && 'Unified OpenRouter catalog; optional base URL override.'}
                {provider === 'zai' && 'Z.AI Coding API — tier below matches subscription concurrency.'}
                {provider === 'hermes' && (
                  <>
                    Tools-capable Hermes gateway (<code className="text-gray-400">/v1/responses</code>) or Z.AI OpenAI
                    base when Integrations point at <code className="text-gray-400">api.z.ai</code>. Base URL, model id,
                    and Bearer live under <strong className="text-gray-400">Integrations</strong> → Hermes API — enable
                    here, then choose <strong className="text-gray-400">Hermes (…)</strong> in Default model.
                  </>
                )}
                {provider === 'ollama' && 'Local pull / run; refresh list after `ollama serve`.'}
                {provider === 'llamacpp' && 'llama-server OpenAI-compatible endpoint; default port 8000.'}
                {provider === 'mistral' && (
                  <>
                    OpenAI-compatible <code className="text-gray-400">/v1/chat/completions</code> at{' '}
                    <code className="text-gray-400">api.mistral.ai</code> (Mistral’s chat API via the compat surface).
                  </>
                )}
                {provider === 'azureOpenai' && (
                  <>
                    Azure resource endpoint + deployment; optional Responses API aligned with{' '}
                    <code className="text-gray-400">azure-openai-responses</code>.
                  </>
                )}
                {provider === 'githubCopilot' && (
                  <>
                    <code className="text-gray-400">github-copilot</code> token; Orca sends Copilot-compatible headers
                    to the configured base URL.
                  </>
                )}
                {provider === 'googleVertex' && (
                  <>
                    Vertex OpenAI-compatible gateway URL (region + project path). Env{' '}
                    <code className="text-gray-400">GOOGLE_CLOUD_ACCESS_TOKEN</code> or API key in Settings.
                  </>
                )}
                {provider === 'bedrock' && (
                  <>
                    Claude on Bedrock via the desktop app (<code className="text-gray-400">bedrock_invoke_model</code>
                    ). Set AWS credentials in the environment; base URL field stores the AWS region id (e.g.{' '}
                    <code className="text-gray-400">us-east-1</code>).
                  </>
                )}
              </p>
            </div>
            <label className="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => {
                  const enabled = e.target.checked
                  setProviderConfig(provider, { enabled })
                  if (provider === 'openaiCodex' && enabled) {
                    setSelectedModel(OPENAI_CODEX_DEFAULT_MODEL_ID)
                  }
                }}
                className="peer sr-only"
              />
              <div className="h-6 w-11 rounded-full bg-gray-700 peer-focus:outline-none peer-checked:bg-accent-teal after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full" />
            </label>
          </div>

          {config.enabled && (
            <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
              {provider === 'openai' && (
                <div className="space-y-3 rounded-xl border border-white/[0.05] bg-black/15 px-3 py-2.5">
                  <div className="space-y-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      Auth mode
                    </div>
                    <div className="inline-flex rounded-lg border border-white/10 bg-black/20 p-1">
                      <button
                        type="button"
                        onClick={() => setProviderConfig('openai', { authMode: 'oauth' })}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          (config.authMode ?? 'oauth') === 'oauth'
                            ? 'bg-accent-teal/20 text-accent-teal'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        OAuth
                      </button>
                      <button
                        type="button"
                        onClick={() => setProviderConfig('openai', { authMode: 'apiKey' })}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          config.authMode === 'apiKey'
                            ? 'bg-accent-teal/20 text-accent-teal'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        API key
                      </button>
                    </div>
                    <div className="text-[11px] leading-relaxed text-gray-500">
                      {(config.authMode ?? 'oauth') === 'oauth'
                        ? 'Catalog / listing compatibility. Account-linked models may appear in the picker, but orchestrator tool execution on Platform endpoints needs an API key here. For ChatGPT/Codex OAuth and codex-* models, use the OpenAI Codex provider + Codex sign-in.'
                        : 'Use the API key field and OpenAI API billing/scopes.'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] leading-relaxed text-gray-500">
                      Pull live OpenAI models from your authenticated account so the picker matches your current plan.
                    </div>
                    <button
                      type="button"
                      disabled={openAiModelsBusy}
                      onClick={() => void refreshOpenAiModels()}
                      className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-accent-teal/35 hover:text-white disabled:opacity-50"
                    >
                      {openAiModelsBusy ? 'Refreshing…' : 'Refresh models'}
                    </button>
                  </div>

                  <div className="border-t border-white/[0.05] pt-3">
                    <div className="text-[11px] leading-relaxed text-gray-500">
                      If OpenAI OAuth only returns a partial catalog, add any exact model id from your plan manually.
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={openAiCustomModelDraft}
                        onChange={(e) => setOpenAiCustomModelDraft(e.target.value)}
                        placeholder="e.g. gpt-5, o3, o4-mini, codex-mini-latest"
                        className="min-w-[18rem] flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-600 focus:border-accent-teal/45"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = openAiCustomModelDraft.trim()
                          if (!next) return
                          addOpenAiCustomModel(next)
                          setOpenAiCustomModelDraft('')
                        }}
                        className="shrink-0 rounded-lg border border-accent-teal/35 bg-accent-teal/[0.14] px-3 py-1.5 text-xs font-semibold text-accent-teal transition-colors hover:border-accent-teal/55 hover:bg-accent-teal/20"
                      >
                        Add model
                      </button>
                    </div>
                    {openAiCustomModelIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {openAiCustomModelIds.map((modelId) => (
                          <span
                            key={modelId}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-gray-300"
                          >
                            <span className="font-['IBM_Plex_Mono',monospace] text-[10px] text-gray-400">{modelId}</span>
                            <button
                              type="button"
                              onClick={() => removeOpenAiCustomModel(modelId)}
                              className="text-gray-500 transition-colors hover:text-white"
                              data-tooltip={`Remove ${modelId}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {provider === 'openaiCodex' && (
                <div className="space-y-2 rounded-xl border border-white/[0.05] bg-black/15 px-3 py-2.5">
                  <div className="text-[11px] leading-relaxed text-gray-500">
                    Uses the ChatGPT Codex backend with your desktop OAuth session. Leave the key field empty if you
                    signed in below; Orca will read the token from your local auth store automatically.
                  </div>
                </div>
              )}

              {provider === 'hermes' && (
                <div className="rounded-xl border border-teal-500/25 bg-teal-950/20 px-3 py-2.5 text-[11px] leading-relaxed text-gray-400">
                  <div className="text-gray-300">
                    Hermes API (shared with <code className="text-gray-500">hermes_agent</code> tile)
                  </div>
                  <div className="mt-1 font-['IBM_Plex_Mono',monospace] text-[10px] text-gray-500">
                    base {hermesApiBaseUrl}
                  </div>
                  <div className="font-['IBM_Plex_Mono',monospace] text-[10px] text-gray-500">model {hermesModel}</div>
                  <button
                    type="button"
                    className="mt-2 text-accent-teal/90 underline-offset-2 hover:underline"
                    onClick={() => openSettingsToSection('integrations')}
                  >
                    Edit in Integrations → Hermes API
                  </button>
                </div>
              )}
              {info.requiresKey && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    API key
                  </label>
                  <div className="relative">
                    <input
                      type={showKey[provider] ? 'text' : 'password'}
                      value={config.apiKey || ''}
                      onChange={(e) => setProviderConfig(provider, { apiKey: e.target.value })}
                      placeholder={
                        provider === 'google'
                          ? 'Optional if GEMINI_API_KEY or desktop OAuth is set'
                          : `Enter ${info.name} API key`
                      }
                      className="w-full rounded-xl border border-tile-border bg-tile-bg/80 px-3 py-2.5 pr-10 font-['IBM_Plex_Mono',monospace] text-sm text-white placeholder:text-gray-600 focus:border-accent-teal/80 focus:outline-none focus:ring-1 focus:ring-accent-teal/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey({ ...showKey, [provider]: !showKey[provider] })}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-gray-300"
                      aria-label={showKey[provider] ? 'Hide key' : 'Show key'}
                    >
                      {showKey[provider] ? (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {(provider === 'openai' || provider === 'azureOpenai') && (
                <div className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={
                        provider === 'openai' && (config.authMode ?? 'oauth') === 'oauth'
                          ? false
                          : !!config.useResponsesApi
                      }
                      disabled={provider === 'openai' && (config.authMode ?? 'oauth') === 'oauth'}
                      onChange={(e) => setProviderConfig(provider, { useResponsesApi: e.target.checked })}
                      className="mt-0.5 rounded border-white/20 bg-tile-bg"
                    />
                    <span className="text-[11px] leading-relaxed text-gray-400">
                      <span className="font-medium text-gray-300">Use Responses API</span> —{' '}
                      <code className="text-gray-500">/v1/responses</code> instead of chat/completions (
                      {provider === 'openai' ? 'openai-responses' : 'azure-openai-responses'} style).{' '}
                      {provider === 'openai' && (config.authMode ?? 'oauth') === 'oauth'
                        ? 'Disabled in OAuth mode because those sessions may not include `api.responses.write`.'
                        : ''}
                    </span>
                  </label>
                  {provider === 'azureOpenai' && (
                    <div>
                      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                        Deployment name
                      </label>
                      <input
                        type="text"
                        value={config.azureDeployment || ''}
                        onChange={(e) => setProviderConfig('azureOpenai', { azureDeployment: e.target.value })}
                        placeholder="e.g. gpt-4o-deployment"
                        className="w-full rounded-xl border border-tile-border bg-tile-bg/80 px-3 py-2 font-['IBM_Plex_Mono',monospace] text-sm text-white placeholder:text-gray-600 focus:border-accent-teal/80 focus:outline-none focus:ring-1 focus:ring-accent-teal/30"
                      />
                      <p className="mt-1 text-[10px] text-gray-600">
                        Used in <code className="text-gray-500">/openai/deployments/{'{name}'}/…</code> paths.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {(provider === 'ollama' ||
                provider === 'openrouter' ||
                provider === 'xai' ||
                provider === 'zai' ||
                provider === 'llamacpp' ||
                provider === 'anthropic' ||
                provider === 'google' ||
                provider === 'mistral' ||
                provider === 'azureOpenai' ||
                provider === 'githubCopilot' ||
                provider === 'googleVertex' ||
                provider === 'bedrock') && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    {provider === 'bedrock' ? (
                      'AWS region'
                    ) : (
                      <>
                        Base URL {info.baseUrlOptional && <span className="text-gray-600">(optional)</span>}
                      </>
                    )}
                  </label>
                  {provider === 'zai' && (
                    <div className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/90">
                      <p className="font-['Syne',sans-serif] text-xs font-semibold text-amber-50/95">Z.AI API</p>
                      <p className="mt-1 text-amber-100/80">
                        Default: <code className="rounded bg-black/35 px-1 py-0.5">{ZAI_DEFAULT_BASE}</code>
                      </p>
                      <label className="mt-2 block text-[11px] text-amber-100/85">
                        GLM Coding Plan tier
                        <select
                          value={zaiPlanTier}
                          onChange={(e) => setZaiPlanTier(e.target.value as ZaiPlanTier)}
                          className="mt-1.5 block w-full rounded-lg border border-amber-500/25 bg-black/30 px-2 py-2 text-xs text-amber-50 focus:border-accent-teal/60 focus:outline-none"
                        >
                          <option value="lite">Lite — lower concurrency</option>
                          <option value="pro">Pro — balanced</option>
                          <option value="max">Max — higher concurrency</option>
                        </select>
                      </label>
                    </div>
                  )}
                  {provider === 'llamacpp' && (
                    <div className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/90">
                      <p className="font-['Syne',sans-serif] text-xs font-semibold text-amber-50/95">
                        llama.cpp local server
                      </p>
                      <p className="mt-1 text-amber-100/80">
                        Run <code className="rounded bg-black/35 px-1">llama-server</code> (e.g.{' '}
                        <code className="rounded bg-black/35 px-1">brew install llama.cpp</code>) — OpenAI-compatible{' '}
                        <code className="rounded bg-black/35 px-1">/v1</code> on your port.
                      </p>
                      <p className="mt-1.5 text-amber-200/70">
                        See{' '}
                        <a
                          href="https://github.com/walter-grace/mac-code"
                          className="text-amber-200 underline-offset-2 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          mac-code
                        </a>{' '}
                        for Qwen-optimized configs.
                      </p>
                    </div>
                  )}
                  <input
                    type="text"
                    value={config.baseUrl || ''}
                    onChange={(e) => setProviderConfig(provider, { baseUrl: e.target.value })}
                    placeholder={
                      provider === 'ollama'
                        ? 'http://localhost:11434'
                        : provider === 'zai'
                          ? ZAI_DEFAULT_BASE
                          : provider === 'xai'
                            ? XAI_DEFAULT_BASE
                          : provider === 'llamacpp'
                            ? LLAMACPP_DEFAULT_BASE
                            : provider === 'anthropic'
                              ? 'https://api.anthropic.com'
                              : provider === 'google'
                                ? GOOGLE_OPENAI_COMPAT_PLACEHOLDER
                                : provider === 'mistral'
                                  ? MISTRAL_DEFAULT_BASE
                                  : provider === 'azureOpenai'
                                    ? 'https://YOUR_RESOURCE.openai.azure.com'
                                    : provider === 'githubCopilot'
                                      ? GITHUB_COPILOT_DEFAULT_BASE
                                      : provider === 'googleVertex'
                                        ? GOOGLE_VERTEX_OPENAI_DEFAULT_BASE
                                        : provider === 'bedrock'
                                          ? 'us-east-1'
                                          : OPENROUTER_DEFAULT_BASE
                    }
                    className="w-full rounded-xl border border-tile-border bg-tile-bg/80 px-3 py-2.5 font-['IBM_Plex_Mono',monospace] text-sm text-white placeholder:text-gray-600 focus:border-accent-teal/80 focus:outline-none focus:ring-1 focus:ring-accent-teal/30"
                  />
                  {(provider === 'openrouter' || provider === 'zai' || provider === 'xai') && (
                    <p className="mt-1.5 text-[11px] text-gray-600">
                      Override only if your workspace uses a custom gateway.
                    </p>
                  )}
                  {provider === 'openrouter' && (
                    <div className="mt-4 space-y-4 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] px-3 py-3">
                      <details
                        className="group rounded-lg border border-white/[0.06] bg-black/20"
                        onToggle={(e) => {
                          const el = e.currentTarget
                          if (
                            el.open &&
                            openrouterCatalog.length === 0 &&
                            !openrouterCatalogBusy
                          ) {
                            void refreshOpenRouterCatalog()
                          }
                        }}
                      >
                        <summary className="cursor-pointer list-none px-3 py-2.5 font-medium text-gray-200 outline-none [&::-webkit-details-marker]:hidden">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span>Browse OpenRouter catalog</span>
                            <span className="text-gray-500 transition group-open:rotate-180">
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M6 9l6 6 6-6" />
                              </svg>
                            </span>
                          </span>
                          <p className="mt-1 text-[11px] font-normal text-gray-500">
                            Live list from{' '}
                            <code className="rounded bg-black/35 px-1 text-[10px]">openrouter.ai/api/v1/models</code>
                            {openrouterCatalogFetchedAt != null ? (
                              <>
                                {' '}
                                · updated {formatOpenRouterCatalogRelativeTime(openrouterCatalogFetchedAt)}
                              </>
                            ) : null}
                          </p>
                        </summary>
                        <div className="space-y-2 border-t border-white/[0.06] px-3 pb-3 pt-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <input
                              type="search"
                              value={openRouterCatalogSearch}
                              onChange={(e) => setOpenRouterCatalogSearch(e.target.value)}
                              placeholder="Filter by slug or name…"
                              className="min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-accent-teal/45"
                            />
                            <button
                              type="button"
                              disabled={openrouterCatalogBusy}
                              onClick={() => void refreshOpenRouterCatalog()}
                              className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-accent-teal/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {openrouterCatalogBusy ? 'Refreshing…' : 'Refresh'}
                            </button>
                          </div>
                          {openrouterCatalogError ? (
                            <p className="text-[11px] text-amber-200/90">{openrouterCatalogError}</p>
                          ) : null}
                          {openrouterCatalogBusy && openrouterCatalog.length === 0 ? (
                            <p className="py-6 text-center text-[11px] text-gray-500">Loading catalog…</p>
                          ) : openRouterCatalogFiltered.length === 0 ? (
                            <p className="py-4 text-center text-[11px] text-gray-500">
                              {openrouterCatalog.length === 0
                                ? 'Open to load the catalog, or use Add model below.'
                                : 'No matches for this filter.'}
                            </p>
                          ) : (
                            <ul className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-white/[0.05] bg-black/20 p-1">
                              {openRouterCatalogFiltered.map((row) => {
                                const added =
                                  isBuiltinOpenRouterModelSlug(row.id) ||
                                  openrouterCustomModelIds.includes(row.id)
                                const prompt = row.pricing?.prompt
                                const completion = row.pricing?.completion
                                return (
                                  <li
                                    key={row.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-white/[0.04]"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="font-['IBM_Plex_Mono',monospace] text-[10px] text-cyan-200/90">
                                        {row.id}
                                      </div>
                                      <div className="truncate text-gray-400">{row.name}</div>
                                      <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] text-gray-500">
                                        {row.contextLength != null ? (
                                          <span className="rounded bg-black/35 px-1">
                                            ctx {row.contextLength.toLocaleString()}
                                          </span>
                                        ) : null}
                                        {prompt != null ? (
                                          <span className="rounded bg-black/35 px-1">in {prompt}</span>
                                        ) : null}
                                        {completion != null ? (
                                          <span className="rounded bg-black/35 px-1">out {completion}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      <PreflightBadge slug={row.id} compact />
                                      <button
                                        type="button"
                                        disabled={added}
                                        onClick={() => {
                                          addOpenRouterCustomModel(row.id)
                                          void runOpenRouterPreflight(row.id)
                                        }}
                                        className="rounded-md border border-accent-teal/35 bg-accent-teal/[0.12] px-2 py-1 text-[10px] font-semibold text-accent-teal transition-colors hover:border-accent-teal/55 hover:bg-accent-teal/18 disabled:cursor-default disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-gray-500"
                                      >
                                        {added ? 'Added' : 'Add'}
                                      </button>
                                    </div>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>
                      </details>

                      <div className="border-t border-white/[0.06] pt-3">
                        <div className="text-[11px] leading-relaxed text-gray-500">
                          Add model slugs to your picker (comma- or newline-separated). They appear under{' '}
                          <strong className="text-gray-400">Settings → Models → Default model &amp; sub-agents</strong>.
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <input
                            type="text"
                            value={openRouterCustomDraft}
                            onChange={(e) => {
                              setOpenRouterCustomDraft(e.target.value)
                              setOpenRouterSlugHint(null)
                            }}
                            placeholder="anthropic/claude-sonnet-4.5, openai/gpt-5-codex, x-ai/grok-code-fast-2:free"
                            className="min-w-[18rem] flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-600 focus:border-accent-teal/45"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const raw = openRouterCustomDraft.trim()
                              if (!raw) return
                              const parts = raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
                              const invalid = parts.filter((p) => !OPENROUTER_SLUG_RE.test(p))
                              if (invalid.length > 0) {
                                setOpenRouterSlugHint(
                                  `Some entries don’t match vendor/model format (still added): ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}`
                                )
                              } else {
                                setOpenRouterSlugHint(null)
                              }
                              addOpenRouterCustomModel(raw)
                              setOpenRouterCustomDraft('')
                              for (const p of parts) {
                                if (OPENROUTER_SLUG_RE.test(p)) void runOpenRouterPreflight(p)
                              }
                            }}
                            className="shrink-0 rounded-lg border border-accent-teal/35 bg-accent-teal/[0.14] px-3 py-1.5 text-xs font-semibold text-accent-teal transition-colors hover:border-accent-teal/55 hover:bg-accent-teal/20"
                          >
                            Add model
                          </button>
                        </div>
                        {openRouterSlugHint ? (
                          <p className="mt-1.5 text-[11px] text-amber-200/85">{openRouterSlugHint}</p>
                        ) : null}
                        {openrouterCustomModelIds.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {openrouterCustomModelIds.map((slug) => (
                              <span
                                key={slug}
                                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-gray-300"
                              >
                                <span className="font-['IBM_Plex_Mono',monospace] text-[10px] text-gray-400">
                                  {slug}
                                </span>
                                <PreflightBadge slug={slug} compact />
                                <button
                                  type="button"
                                  onClick={() => removeOpenRouterCustomModel(slug)}
                                  className="text-gray-500 transition-colors hover:text-white"
                                  data-tooltip={`Remove ${slug}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {provider === 'anthropic' && (
                    <p className="mt-1.5 text-[11px] text-gray-600">
                      Default <code className="text-gray-500">https://api.anthropic.com</code> — or{' '}
                      <code className="text-gray-500">ANTHROPIC_BASE_URL</code>.
                    </p>
                  )}
                  {provider === 'google' && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-gray-600">
                      Gemini OpenAI-compatible root; env{' '}
                      <code className="text-gray-500">GOOGLE_GENAI_BASE_URL</code> /{' '}
                      <code className="text-gray-500">GEMINI_BASE_URL</code> override this.
                    </p>
                  )}
                  {provider === 'llamacpp' && (
                    <p className="mt-1.5 text-[11px] text-gray-600">
                      Default <code className="text-gray-500">{LLAMACPP_DEFAULT_BASE}</code>
                    </p>
                  )}
                  {(provider === 'ollama' || provider === 'llamacpp') && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={localModelsBusy}
                        onClick={() => runLocalModelFetch(provider === 'ollama' ? 'ollama' : 'llamacpp')}
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-accent-teal/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {localModelsBusy ? 'Refreshing…' : 'Refresh model list'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Intro + legend */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[radial-gradient(120%_80%_at_0%_0%,rgba(0,212,170,0.12),transparent),radial-gradient(80%_60%_at_100%_20%,rgba(59,130,246,0.08),transparent)] px-5 py-4">
        <div className="pointer-events-none absolute inset-0 opacity-[0.35] mix-blend-overlay [background-image:repeating-linear-gradient(-45deg,transparent,transparent_3px,rgba(255,255,255,0.02)_3px,rgba(255,255,255,0.02)_6px)]" />
        <div className="relative">
          <h3 className="font-['Syne',sans-serif] text-lg font-bold tracking-tight text-white">
            Model providers
          </h3>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-gray-400">
            Choose who powers the orchestrator. Keys you save here take precedence over your shell environment; the
            desktop app can also use OAuth sessions from the sign-in card below (stored locally for Claude, ChatGPT
            Codex, and Google Gemini CLI).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-accent-teal/25 bg-accent-teal/10 px-2.5 py-1 text-[11px] font-medium text-accent-teal">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-teal shadow-[0_0_8px_rgba(0,212,170,0.8)]" />
              Stored key wins
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300/95">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Env / .env
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-300/90">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              Desktop OAuth
            </span>
          </div>
        </div>
      </div>

      {isTauri() && (
        <DesktopOAuthSignInCard
          loading={piLoading}
          registry={piRegistry}
          oauthKind={piOauthKind}
          terminalBusy={piTerminalBusy}
          actionMsg={piActionMsg}
          onRefresh={() => void loadPiRegistry()}
          onSignInAnthropic={() => {
            setPiActionMsg(null)
            setPiOauthKind('anthropic')
            void piOauthLoginAnthropic()
              .then(() => {
                setProviderConfig('anthropic', { enabled: true })
                setPiActionMsg(
                  'Claude (Anthropic) OAuth saved. Provider enabled — pick a Claude model in the orchestrator bar.',
                )
                return loadPiRegistry()
              })
              .catch((e: unknown) =>
                setPiActionMsg(
                  typeof e === 'string' ? e : e instanceof Error ? e.message : 'Anthropic OAuth failed.',
                ),
              )
              .finally(() => setPiOauthKind(null))
          }}
          onSignInOpenaiCodex={() => {
            setPiActionMsg(null)
            setPiOauthKind('openai')
            void piOauthLoginOpenaiCodex()
              .then(() => {
                setProviderConfig('openaiCodex', { enabled: true })
                setSelectedModel(OPENAI_CODEX_DEFAULT_MODEL_ID)
                setPiActionMsg(
                  'OpenAI Codex OAuth saved. Provider enabled — pick an OpenAI Codex model in the orchestrator bar.',
                )
                return loadPiRegistry()
              })
              .catch((e: unknown) =>
                setPiActionMsg(
                  typeof e === 'string' ? e : e instanceof Error ? e.message : 'OpenAI Codex OAuth failed.',
                ),
              )
              .finally(() => setPiOauthKind(null))
          }}
          onSignInGoogleGemini={() => {
            setPiActionMsg(null)
            setPiOauthKind('google')
            void piOauthLoginGoogleGeminiCli()
              .then(() => {
                setProviderConfig('google', { enabled: true })
                setPiActionMsg(
                  'Google (Gemini CLI) OAuth saved. Provider enabled — pick a Gemini model in the orchestrator bar.',
                )
                return loadPiRegistry()
              })
              .catch((e: unknown) =>
                setPiActionMsg(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Google OAuth failed.'),
              )
              .finally(() => setPiOauthKind(null))
          }}
          onOpenCliInTerminal={() => {
            setPiActionMsg(null)
            setPiTerminalBusy(true)
            void openPiCliInTerminal()
              .then(() =>
                setPiActionMsg(
                  'Opened Terminal — in the CLI prompt, run /login and choose your provider.',
                ),
              )
              .catch((e: unknown) =>
                setPiActionMsg(
                  typeof e === 'string'
                    ? e
                    : e instanceof Error
                      ? e.message
                      : 'Could not open Terminal for CLI login. Open a terminal, run the CLI, then /login.',
                ),
              )
              .finally(() => setPiTerminalBusy(false))
          }}
        />
      )}

      {PROVIDER_GROUPS.map((group) =>
        group.id === 'local' ? (
          <SettingsAccordion
            key={group.id}
            id="provider-group-on-device"
            title={group.title}
            description={group.blurb}
            defaultOpen={false}
          >
            <div className="space-y-3">{group.providers.map((p) => renderProviderFields(p))}</div>
          </SettingsAccordion>
        ) : (
          <section key={group.id} className="space-y-3" aria-labelledby={`provider-group-${group.id}`}>
            <div className="flex flex-col gap-0.5 border-b border-white/[0.06] pb-2">
              <h3
                id={`provider-group-${group.id}`}
                className="font-['Syne',sans-serif] text-xs font-bold uppercase tracking-[0.22em] text-gray-500"
              >
                {group.title}
              </h3>
              <p className="text-[11px] text-gray-600">{group.blurb}</p>
            </div>
            <div className="space-y-3">{group.providers.map((p) => renderProviderFields(p))}</div>
          </section>
        )
      )}

      <p className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 text-[11px] leading-relaxed text-gray-500">
        <strong className="font-medium text-gray-400">Z.AI env:</strong>{' '}
        <code className="font-['IBM_Plex_Mono',monospace] text-gray-500">ZAI_API_KEY</code> per official SDK; also{' '}
        <code className="font-['IBM_Plex_Mono',monospace] text-gray-500">GLM_API_KEY</code> /{' '}
        <code className="font-['IBM_Plex_Mono',monospace] text-gray-500">ZHIPU_API_KEY</code> for OpenClaw / Hermes.
      </p>
    </div>
  )
}

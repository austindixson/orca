import { useCallback, useEffect, useState } from 'react'
import { HERMES_DEBUG_STORAGE_KEY } from '../../lib/hermes/hermesDebugLog'
import { probeHermesModels, type HermesProbeResult } from '../../lib/hermes/hermesResponses'
import {
  clearHermesEnvKeyCache,
  resolveHermesAuthStatusAsync,
  type HermesResolvedAuthStatus,
} from '../../lib/hermes/hermesApiKey'
import {
  HERMES_API_DEFAULT_BASE,
  HERMES_API_DEFAULT_MODEL,
  ZAI_DEFAULT_BASE,
  ZAI_DEFAULT_MODEL_ID,
  useSettingsStore,
} from '../../store/settingsStore'
import { useToastStore } from '../../store/toastStore'

const HERMES_API_SERVER_DOCS =
  'https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server'

function describeAuthMode(status: HermesResolvedAuthStatus | null): string {
  if (!status) return 'Resolving…'
  switch (status.mode) {
    case 'ui_key':
      return 'Using UI key'
    case 'env_hermes_dotenv':
      return 'Using key from ~/.hermes/.env'
    case 'zai_provider':
      return status.bearer ? 'Using Z.AI provider key' : 'No resolved Z.AI key'
    case 'none_local_gateway':
      return 'No key (open local gateway)'
    case 'none_remote_host':
      return 'No key (remote host)'
  }
}

export function HermesApiSettingsPanel() {
  const addToast = useToastStore((s) => s.addToast)
  const hermesApiBaseUrl = useSettingsStore((s) => s.hermesApiBaseUrl)
  const hermesApiKey = useSettingsStore((s) => s.hermesApiKey)
  const hermesModel = useSettingsStore((s) => s.hermesModel)
  const hermesAutoRunnerForSubAgents = useSettingsStore((s) => s.hermesAutoRunnerForSubAgents)
  const setHermesApiBaseUrl = useSettingsStore((s) => s.setHermesApiBaseUrl)
  const setHermesApiKey = useSettingsStore((s) => s.setHermesApiKey)
  const setHermesModel = useSettingsStore((s) => s.setHermesModel)
  const setHermesAutoRunnerForSubAgents = useSettingsStore((s) => s.setHermesAutoRunnerForSubAgents)

  const [showKey, setShowKey] = useState(false)
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeResult, setProbeResult] = useState<HermesProbeResult | null>(null)
  const [authStatus, setAuthStatus] = useState<HermesResolvedAuthStatus | null>(null)

  const hasKey = Boolean(hermesApiKey?.trim())

  const refreshAuthStatus = useCallback(async () => {
    const status = await resolveHermesAuthStatusAsync(
      hermesApiKey?.trim() || undefined,
      hermesApiBaseUrl?.trim()
    )
    setAuthStatus(status)
    return status
  }, [hermesApiKey, hermesApiBaseUrl])

  useEffect(() => {
    let cancelled = false
    void refreshAuthStatus()
      .then((s) => {
        if (cancelled) return
        setAuthStatus(s)
      })
      .catch(() => {
        if (!cancelled) setAuthStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [refreshAuthStatus])

  const onClearApiKey = () => {
    setHermesApiKey('')
    addToast({
      type: 'info',
      title: 'Hermes API',
      message: 'Saved UI key cleared. Orca will now use `~/.hermes/.env` (or no Bearer).',
    })
  }

  const onResetHermesConnection = () => {
    setHermesApiBaseUrl(HERMES_API_DEFAULT_BASE)
    setHermesApiKey('')
    setHermesModel(HERMES_API_DEFAULT_MODEL)
    addToast({
      type: 'info',
      title: 'Hermes API',
      message: 'Reset base URL + model; UI key cleared. Orca will auto-read `~/.hermes/.env`.',
    })
  }

  const onUseZaiCoding = () => {
    setHermesApiBaseUrl(ZAI_DEFAULT_BASE)
    setHermesModel(ZAI_DEFAULT_MODEL_ID)
    addToast({
      type: 'info',
      title: 'Hermes API',
      message:
        'Set base to Z.AI Coding. Empty Hermes key means Orca reuses your Z.AI key from Settings → Integrations.',
    })
  }

  const onRefreshEnv = async () => {
    clearHermesEnvKeyCache()
    const s = await refreshAuthStatus()
    addToast({
      type: 'info',
      title: 'Hermes API',
      message: `Re-read ~/.hermes/.env → ${s.label}.`,
    })
  }

  const onTestConnection = async () => {
    setProbeBusy(true)
    setProbeResult(null)
    try {
      const result = await probeHermesModels(hermesApiBaseUrl, hermesApiKey?.trim() || undefined)
      setProbeResult(result)
      addToast({
        type: result.ok ? 'success' : 'error',
        title: 'Hermes API probe',
        message: `${result.status || 'network'} · ${result.hint}`.slice(0, 220),
      })
    } finally {
      setProbeBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-tile-border bg-canvas-bg p-4">
      <h3 className="text-sm font-medium text-gray-200">Hermes gateway</h3>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        Used by the Hermes tile (<code className="text-gray-500">POST /v1/responses</code>). Orca reads{' '}
        <code className="text-gray-600">API_SERVER_KEY</code> from <code className="text-gray-600">~/.hermes/.env</code>
        . Fill the fields below only to override that file.{' '}
        <a href={HERMES_API_SERVER_DOCS} target="_blank" rel="noreferrer" className="text-accent-teal hover:underline">
          Docs
        </a>
      </p>

      <div
        className="mt-3 rounded-lg border border-tile-border/80 bg-black/20 px-3 py-2 text-xs leading-relaxed"
        data-testid="hermes-auth-summary"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="font-semibold uppercase tracking-wide text-teal-200/90">Auth</span>{' '}
            <span className="font-mono text-gray-200">{describeAuthMode(authStatus)}</span>
          </div>
          <button
            type="button"
            onClick={() => void onRefreshEnv()}
            className="rounded border border-teal-500/40 bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-100/95 hover:bg-teal-500/20"
            data-testid="hermes-refresh-env"
          >
            Refresh from ~/.hermes/.env
          </button>
        </div>
        {authStatus ? (
          <div className="mt-1 text-gray-500">{authStatus.detail}</div>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        <label className="block text-[11px] text-gray-500">
          API base URL (local Hermes: typically <code className="text-gray-600">…/v1</code>; Z.AI
          Coding: <code className="text-gray-600">…/paas/v4</code>)
          <input
            type="text"
            value={hermesApiBaseUrl}
            onChange={(e) => setHermesApiBaseUrl(e.target.value)}
            className="mt-1 w-full rounded border border-tile-border bg-black/30 px-2 py-1.5 font-mono text-[11px] text-gray-200"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="block text-[11px] text-gray-500">
          API key
          <span className="text-gray-600">
            {' '}
            — leave empty to use <code className="text-gray-600">~/.hermes/.env</code>.
          </span>
          <div className="mt-1 flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={hermesApiKey}
              onChange={(e) => setHermesApiKey(e.target.value)}
              placeholder="(leave empty to use ~/.hermes/.env)"
              className="min-w-0 flex-1 rounded border border-tile-border bg-black/30 px-2 py-1.5 font-mono text-[11px] text-gray-200"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="shrink-0 rounded border border-tile-border/70 px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        <label className="block text-[11px] text-gray-500">
          Model id (cosmetic)
          <input
            type="text"
            value={hermesModel}
            onChange={(e) => setHermesModel(e.target.value)}
            className="mt-1 w-full rounded border border-tile-border bg-black/30 px-2 py-1.5 font-mono text-[11px] text-gray-200"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="flex items-center gap-2 rounded border border-tile-border/60 bg-black/20 px-2 py-1.5 text-[11px] text-gray-400">
          <input
            type="checkbox"
            checked={hermesAutoRunnerForSubAgents}
            onChange={(e) => setHermesAutoRunnerForSubAgents(e.target.checked)}
          />
          Auto-route Hermes-intent sub-agents to <code className="text-gray-500">runner:"hermes"</code>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onTestConnection()}
          disabled={probeBusy}
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-100/90 hover:bg-emerald-500/20 disabled:opacity-40"
        >
          {probeBusy ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          onClick={onClearApiKey}
          disabled={!hasKey}
          className="rounded-lg border border-amber-500/45 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100/95 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear UI key
        </button>
        <button
          type="button"
          onClick={onResetHermesConnection}
          className="rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/5"
        >
          Reset to defaults
        </button>
        <button
          type="button"
          onClick={onUseZaiCoding}
          className="rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-1.5 text-xs font-medium text-teal-100/90 hover:bg-teal-500/20"
        >
          Use Z.AI Coding API
        </button>
      </div>

      {probeResult ? (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
            probeResult.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100/90'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-100/90'
          }`}
        >
          <div className="font-semibold">
            {probeResult.ok ? 'Connection OK' : 'Connection failed'} · status{' '}
            {probeResult.status || 'network'}
          </div>
          <div className="mt-1 text-gray-300">{probeResult.hint}</div>
          <div className="mt-1 font-mono text-[10px] text-gray-500">{probeResult.modelsUrl}</div>
          {probeResult.detail ? (
            <div className="mt-1 max-h-24 overflow-auto rounded bg-black/20 px-2 py-1 font-mono text-[10px] text-gray-500">
              {probeResult.detail}
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2 text-[10px] leading-relaxed text-gray-600">
        Console debug (Hermes tile + auth + fetch):{' '}
        <code className="text-gray-500">
          localStorage.setItem(&apos;{HERMES_DEBUG_STORAGE_KEY}&apos;, &apos;1&apos;);
          location.reload()
        </code>{' '}
        Omit for quiet. Logs never print full keys.
      </p>
    </div>
  )
}

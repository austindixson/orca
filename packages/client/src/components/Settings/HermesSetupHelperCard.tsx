import { useCallback, useState } from 'react'
import { runHermesOrchestratorSetupDiagnose } from '../../lib/hermes/hermesOrchestratorSetupHelper'
import { useSettingsStore } from '../../store/settingsStore'

type Props = {
  /** When true, show the troubleshooting card (Hermes tile enabled in settings). */
  active: boolean
}

/**
 * In-app entrypoint for the same diagnose as orchestrator tool `diagnose_hermes_setup`.
 */
export function HermesSetupHelperCard({ active }: Props) {
  const openSettingsToSection = useSettingsStore((s) => s.openSettingsToSection)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const md = await runHermesOrchestratorSetupDiagnose()
      setReport(md)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  if (!active) return null

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-xs leading-relaxed text-gray-300">
      <p className="font-medium text-amber-200/90">Hermes setup helper</p>
      <p className="mt-1 text-gray-400">
        If you enabled the Hermes tile but don&apos;t have Hermes installed, runs can fail with gateway or command-not-found errors. Check your machine for the{' '}
        <code className="text-[11px] text-gray-500">hermes</code> CLI and your API base, or turn the Hermes tile off below.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-gray-200 hover:bg-white/10 disabled:opacity-50"
          onClick={() => void run()}
        >
          {busy ? 'Checking…' : 'Run diagnose'}
        </button>
        <button
          type="button"
          className="rounded-md border border-white/10 bg-transparent px-2.5 py-1 text-[11px] text-gray-400 hover:bg-white/5"
          onClick={() => openSettingsToSection('agent', { expandHermes: true })}
        >
          Open Agent → Hermes
        </button>
      </div>
      {error ? <p className="mt-2 text-[11px] text-red-400/90">{error}</p> : null}
      {report ? (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-white/[0.06] bg-black/30 p-2 font-mono text-[10px] text-gray-400">
          {report}
        </pre>
      ) : null}
    </div>
  )
}

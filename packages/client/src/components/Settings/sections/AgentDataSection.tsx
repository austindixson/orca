import { useEffect, useMemo, useState } from 'react'
import {
  PROVIDER_INFO,
  sortModelsForDisplay,
  useSettingsStore,
  type OrchestratorArticulationMode,
} from '../../../store/settingsStore'
import { useToastStore } from '../../../store/toastStore'
import { useVaultMirrorDiagnosticsStore } from '../../../store/vaultMirrorDiagnosticsStore'
import * as tauri from '../../../lib/tauri'
import { forceVaultMirrorSelfTest } from '../../../lib/vault/vaultBrainMirror'
import { forceCentralBrainSelfTest, getEffectiveCentralVaultPath } from '../../../lib/vault/centralBrainMirror'
import { invoke } from '@tauri-apps/api/core'
import { useCentralBrainDiagnosticsStore } from '../../../store/centralBrainDiagnosticsStore'
import { useOrchestratorActivityStore } from '../../../store/orchestratorActivityStore'
import { useOrchestratorSessionStore } from '../../../store/orchestratorSessionStore'
import {
  analyzeHarnessTraceSession,
  exportHarnessExperimentArchive,
  type HarnessWorkflowTraceSummary,
} from '../../../lib/orchestrator/orchestratorHarnessOptimizer'
import { approveAllPendingMergeReviews } from '../../../lib/harness/mergeReviewerPipeline'
import {
  exportHarnessParetoFrontierReport,
  maybeAutoApplyBestHarnessCandidate,
  revertActiveHarnessCandidate,
} from '../../../lib/orchestrator/harnessCandidates'
import { SettingsPageHeader } from '../settingsLayout'
import { SettingsAccordion, SettingsSurface, SettingsToggleRow } from '../settingsPrimitives'
import { HermesExternalOrchestratorCard } from '../HermesExternalOrchestratorCard'
import { HermesSetupHelperCard } from '../HermesSetupHelperCard'
import { useWorkspaceRebuildStore } from '../../../store/workspaceRebuildStore'
import { clearCanvasRebuildStateBreadcrumb } from '../../../lib/canvasStatePersistence'

type AgentDataSectionProps = {
  /** When true (settings open + this section selected), prefill experiment session from last trace. */
  prefillHarnessSession: boolean
}

function laneChipClass(lane: string): string {
  const normalized = lane.trim().toLowerCase()
  if (normalized === 'oauth') {
    return 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200'
  }
  if (normalized === 'browser_session' || normalized === 'browser-session') {
    return 'border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200'
  }
  if (normalized === 'hybrid_router' || normalized === 'hybrid-router') {
    return 'border-amber-400/30 bg-amber-500/10 text-amber-200'
  }
  return 'border-indigo-400/30 bg-indigo-500/10 text-indigo-100'
}

export function AgentDataSection({ prefillHarnessSession }: AgentDataSectionProps) {
  const addToast = useToastStore((s) => s.addToast)
  const lastHarnessTraceSessionKey = useOrchestratorSessionStore((s) => s.lastHarnessTraceSessionKey)

  const autoAcceptOrchestratorDiffs = useOrchestratorActivityStore((s) => s.autoAcceptOrchestratorDiffs)
  const setAutoAcceptOrchestratorDiffs = useOrchestratorActivityStore((s) => s.setAutoAcceptOrchestratorDiffs)
  const orchestratorLeadDelegationOnly = useSettingsStore((s) => s.orchestratorLeadDelegationOnly)
  const setOrchestratorLeadDelegationOnly = useSettingsStore((s) => s.setOrchestratorLeadDelegationOnly)
  const orchestratorArticulationMode = useSettingsStore((s) => s.orchestratorArticulationMode)
  const setOrchestratorArticulationMode = useSettingsStore((s) => s.setOrchestratorArticulationMode)
  const orchestratorDisplayName = useSettingsStore((s) => s.orchestratorDisplayName)
  const setOrchestratorDisplayName = useSettingsStore((s) => s.setOrchestratorDisplayName)
  const orchestratorPersonalityEnabled = useSettingsStore((s) => s.orchestratorPersonalityEnabled)
  const setOrchestratorPersonalityEnabled = useSettingsStore((s) => s.setOrchestratorPersonalityEnabled)
  const orchestratorSoulEnabled = useSettingsStore((s) => s.orchestratorSoulEnabled)
  const setOrchestratorSoulEnabled = useSettingsStore((s) => s.setOrchestratorSoulEnabled)
  const narratorMode = useSettingsStore((s) => s.narratorMode)
  const setNarratorMode = useSettingsStore((s) => s.setNarratorMode)
  const narratorAiModelId = useSettingsStore((s) => s.narratorAiModelId)
  const setNarratorAiModelId = useSettingsStore((s) => s.setNarratorAiModelId)
  const selectedModel = useSettingsStore((s) => s.selectedModel)
  const harnessTraceRaw = useSettingsStore((s) => s.harnessTraceRaw)
  const setHarnessTraceRaw = useSettingsStore((s) => s.setHarnessTraceRaw)
  const harnessTraceDetailed = useSettingsStore((s) => s.harnessTraceDetailed)
  const setHarnessTraceDetailed = useSettingsStore((s) => s.setHarnessTraceDetailed)
  const harnessFileStateSnapshot = useSettingsStore((s) => s.harnessFileStateSnapshot)
  const setHarnessFileStateSnapshot = useSettingsStore((s) => s.setHarnessFileStateSnapshot)
  const harnessSafetyMode = useSettingsStore((s) => s.harnessSafetyMode)
  const setHarnessSafetyMode = useSettingsStore((s) => s.setHarnessSafetyMode)
  const harnessStagnationGuard = useSettingsStore((s) => s.harnessStagnationGuard)
  const setHarnessStagnationGuard = useSettingsStore((s) => s.setHarnessStagnationGuard)
  const harnessInspectErrorDetection = useSettingsStore((s) => s.harnessInspectErrorDetection)
  const setHarnessInspectErrorDetection = useSettingsStore((s) => s.setHarnessInspectErrorDetection)
  const harnessAutoFixGate = useSettingsStore((s) => s.harnessAutoFixGate)
  const setHarnessAutoFixGate = useSettingsStore((s) => s.setHarnessAutoFixGate)
  const harnessParallelBatchRules = useSettingsStore((s) => s.harnessParallelBatchRules)
  const setHarnessParallelBatchRules = useSettingsStore((s) => s.setHarnessParallelBatchRules)
  const harnessSubAgentCompactContext = useSettingsStore((s) => s.harnessSubAgentCompactContext)
  const setHarnessSubAgentCompactContext = useSettingsStore((s) => s.setHarnessSubAgentCompactContext)
  const harnessSubAgentAutoWorktree = useSettingsStore((s) => s.harnessSubAgentAutoWorktree)
  const setHarnessSubAgentAutoWorktree = useSettingsStore((s) => s.setHarnessSubAgentAutoWorktree)
  const autoApproveMergeReviews = useSettingsStore((s) => s.autoApproveMergeReviews)
  const setAutoApproveMergeReviews = useSettingsStore((s) => s.setAutoApproveMergeReviews)
  const harnessTerminalReadOnlyBash = useSettingsStore((s) => s.harnessTerminalReadOnlyBash)
  const setHarnessTerminalReadOnlyBash = useSettingsStore((s) => s.setHarnessTerminalReadOnlyBash)
  const orcaBugBountyLaneEnabled = useSettingsStore((s) => s.orcaBugBountyLaneEnabled)
  const setOrcaBugBountyLaneEnabled = useSettingsStore((s) => s.setOrcaBugBountyLaneEnabled)
  const orcaBugBountyAutoDelegateSubagents = useSettingsStore((s) => s.orcaBugBountyAutoDelegateSubagents)
  const setOrcaBugBountyAutoDelegateSubagents = useSettingsStore(
    (s) => s.setOrcaBugBountyAutoDelegateSubagents
  )
  const orcaBugBountyHunterModelId = useSettingsStore((s) => s.orcaBugBountyHunterModelId)
  const setOrcaBugBountyHunterModelId = useSettingsStore((s) => s.setOrcaBugBountyHunterModelId)
  const getAvailableModels = useSettingsStore((s) => s.getAvailableModels)
  const providersSnapshot = useSettingsStore((s) => s.providers)
  const bountyHunterToolCapableModels = useMemo(() => {
    void providersSnapshot
    return sortModelsForDisplay(getAvailableModels()).filter((m) => m.supportsTools !== false)
  }, [getAvailableModels, providersSnapshot])
  const narratorModelChoices = useMemo(() => {
    void providersSnapshot
    return sortModelsForDisplay(getAvailableModels())
  }, [getAvailableModels, providersSnapshot])
  const orcaVaultBrainMirrorEnabled = useSettingsStore((s) => s.orcaVaultBrainMirrorEnabled)
  const setOrcaVaultBrainMirrorEnabled = useSettingsStore((s) => s.setOrcaVaultBrainMirrorEnabled)
  const orcaVaultMirrorErrors = useSettingsStore((s) => s.orcaVaultMirrorErrors)
  const setOrcaVaultMirrorErrors = useSettingsStore((s) => s.setOrcaVaultMirrorErrors)
  const orcaVaultMirrorSessions = useSettingsStore((s) => s.orcaVaultMirrorSessions)
  const setOrcaVaultMirrorSessions = useSettingsStore((s) => s.setOrcaVaultMirrorSessions)
  const orcaVaultMirrorTelemetry = useSettingsStore((s) => s.orcaVaultMirrorTelemetry)
  const setOrcaVaultMirrorTelemetry = useSettingsStore((s) => s.setOrcaVaultMirrorTelemetry)
  const orcaVaultMirrorChatTranscript = useSettingsStore((s) => s.orcaVaultMirrorChatTranscript)
  const setOrcaVaultMirrorChatTranscript = useSettingsStore((s) => s.setOrcaVaultMirrorChatTranscript)
  const orcaVaultWikiDistillPrompt = useSettingsStore((s) => s.orcaVaultWikiDistillPrompt)
  const setOrcaVaultWikiDistillPrompt = useSettingsStore((s) => s.setOrcaVaultWikiDistillPrompt)
  const centralBrainEnabled = useSettingsStore((s) => s.centralBrainEnabled)
  const setCentralBrainEnabled = useSettingsStore((s) => s.setCentralBrainEnabled)
  const centralBrainVaultPath = useSettingsStore((s) => s.centralBrainVaultPath)
  const setCentralBrainVaultPath = useSettingsStore((s) => s.setCentralBrainVaultPath)
  const centralBrainReverseWatchEnabled = useSettingsStore((s) => s.centralBrainReverseWatchEnabled)
  const setCentralBrainReverseWatchEnabled = useSettingsStore(
    (s) => s.setCentralBrainReverseWatchEnabled
  )
  const memoryShortTermMaxChars = useSettingsStore((s) => s.memoryShortTermMaxChars)
  const setMemoryShortTermMaxChars = useSettingsStore((s) => s.setMemoryShortTermMaxChars)
  const memoryLongTermEnabled = useSettingsStore((s) => s.memoryLongTermEnabled)
  const setMemoryLongTermEnabled = useSettingsStore((s) => s.setMemoryLongTermEnabled)
  const memoryLongTermSource = useSettingsStore((s) => s.memoryLongTermSource)
  const setMemoryLongTermSource = useSettingsStore((s) => s.setMemoryLongTermSource)
  const memoryLongTermMaxChars = useSettingsStore((s) => s.memoryLongTermMaxChars)
  const setMemoryLongTermMaxChars = useSettingsStore((s) => s.setMemoryLongTermMaxChars)

  const orcaPersistenceEnabled = useSettingsStore((s) => s.orcaPersistenceEnabled)
  const setOrcaPersistenceEnabled = useSettingsStore((s) => s.setOrcaPersistenceEnabled)
  const orcaBurstAggregationEnabled = useSettingsStore((s) => s.orcaBurstAggregationEnabled)
  const setOrcaBurstAggregationEnabled = useSettingsStore((s) => s.setOrcaBurstAggregationEnabled)
  const orcaAutoCompactionEnabled = useSettingsStore((s) => s.orcaAutoCompactionEnabled)
  const setOrcaAutoCompactionEnabled = useSettingsStore((s) => s.setOrcaAutoCompactionEnabled)
  const orcaAutoCompactionThreshold = useSettingsStore((s) => s.orcaAutoCompactionThreshold)
  const setOrcaAutoCompactionThreshold = useSettingsStore((s) => s.setOrcaAutoCompactionThreshold)
  const orcaMemoryDistillerEnabled = useSettingsStore((s) => s.orcaMemoryDistillerEnabled)
  const setOrcaMemoryDistillerEnabled = useSettingsStore((s) => s.setOrcaMemoryDistillerEnabled)
  const orcaUserProfileEnabled = useSettingsStore((s) => s.orcaUserProfileEnabled)
  const setOrcaUserProfileEnabled = useSettingsStore((s) => s.setOrcaUserProfileEnabled)
  const orcaUserProfileSource = useSettingsStore((s) => s.orcaUserProfileSource)
  const setOrcaUserProfileSource = useSettingsStore((s) => s.setOrcaUserProfileSource)
  const orcaUserProfileMaxChars = useSettingsStore((s) => s.orcaUserProfileMaxChars)
  const setOrcaUserProfileMaxChars = useSettingsStore((s) => s.setOrcaUserProfileMaxChars)
  const orcaUserProfileDistillerEnabled = useSettingsStore((s) => s.orcaUserProfileDistillerEnabled)
  const setOrcaUserProfileDistillerEnabled = useSettingsStore(
    (s) => s.setOrcaUserProfileDistillerEnabled
  )
  const orchestratorHeartbeatEnabled = useSettingsStore((s) => s.orchestratorHeartbeatEnabled)
  const setOrchestratorHeartbeatEnabled = useSettingsStore((s) => s.setOrchestratorHeartbeatEnabled)
  const orchestratorHeartbeatIntervalMinutes = useSettingsStore(
    (s) => s.orchestratorHeartbeatIntervalMinutes
  )
  const setOrchestratorHeartbeatIntervalMinutes = useSettingsStore(
    (s) => s.setOrchestratorHeartbeatIntervalMinutes
  )
  const orchestratorAutonomyMode = useSettingsStore((s) => s.orchestratorAutonomyMode)
  const setOrchestratorAutonomyMode = useSettingsStore((s) => s.setOrchestratorAutonomyMode)
  const harnessAutoApplyBestCandidate = useSettingsStore((s) => s.harnessAutoApplyBestCandidate)
  const setHarnessAutoApplyBestCandidate = useSettingsStore(
    (s) => s.setHarnessAutoApplyBestCandidate
  )
  const showHermesAgentTile = useSettingsStore((s) => s.showHermesAgentTile)
  const setShowHermesAgentTile = useSettingsStore((s) => s.setShowHermesAgentTile)
  const openSettingsToSection = useSettingsStore((s) => s.openSettingsToSection)
  const settingsAgentExpandHermes = useSettingsStore((s) => s.settingsAgentExpandHermes)
  const setSettingsAgentExpandHermes = useSettingsStore((s) => s.setSettingsAgentExpandHermes)
  const showSettings = useSettingsStore((s) => s.showSettings)
  const settingsSection = useSettingsStore((s) => s.settingsSection)

  const [harnessExperimentSession, setHarnessExperimentSession] = useState('')
  const [harnessExperimentId, setHarnessExperimentId] = useState('')
  const [harnessHypothesis, setHarnessHypothesis] = useState('')
  const [harnessExperimentReport, setHarnessExperimentReport] = useState<string | null>(null)
  const [harnessWorkflowTracePreview, setHarnessWorkflowTracePreview] =
    useState<HarnessWorkflowTraceSummary | null>(null)
  const [harnessExperimentBusy, setHarnessExperimentBusy] = useState(false)

  const vaultDiagEntries = useVaultMirrorDiagnosticsStore((s) => s.entries)
  const lastSuccessAtMs = useVaultMirrorDiagnosticsStore((s) => s.lastSuccessAtMs)
  const lastSuccessRelPath = useVaultMirrorDiagnosticsStore((s) => s.lastSuccessRelPath)
  const centralDiagEntries = useCentralBrainDiagnosticsStore((s) => s.entries)
  const centralLastSuccessAtMs = useCentralBrainDiagnosticsStore((s) => s.lastSuccessAtMs)
  const centralLastSuccessRelPath = useCentralBrainDiagnosticsStore((s) => s.lastSuccessRelPath)
  const [vaultWorkspacePath, setVaultWorkspacePath] = useState<string | null>(null)
  const [vaultSelfTestBusy, setVaultSelfTestBusy] = useState(false)
  const [vaultSelfTestMsg, setVaultSelfTestMsg] = useState<string | null>(null)
  const [vaultDiagOpen, setVaultDiagOpen] = useState(false)
  const [resolvedCentralVault, setResolvedCentralVault] = useState<string>('')
  const [centralSelfTestBusy, setCentralSelfTestBusy] = useState(false)
  const [centralSelfTestMsg, setCentralSelfTestMsg] = useState<string | null>(null)
  const [centralDiagOpen, setCentralDiagOpen] = useState(false)

  const canvasSafeModeDiagnostics = useWorkspaceRebuildStore((s) => s.canvasSafeModeDiagnostics)
  const activateAllCanvasTilesNow = useWorkspaceRebuildStore((s) => s.activateAllNow)
  const [clearRebuildBusy, setClearRebuildBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void tauri.getWorkspace().then((ws) => {
      if (cancelled) return
      if (!ws?.path || ws.path === '.') {
        setVaultWorkspacePath(null)
        return
      }
      setVaultWorkspacePath(ws.path.replace(/\\/g, '/'))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const p = await getEffectiveCentralVaultPath()
        if (!cancelled) setResolvedCentralVault(p.replace(/\\/g, '/'))
      } catch {
        if (!cancelled) setResolvedCentralVault('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [centralBrainVaultPath])

  useEffect(() => {
    if (prefillHarnessSession && lastHarnessTraceSessionKey) {
      setHarnessExperimentSession((prev) => (prev.trim() ? prev : lastHarnessTraceSessionKey))
    }
  }, [prefillHarnessSession, lastHarnessTraceSessionKey])

  useEffect(() => {
    if (!showSettings || settingsSection !== 'agent' || !settingsAgentExpandHermes) return
    const el = document.getElementById('agent-hermes') as HTMLDetailsElement | null
    if (el?.tagName === 'DETAILS') {
      el.open = true
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    setSettingsAgentExpandHermes(false)
  }, [showSettings, settingsSection, settingsAgentExpandHermes, setSettingsAgentExpandHermes])

  return (
    <div className="space-y-4 text-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <SettingsPageHeader
        title="Agent & memory"
        description="Save sessions locally, mirror notes to your vault, tune the orchestrator, and configure harness diagnostics. Some options need the desktop app."
      />

      <SettingsSurface>
        <SettingsToggleRow
          label="Automatically merge sub-agent branches"
          hint="When a delegated sub-agent finishes, merge its worktree branch into your current branch (desktop app) and mark the merge-review item approved—no per-item clicks. Turning this on also approves anything pending now. You can still change this from the Agents sidebar."
          checked={autoApproveMergeReviews}
          onChange={(v) => {
            setAutoApproveMergeReviews(v)
            if (v) void approveAllPendingMergeReviews()
          }}
        />
      </SettingsSurface>

      <SettingsAccordion
        id="agent-hermes"
        title="Hermes"
        description="Gateway chat vs Orca agents, bridge, optional Hermes tile, and related toggles."
        defaultOpen={false}
      >
        <div className="space-y-4">
          <p className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5 text-xs leading-relaxed text-gray-400">
            <span className="font-medium text-gray-300">Hermes tile vs standard Agent tile:</span> The Hermes module
            streams to your Hermes API (<code className="text-[11px] text-gray-500">/v1/responses</code>) — skills and
            server-side tools come from <span className="text-gray-300">Hermes</span> for that session. A normal{' '}
            <span className="text-gray-300">Agent</span> tile runs Orca&apos;s orchestrator with Orca&apos;s canvas tools
            and skills instead. Those catalogs are not the same; a large Hermes setup does not carry over to the generic
            Agent tile unless you route through Hermes explicitly (e.g. sub-agent with the Hermes runner, or the bridge).
          </p>
          <HermesExternalOrchestratorCard />
          <SettingsToggleRow
            label="Show Hermes agent tile in add-tile menus"
            hint="When off, Hermes is hidden from tile pickers and the orchestrator no longer receives chat_with_hermes_tile or hermes_agent in canvas_create_tile — use standard agent tiles for delegation. Existing Hermes tiles stay on the canvas. Hermes bridge tile is separate."
            checked={showHermesAgentTile}
            onChange={setShowHermesAgentTile}
          />
          <HermesSetupHelperCard active={showHermesAgentTile} />
          <p className="text-xs text-gray-500">
            Hermes gateway URL and API key live in{' '}
            <button
              type="button"
              className="text-accent-teal/90 underline underline-offset-2 hover:text-accent-teal"
              onClick={() => openSettingsToSection('integrations')}
            >
              Integrations
            </button>{' '}
            (Hermes API).
          </p>
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="agent-data-sessions"
        title="Sessions & persistence"
        description="Store sessions, tasks, and terminal state on disk (desktop)."
        defaultOpen
      >
        <div className="space-y-3">
          <SettingsToggleRow
            label="Enable Orca persistence"
            hint="~/.orca/sessions and related state when using the desktop app."
            checked={orcaPersistenceEnabled}
            onChange={setOrcaPersistenceEnabled}
          />
          <SettingsToggleRow
            label="Group similar tasks (burst aggregation)"
            hint="Requires persistence. Rate-limits noisy auto-created tasks."
            checked={orcaBurstAggregationEnabled}
            onChange={setOrcaBurstAggregationEnabled}
            disabled={!orcaPersistenceEnabled}
          />
          <SettingsToggleRow
            label="Auto-compact long sessions"
            hint="Summarize to summary.md when message count exceeds the threshold."
            checked={orcaAutoCompactionEnabled}
            onChange={setOrcaAutoCompactionEnabled}
            disabled={!orcaPersistenceEnabled}
          />
          <label className="flex flex-col gap-1 text-xs text-gray-500 sm:flex-row sm:items-center sm:gap-3">
            <span className="min-w-[10rem] shrink-0 text-gray-400">Auto-compaction threshold (messages)</span>
            <input
              type="number"
              min={10}
              max={500}
              className="max-w-[8rem] rounded border border-white/10 bg-black/30 px-2 py-1 text-gray-100"
              value={orcaAutoCompactionThreshold}
              onChange={(e) => setOrcaAutoCompactionThreshold(Number(e.target.value))}
              disabled={!orcaPersistenceEnabled || !orcaAutoCompactionEnabled}
            />
          </label>

          {canvasSafeModeDiagnostics ? (
            <div className="space-y-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-3 text-xs text-amber-100/95">
              <p className="font-semibold text-amber-50">Canvas Safe Mode (diagnostics)</p>
              <p className="leading-relaxed text-amber-100/85">
                A previous workspace reload did not finish before exit, so heavy tiles were left paused. Reason:{' '}
                <span className="font-mono text-[11px] text-amber-100/90">
                  {canvasSafeModeDiagnostics.reason.replace(/_/g, ' ')}
                </span>
                .
                {canvasSafeModeDiagnostics.megaWorkspace
                  ? ' This is also a large workspace — open or activate modules to load editors, terminals, and browsers.'
                  : ' Use the button below to wake every paused module at once, or click individual tiles on the canvas.'}
              </p>
              <p className="font-mono text-[10px] text-amber-200/55">
                Detected {new Date(canvasSafeModeDiagnostics.enteredAt).toLocaleString()}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="rounded-md bg-amber-500/90 px-3 py-1.5 text-[11px] font-medium text-gray-950 hover:bg-amber-400"
                  onClick={() => {
                    activateAllCanvasTilesNow()
                    addToast({
                      type: 'success',
                      title: 'Activating tiles',
                      message: 'All queued and paused tiles are being activated.',
                    })
                  }}
                >
                  Activate all paused tiles
                </button>
                <button
                  type="button"
                  disabled={clearRebuildBusy || !vaultWorkspacePath}
                  className="rounded-md border border-amber-400/40 px-3 py-1.5 text-[11px] font-medium text-amber-50/90 hover:bg-amber-500/15 disabled:opacity-40"
                  onClick={() => {
                    if (!vaultWorkspacePath) {
                      addToast({
                        type: 'warning',
                        title: 'No workspace',
                        message: 'Open a project folder first.',
                      })
                      return
                    }
                    setClearRebuildBusy(true)
                    void (async () => {
                      try {
                        await clearCanvasRebuildStateBreadcrumb()
                        addToast({
                          type: 'success',
                          title: 'Rebuild lock cleared',
                          message: 'Removed .agent-canvas/rebuild-state.json. Reload the workspace if Safe Mode still appears.',
                        })
                      } catch (e) {
                        addToast({
                          type: 'error',
                          title: 'Could not clear lock file',
                          message: e instanceof Error ? e.message : String(e),
                        })
                      } finally {
                        setClearRebuildBusy(false)
                      }
                    })()
                  }}
                >
                  Clear rebuild lock file
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="agent-vault"
        title="Workspace vault mirror"
        description="Write orchestrator notes under Orca/brain/ and full chat under Orca/chat/ in this project."
      >
        <p className="mb-3 text-xs text-gray-500">
          Template: <code className="rounded bg-black/35 px-1">docs/templates/vault-wiki/</code>. No API keys stored.
        </p>
        <div className="space-y-2">
          <SettingsToggleRow
            label="Mirror orchestrator notes (Orca/brain/)"
            checked={orcaVaultBrainMirrorEnabled}
            onChange={setOrcaVaultBrainMirrorEnabled}
          />
          <SettingsToggleRow
            label="Errors → Orca/brain/errors/"
            checked={orcaVaultMirrorErrors}
            onChange={setOrcaVaultMirrorErrors}
            disabled={!orcaVaultBrainMirrorEnabled}
          />
          <SettingsToggleRow
            label="Session stubs → Orca/brain/sessions/"
            checked={orcaVaultMirrorSessions}
            onChange={setOrcaVaultMirrorSessions}
            disabled={!orcaVaultBrainMirrorEnabled}
          />
          <SettingsToggleRow
            label="Full transcript → Orca/chat/ (per session)"
            checked={orcaVaultMirrorChatTranscript}
            onChange={setOrcaVaultMirrorChatTranscript}
            disabled={!orcaVaultBrainMirrorEnabled}
          />
          <SettingsToggleRow
            label="Telemetry rollups → Orca/brain/telemetry/"
            checked={orcaVaultMirrorTelemetry}
            onChange={setOrcaVaultMirrorTelemetry}
            disabled={!orcaVaultBrainMirrorEnabled}
          />
          <SettingsToggleRow
            label="Suggest wiki distill (state.md / log.md in prompt)"
            checked={orcaVaultWikiDistillPrompt}
            onChange={setOrcaVaultWikiDistillPrompt}
          />
        </div>

        <div className="mt-4 space-y-2 rounded-lg border border-tile-border/80 bg-black/15 p-3">
          <div className="text-xs font-medium text-gray-300">Vault mirror status</div>
          <ul className="space-y-1 font-mono text-[11px] text-gray-500">
            <li>
              Tauri:{' '}
              <span className={tauri.isTauri() ? 'text-emerald-400/90' : 'text-amber-400/90'}>
                {tauri.isTauri() ? 'yes' : 'no (web build — mirrors disabled)'}
              </span>
            </li>
            <li>
              Master mirror:{' '}
              <span className={orcaVaultBrainMirrorEnabled ? 'text-emerald-400/90' : 'text-gray-400'}>
                {orcaVaultBrainMirrorEnabled ? 'on' : 'off'}
              </span>
            </li>
            <li className="break-all">
              Workspace:{' '}
              {vaultWorkspacePath ?? '(none — open a folder in the desktop app)'}
            </li>
            <li>
              Last successful write:{' '}
              {lastSuccessAtMs != null
                ? `${new Date(lastSuccessAtMs).toLocaleString()}${lastSuccessRelPath ? ` → ${lastSuccessRelPath}` : ''}`
                : '(none yet)'}
            </li>
          </ul>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={vaultSelfTestBusy}
              onClick={() => {
                setVaultSelfTestBusy(true)
                setVaultSelfTestMsg(null)
                void forceVaultMirrorSelfTest()
                  .then((r) => {
                    if (r.ok) {
                      setVaultSelfTestMsg(`OK → ${r.relPath}`)
                      addToast({
                        type: 'success',
                        title: 'Vault self-test',
                        message: `Wrote ${r.relPath}`,
                      })
                    } else {
                      setVaultSelfTestMsg(r.error ?? 'Failed')
                    }
                  })
                  .finally(() => setVaultSelfTestBusy(false))
              }}
              className="rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-40"
            >
              {vaultSelfTestBusy ? 'Writing…' : 'Mirror now (self-test)'}
            </button>
            {vaultSelfTestMsg ? (
              <span className="text-[11px] text-gray-500">{vaultSelfTestMsg}</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setVaultDiagOpen((v) => !v)}
            className="text-[11px] text-gray-500 underline decoration-dotted hover:text-gray-400"
          >
            {vaultDiagOpen ? 'Hide' : 'Show'} last 10 mirror attempts
          </button>
          {vaultDiagOpen ? (
            <ul className="max-h-40 overflow-auto rounded border border-tile-border/60 bg-black/30 p-2 font-mono text-[10px] leading-snug text-gray-500">
              {vaultDiagEntries.slice(0, 10).map((e, i) => (
                <li key={`${e.ts}-${i}`} className="mb-1 border-b border-white/5 pb-1 last:mb-0 last:border-0">
                  <span className={e.ok ? 'text-emerald-400/80' : 'text-rose-400/80'}>{e.ok ? 'ok' : 'err'}</span>{' '}
                  {new Date(e.ts).toLocaleTimeString()} {e.scope} {e.relPath}
                  {e.errorMessage ? ` — ${e.errorMessage}` : ''}
                </li>
              ))}
              {vaultDiagEntries.length === 0 ? 'No attempts recorded this session.' : null}
            </ul>
          ) : null}
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="agent-central-brain"
        title="Central vault (iCloud)"
        description="Optional second vault that merges brain + chat from all projects for search across worktrees."
      >
        <p className="mb-3 text-xs text-gray-500">
          Leave the path empty for the default iCloud <code className="rounded bg-black/35 px-1">OrcaBrain</code> folder.
          Use <code className="rounded bg-black/35 px-1">search_project_wiki</code> and{' '}
          <code className="rounded bg-black/35 px-1">search_central_playbooks</code> from the orchestrator.
        </p>
        <div className="space-y-2">
          <SettingsToggleRow
            label="Enable central brain (dual-write to vault)"
            checked={centralBrainEnabled}
            onChange={setCentralBrainEnabled}
            disabled={!tauri.isTauri()}
          />
          <SettingsToggleRow
            label="Reverse sync (central vault → this workspace)"
            hint="Apply changes when iCloud updates files under projects/&lt;id&gt;/."
            checked={centralBrainReverseWatchEnabled}
            onChange={setCentralBrainReverseWatchEnabled}
            disabled={!tauri.isTauri() || !centralBrainEnabled}
          />
        </div>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-xs text-gray-400">Central vault path (optional override)</span>
          <input
            type="text"
            value={centralBrainVaultPath}
            onChange={(e) => setCentralBrainVaultPath(e.target.value)}
            placeholder="Empty = default iCloud OrcaBrain"
            disabled={!tauri.isTauri()}
            className="rounded border border-tile-border bg-black/40 px-2 py-1.5 font-mono text-xs text-gray-100 disabled:opacity-40"
          />
          <span className="break-all font-mono text-[10px] text-gray-500">
            Effective: {resolvedCentralVault || '(resolving…)'}
          </span>
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!tauri.isTauri()}
            onClick={() => {
              void (async () => {
                const p = await invoke<string | null>('pick_central_brain_folder_dialog')
                if (p) setCentralBrainVaultPath(p)
              })()
            }}
            className="rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-40"
          >
            Choose folder…
          </button>
          <button
            type="button"
            disabled={centralSelfTestBusy || !tauri.isTauri() || !centralBrainEnabled}
            onClick={() => {
              setCentralSelfTestBusy(true)
              setCentralSelfTestMsg(null)
              void forceCentralBrainSelfTest()
                .then((r) => {
                  if (r.ok) {
                    setCentralSelfTestMsg(`OK → ${r.relPath}`)
                    addToast({
                      type: 'success',
                      title: 'Central brain self-test',
                      message: `Wrote ${r.relPath}`,
                    })
                  } else {
                    setCentralSelfTestMsg(r.error ?? 'Failed')
                  }
                })
                .finally(() => setCentralSelfTestBusy(false))
            }}
            className="rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-40"
          >
            {centralSelfTestBusy ? 'Writing…' : 'Central self-test'}
          </button>
          {centralSelfTestMsg ? (
            <span className="text-[11px] text-gray-500">{centralSelfTestMsg}</span>
          ) : null}
        </div>
        <div className="mt-4 space-y-2 rounded-lg border border-tile-border/80 bg-black/15 p-3">
          <div className="text-xs font-medium text-gray-300">Central brain status</div>
          <ul className="space-y-1 font-mono text-[11px] text-gray-500">
            <li>
              Enabled:{' '}
              <span className={centralBrainEnabled ? 'text-emerald-400/90' : 'text-gray-400'}>
                {centralBrainEnabled ? 'on' : 'off'}
              </span>
            </li>
            <li>
              Last successful write:{' '}
              {centralLastSuccessAtMs != null
                ? `${new Date(centralLastSuccessAtMs).toLocaleString()}${centralLastSuccessRelPath ? ` → ${centralLastSuccessRelPath}` : ''}`
                : '(none yet)'}
            </li>
          </ul>
          <button
            type="button"
            onClick={() => setCentralDiagOpen((v) => !v)}
            className="text-[11px] text-gray-500 underline decoration-dotted hover:text-gray-400"
          >
            {centralDiagOpen ? 'Hide' : 'Show'} last 10 central writes
          </button>
          {centralDiagOpen ? (
            <ul className="max-h-40 overflow-auto rounded border border-tile-border/60 bg-black/30 p-2 font-mono text-[10px] leading-snug text-gray-500">
              {centralDiagEntries.slice(0, 10).map((e, i) => (
                <li key={`${e.ts}-${i}`} className="mb-1 border-b border-white/5 pb-1 last:mb-0 last:border-0">
                  <span className={e.ok ? 'text-emerald-400/80' : 'text-rose-400/80'}>{e.ok ? 'ok' : 'err'}</span>{' '}
                  {new Date(e.ts).toLocaleTimeString()} {e.relPath}
                  {e.errorMessage ? ` — ${e.errorMessage}` : ''}
                </li>
              ))}
              {centralDiagEntries.length === 0 ? 'No attempts recorded this session.' : null}
            </ul>
          ) : null}
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="agent-memory"
        title="Context, memory & user profile"
        description="Short-term budget, MEMORY.md, and optional USER.md (human preferences) for the orchestrator."
      >
        <p className="mb-3 text-xs text-gray-500">
          <code className="rounded bg-black/35 px-1">recall_session_history</code> needs persistence and desktop for
          search; otherwise use <code className="rounded bg-black/35 px-1">search_project_wiki</code>.
        </p>
        <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-gray-200">Short-term budget (characters)</span>
          <input
            type="number"
            min={2000}
            max={200000}
            step={500}
            value={memoryShortTermMaxChars}
            onChange={(e) => setMemoryShortTermMaxChars(Number(e.target.value))}
            className="w-full max-w-[11rem] rounded border border-tile-border bg-black/40 px-2 py-1 text-right text-gray-100 sm:w-40"
          />
        </label>
        <SettingsToggleRow
          label="Inject long-term memory (MEMORY.md)"
          checked={memoryLongTermEnabled}
          onChange={setMemoryLongTermEnabled}
        />
        <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-gray-200">Long-term source</span>
          <select
            value={memoryLongTermSource}
            onChange={(e) =>
              setMemoryLongTermSource(e.target.value as 'workspace' | 'user' | 'both')
            }
            disabled={!memoryLongTermEnabled}
            className="w-full max-w-[11rem] rounded border border-tile-border bg-black/40 px-2 py-1 text-gray-100 sm:w-48 disabled:opacity-40"
          >
            <option value="both">Workspace + user</option>
            <option value="workspace">Workspace only</option>
            <option value="user">User only</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-gray-200">Long-term cap (characters)</span>
          <input
            type="number"
            min={500}
            max={50000}
            step={500}
            value={memoryLongTermMaxChars}
            onChange={(e) => setMemoryLongTermMaxChars(Number(e.target.value))}
            disabled={!memoryLongTermEnabled}
            className="w-full max-w-[11rem] rounded border border-tile-border bg-black/40 px-2 py-1 text-right text-gray-100 sm:w-40 disabled:opacity-40"
          />
        </label>
        <p className="mt-4 border-t border-tile-border/60 pt-3 text-[11px] text-gray-500">
          <strong className="text-gray-400">USER.md</strong> is separate from MEMORY.md: durable notes about the{' '}
          <em>human</em> (tone, goals, habits). See <code className="rounded bg-black/35 px-1">docs/PROACTIVE_ORCA_HARNESS.md</code>.
        </p>
        <SettingsToggleRow
          label="Inject user profile (USER.md)"
          hint="Workspace `.orca/USER.md` and/or `~/.orca/USER.md` — same source options as memory."
          checked={orcaUserProfileEnabled}
          onChange={setOrcaUserProfileEnabled}
        />
        <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-gray-200">User profile source</span>
          <select
            value={orcaUserProfileSource}
            onChange={(e) =>
              setOrcaUserProfileSource(e.target.value as 'workspace' | 'user' | 'both')
            }
            disabled={!orcaUserProfileEnabled}
            className="w-full max-w-[11rem] rounded border border-tile-border bg-black/40 px-2 py-1 text-gray-100 sm:w-48 disabled:opacity-40"
          >
            <option value="both">Workspace + user</option>
            <option value="workspace">Workspace only</option>
            <option value="user">User only</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-gray-200">User profile cap (characters)</span>
          <input
            type="number"
            min={400}
            max={8000}
            step={100}
            value={orcaUserProfileMaxChars}
            onChange={(e) => setOrcaUserProfileMaxChars(Number(e.target.value))}
            disabled={!orcaUserProfileEnabled}
            className="w-full max-w-[11rem] rounded border border-tile-border bg-black/40 px-2 py-1 text-right text-gray-100 sm:w-40 disabled:opacity-40"
          />
        </label>
        <SettingsToggleRow
          label="User profile distiller (session end)"
          hint="Desktop only. Proposes bullets under ## Distilled user notes (auto) in USER.md. Skips heartbeat runs. When source is both, writes workspace only."
          checked={orcaUserProfileDistillerEnabled}
          onChange={setOrcaUserProfileDistillerEnabled}
          disabled={!orcaUserProfileEnabled}
        />
      </SettingsAccordion>

      <SettingsAccordion
        id="agent-proactive"
        title="Proactivity & autonomy"
        description="Heartbeat scheduling (HEARTBEAT.md) and autonomy constitution for proactive runs."
      >
        <p className="mb-3 text-xs text-gray-500">
          Add <code className="rounded bg-black/35 px-1">.orca/HEARTBEAT.md</code> (and optionally{' '}
          <code className="rounded bg-black/35 px-1">~/.orca/HEARTBEAT.md</code>) with routines and loose-end policies.
          The app must be open and the tab visible for ticks to run.
        </p>
        <SettingsToggleRow
          label="Enable orchestrator heartbeat (scheduled proactive runs)"
          checked={orchestratorHeartbeatEnabled}
          onChange={setOrchestratorHeartbeatEnabled}
        />
        <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-gray-200">Heartbeat interval (minutes)</span>
          <input
            type="number"
            min={1}
            max={1440}
            step={1}
            value={orchestratorHeartbeatIntervalMinutes}
            onChange={(e) => setOrchestratorHeartbeatIntervalMinutes(Number(e.target.value))}
            disabled={!orchestratorHeartbeatEnabled}
            className="w-full max-w-[11rem] rounded border border-tile-border bg-black/40 px-2 py-1 text-right text-gray-100 sm:w-40 disabled:opacity-40"
          />
        </label>
        <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex flex-col gap-0.5">
            <span className="text-gray-200">Autonomy mode</span>
            <span className="text-[11px] text-gray-500">
              <strong>Broad</strong> allows wide initiative with explicit red lines (comms, money, destructive actions still ask first).{' '}
              <strong>Standard</strong> confirms before risky external effects.
            </span>
          </span>
          <select
            value={orchestratorAutonomyMode}
            onChange={(e) =>
              setOrchestratorAutonomyMode(e.target.value === 'broad' ? 'broad' : 'standard')
            }
            className="w-full max-w-[14rem] rounded border border-tile-border bg-black/35 px-2 py-1 text-gray-100 sm:w-52"
          >
            <option value="broad">Broad (default)</option>
            <option value="standard">Standard</option>
          </select>
        </label>
        <p className="text-[11px] text-gray-600">
          Harness: <code className="rounded bg-black/35 px-1">npm run harness:eval -- --candidate &lt;id&gt; --split proactive</code>
        </p>
      </SettingsAccordion>

      <SettingsAccordion
        id="agent-orch"
        title="Orchestrator chat"
        description="Name, optional personality files, narrator, and delegation rules."
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex flex-col gap-0.5">
              <span className="text-gray-200">Display name</span>
              <span className="text-[11px] text-gray-500">
                Shown in the chat (e.g. <code>Mei</code>, <code>Sora</code>). Defaults to <code>Assistant</code>.
              </span>
            </span>
            <input
              type="text"
              value={orchestratorDisplayName}
              maxLength={48}
              placeholder="Assistant"
              onChange={(e) => setOrchestratorDisplayName(e.target.value)}
              onBlur={(e) => setOrchestratorDisplayName(e.target.value)}
              className="w-full max-w-[14rem] rounded border border-tile-border bg-black/40 px-2 py-1 text-gray-100 sm:w-52"
            />
          </label>
          <SettingsToggleRow
            label="Import personality.md into the system prompt"
            hint="Looks in workspace (personality.md, .orca/personality.md, .claude/personality.md), then ~/.claude/personality.md and ~/.orca/personality.md."
            checked={orchestratorPersonalityEnabled}
            onChange={setOrchestratorPersonalityEnabled}
          />
          <SettingsToggleRow
            label="Import soul.md into the system prompt"
            hint="Same search order as personality.md. Both files are merged with orca.md / CLAUDE.md."
            checked={orchestratorSoulEnabled}
            onChange={setOrchestratorSoulEnabled}
          />
          <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex flex-col gap-0.5">
              <span className="text-gray-200">Narrator generation</span>
              <span className="text-[11px] text-gray-500">
                Template mode uses 100+ built-in phrasing variants. AI mode rewrites each line with your selected
                model.
              </span>
            </span>
            <select
              value={narratorMode}
              onChange={(e) => setNarratorMode(e.target.value === 'ai' ? 'ai' : 'template')}
              className="w-full max-w-[14rem] rounded border border-tile-border bg-black/35 px-2 py-1 text-gray-100 sm:w-52"
            >
              <option value="template">Template variations (fast)</option>
              <option value="ai">AI generated</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex flex-col gap-0.5">
              <span className="text-gray-200">Narrator model</span>
              <span className="text-[11px] text-gray-500">
                Used only when narrator generation is AI. Default follows your main orchestrator model.
              </span>
            </span>
            <select
              value={narratorAiModelId ?? ''}
              onChange={(e) => setNarratorAiModelId(e.target.value || null)}
              className="w-full max-w-[18rem] rounded border border-tile-border bg-black/35 px-2 py-1 text-gray-100 sm:w-72"
            >
              <option value="">
                Default orchestrator model
                {selectedModel ? ` (${selectedModel})` : ''}
              </option>
              {narratorModelChoices.map((m) => (
                <option key={`narrator-model-${m.id}`} value={m.id}>
                  {m.displayName} ({PROVIDER_INFO[m.provider].name})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 rounded-lg border border-tile-border bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex flex-col gap-0.5">
              <span className="text-gray-200">Prompt articulation</span>
              <span className="text-[11px] text-gray-500">
                Expands shorthand and vague requests before parallel planning. The default runs only on short or
                underspecified prompts (heuristic). “Every turn” adds one LLM call before classification on every
                message (except heartbeat runs).
              </span>
            </span>
            <select
              value={orchestratorArticulationMode}
              onChange={(e) =>
                setOrchestratorArticulationMode(e.target.value as OrchestratorArticulationMode)
              }
              className="w-full max-w-[18rem] rounded border border-tile-border bg-black/35 px-2 py-1 text-gray-100 sm:w-60"
            >
              <option value="off">Off</option>
              <option value="before_planning">Vague or short prompts (default)</option>
              <option value="always">Every turn</option>
            </select>
          </label>
          <SettingsToggleRow
            label="Lead delegates only (no direct file/terminal tools on main orchestrator)"
            checked={orchestratorLeadDelegationOnly}
            onChange={setOrchestratorLeadDelegationOnly}
          />
          <SettingsToggleRow
            label="Auto-accept all orchestrator file writes (diffs)"
            hint="On by default: successful write_file previews drop from the tracker immediately (Cursor-style). You can still review from the orchestrator diff list until the next write. Turn off to keep every preview until you dismiss it."
            checked={autoAcceptOrchestratorDiffs}
            onChange={setAutoAcceptOrchestratorDiffs}
          />
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="agent-traces"
        title="Harness traces & experiments"
        description="Write JSONL traces, export runs, and tune harness experiments."
      >
        <div className="space-y-2">
          <SettingsToggleRow
            label="Write raw harness traces (.agent-canvas/harness/traces)"
            checked={harnessTraceRaw}
            onChange={setHarnessTraceRaw}
          />
          <SettingsToggleRow
            label="Diagnostic traces (detailed rows, redacted)"
            hint="Requires raw traces."
            checked={harnessTraceDetailed}
            onChange={setHarnessTraceDetailed}
            disabled={!harnessTraceRaw}
          />
          <SettingsToggleRow
            label="Snapshot harness state after each run"
            checked={harnessFileStateSnapshot}
            onChange={setHarnessFileStateSnapshot}
          />
          <SettingsToggleRow
            label="Memory distiller (session-end lessons + signals)"
            hint="Default off. Enable after `npm run harness:eval` with `--split memory` shows a positive passRateDelta (see docs/MEMORY_ARCHITECTURE.md). Desktop: writes `.orca/MEMORY.md` + `.orca/MEMORY.signals.jsonl`."
            checked={orcaMemoryDistillerEnabled}
            onChange={setOrcaMemoryDistillerEnabled}
          />
          <SettingsToggleRow
            label="Inject active harness candidate into system prompt"
            hint="Reads `.agent-canvas/harness/active-candidate.json` when present."
            checked={harnessAutoApplyBestCandidate}
            onChange={setHarnessAutoApplyBestCandidate}
          />
        </div>

        <div className="mt-4 space-y-2 border-t border-tile-border/80 pt-4">
          <p className="text-xs text-gray-600">Export under .agent-canvas/harness/experiments/</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Session key"
              value={harnessExperimentSession}
              onChange={(e) => setHarnessExperimentSession(e.target.value)}
              className="min-w-[12rem] flex-1 rounded border border-tile-border bg-black/35 px-2 py-1.5 font-mono text-xs text-gray-200"
            />
            <button
              type="button"
              disabled={!lastHarnessTraceSessionKey}
              onClick={() =>
                lastHarnessTraceSessionKey && setHarnessExperimentSession(lastHarnessTraceSessionKey)
              }
              className="rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-40"
            >
              Use last run
            </button>
          </div>
          <input
            type="text"
            placeholder="Experiment id (optional)"
            value={harnessExperimentId}
            onChange={(e) => setHarnessExperimentId(e.target.value)}
            className="w-full rounded border border-tile-border bg-black/35 px-2 py-1.5 font-mono text-xs text-gray-200"
          />
          <textarea
            placeholder="Hypothesis note (optional)"
            value={harnessHypothesis}
            onChange={(e) => setHarnessHypothesis(e.target.value)}
            rows={2}
            className="w-full resize-y rounded border border-tile-border bg-black/35 px-2 py-1.5 text-xs text-gray-200 placeholder:text-gray-600"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={harnessExperimentBusy || !harnessExperimentSession.trim()}
              onClick={() => {
                const key = harnessExperimentSession.trim()
                if (!key) return
                setHarnessExperimentBusy(true)
                void analyzeHarnessTraceSession(key)
                  .then(({ stats, hints, metrics, workflowTrace }) => {
                    setHarnessWorkflowTracePreview(workflowTrace)
                    const workflowLines = workflowTrace.present
                      ? [
                          `workflow: required_lanes=${workflowTrace.requiredLanes.length ? workflowTrace.requiredLanes.join(',') : '(none)'}`,
                          ...(workflowTrace.routes.length
                            ? workflowTrace.routes.slice(0, 8).map((route) => {
                                const reason = route.laneReason ? ` reason=${route.laneReason}` : ''
                                const profile = route.authProfileId ? ` profile=${route.authProfileId}` : ''
                                return `  route: ${route.command} -> ${route.lane}${reason}${profile}`
                              })
                            : ['  route: (none)']),
                        ]
                      : ['workflow: workflow_trace_context not present']
                    const lines = [
                      `session: ${stats.sessionKey}`,
                      `metrics: ok_rate=${(metrics.runEndOkRate * 100).toFixed(1)}% batches/run_end=${metrics.toolBatchesPerRunEnd.toFixed(2)} median_llm_gap_ms=${metrics.medianInterLlmRoundMs ?? 'n/a'} wall_ms=${metrics.traceWallMs ?? 'n/a'}`,
                      `counts: lines=${stats.lineCount} tool_batches=${stats.toolBatches} llm_rounds=${stats.llmRounds} run_ends=${stats.runEnds} (ok ${stats.okRuns} / fail ${stats.failedRuns})`,
                      ...workflowLines,
                      'hints:',
                      ...hints.map((h) => `  [${h.id}] ${h.message}`),
                    ]
                    setHarnessExperimentReport(lines.join('\n'))
                    addToast({
                      type: 'success',
                      title: 'Harness hints',
                      message: `${hints.length} suggestion(s) from trace stats.`,
                    })
                  })
                  .catch((e) => {
                    const msg = e instanceof Error ? e.message : String(e)
                    setHarnessWorkflowTracePreview(null)
                    setHarnessExperimentReport(`Error: ${msg}`)
                    addToast({ type: 'error', title: 'Analyze failed', message: msg })
                  })
                  .finally(() => setHarnessExperimentBusy(false))
              }}
              className="rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-40"
            >
              Show hints from trace
            </button>
            <button
              type="button"
              disabled={harnessExperimentBusy || !harnessExperimentSession.trim()}
              onClick={() => {
                const key = harnessExperimentSession.trim()
                if (!key) return
                setHarnessExperimentBusy(true)
                void exportHarnessExperimentArchive(key, {
                  experimentId: harnessExperimentId.trim() || undefined,
                  hypothesis: harnessHypothesis.trim() || undefined,
                })
                  .then(({ experimentId, rootRel, workflowTrace }) => {
                    setHarnessWorkflowTracePreview(workflowTrace)
                    setHarnessExperimentReport(`Exported experiment "${experimentId}" → workspace ${rootRel}/`)
                    addToast({
                      type: 'success',
                      title: 'Experiment exported',
                      message: `${rootRel}/`,
                    })
                  })
                  .catch((e) => {
                    const msg = e instanceof Error ? e.message : String(e)
                    setHarnessWorkflowTracePreview(null)
                    setHarnessExperimentReport(`Error: ${msg}`)
                    addToast({ type: 'error', title: 'Export failed', message: msg })
                  })
                  .finally(() => setHarnessExperimentBusy(false))
              }}
              className="rounded-lg bg-accent-teal/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-accent-teal disabled:opacity-40"
            >
              Export experiment folder
            </button>
            <button
              type="button"
              disabled={harnessExperimentBusy}
              onClick={() => {
                setHarnessExperimentBusy(true)
                void exportHarnessParetoFrontierReport()
                  .then(({ jsonPath, csvPath, frontier }) => {
                    setHarnessExperimentReport(
                      `Pareto: ${frontier.nonDominatedIds.length} non-dominated of ${frontier.points.length} candidates.\n${jsonPath}\n${csvPath}`
                    )
                    addToast({
                      type: 'success',
                      title: 'Pareto frontier',
                      message: `${frontier.nonDominatedIds.length} point(s) on frontier`,
                    })
                  })
                  .catch((e) => {
                    const msg = e instanceof Error ? e.message : String(e)
                    setHarnessExperimentReport(`Error: ${msg}`)
                    addToast({ type: 'error', title: 'Pareto export failed', message: msg })
                  })
                  .finally(() => setHarnessExperimentBusy(false))
              }}
              className="rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-40"
            >
              Export Pareto frontier
            </button>
            <button
              type="button"
              disabled={harnessExperimentBusy}
              onClick={() => {
                setHarnessExperimentBusy(true)
                void maybeAutoApplyBestHarnessCandidate({
                  reason: 'Manual: best passRate / meanContextKTokens ratio (non-dominated)',
                })
                  .then((result) => {
                    if (result.status === 'applied') {
                      setHarnessExperimentReport(
                        `Active harness candidate → ${result.candidateId}${
                          result.previousCandidateId
                            ? ` (was ${result.previousCandidateId}, backed up)`
                            : ''
                        }`
                      )
                      addToast({
                        type: 'success',
                        title: 'Active candidate',
                        message: result.candidateId ?? '',
                      })
                    } else if (result.status === 'skipped_regression') {
                      const pass = result.candidatePassRate?.toFixed(3) ?? '?'
                      const base = result.baselinePassRate?.toFixed(3) ?? '?'
                      setHarnessExperimentReport(
                        `Skipped: regression gate (pass ${pass} vs. baseline ${base}, tol ${result.tolerance})`
                      )
                      addToast({
                        type: 'warning',
                        title: 'Regression gate',
                        message: `pass ${pass} < baseline ${base} - ${result.tolerance}`,
                      })
                    } else if (result.status === 'skipped_same') {
                      setHarnessExperimentReport(
                        `Already active: ${result.candidateId}`
                      )
                      addToast({
                        type: 'info',
                        title: 'Already active',
                        message: result.candidateId ?? '',
                      })
                    } else if (result.status === 'skipped_no_candidate') {
                      setHarnessExperimentReport('No scored candidates on the Pareto frontier.')
                      addToast({
                        type: 'info',
                        title: 'No candidate',
                        message: 'Score at least one candidate first.',
                      })
                    }
                  })
                  .catch((e) => {
                    const msg = e instanceof Error ? e.message : String(e)
                    addToast({ type: 'error', title: 'Active candidate failed', message: msg })
                  })
                  .finally(() => setHarnessExperimentBusy(false))
              }}
              className="rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-40"
            >
              Set best Pareto as active
            </button>
            <button
              type="button"
              disabled={harnessExperimentBusy}
              onClick={() => {
                setHarnessExperimentBusy(true)
                void revertActiveHarnessCandidate()
                  .then((r) => {
                    if (r.ok) {
                      setHarnessExperimentReport(`Reverted to ${r.candidateId}`)
                      addToast({
                        type: 'success',
                        title: 'Reverted',
                        message: r.candidateId,
                      })
                    } else {
                      setHarnessExperimentReport(`No backup to revert (${r.reason}).`)
                      addToast({
                        type: 'info',
                        title: 'Nothing to revert',
                        message: r.reason,
                      })
                    }
                  })
                  .catch((e) => {
                    const msg = e instanceof Error ? e.message : String(e)
                    addToast({ type: 'error', title: 'Revert failed', message: msg })
                  })
                  .finally(() => setHarnessExperimentBusy(false))
              }}
              className="rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-40"
            >
              Revert active candidate
            </button>
          </div>
          {harnessWorkflowTracePreview?.present ? (
            <div className="space-y-1.5 rounded border border-tile-border/80 bg-black/20 p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Required lanes</span>
                {harnessWorkflowTracePreview.requiredLanes.length > 0 ? (
                  harnessWorkflowTracePreview.requiredLanes.map((lane) => (
                    <span
                      key={`lane-${lane}`}
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${laneChipClass(lane)}`}
                    >
                      {lane}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border border-gray-600/70 bg-black/25 px-2 py-0.5 font-mono text-[10px] text-gray-400">
                    (none)
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {harnessWorkflowTracePreview.routes.length > 0 ? (
                  harnessWorkflowTracePreview.routes.slice(0, 12).map((route, idx) => (
                    <div
                      key={`route-${route.command}-${route.lane}-${idx}`}
                      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${laneChipClass(route.lane)}`}
                      title={`${route.command} -> ${route.lane}${route.laneReason ? ` | reason=${route.laneReason}` : ''}${route.authProfileId ? ` | profile=${route.authProfileId}` : ''}`}
                    >
                      <span className="font-mono">{route.command}</span>
                      <span className="opacity-80">→</span>
                      <span className="font-semibold">{route.lane}</span>
                      {route.authProfileId ? (
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-[1px] font-mono text-[9px] text-emerald-200">
                          {route.authProfileId}
                        </span>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <span className="rounded-full border border-gray-600/70 bg-black/25 px-2 py-0.5 font-mono text-[10px] text-gray-400">
                    command routes unavailable
                  </span>
                )}
              </div>
            </div>
          ) : null}
          {harnessExperimentReport ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-tile-border bg-black/35 p-2 font-mono text-[10px] leading-snug text-gray-400">
              {harnessExperimentReport}
            </pre>
          ) : null}
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="agent-safety"
        title="Safety"
        description="Warn or block risky shell patterns; optional read-only orchestrator terminal."
      >
        <SettingsSurface className="!bg-black/10 !p-3">
          <div className="mb-2 text-sm text-gray-200">Safety mode (shell / sensitive paths)</div>
          <select
            value={harnessSafetyMode}
            onChange={(e) => setHarnessSafetyMode(e.target.value as 'off' | 'warn' | 'block')}
            className="w-full rounded border border-tile-border bg-tile-bg px-2 py-1.5 text-gray-200"
          >
            <option value="off">Off</option>
            <option value="warn">Warn only (default)</option>
            <option value="block">Block risky patterns</option>
          </select>
        </SettingsSurface>
        <div className="mt-3">
          <SettingsToggleRow
            label="Read-only orchestrator terminal (meta.command)"
            hint="Does not filter manual typing."
            checked={harnessTerminalReadOnlyBash}
            onChange={setHarnessTerminalReadOnlyBash}
          />
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="agent-bounty"
        title="Bug bounty queue"
        description="Send high-severity issues to a dedicated lane and optional hunter sub-agents."
      >
        <div className="space-y-3">
          <SettingsToggleRow
            label="Route critical/high issues to bounty queue"
            checked={orcaBugBountyLaneEnabled}
            onChange={setOrcaBugBountyLaneEnabled}
          />
          <SettingsToggleRow
            label="Auto-spawn bounty sub-agents"
            checked={orcaBugBountyAutoDelegateSubagents}
            onChange={setOrcaBugBountyAutoDelegateSubagents}
            disabled={!orcaBugBountyLaneEnabled}
          />
          <div>
            <label
              className={`mb-1 block text-xs text-gray-500 ${
                !orcaBugBountyLaneEnabled ? 'opacity-50' : ''
              }`}
            >
              Bounty hunter model
            </label>
            <select
              value={orcaBugBountyHunterModelId ?? ''}
              onChange={(e) =>
                setOrcaBugBountyHunterModelId(e.target.value === '' ? null : e.target.value)
              }
              disabled={!orcaBugBountyLaneEnabled || bountyHunterToolCapableModels.length === 0}
              className="w-full rounded-lg border border-tile-border bg-tile-bg px-3 py-2 text-sm text-white focus:border-accent-teal focus:outline-none disabled:opacity-50"
            >
              <option value="">Automatic (same routing as other sub-agents)</option>
              {bountyHunterToolCapableModels.map((m) => (
                <option key={`bounty-hunter-${m.id}`} value={m.id}>
                  {m.displayName} · {PROVIDER_INFO[m.provider].name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-snug text-gray-500">
              Pin a dedicated model for bounty hunter troubleshooter sub-agents. Useful when several
              hunters run in parallel — routing them to a different provider/key avoids 429s on
              your main orchestrator model.
            </p>
            {bountyHunterToolCapableModels.length === 0 ? (
              <p className="mt-1 text-[11px] text-amber-200/80">
                Enable a provider with tool-capable models to pin a bounty hunter model.
              </p>
            ) : null}
          </div>
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="agent-advanced"
        title="Harness tuning"
        description="Fine-grained harness switches. All enabled matches the default profile."
      >
        <div className="space-y-2">
          <SettingsToggleRow
            label="Stagnation guard"
            checked={harnessStagnationGuard}
            onChange={setHarnessStagnationGuard}
          />
          <SettingsToggleRow
            label="Inspect auto-detection"
            checked={harnessInspectErrorDetection}
            onChange={setHarnessInspectErrorDetection}
          />
          <SettingsToggleRow
            label="Auto-fix gate (canAutoFix)"
            checked={harnessAutoFixGate}
            onChange={setHarnessAutoFixGate}
          />
          <SettingsToggleRow
            label="Parallel batch safety (FS overlap)"
            checked={harnessParallelBatchRules}
            onChange={setHarnessParallelBatchRules}
          />
          <SettingsToggleRow
            label="Compact sub-agent preamble"
            checked={harnessSubAgentCompactContext}
            onChange={setHarnessSubAgentCompactContext}
          />
          <SettingsToggleRow
            label="Git worktree per sub-agent (desktop, git repo)"
            checked={harnessSubAgentAutoWorktree}
            onChange={setHarnessSubAgentAutoWorktree}
          />
        </div>
      </SettingsAccordion>
    </div>
  )
}

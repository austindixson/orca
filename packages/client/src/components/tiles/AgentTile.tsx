import { useState, useEffect, useRef, useCallback, useMemo, type DragEvent } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { TileComponentProps } from '../Canvas/TileRegistry'
import {
  useSettingsStore,
  PROVIDER_INFO,
  ZAI_DEFAULT_BASE,
  ZAI_DEFAULT_MODEL_ID,
  sortModelsForDisplay,
  type Provider,
} from '../../store/settingsStore'
import { useToastStore } from '../../store/toastStore'
import { resolveApiKey, resolveBaseUrl } from '../../lib/llmCredentials'
import { runOrchestratorAgent } from '../../lib/orchestrator/runOrchestrator'
import { providerSupportsOrchestratorTools, type ChatMessage } from '../../lib/orchestrator/types'
import { emitRefreshChangelog } from '../../lib/uiEvents'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import { filesToImageAttachments, type ImageAttachment } from '../../lib/imageAttachments'
import { preprocessImagesWithZai } from '../../lib/zaiVisionPreprocess'
import { loadInstalledSkillsCatalogForOrchestrator, resolveSkillCommandPrompt } from '../../lib/skillCommands'
import { useAgentTeamStore } from '../../store/agentTeamStore'
import { useAgentTaskStore, type AgentTaskEntry } from '../../store/agentTaskStore'
import { useAgentSubtaskStore } from '../../store/agentSubtaskStore'
import { classifyAgentLogLine } from '../../lib/agentIssueDetector'
import { AgentHeader } from './agent-tile/AgentHeader'
import { AgentStatusStrip } from './agent-tile/AgentStatusStrip'
import { AgentOutputStream } from './agent-tile/AgentOutputStream'
import { AgentTraceDrawer } from './agent-tile/AgentTraceDrawer'
import { AgentHistoryDrawer } from './agent-tile/AgentHistoryDrawer'
import { AgentInputRow } from './agent-tile/AgentInputRow'
import { AgentTaskPanel } from './agent-tile/AgentTaskPanel'
import { isOrchestratorTraceVerbBumpLine } from '../../lib/orchestrator/activityLineParsing'
import {
  glitterVerbForToolInvocation,
  shimmerThinkingPhrase,
  shimmerVerbFromTraceLine,
} from '../../lib/orchestrator/orchestratorShimmerVerbs'
import {
  collapseStillWaitingRuns,
  extractDelegatedTraceChip,
  flattenLogTail,
  type DelegatedTraceChip,
} from '../../lib/orchestrator/delegatedLogPresentation'
import { useTileMountAck } from '../../hooks/useTileMountAck'
import { pickPreferredVisionModel } from '../../lib/modelRouting'

type AgentStatus = 'idle' | 'working' | 'done' | 'error'

/**
 * Z.AI Open Platform HTTP API: base is …/paas/v4, resource is /chat/completions.
 * @see https://docs.z.ai/guides/develop/http/introduction
 */
function zaiChatCompletionsUrl(rawBase: string): string {
  const t = rawBase.trim().replace(/\/+$/, '')
  if (/\/chat\/completions(\?|$)/.test(t)) return t
  return `${t}/chat/completions`
}

function isZaiVisionModel(model: string): boolean {
  return /(?:^|[\W_])(glm-(?:5v|4\.6v|4\.5v))/i.test(model) || /glm-5v-turbo/i.test(model)
}

function isZaiCodingPlanModel(model: string): boolean {
  const t = model.toLowerCase()
  return (
    isZaiVisionModel(model) ||
    /glm-(?:4\.5|4\.6|4\.7|5(?:\.1)?)(?:$|[\W_])/i.test(t)
  )
}

function zaiBaseForModel(model: string, base: string): string {
  if (!isZaiCodingPlanModel(model)) return base
  return base.replace(/\/api\/paas\/v4/i, '/api/coding/paas/v4')
}

function isZaiRateLimitError(msg: string): boolean {
  const t = msg.toLowerCase()
  return t.includes('rate limited') || t.includes('quota') || t.includes('429')
}

export function AgentTile({ data }: TileComponentProps) {
  const { getAvailableModels, selectedModel, setSelectedModel, toggleSettings, providers } = useSettingsStore()
  const addToast = useToastStore((s) => s.addToast)
  const updateTile = useCanvasStore((s) => s.updateTile)
  useTileMountAck(data.id, true)
  
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [output, setOutput] = useState<string[]>([])
  const [task, setTask] = useState('')
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionMessages, setSessionMessages] = useState<ChatMessage[]>([])
  /** Last submitted prompt (non-delegated) — pinned in the Task panel at the top. */
  const [taskSnapshot, setTaskSnapshot] = useState<string>('')
  /** Collapsible trace panel — default collapsed, chip strip stays visible. */
  const [traceExpanded, setTraceExpanded] = useState(false)
  /** Collapsible Tasks panel (per-agent task history). Current-task chip stays visible. */
  const [tasksExpanded, setTasksExpanded] = useState(true)
  /**
   * Chat stream defaults collapsed. Expanded when the user adds an Agent tile from the
   * +Tiles menu (meta.fromAddTileMenu). Delegated sub-agents stay collapsed.
   */
  const [chatExpanded, setChatExpanded] = useState<boolean>(() => {
    if (data.meta?.subAgentDelegated === true) return false
    return data.meta?.fromAddTileMenu === true
  })
  /** Text field hidden until user expands (Stop/Run stay reachable when needed). */
  const [composeExpanded, setComposeExpanded] = useState(false)
  /** Kebab menu (Restart task / Nudge / Clear task history). */
  const [menuOpen, setMenuOpen] = useState(false)
  /** Status verb while streaming (claw-code–style: tool-aware or Thinking). */
  const [verbPhrase, setVerbPhrase] = useState<string>('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const outputRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const streamStartRef = useRef<number | null>(null)

  const delegated = data.meta?.subAgentDelegated === true
  const teamMember = useAgentTeamStore((s) => s.membersByTileId[data.id])
  const agentTasks = useAgentTaskStore((s) => s.byTileId[data.id] ?? [])
  const currentTaskEntry: AgentTaskEntry | undefined =
    agentTasks.length > 0 ? agentTasks[agentTasks.length - 1] : undefined

  const delegatedFullTraceText = useMemo(() => {
    if (!teamMember?.logTail?.length) return ''
    return flattenLogTail(teamMember.logTail).join('\n')
  }, [teamMember?.logTail])

  const delegatedDisplayText = useMemo(() => {
    if (!teamMember?.logTail?.length) return ''
    return collapseStillWaitingRuns(flattenLogTail(teamMember.logTail)).join('\n')
  }, [teamMember?.logTail])

  /**
   * Trace chips — orchestrator tool log plus sub-agent log tail / local output.
   * Must run before any early return (hooks rule).
   */
  const traceChips = useMemo((): DelegatedTraceChip[] => {
    const logLines: string[] = []
    if (Array.isArray(data.meta?.orchestratorToolLog)) {
      logLines.push(...(data.meta.orchestratorToolLog as string[]))
    }
    if (delegated) {
      logLines.push(...flattenLogTail(teamMember?.logTail ?? []))
    } else {
      for (const chunk of output) {
        for (const ln of String(chunk).split('\n')) logLines.push(ln)
      }
    }
    const chips: DelegatedTraceChip[] = []
    logLines.forEach((raw, i) => {
      const chip = extractDelegatedTraceChip(raw, i)
      if (!chip) return
      chips.push(chip)
    })
    return chips
  }, [data.meta?.orchestratorToolLog, delegated, teamMember?.logTail, output])

  const fallbackTraceChip = useMemo<DelegatedTraceChip | null>(() => {
    if (traceChips.length > 0) return null
    const hint = delegated
      ? (teamMember?.currentTask?.trim() ||
        (teamMember?.status === 'working' ? 'Working…' : 'No trace yet'))
      : (status === 'working'
          ? 'Working…'
          : currentTaskEntry?.text?.trim() || taskSnapshot.trim() || 'No trace yet')
    if (!hint) return null
    return {
      id: `fallback-${data.id}`,
      kind: 'info',
      name: hint.slice(0, 72),
    }
  }, [traceChips, delegated, teamMember?.currentTask, teamMember?.status, status, currentTaskEntry, taskSnapshot, data.id])

  const recentChips = traceChips.length > 0 ? traceChips : fallbackTraceChip ? [fallbackTraceChip] : []
  const hiddenChipCount = 0

  const outputRawText = useMemo(
    () => (delegated ? delegatedDisplayText : output.join('')),
    [delegated, delegatedDisplayText, output]
  )

  const lastToolChip = useMemo(() => {
    const toolOnly = traceChips.filter((c) => c.kind !== 'info')
    return toolOnly.length ? toolOnly[toolOnly.length - 1]! : null
  }, [traceChips])

  const idleSummary = useMemo(() => {
    const parts: string[] = []
    if (status === 'done') parts.push('Last run: done')
    else if (status === 'error') parts.push('Last run: error')
    else parts.push('Idle · ready for a task')
    if (currentTaskEntry && currentTaskEntry.status !== 'running') {
      const e = currentTaskEntry.issues.error + currentTaskEntry.issues.fail
      const w = currentTaskEntry.issues.warning
      if (e) parts.push(`${e} err/fail`)
      if (w) parts.push(`${w} warn`)
    }
    return parts.join(' · ')
  }, [status, currentTaskEntry])

  const availableModels = sortModelsForDisplay(getAvailableModels())
  const currentModel = availableModels.find((m) => m.id === selectedModel)
  const hasModels = availableModels.length > 0

  /** Non-Picasso: collapse clutter by removing finished agent tiles after a short delay. */
  useEffect(() => {
    if (data.meta?.subAgentDelegated === true) return
    if (useSettingsStore.getState().picassoMode) return
    if (status !== 'done') return
    const timer = window.setTimeout(() => {
      useCanvasStore.getState().removeTile(data.id)
    }, 4500)
    return () => window.clearTimeout(timer)
  }, [status, data.id, data.meta?.subAgentDelegated])

  /**
   * Delegated sub-agents: dismiss the tile when the run terminates (done or cancelled)
   * while keeping the Agent Team roster entry so the user can acknowledge work done
   * and check the status/summary from the team tile (non-Picasso).
   */
  useEffect(() => {
    if (data.meta?.subAgentDelegated !== true) return
    if (useSettingsStore.getState().picassoMode) return
    const isDone = teamMember?.status === 'done'
    const isCancelled = data.tileStatus === 'idle' && teamMember?.currentTask === 'Cancelled'
    if (!isDone && !isCancelled) return
    const timer = window.setTimeout(() => {
      useCanvasStore.getState().removeTile(data.id, { preserveAgentTeamEntry: true })
    }, 4500)
    return () => window.clearTimeout(timer)
  }, [
    data.id,
    data.meta?.subAgentDelegated,
    data.tileStatus,
    teamMember?.status,
    teamMember?.currentTask,
  ])

  useEffect(() => {
    if (!hasModels) return
    const ids = new Set(availableModels.map((m) => m.id))
    if (selectedModel && ids.has(selectedModel)) return
    const first = availableModels[0]
    if (first) setSelectedModel(first.id)
  }, [hasModels, selectedModel, availableModels, setSelectedModel])

  useEffect(() => {
    if (!chatExpanded) return
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output, delegated, teamMember?.logTail, outputRawText, chatExpanded])

  /** Shimmer verb: advance on tool chips / trace lines, not on a fixed timer. */
  useEffect(() => {
    const streaming = delegated ? teamMember?.status === 'working' : isStreaming
    if (!streaming) {
      setVerbPhrase('')
      return
    }
    if (lastToolChip) {
      setVerbPhrase(glitterVerbForToolInvocation(lastToolChip.name, undefined))
      return
    }
    if (delegated) {
      const flat = flattenLogTail(teamMember?.logTail ?? [])
      const lastLine = flat[flat.length - 1] ?? ''
      if (lastLine && isOrchestratorTraceVerbBumpLine(lastLine)) {
        setVerbPhrase(shimmerVerbFromTraceLine(lastLine.slice(0, 200)))
        return
      }
    }
    setVerbPhrase((prev) => prev || shimmerThinkingPhrase(`agent:${data.id}:start`))
  }, [isStreaming, delegated, teamMember?.status, data.id, lastToolChip, teamMember?.logTail])

  useEffect(() => {
    const streaming = delegated ? teamMember?.status === 'working' : isStreaming
    if (!streaming) {
      setElapsedMs(0)
      streamStartRef.current = null
      return
    }
    if (streamStartRef.current == null) streamStartRef.current = performance.now()
    const elapsedTick = window.setInterval(() => {
      const started = streamStartRef.current
      if (started != null) setElapsedMs(performance.now() - started)
    }, 250)
    return () => {
      window.clearInterval(elapsedTick)
    }
  }, [isStreaming, delegated, teamMember?.status])

  useEffect(() => {
    if (delegated) return
    updateTile(data.id, { tileStatus: status })
  }, [data.id, status, updateTile, delegated])

  useEffect(() => {
    const t = useCanvasStore.getState().tiles.get(data.id)
    if (!t) return
    if (data.meta?.subAgentDelegated === true) {
      const label = teamMember?.executionModelLabel
      if (label) {
        updateTile(data.id, {
          meta: { ...t.meta, subtitle: label },
        })
      }
      return
    }
    const subtitle = currentModel?.displayName ?? ''
    updateTile(data.id, {
      meta: { ...t.meta, subtitle },
    })
  }, [data.id, currentModel?.displayName, updateTile, data.meta?.subAgentDelegated, teamMember?.executionModelLabel])

  const runTask = useCallback(async () => {
    if (data.meta?.subAgentDelegated === true) return
    const text = task.trim()
    if ((!text && attachments.length === 0) || !currentModel || isStreaming) return

    const wantsImages = attachments.length > 0
    let effectiveModel = currentModel
    let shouldRestoreZaiDefaultAfterRun = false
    if (wantsImages) {
      const visionModel = pickPreferredVisionModel(availableModels, currentModel)
      if (!visionModel) {
        addToast({
          type: 'error',
          title: 'No multimodal model available',
          message: 'Enable or select a model that supports image attachments.',
        })
        return
      }
      effectiveModel = visionModel
      shouldRestoreZaiDefaultAfterRun = effectiveModel.provider === 'zai'
      if (effectiveModel.id !== selectedModel) {
        setSelectedModel(effectiveModel.id)
        addToast({
          type: 'info',
          title: 'Using vision-capable model',
          message: `${effectiveModel.displayName} selected for image attachments.`,
        })
      }
    }

    const providerConfig = providers[effectiveModel.provider]
    const apiKey = await resolveApiKey(effectiveModel.provider, providerConfig.apiKey)

    if (effectiveModel.provider === 'openai' && providerConfig.authMode === 'oauth') {
      const { hasOpenAiCodexOAuthOnly } = await import('../../lib/llmCredentials')
      if (await hasOpenAiCodexOAuthOnly()) {
        addToast({
          type: 'error',
          title: 'OpenAI OAuth cannot run models here',
          message:
            'Your desktop ChatGPT/Codex OAuth is signed in, but this account token does not include OpenAI API model scopes. Switch OpenAI auth mode to API key for agent tiles, or use another provider.',
        })
        toggleSettings()
        return
      }
    }

    if (!apiKey && PROVIDER_INFO[effectiveModel.provider].requiresKey) {
      const keyHint =
        effectiveModel.provider === 'zai'
          ? `Set Z.AI in Settings, or env ZAI_API_KEY (recommended), ZHIPU_API_KEY, or GLM_API_KEY (or ~/.hermes/.env, ~/.openclaw/.env). Keys: https://z.ai/manage-apikey/apikey-list — https://docs.z.ai/guides/develop/python/introduction`
          : `Set ${PROVIDER_INFO[effectiveModel.provider].name} in Settings, or use the same env / ~/.hermes/.env / ~/.openclaw/.env keys as Hermes or OpenClaw (e.g. GLM_API_KEY for Z.AI).`
      addToast({
        type: 'error',
        title: 'API key required',
        message: keyHint,
      })
      toggleSettings()
      return
    }

    if (!providerSupportsOrchestratorTools(effectiveModel.provider) || effectiveModel.supportsTools === false) {
      addToast({
        type: 'error',
        title: 'Model unsupported for agent tools',
        message: 'This agent needs a Tools-capable model.',
      })
      return
    }

    setStatus('working')
    setIsStreaming(true)
    const displayText = text || '(image attachment)'
    setTaskSnapshot(displayText)
    useAgentTaskStore.getState().startTask(data.id, displayText, { source: 'user' })
    let promptBaseText = displayText
    if (text) {
      const skillResolved = await resolveSkillCommandPrompt(text)
      if (skillResolved.error) {
        addToast({
          type: 'warning',
          title: 'Skill command',
          message: skillResolved.error,
        })
      }
      if (skillResolved.activated) {
        setOutput((prev) => [
          ...prev,
          `[Skill] Activated /${skillResolved.skillName}${skillResolved.sourcePath ? ` (${skillResolved.sourcePath})` : ''}\n`,
        ])
      }
      promptBaseText = skillResolved.promptText
    }
    setOutput(prev => [...prev, `\n> ${displayText}${attachments.length > 0 ? ` [${attachments.length} image${attachments.length === 1 ? '' : 's'}]` : ''}\n\n`])

    abortControllerRef.current = new AbortController()
    useAgentTeamStore.getState().setAbortController(data.id, abortControllerRef.current)

    try {
      if (wantsImages && effectiveModel.provider === 'zai') {
        setOutput((prev) => [
          ...prev,
          '[Z.AI Vision MCP default] Recommended for Z.AI image workflows: https://docs.z.ai/devpack/mcp/vision-mcp-server\n',
        ])
        for (const img of attachments) {
          setOutput((prev) => [
            ...prev,
            `Read(${img.name})\n`,
            `⎿  Read image (${(img.size / 1024).toFixed(1)}KB)\n`,
          ])
        }
      }

      let finalPrompt = promptBaseText
      if (wantsImages && attachments.length > 0 && effectiveModel.provider === 'zai') {
        const pre = await preprocessImagesWithZai({
          apiKey: apiKey!,
          baseUrl: providerConfig.baseUrl,
          images: attachments.map((img) => ({
            name: img.name,
            size: img.size,
            dataUrl: img.dataUrl,
          })),
          signal: abortControllerRef.current.signal,
        })
        setOutput((prev) => [
          ...prev,
          '⎿  Async hook PreToolUse completed\n',
          `[Vision preprocess] ${pre.modelUsed} analyzed ${attachments.length} image(s).\n`,
        ])
        finalPrompt = `${promptBaseText}\n\n[Vision analysis]\n${pre.summary}`
      }
      const resolvedBaseUrl =
        effectiveModel.provider === 'zai'
          ? zaiChatCompletionsUrl(
              zaiBaseForModel(
                effectiveModel.name,
                ((await resolveBaseUrl('zai', providerConfig.baseUrl)) ||
                  providerConfig.baseUrl ||
                  ZAI_DEFAULT_BASE
                ).trim() || ZAI_DEFAULT_BASE
              )
            )
          : await resolveBaseUrl(effectiveModel.provider, providerConfig.baseUrl)

      let installedSkillsCatalog: string | null = null
      try {
        const cat = await loadInstalledSkillsCatalogForOrchestrator()
        if (cat) installedSkillsCatalog = cat
      } catch {
        /* ignore */
      }

      setOutput((prev) => [
        ...prev,
        `[Using model: ${effectiveModel.displayName} (${effectiveModel.name}) — ${PROVIDER_INFO[effectiveModel.provider].name}]\n`,
      ])
      const zaiVisionFallback =
        wantsImages && effectiveModel.provider === 'zai'
          ? availableModels.find(
              (m) => m.provider === 'zai' && m.id !== effectiveModel.id && /glm-4-5v/i.test(m.id)
            )
          : null
      const attempts = zaiVisionFallback ? [effectiveModel, zaiVisionFallback] : [effectiveModel]
      let result: { assistantText: string; messages: ChatMessage[] } | null = null
      let lastError: unknown = null

      for (let i = 0; i < attempts.length; i++) {
        const m = attempts[i]
        const resolved =
          m.provider === 'zai'
            ? zaiChatCompletionsUrl(
                zaiBaseForModel(
                  m.name,
                  ((await resolveBaseUrl('zai', providerConfig.baseUrl)) ||
                    providerConfig.baseUrl ||
                    ZAI_DEFAULT_BASE
                  ).trim() || ZAI_DEFAULT_BASE
                )
              )
            : resolvedBaseUrl
        if (i > 0) {
          setOutput((prev) => [
            ...prev,
            `[Using model: ${m.displayName} (${m.name}) — ${PROVIDER_INFO[m.provider].name}]\n`,
          ])
          setSelectedModel(m.id)
        }
        try {
          const raw = await runOrchestratorAgent({
            provider: m.provider,
            model: m.name,
            apiKey,
            baseUrl: resolved || providerConfig.baseUrl,
            modelDisplayLabel: `${m.displayName} (${m.name})`,
            messages: sessionMessages,
            userMessage: finalPrompt,
            userContent:
              finalPrompt,
            onLog: (line) => {
              const kind = classifyAgentLogLine(line)
              if (kind) useAgentTaskStore.getState().noteIssue(data.id, kind)
              setOutput((prev) => [...prev, `${line}\n`])
            },
            onAssistantReply: (text) => {
              for (const ln of String(text).split(/\r?\n/)) {
                const kind = classifyAgentLogLine(ln)
                if (kind) useAgentTaskStore.getState().noteIssue(data.id, kind)
              }
              setOutput((prev) => [...prev, `\n${text}\n`])
            },
            orchestratorTileId: data.id,
            runGeneration: useOrchestratorSessionStore.getState().runGeneration,
            signal: abortControllerRef.current.signal,
            installedSkillsCatalog,
          })
          result = raw
          break
        } catch (e) {
          lastError = e
          const msg = e instanceof Error ? e.message : String(e)
          const canTryNext =
            i < attempts.length - 1 && wantsImages && effectiveModel.provider === 'zai' && isZaiRateLimitError(msg)
          if (canTryNext) {
            setOutput((prev) => [
              ...prev,
              '[Z.AI vision fallback] Current model rate-limited. Trying next Z.AI vision model…\n',
            ])
            continue
          }
          throw e
        }
      }

      if (!result && lastError) throw lastError
      if (!result) throw new Error('No vision model succeeded for this image attachment.')
      const { assistantText, messages } = result

      setSessionMessages(messages)
      if (assistantText.trim()) {
        setOutput((prev) => [...prev, `\n${assistantText}\n`])
      }
      setStatus('done')
      useAgentTaskStore.getState().finishTask(data.id, 'done')
      emitRefreshChangelog({ reason: 'agent-task-complete', sourceTileId: data.id })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setOutput(prev => [...prev, '\n[Cancelled]\n'])
        setStatus('idle')
        useAgentTaskStore.getState().finishTask(data.id, 'cancelled')
        emitRefreshChangelog({ reason: 'agent-task-complete', sourceTileId: data.id })
      } else {
        setOutput(prev => [...prev, `\n[Error: ${(error as Error).message}]\n`])
        setStatus('error')
        useAgentTaskStore.getState().finishTask(data.id, 'error', (error as Error).message)
        addToast({
          type: 'error',
          title: 'Request failed',
          message: (error as Error).message,
        })
        emitRefreshChangelog({ reason: 'agent-task-complete', sourceTileId: data.id })
      }
    } finally {
      if (shouldRestoreZaiDefaultAfterRun) {
        const latest = useSettingsStore.getState()
        const hasDefault = latest.getAvailableModels().some((m) => m.id === ZAI_DEFAULT_MODEL_ID)
        if (hasDefault && latest.selectedModel !== ZAI_DEFAULT_MODEL_ID) {
          latest.setSelectedModel(ZAI_DEFAULT_MODEL_ID)
        }
      }
      setIsStreaming(false)
      setTask('')
      setAttachments([])
      useAgentTeamStore.getState().setAbortController(data.id, null)
      abortControllerRef.current = null
    }
  }, [task, attachments, currentModel, providers, addToast, toggleSettings, isStreaming, sessionMessages, data.id, availableModels, selectedModel, setSelectedModel, data.meta?.subAgentDelegated])

  const handleStop = () => {
    if (data.meta?.subAgentDelegated === true) {
      useAgentTeamStore.getState().abortSubAgent(data.id)
      return
    }
    abortControllerRef.current?.abort()
  }

  const handleClear = () => {
    setOutput([])
    setStatus('idle')
    setSessionMessages([])
    setTaskSnapshot('')
  }

  /** Kebab menu actions. */
  const currentTaskText = currentTaskEntry?.text ?? taskSnapshot ?? ''

  const handleRestartTask = useCallback(() => {
    if (delegated || !currentTaskText.trim() || isStreaming) return
    // Reuse the prompt input + runTask flow so credential / model checks apply.
    setTask(currentTaskText)
    // Fire on the next tick so the controlled input has committed.
    window.setTimeout(() => void runTask(), 0)
  }, [currentTaskText, delegated, isStreaming, runTask])

  const handleNudge = useCallback(() => {
    if (delegated) return
    if (!currentTaskText.trim() || isStreaming) return
    // "Nudge" appends a short follow-up prompt to keep the conversation moving.
    setTask((prev) => (prev?.trim() ? prev : 'Continue — are you stuck? Report status briefly.'))
  }, [currentTaskText, delegated, isStreaming])

  const handleClearTaskHistory = useCallback(() => {
    useAgentTaskStore.getState().clearTileTasks(data.id)
    useAgentSubtaskStore.getState().clearTile(data.id)
  }, [data.id])

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuOpen])

  const copyAgentTelemetrySnapshot = useCallback(async () => {
    const toolLog = Array.isArray(data.meta?.orchestratorToolLog)
      ? (data.meta!.orchestratorToolLog as string[])
      : []
    const subAgentRole =
      typeof data.meta?.subAgentRole === 'string' ? data.meta.subAgentRole : undefined
    const snap = {
      kind: 'orca.agent_tile',
      tileId: data.id,
      tileTitle: data.title ?? null,
      delegated: delegated || undefined,
      status,
      model: delegated ? teamMember?.executionModelLabel ?? null : currentModel?.id ?? null,
      provider: delegated ? teamMember?.executionProvider ?? null : currentModel?.provider ?? null,
      subAgentRole,
      streaming: delegated ? teamMember?.status === 'working' : isStreaming,
      outputChars: delegated
        ? delegatedDisplayText.length
        : output.join('').length,
      sessionMessagesCount: sessionMessages.length,
      orchestratorToolLogLineCount: toolLog.length,
      teamMember: delegated
        ? {
            status: teamMember?.status,
            currentTask: teamMember?.currentTask,
          }
        : undefined,
      agentTeamRowPresent: delegated ? Boolean(teamMember) : undefined,
      agentTeamNote:
        delegated && !teamMember
          ? 'No agentTeamStore row for this tile id — common after reload before delegated roster was saved with the canvas, or if spawn failed before registerMember.'
          : undefined,
      capturedAt: new Date().toISOString(),
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(snap, null, 2))
      addToast({
        type: 'info',
        title: 'Telemetry',
        message: 'Troubleshooting snapshot copied to clipboard.',
      })
    } catch {
      addToast({ type: 'error', title: 'Copy failed', message: 'Clipboard unavailable.' })
    }
  }, [
    data.id,
    data.title,
    data.meta,
    delegated,
    status,
    teamMember?.executionModelLabel,
    teamMember?.executionProvider,
    teamMember?.status,
    teamMember?.currentTask,
    currentModel?.id,
    currentModel?.provider,
    isStreaming,
    teamMember?.logTail,
    delegatedDisplayText,
    output,
    sessionMessages.length,
    addToast,
  ])

  const handleDropFiles = async (files: File[]) => {
    const { attachments: next, rejected } = await filesToImageAttachments(files)
    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next])
      addToast({
        type: 'success',
        title: 'Images attached',
        message: `${next.length} image${next.length === 1 ? '' : 's'} added.`,
      })
    }
    if (rejected.length > 0) {
      addToast({
        type: 'warning',
        title: 'Some files were skipped',
        message: rejected.slice(0, 2).join(' · '),
      })
    }
  }

  if (!hasModels) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-canvas-bg">
        <svg className="w-16 h-16 text-gray-700 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
        </svg>
        <h3 className="text-lg font-medium text-gray-300 mb-2">No Models Configured</h3>
        <p className="text-sm text-gray-500 text-center mb-4">
          Configure your API keys to start using AI agents
        </p>
        <button
          onClick={toggleSettings}
          className="px-4 py-2 bg-accent-teal text-canvas-bg text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          Configure API Keys
        </button>
      </div>
    )
  }

  const executionProvider = teamMember?.executionProvider
  const providerInfo = currentModel
    ? PROVIDER_INFO[currentModel.provider]
    : executionProvider
      ? PROVIDER_INFO[executionProvider]
      : null
  const streaming = delegated ? teamMember?.status === 'working' : isStreaming
  const subRole = typeof data.meta?.subAgentRole === 'string' ? data.meta.subAgentRole : ''
  const subTask = typeof data.meta?.delegatedTask === 'string' ? data.meta.delegatedTask : ''
  // Bug-bounty hunter tiles carry the troubleshooter system prompt in `delegatedTask`
  // for the LLM; for the human we prefer the concise bug description set in
  // `bountyDisplayTask` (falling back to the original task if older tiles predate this field).
  const bountyDisplayTask =
    typeof data.meta?.bountyDisplayTask === 'string' ? data.meta.bountyDisplayTask : ''
  const isBountyHunterTile =
    typeof data.meta?.bountyItemId === 'string' && data.meta.bountyItemId.length > 0

  /** Scrollable Task panel body: delegated task or the last user prompt. */
  const taskPanelText = delegated
    ? isBountyHunterTile && bountyDisplayTask
      ? bountyDisplayTask
      : subTask
    : taskSnapshot
  const taskPanelRole = delegated ? subRole : ''

  const tileSubtitle =
    typeof data.meta === 'object' && data.meta && 'subtitle' in data.meta
      ? String((data.meta as Record<string, unknown>).subtitle ?? '')
      : ''
  const hideDuplicateModelLabel = Boolean(
    delegated &&
      teamMember?.executionModelLabel &&
      tileSubtitle &&
      tileSubtitle === teamMember.executionModelLabel
  )

  const worktreeError =
    delegated &&
    data.meta &&
    typeof data.meta === 'object' &&
    typeof (data.meta as Record<string, unknown>).subAgentWorktreeError === 'string'
      ? String((data.meta as Record<string, unknown>).subAgentWorktreeError)
      : undefined

  const worktreeSkipped = Boolean(
    delegated &&
      data.meta &&
      typeof data.meta === 'object' &&
      (data.meta as Record<string, unknown>).subAgentWorktreeSkipped === 'no_git_repo'
  )

  const orchestratorToolLogLines = Array.isArray(data.meta?.orchestratorToolLog)
    ? (data.meta!.orchestratorToolLog as string[])
    : undefined

  const showTraceSection =
    streaming ||
    traceChips.length > 0 ||
    (delegated && (teamMember?.logTail?.length ?? 0) > 0) ||
    (orchestratorToolLogLines?.length ?? 0) > 0

  const headerAvatar = delegated
    ? {
        displayName: typeof data.title === 'string' && data.title ? data.title : 'Agent',
        role: subRole || undefined,
        provider: (executionProvider ?? 'openrouter') as Provider,
        title: `${data.title || 'Agent'} — click to change avatar`,
      }
    : null

  const simplifiedDelegatedChrome = delegated

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-canvas-bg">
      <AgentHeader
        delegated={delegated}
        hideDuplicateModelLabel={hideDuplicateModelLabel}
        providerColor={providerInfo?.color}
        avatar={headerAvatar}
        availableModels={availableModels}
        selectedModel={selectedModel || ''}
        onModelChange={setSelectedModel}
        executionModelLabel={teamMember?.executionModelLabel}
        showFreeBadge={Boolean(!delegated && currentModel?.isFree) || Boolean(delegated && teamMember?.executionModelIsFree)}
        showVisionBadge={
          Boolean(!delegated && currentModel?.supportsImages) ||
          Boolean(delegated && teamMember?.executionModelSupportsImages)
        }
        streaming={streaming}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onCopyTelemetry={() => void copyAgentTelemetrySnapshot()}
        onClearOutput={handleClear}
        onOpenSettings={toggleSettings}
        onRestartTask={handleRestartTask}
        onNudge={handleNudge}
        onClearTaskHistory={handleClearTaskHistory}
        restartDisabled={delegated || !currentTaskText.trim() || isStreaming}
        nudgeDisabled={delegated || isStreaming}
        clearHistoryDisabled={agentTasks.length === 0}
      />

      {!simplifiedDelegatedChrome ? (
        <AgentStatusStrip
          tileId={data.id}
          tileType={data.type}
          streaming={streaming}
          verbPhrase={verbPhrase}
          elapsedMs={elapsedMs}
          lastToolChip={lastToolChip}
          delegatedNoWorker={Boolean(delegated && !teamMember)}
          worktreeSkipped={worktreeSkipped}
          worktreeError={worktreeError}
          idleSummary={idleSummary}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AgentTaskPanel
          tileId={data.id}
          taskPanelText={taskPanelText}
          taskPanelRole={taskPanelRole}
          delegated={delegated}
          logText={delegated ? delegatedFullTraceText : outputRawText}
          runStatus={delegated ? teamMember?.status : status}
        />

        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-tile-border bg-black/10 px-3 py-1 text-[11px] text-gray-500">
          <button
            type="button"
            onClick={() => setChatExpanded((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-gray-300"
            aria-expanded={chatExpanded}
            data-tooltip={chatExpanded ? 'Collapse chat' : 'Expand chat'}
          >
            <svg
              className={`h-3 w-3 shrink-0 transition-transform ${chatExpanded ? 'rotate-90' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate font-medium uppercase tracking-wide text-[10px]">Chat</span>
            {!chatExpanded && outputRawText ? (
              <span className="shrink-0 tabular-nums text-gray-600">
                · {outputRawText.split('\n').length} lines
              </span>
            ) : null}
            {!chatExpanded ? (
              <span className="ml-1 shrink-0 text-[10px] text-gray-600">
                {delegated ? 'collapsed' : 'expand for full output'}
              </span>
            ) : null}
          </button>
        </div>

        {chatExpanded ? (
          <div
            ref={outputRef}
            className="min-h-0 flex-1 basis-0 overflow-auto p-3 text-sm leading-relaxed text-gray-400"
          >
            <AgentOutputStream
              rawText={outputRawText}
              delegated={delegated}
              localEmpty={!delegated && output.length === 0}
              currentModelDisplayName={currentModel?.displayName}
            />
          </div>
        ) : null}
      </div>

      <AgentTraceDrawer
        tileId={data.id}
        traceExpanded={traceExpanded}
        setTraceExpanded={setTraceExpanded}
        traceChips={traceChips}
        hiddenChipCount={hiddenChipCount}
        recentChips={recentChips}
        delegated={delegated}
        delegatedFullTraceText={delegatedFullTraceText}
        orchestratorToolLog={orchestratorToolLogLines}
        showTraceSection={showTraceSection}
        runActive={delegated && teamMember?.status === 'working'}
      />

      {!simplifiedDelegatedChrome ? (
        <AgentHistoryDrawer
          tasksExpanded={tasksExpanded}
          setTasksExpanded={setTasksExpanded}
          agentTasks={agentTasks}
          currentTaskEntry={currentTaskEntry}
        />
      ) : null}

      <AgentInputRow
        task={task}
        onTaskChange={setTask}
        onSubmit={() => void runTask()}
        onStop={handleStop}
        streaming={streaming}
        delegated={delegated}
        disabled={streaming || delegated}
        dragActive={dragActive}
        onDragOver={(e: DragEvent) => {
          e.preventDefault()
          e.stopPropagation()
          setDragActive(true)
        }}
        onDragLeave={(e: DragEvent) => {
          e.preventDefault()
          e.stopPropagation()
          setDragActive(false)
        }}
        onDrop={(e: DragEvent) => {
          e.preventDefault()
          e.stopPropagation()
          setDragActive(false)
          const files = Array.from(e.dataTransfer.files || [])
          if (files.length > 0) setComposeExpanded(true)
          void handleDropFiles(files)
        }}
        attachments={attachments}
        onRemoveAttachment={(id: string) => setAttachments((prev) => prev.filter((x) => x.id !== id))}
        attachmentsDisabled={isStreaming}
        composeExpanded={composeExpanded}
        onExpandCompose={() => setComposeExpanded(true)}
      />
    </div>
  )
}

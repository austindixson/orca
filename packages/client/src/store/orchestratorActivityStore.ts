import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { isOrchestratorTraceVerbBumpLine } from '../lib/orchestrator/activityLineParsing'
import {
  glitterVerbForToolComplete,
  glitterVerbForToolInvocation,
  nextGlitterPhrase,
  resetGlitterVerbSession,
} from '../lib/orchestrator/orchestratorShimmerVerbs'

const MAX_FEED = 240

/** Visual effect on the canvas tile when orchestrator auto-focuses it. */
export type OrchestratorTileRevealEffect = 'scan' | 'shimmer' | 'pulse'

export interface OrchestratorTileRevealHint {
  label: string
  effect?: OrchestratorTileRevealEffect
  /**
   * Canvas orchestrator widget tile id or **agent** tile id that owns this tool focus.
   * Used for hub→module link colors. Omitted/`null` = implicit session (e.g. bridge).
   */
  sourceSessionTileId?: string | null
}

/** Stable key for counting in-flight tools per orchestrator/agent session. */
export function sessionKeyForOrchestratorTileId(orchestratorTileId: string | null): string {
  return orchestratorTileId ?? '__null__'
}

/** Inline write preview in the orchestrator sidebar (Cursor-style diff card). */
export interface OrchestratorWritePreview {
  id: string
  path: string
  fileName: string
  language: string
  added: number
  removed: number
  previous: string
  next: string
  /** True after the file write succeeds. */
  done: boolean
}

/** Which canvas tile the orchestrator is actively using (for hub link tint + HUD). */
export interface AgentTileFocus {
  tileId: string
  tileType: 'editor' | 'browser' | 'agent_browser' | 'diff' | 'terminal'
  action: 'reading' | 'writing' | 'navigating' | 'executing'
  /** 0–1 for optional progress UIs */
  progress: number
  /** e.g. line count, URL fragment */
  detail?: string
}

interface OrchestratorActivityState {
  running: boolean
  /** Short status line (claw-code–style shimmer verb), e.g. "🦀 Thinking...", "📄 Reading …" */
  verb: string
  iteration: number
  /** Wall-clock start of the current orchestrator run (for elapsed timer UI). */
  runStartedAtMs: number | null
  /**
   * Lines that look like tool I/O (`→`, `←`, parallel batch `⋯`) for a dedicated Activity panel.
   * Cleared when a new orchestrator run starts; kept after a run ends so you can still read it.
   */
  toolFeed: string[]
  /** Full orchestrator transcript lines (what the input bar used to show). */
  activityFeed: string[]
  /** Latest started tool call line (single-line HUD in orchestrator widget). */
  latestToolCallLine: string | null
  latestToolName: string | null
  latestToolStartedAtMs: number | null
  latestToolElapsedMs: number
  latestToolRunning: boolean
  /** Aggregated model token usage for current run (if provider returns usage). */
  runUsagePromptTokens: number
  runUsageCompletionTokens: number
  runUsageTotalTokens: number
  /** Live estimated context tokens from in-flight orchestrator working set. */
  runEstimatedContextTokens: number
  /** One entry per write_file (for inline diff cards in the main panel). */
  writePreviewItems: OrchestratorWritePreview[]
  pushWritePreview: (p: Omit<OrchestratorWritePreview, 'id' | 'done'> & { id?: string }) => string
  patchWritePreview: (id: string, patch: Partial<Pick<OrchestratorWritePreview, 'done' | 'next' | 'previous'>>) => void
  removeWritePreview: (id: string) => void
  clearWritePreviews: () => void
  /** When true, each successful write_file drops its preview from the tracker immediately (Cursor-style auto-accept). */
  autoAcceptOrchestratorDiffs: boolean
  setAutoAcceptOrchestratorDiffs: (v: boolean) => void
  /**
   * When auto-focus pans to a module, show status + animation on that tile.
   * Cleared when the run ends or a new run starts.
   */
  autoFocusHighlight: {
    tileId: string
    label: string
    effect: OrchestratorTileRevealEffect
    sourceSessionTileId?: string | null
  } | null
  setAutoFocusHighlight: (h: OrchestratorTileRevealHint & { tileId: string } | null) => void
  clearAutoFocusHighlight: () => void
  /**
   * Sticky pointer to the last tile the orchestrator touched, kept even after a run ends
   * (unlike `autoFocusHighlight`, which is cleared on idle so the pulsing label disappears).
   * Lets the "Auto-focus" toolbar button still pan/zoom to "what the orchestrator was using"
   * when the user clicks it between runs.
   */
  lastOrchestratorTileId: string | null
  /** Current agent “attention” target for canvas UX (cursor, link color, browser bar). */
  agentTileFocus: AgentTileFocus | null
  setAgentTileFocus: (focus: AgentTileFocus | null) => void
  /**
   * In-flight `executeOrchestratorTool` depth per session (supports parallel tool batches).
   * Hub→module links animate only when depth &gt; 0 for the highlight’s `sourceSessionTileId`.
   */
  sessionToolDepthByKey: Record<string, number>
  incrementSessionToolDepth: (orchestratorTileId: string | null) => void
  decrementSessionToolDepth: (orchestratorTileId: string | null) => void
  setRunning: (running: boolean) => void
  setVerb: (verb: string) => void
  setIteration: (n: number) => void
  addRunUsage: (u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }) => void
  setRunEstimatedContextTokens: (tokens: number) => void
  appendActivityLine: (line: string) => void
  /** Replace the visible transcript with lines derived from a persisted conversation. */
  seedActivityFromMessages: (lines: string[]) => void
  /** Append one log line to the tool feed when it is tool-related. */
  appendToolFeedLine: (line: string) => void
  clearToolFeed: () => void
  resetIdle: () => void
}

function isToolishLogLine(line: string): boolean {
  const t = line.trimStart()
  return (
    t.startsWith('→') ||
    t.startsWith('←') ||
    t.startsWith('⋯') ||
    t.startsWith('◆')
  )
}

function parseStartedToolName(line: string): string | null {
  const m = line.trimStart().match(/^→\s*([A-Za-z0-9_:-]+)/)
  return m?.[1] ?? null
}

function parseFinishedToolName(line: string): string | null {
  const m = line.trimStart().match(/^←\s*([A-Za-z0-9_:-]+)/)
  return m?.[1] ?? null
}

export const useOrchestratorActivityStore = create<OrchestratorActivityState>((set, get) => ({
  running: false,
  verb: 'Ready',
  iteration: 0,
  runStartedAtMs: null,
  toolFeed: [],
  activityFeed: [],
  latestToolCallLine: null,
  latestToolName: null,
  latestToolStartedAtMs: null,
  latestToolElapsedMs: 0,
  latestToolRunning: false,
  runUsagePromptTokens: 0,
  runUsageCompletionTokens: 0,
  runUsageTotalTokens: 0,
  runEstimatedContextTokens: 0,
  writePreviewItems: [],
  autoAcceptOrchestratorDiffs: true,
  setAutoAcceptOrchestratorDiffs: (v) => set({ autoAcceptOrchestratorDiffs: v }),
  pushWritePreview: (p) => {
    const id = p.id ?? nanoid()
    const entry: OrchestratorWritePreview = {
      id,
      path: p.path,
      fileName: p.fileName,
      language: p.language,
      added: p.added,
      removed: p.removed,
      previous: p.previous,
      next: p.next,
      done: false,
    }
    const prev = get().writePreviewItems
    set({ writePreviewItems: [...prev.slice(-31), entry] })
    return id
  },
  patchWritePreview: (id, patch) => {
    const items = get().writePreviewItems
    set({
      writePreviewItems: items.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })
  },
  removeWritePreview: (id) => {
    const items = get().writePreviewItems
    set({ writePreviewItems: items.filter((x) => x.id !== id) })
  },
  clearWritePreviews: () => set({ writePreviewItems: [] }),
  autoFocusHighlight: null,
  lastOrchestratorTileId: null,
  sessionToolDepthByKey: {},
  incrementSessionToolDepth: (orchestratorTileId) => {
    const k = sessionKeyForOrchestratorTileId(orchestratorTileId)
    const prev = get().sessionToolDepthByKey[k] ?? 0
    set({ sessionToolDepthByKey: { ...get().sessionToolDepthByKey, [k]: prev + 1 } })
  },
  decrementSessionToolDepth: (orchestratorTileId) => {
    const k = sessionKeyForOrchestratorTileId(orchestratorTileId)
    const prev = get().sessionToolDepthByKey[k] ?? 0
    const next = Math.max(0, prev - 1)
    const copy = { ...get().sessionToolDepthByKey }
    if (next === 0) delete copy[k]
    else copy[k] = next
    set({ sessionToolDepthByKey: copy })
  },
  setAutoFocusHighlight: (h) => {
    if (h == null) {
      set({ autoFocusHighlight: null })
      return
    }
    const effect: OrchestratorTileRevealEffect = h.effect ?? 'pulse'
    set({
      autoFocusHighlight: {
        tileId: h.tileId,
        label: h.label,
        effect,
        sourceSessionTileId: h.sourceSessionTileId,
      },
      lastOrchestratorTileId: h.tileId,
    })
  },
  clearAutoFocusHighlight: () => set({ autoFocusHighlight: null }),
  agentTileFocus: null,
  setAgentTileFocus: (focus) => set({ agentTileFocus: focus }),
  setRunning: (running) =>
    set({
      running,
      runStartedAtMs: running ? Date.now() : null,
      ...(running
        ? {
            runUsagePromptTokens: 0,
            runUsageCompletionTokens: 0,
            runUsageTotalTokens: 0,
            runEstimatedContextTokens: 0,
          }
        : {}),
    }),
  setVerb: (verb) => set({ verb }),
  setIteration: (iteration) => set({ iteration }),
  addRunUsage: (u) => {
    const prompt = Math.max(0, Number(u.prompt_tokens) || 0)
    const completion = Math.max(0, Number(u.completion_tokens) || 0)
    const total = Math.max(0, Number(u.total_tokens) || 0)
    set((s) => ({
      runUsagePromptTokens: s.runUsagePromptTokens + prompt,
      runUsageCompletionTokens: s.runUsageCompletionTokens + completion,
      runUsageTotalTokens:
        s.runUsageTotalTokens + (total > 0 ? total : prompt + completion),
    }))
  },
  setRunEstimatedContextTokens: (tokens) =>
    set({ runEstimatedContextTokens: Math.max(0, Math.round(Number(tokens) || 0)) }),
  appendActivityLine: (line: string) => {
    const prev = get().activityFeed
    const nextFeed = [...prev.slice(-(MAX_FEED - 1)), line]
    const bumpVerb = get().running && isOrchestratorTraceVerbBumpLine(line)
    set({
      activityFeed: nextFeed,
      ...(bumpVerb ? { verb: nextGlitterPhrase(`trace:${line.slice(0, 200)}`) } : {}),
    })
  },
  /**
   * Rehydrate the visible orchestrator transcript from a persisted conversation.
   * Only user + assistant turns are surfaced here (tool lines live in `toolFeed`
   * and are reconstructed from `timeline.jsonl` by their own loader).
   * Replaces the current feed — safe to call once on session load while the feed
   * is still empty; later live `appendLog` calls append to what we seed here.
   */
  seedActivityFromMessages: (lines: string[]) => {
    set({ activityFeed: lines.slice(-MAX_FEED) })
  },
  appendToolFeedLine: (line: string) => {
    if (!isToolishLogLine(line)) return
    const prev = get().toolFeed
    const sameAsPrev = prev.length > 0 && prev[prev.length - 1] === line

    const now = Date.now()
    const state = get()
    const startedTool = parseStartedToolName(line)
    const finishedTool = parseFinishedToolName(line)
    const nextFeed = sameAsPrev ? prev : [...prev.slice(-(MAX_FEED - 1)), line]

    if (startedTool) {
      set({
        toolFeed: nextFeed,
        latestToolCallLine: line,
        latestToolName: startedTool,
        latestToolStartedAtMs: now,
        latestToolElapsedMs: 0,
        latestToolRunning: true,
        verb: glitterVerbForToolInvocation(startedTool, line),
      })
      return
    }

    if (finishedTool && state.latestToolRunning && state.latestToolName === finishedTool) {
      set({
        toolFeed: nextFeed,
        latestToolElapsedMs:
          state.latestToolStartedAtMs == null ? 0 : Math.max(0, now - state.latestToolStartedAtMs),
        latestToolRunning: false,
        verb: glitterVerbForToolComplete(finishedTool, line),
      })
      return
    }

    if (sameAsPrev) return
    set({ toolFeed: nextFeed })
  },
  /** Clears tool HUD only; activity transcript stays for cross-run context. */
  clearToolFeed: () =>
    set({
      toolFeed: [],
      latestToolCallLine: null,
      latestToolName: null,
      latestToolStartedAtMs: null,
      latestToolElapsedMs: 0,
      latestToolRunning: false,
      autoFocusHighlight: null,
      agentTileFocus: null,
      sessionToolDepthByKey: {},
    }),
  resetIdle: () => {
    resetGlitterVerbSession()
    set({
      running: false,
      verb: 'Ready',
      iteration: 0,
      runStartedAtMs: null,
      latestToolRunning: false,
      autoFocusHighlight: null,
      agentTileFocus: null,
      sessionToolDepthByKey: {},
    })
  },
}))

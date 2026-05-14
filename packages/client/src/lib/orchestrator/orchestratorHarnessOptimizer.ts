/**
 * Heuristic harness suggestions from raw JSONL traces (no LLM — deterministic stats).
 * Pair with orchestratorTraceAccumulator append-only logs.
 */
import * as tauri from '../tauri'

const REL_DIR = '.agent-canvas/harness/traces'
const EXPERIMENTS_REL = '.agent-canvas/harness/experiments'

export interface HarnessTraceStats {
  sessionKey: string
  lineCount: number
  toolBatches: number
  llmRounds: number
  runEnds: number
  okRuns: number
  failedRuns: number
  topTools: Array<{ name: string; count: number }>
  /** Rows with kind === `tool_call_detail` (Meta-Harness–style diagnostic trace). */
  toolCallDetailRows: number
  /** Fraction of tool_call_detail rows with resultTruncated === true. */
  truncatedToolResultRate: number
  /** Rows: llm_round_meta, compaction, stagnation */
  diagnosticMetaRows: number
}

export interface HarnessOptimizationHint {
  id: string
  message: string
}

/** Trace-derived metrics for Meta-Harness–style experiment folders (deterministic, no LLM). */
export interface HarnessTraceDerivedMetrics {
  /** okRuns / max(1, runEnds) */
  runEndOkRate: number
  /** tool_batches / max(1, runEnds) */
  toolBatchesPerRunEnd: number
  /** Median gap between consecutive `llm_round` timestamps (ms); proxy for model+tool latency. */
  medianInterLlmRoundMs: number | null
  /** Wall time from first to last trace line (`ts` fields), ms */
  traceWallMs: number | null
}

export interface HarnessWorkflowTraceRouteSummary {
  command: string
  lane: string
  laneReason: string | null
  authProfileId: string | null
}

export interface HarnessWorkflowTraceSummary {
  present: boolean
  requiredLanes: string[]
  routes: HarnessWorkflowTraceRouteSummary[]
}

function parseJsonl(content: string): unknown[] {
  const rows: unknown[] = []
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      rows.push(JSON.parse(t))
    } catch {
      // skip corrupt lines
    }
  }
  return rows
}

/**
 * Read a trace file by session key (same sanitize rules as appendHarnessTraceLine).
 */
export async function readHarnessTraceRaw(sessionKey: string): Promise<string> {
  const safe = sessionKey.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'session'
  const path = `${REL_DIR}/${safe}.jsonl`
  try {
    return await tauri.readFile(path)
  } catch {
    return ''
  }
}

/**
 * Aggregate counts + top tool names from raw trace lines.
 */
export function summarizeHarnessTrace(sessionKey: string, content: string): HarnessTraceStats {
  const rows = parseJsonl(content) as Array<Record<string, unknown>>
  const toolCounts = new Map<string, number>()
  let toolBatches = 0
  let llmRounds = 0
  let runEnds = 0
  let okRuns = 0
  let failedRuns = 0
  let toolCallDetailRows = 0
  let truncatedToolResults = 0
  let diagnosticMetaRows = 0

  for (const r of rows) {
    const kind = r.kind
    if (kind === 'tool_batch') {
      toolBatches += 1
      const names = r.toolNames as string[] | undefined
      if (Array.isArray(names)) {
        for (const n of names) {
          toolCounts.set(n, (toolCounts.get(n) ?? 0) + 1)
        }
      }
    } else if (kind === 'tool_call_detail') {
      toolCallDetailRows += 1
      if (r.resultTruncated === true) truncatedToolResults += 1
      const tn = r.tool as string | undefined
      if (tn) toolCounts.set(tn, (toolCounts.get(tn) ?? 0) + 1)
    } else if (kind === 'llm_round') {
      llmRounds += 1
    } else if (kind === 'llm_round_meta' || kind === 'compaction' || kind === 'stagnation') {
      diagnosticMetaRows += 1
    } else if (kind === 'run_end') {
      runEnds += 1
      if (r.ok === true) okRuns += 1
      else failedRuns += 1
    }
  }

  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }))

  const truncatedToolResultRate =
    toolCallDetailRows > 0 ? truncatedToolResults / toolCallDetailRows : 0

  return {
    sessionKey,
    lineCount: rows.length,
    toolBatches,
    llmRounds,
    runEnds,
    okRuns,
    failedRuns,
    topTools,
    toolCallDetailRows,
    truncatedToolResultRate,
    diagnosticMetaRows,
  }
}

function medianSorted(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export function extractWorkflowTraceSummary(raw: string): HarnessWorkflowTraceSummary {
  const rows = parseJsonl(raw) as Array<Record<string, unknown>>
  let latestPayload: Record<string, unknown> | null = null
  for (const row of rows) {
    if (row.kind !== 'custom') continue
    if (row.label !== 'workflow_trace_context') continue
    const payload = row.payload
    if (!payload || typeof payload !== 'object') continue
    latestPayload = payload as Record<string, unknown>
  }
  if (!latestPayload) {
    return { present: false, requiredLanes: [], routes: [] }
  }

  const requiredLanes = asStringArray(latestPayload.requiredLanes)
  const routes: HarnessWorkflowTraceRouteSummary[] = []
  const workflows = Array.isArray(latestPayload.workflows)
    ? (latestPayload.workflows as Array<Record<string, unknown>>)
    : []
  for (const workflow of workflows) {
    const commandRoutes = Array.isArray(workflow.commandRoutes)
      ? (workflow.commandRoutes as Array<Record<string, unknown>>)
      : []
    for (const route of commandRoutes) {
      const command = typeof route.command === 'string' ? route.command.trim() : ''
      const lane = typeof route.lane === 'string' ? route.lane.trim() : ''
      if (!command || !lane) continue
      routes.push({
        command,
        lane,
        laneReason: typeof route.laneReason === 'string' ? route.laneReason : null,
        authProfileId: typeof route.authProfileId === 'string' ? route.authProfileId : null,
      })
    }
  }

  return {
    present: true,
    requiredLanes,
    routes,
  }
}

/**
 * Cheap metrics layered on `summarizeHarnessTrace` + timestamps in JSONL.
 */
export function deriveTraceMetrics(raw: string, stats: HarnessTraceStats): HarnessTraceDerivedMetrics {
  const rows = parseJsonl(raw) as Array<Record<string, unknown>>
  let firstTs: number | null = null
  let lastTs: number | null = null
  const llmTs: number[] = []

  for (const r of rows) {
    const ts = typeof r.ts === 'number' ? r.ts : null
    if (ts != null) {
      if (firstTs == null || ts < firstTs) firstTs = ts
      if (lastTs == null || ts > lastTs) lastTs = ts
    }
    if (r.kind === 'llm_round' && typeof r.ts === 'number') {
      llmTs.push(r.ts)
    }
  }

  llmTs.sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < llmTs.length; i++) {
    gaps.push(llmTs[i]! - llmTs[i - 1]!)
  }

  const runEndOkRate = stats.okRuns / Math.max(1, stats.runEnds)
  const toolBatchesPerRunEnd = stats.toolBatches / Math.max(1, stats.runEnds)

  return {
    runEndOkRate,
    toolBatchesPerRunEnd,
    medianInterLlmRoundMs: medianSorted(gaps),
    traceWallMs:
      firstTs != null && lastTs != null && lastTs >= firstTs ? lastTs - firstTs : null,
  }
}

function formatExperimentReportMd(
  experimentId: string,
  payload: {
    exportedAt: number
    sessionKey: string
    stats: HarnessTraceStats
    metrics: HarnessTraceDerivedMetrics
    hints: HarnessOptimizationHint[]
    workflowTrace: HarnessWorkflowTraceSummary
  }
): string {
  const { stats, metrics, hints, workflowTrace } = payload
  const lines = [
    `# Harness experiment \`${experimentId}\``,
    '',
    `- Exported: ${new Date(payload.exportedAt).toISOString()}`,
    `- Session trace key: \`${payload.sessionKey}\``,
    `- Source: \`${REL_DIR}/${payload.sessionKey.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'session'}.jsonl\` → \`${EXPERIMENTS_REL}/${experimentId}/trace.jsonl\``,
    '',
    '## Metrics',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| run_end ok rate | ${(metrics.runEndOkRate * 100).toFixed(1)}% |`,
    `| tool batches / run_end | ${metrics.toolBatchesPerRunEnd.toFixed(2)} |`,
    `| median inter–LLM-round latency | ${metrics.medianInterLlmRoundMs == null ? 'n/a' : `${Math.round(metrics.medianInterLlmRoundMs)} ms`} |`,
    `| trace wall time | ${metrics.traceWallMs == null ? 'n/a' : `${Math.round(metrics.traceWallMs)} ms`} |`,
    '',
    '## Counts',
    '',
    `- Lines: ${stats.lineCount} · tool batches: ${stats.toolBatches} · LLM rounds: ${stats.llmRounds} · run_end: ${stats.runEnds} (ok ${stats.okRuns}, failed ${stats.failedRuns})`,
    `- Diagnostic rows: tool_call_detail=${stats.toolCallDetailRows} (truncated result rate ${(stats.truncatedToolResultRate * 100).toFixed(0)}%) · meta=${stats.diagnosticMetaRows}`,
    '',
    '## Workflow auth-lane context',
    '',
    workflowTrace.present
      ? `- required lanes: ${workflowTrace.requiredLanes.length ? workflowTrace.requiredLanes.join(', ') : '(none listed)'}`
      : '- workflow_trace_context: not present',
    ...(workflowTrace.present
      ? workflowTrace.routes.length
        ? workflowTrace.routes.slice(0, 8).map((route) => {
            const reason = route.laneReason ? ` reason=${route.laneReason}` : ''
            const profile = route.authProfileId ? ` profile=${route.authProfileId}` : ''
            return `  - ${route.command} → ${route.lane}${reason}${profile}`
          })
        : ['  - command routes: (none)']
      : []),
    '',
    '## Heuristic hints (human review)',
    '',
    ...(hints.length ? hints.map((h) => `- **${h.id}**: ${h.message}`) : ['_None._']),
    '',
    '---',
    '',
    'Edit `hypothesis.md` in this folder, then iterate on harness settings or prompts.',
    '',
  ]
  return lines.join('\n')
}

function sanitizeExperimentId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'exp'
}

/**
 * Copy the session trace into `.agent-canvas/harness/experiments/<id>/` with `stats.json`, `report.md`, and optional `hypothesis.md`.
 */
export async function exportHarnessExperimentArchive(
  sessionKey: string,
  options?: { experimentId?: string; hypothesis?: string }
): Promise<{
  experimentId: string
  rootRel: string
  stats: HarnessTraceStats
  metrics: HarnessTraceDerivedMetrics
  hints: HarnessOptimizationHint[]
  workflowTrace: HarnessWorkflowTraceSummary
}> {
  const raw = (await readHarnessTraceRaw(sessionKey)).trim()
  if (!raw) {
    throw new Error(
      'No harness trace on disk for this session key. Enable “Write raw harness traces”, run the orchestrator, then retry.'
    )
  }

  const stats = summarizeHarnessTrace(sessionKey, raw)
  const metrics = deriveTraceMetrics(raw, stats)
  const hints = proposeHarnessHints(stats)
  const workflowTrace = extractWorkflowTraceSummary(raw)
  const experimentId = sanitizeExperimentId(options?.experimentId ?? `exp-${Date.now()}`)
  const rootRel = `${EXPERIMENTS_REL}/${experimentId}`

  await tauri.createDirectory(EXPERIMENTS_REL)
  await tauri.createDirectory(rootRel)

  const exportedAt = Date.now()
  const statsPayload = {
    exportedAt,
    sessionKey,
    stats,
    metrics,
    hints,
    workflowTrace,
  }
  await tauri.writeFile(`${rootRel}/stats.json`, JSON.stringify(statsPayload, null, 2) + '\n')
  await tauri.writeFile(`${rootRel}/trace.jsonl`, raw.endsWith('\n') ? raw : `${raw}\n`)

  await tauri.writeFile(`${rootRel}/report.md`, formatExperimentReportMd(experimentId, statsPayload))

  const hyp = options?.hypothesis?.trim()
  if (hyp) {
    await tauri.writeFile(`${rootRel}/hypothesis.md`, `${hyp}\n`)
  } else {
    await tauri.writeFile(
      `${rootRel}/hypothesis.md`,
      `# Hypothesis\n\nWhat changed vs the previous run? What should improve next?\n`
    )
  }

  return { experimentId, rootRel, stats, metrics, hints, workflowTrace }
}

/**
 * Cheap rules: suggest scope / verification tweaks from stats (placeholder for meta-harness).
 */
export function proposeHarnessHints(stats: HarnessTraceStats): HarnessOptimizationHint[] {
  const hints: HarnessOptimizationHint[] = []

  if (stats.toolBatches > 40 && stats.llmRounds < stats.toolBatches * 0.2) {
    hints.push({
      id: 'high_tool_churn',
      message:
        'Many tool batches vs LLM rounds — consider tightening the task contract, lead delegation, or tool batching so each LLM round advances the plan.',
    })
  }

  if (stats.failedRuns > 0 && stats.failedRuns >= stats.okRuns) {
    hints.push({
      id: 'failure_balance',
      message:
        'Multiple failed run_end events — review stagnation guard + ablation flags; keep raw traces for root-cause review.',
    })
  }

  const spawnCount = stats.topTools.find(t => t.name === 'spawn_sub_agent')?.count ?? 0
  if (spawnCount > 8) {
    hints.push({
      id: 'heavy_delegation',
      message:
        'High spawn_sub_agent usage — ensure sub-agent compact context is on and contracts are explicit.',
    })
  }

  if (stats.toolCallDetailRows > 0 && stats.truncatedToolResultRate > 0.35) {
    hints.push({
      id: 'heavy_tool_result_truncation',
      message:
        'Many tool results hit trace/LLM truncation — narrow read paths, chunk work, or raise tool result budgets where safe.',
    })
  }

  if (stats.diagnosticMetaRows > 0 && stats.toolCallDetailRows === 0) {
    hints.push({
      id: 'diagnostic_without_per_tool_rows',
      message:
        'Session has llm_round_meta / compaction rows but no tool_call_detail — enable “Diagnostic harness traces” for per-tool rows.',
    })
  }

  return hints
}

export async function analyzeHarnessTraceSession(sessionKey: string): Promise<{
  stats: HarnessTraceStats
  hints: HarnessOptimizationHint[]
  metrics: HarnessTraceDerivedMetrics
  workflowTrace: HarnessWorkflowTraceSummary
}> {
  const raw = (await readHarnessTraceRaw(sessionKey)).trim()
  if (!raw) {
    throw new Error(
      'No harness trace on disk for this session key. Enable “Write raw harness traces”, run the orchestrator, then retry.'
    )
  }
  const stats = summarizeHarnessTrace(sessionKey, raw)
  const metrics = deriveTraceMetrics(raw, stats)
  const workflowTrace = extractWorkflowTraceSummary(raw)
  return { stats, hints: proposeHarnessHints(stats), metrics, workflowTrace }
}

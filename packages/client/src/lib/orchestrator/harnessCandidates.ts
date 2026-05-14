/**
 * Meta-Harness–style filesystem archive: `.agent-canvas/harness/candidates/<id>/`
 * (manifest, scores, trace refs, Pareto frontier export).
 */
import * as tauri from '../tauri'
import { useSettingsStore } from '../../store/settingsStore'
import { patchHarnessFileState } from './orchestratorFileState'

const HARNESS_ROOT = '.agent-canvas/harness'
export const CANDIDATES_ROOT = `${HARNESS_ROOT}/candidates`

/**
 * When set, every harness filesystem op routes through `node:fs/promises` rooted at this
 * absolute path instead of `tauri.*` (which assumes the open workspace + the Tauri runtime).
 * Used by `harness:eval` CLI so one code path serializes candidates in both the app and Node.
 */
let harnessNodeWorkspaceRoot: string | null = null

export function setHarnessNodeWorkspaceRoot(root: string | null): void {
  const trimmed = root?.trim() ?? ''
  harnessNodeWorkspaceRoot = trimmed.length > 0 ? trimmed : null
}

function isNodeFsMode(): boolean {
  return (
    harnessNodeWorkspaceRoot !== null &&
    typeof process !== 'undefined' &&
    !!process.versions?.node
  )
}

async function hcWriteFile(relativePath: string, content: string): Promise<void> {
  if (isNodeFsMode()) {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { join, dirname } = await import('node:path')
    const full = join(harnessNodeWorkspaceRoot!, relativePath)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content, 'utf8')
    return
  }
  await tauri.writeFile(relativePath, content)
}

async function hcCreateDirectory(relativePath: string): Promise<void> {
  if (isNodeFsMode()) {
    const { mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await mkdir(join(harnessNodeWorkspaceRoot!, relativePath), { recursive: true })
    return
  }
  await tauri.createDirectory(relativePath)
}

async function hcReadFile(relativePath: string): Promise<string> {
  if (isNodeFsMode()) {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    return readFile(join(harnessNodeWorkspaceRoot!, relativePath), 'utf8')
  }
  return tauri.readFile(relativePath)
}

async function hcReadDirectory(
  relativePath: string
): Promise<Array<{ name: string; path: string; is_directory: boolean }>> {
  if (isNodeFsMode()) {
    const { readdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const full = join(harnessNodeWorkspaceRoot!, relativePath)
    const entries = await readdir(full, { withFileTypes: true })
    return entries.map((e) => ({
      name: e.name,
      path: join(relativePath, e.name),
      is_directory: e.isDirectory(),
    }))
  }
  return tauri.readDirectory(relativePath)
}

export interface HarnessCandidateManifestV1 {
  version: 1
  candidateId: string
  createdAt: number
  updatedAt?: number
  /** Prior candidate when branching search. */
  parentCandidateId?: string | null
  label?: string
  /** e.g. git SHA or hash of prompt/harness slice */
  sourceRef?: string
  /** Optional pointer to a trace session (`orch-*` key → `.agent-canvas/harness/traces/<key>.jsonl`). */
  lastTraceSessionKey?: string | null
  /** Multi-objective snapshot (optional; superseded by scores.json aggregates). */
  metricsSummary?: {
    passRateSearch?: number
    meanContextKTokens?: number
    meanLatencyMs?: number
  }
}

export interface HarnessTaskResultV1 {
  id: string
  pass: boolean
  score?: number
  notes?: string
  /** Estimated or measured context thousands of tokens for this task. */
  contextKTokens?: number
  latencyMs?: number
}

export interface HarnessCandidateScoresV1 {
  version: 1
  candidateId: string
  evaluatedAt: number
  /** search = optimizer feedback; test = held-out; manual = ad-hoc; memory = recurring-signal gate (cold vs warm); proactive = USER/HEARTBEAT/autonomy smoke; conformance = core loop invariants */
  split: 'search' | 'test' | 'manual' | 'memory' | 'proactive' | 'conformance'
  tasks: HarnessTaskResultV1[]
  aggregates?: {
    passRate?: number
    meanScore?: number
    meanContextKTokens?: number
    meanLatencyMs?: number
    p0HardFail?: boolean
    overallPass?: boolean
    severity?: Partial<
      Record<
        'p0' | 'p1' | 'p2' | 'unknown',
        { total: number; passed: number; failed: number; passRate: number }
      >
    >
    buckets?: Partial<
      Record<
        | 'termination'
        | 'final_response'
        | 'recovery'
        | 'safety'
        | 'cancellation'
        | 'queue_handoff'
        | 'proactive_hygiene'
        | 'observability'
        | 'other',
        { total: number; passed: number; failed: number; passRate: number; failedIds: string[] }
      >
    >
  }
  /**
   * Present when `split === 'memory'`: cold run (empty harness signals file) vs warm run
   * (after seeding duplicate distiller-shaped rows). `passRateDelta` = warm − cold.
   */
  memoryEval?: {
    coldPassRate: number
    warmPassRate: number
    passRateDelta: number
    coldTasks: HarnessTaskResultV1[]
    warmTasks: HarnessTaskResultV1[]
  }
}

export interface ParetoPointV1 {
  candidateId: string
  /** Higher is better when present. */
  passRate?: number
  /** Lower is better (context cost). */
  meanContextKTokens?: number
  /** Lower is better. */
  meanLatencyMs?: number
  dominated: boolean
}

export interface HarnessParetoFrontierV1 {
  version: 1
  generatedAt: number
  points: ParetoPointV1[]
  nonDominatedIds: string[]
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'candidate'
}

export async function ensureCandidatesRoot(): Promise<void> {
  await hcCreateDirectory(CANDIDATES_ROOT)
}

export function validateHarnessCandidateManifest(m: Partial<HarnessCandidateManifestV1>): m is HarnessCandidateManifestV1 {
  return (
    m?.version === 1 &&
    typeof m.candidateId === 'string' &&
    m.candidateId.length > 0 &&
    typeof m.createdAt === 'number'
  )
}

export async function writeHarnessCandidateManifest(manifest: HarnessCandidateManifestV1): Promise<string> {
  const id = sanitizeId(manifest.candidateId)
  const root = `${CANDIDATES_ROOT}/${id}`
  await hcCreateDirectory(HARNESS_ROOT)
  await hcCreateDirectory(CANDIDATES_ROOT)
  await hcCreateDirectory(root)
  const m: HarnessCandidateManifestV1 = {
    ...manifest,
    candidateId: id,
    updatedAt: Date.now(),
  }
  await hcWriteFile(`${root}/manifest.json`, JSON.stringify(m, null, 2) + '\n')
  void patchHarnessFileState('harness_candidate_last', {
    candidateId: id,
    updatedAt: m.updatedAt ?? m.createdAt,
  }).catch(() => {
    /* optional */
  })
  return root
}

export function formatHarnessCandidateScoresJson(scores: HarnessCandidateScoresV1): string {
  return JSON.stringify(scores, null, 2) + '\n'
}

/**
 * Writes `scores.json` for a harness candidate. Uses {@link setHarnessNodeWorkspaceRoot} to
 * select Node vs Tauri I/O; one code path owns serialization in both the app and `harness:eval` CLI.
 *
 * `options.workspaceRootForNode` is kept for back-compat — it sets the module-level root for the
 * duration of this call only, so callers that already pass it keep working unchanged.
 */
export async function writeHarnessCandidateScores(
  scores: HarnessCandidateScoresV1,
  options?: { workspaceRootForNode?: string }
): Promise<string> {
  const id = sanitizeId(scores.candidateId)
  const root = `${CANDIDATES_ROOT}/${id}`
  const relScores = `${root}/scores.json`
  const payload = formatHarnessCandidateScoresJson(scores)

  const legacyRoot = options?.workspaceRootForNode?.trim()
  const prevRoot = harnessNodeWorkspaceRoot
  if (legacyRoot) setHarnessNodeWorkspaceRoot(legacyRoot)
  try {
    await hcCreateDirectory(CANDIDATES_ROOT)
    await hcCreateDirectory(root)
    await hcWriteFile(relScores, payload)
    // Manifest patch is best-effort; skipped silently if no manifest exists yet.
    await patchHarnessCandidateManifest(id, { updatedAt: Date.now() })
    return relScores
  } finally {
    if (legacyRoot) setHarnessNodeWorkspaceRoot(prevRoot)
  }
}

const ACTIVE_CANDIDATE_REL = '.agent-canvas/harness/active-candidate.json'
const ACTIVE_CANDIDATE_BACKUP_REL = '.agent-canvas/harness/active-candidate.prev.json'
/** Default regression tolerance: new candidate must not drop passRate by more than this vs. previous active. */
export const DEFAULT_AUTO_APPLY_REGRESSION_TOLERANCE = 0.02

export interface ActiveHarnessCandidateFileV1 {
  version: 1
  candidateId: string
  appliedAt: number
  reason?: string
}

export type AutoApplyStatus =
  | 'applied'
  | 'skipped_no_candidate'
  | 'skipped_same'
  | 'skipped_regression'
  | 'skipped_disabled'

export interface AutoApplyBestCandidateResult {
  status: AutoApplyStatus
  candidateId: string | null
  previousCandidateId: string | null
  baselinePassRate?: number
  candidatePassRate?: number
  tolerance: number
}

/**
 * Among non-dominated Pareto points, pick the best **passRate / meanContextKTokens** ratio (harness efficiency).
 */
export function pickBestCandidateFromPareto(frontier: HarnessParetoFrontierV1): string | null {
  const candidates = frontier.points.filter((p) => !p.dominated)
  if (candidates.length === 0) return null
  let best: { id: string; score: number } | null = null
  for (const p of candidates) {
    const pass = p.passRate ?? 0
    const k = p.meanContextKTokens
    const denom = k != null && k > 0 ? k : 0.001
    const score = pass / denom
    if (!best || score > best.score) {
      best = { id: p.candidateId, score }
    }
  }
  return best?.id ?? null
}

export async function writeActiveHarnessCandidateFile(
  candidateId: string,
  reason?: string
): Promise<void> {
  const id = sanitizeId(candidateId)
  const body: ActiveHarnessCandidateFileV1 = {
    version: 1,
    candidateId: id,
    appliedAt: Date.now(),
    reason,
  }
  await hcCreateDirectory(HARNESS_ROOT)
  await hcWriteFile(ACTIVE_CANDIDATE_REL, JSON.stringify(body, null, 2) + '\n')
}

/** Pure helper — decides whether a candidate's passRate beats the baseline given a regression tolerance. */
export function passesRegressionGate(
  candidatePassRate: number | undefined,
  baselinePassRate: number | undefined,
  tolerance: number
): boolean {
  if (baselinePassRate === undefined) return true
  if (candidatePassRate === undefined) return false
  return candidatePassRate >= baselinePassRate - tolerance
}

/**
 * Select the best Pareto candidate, apply a regression gate vs. the previous active candidate,
 * back up the previous active file before overwrite, and write the new one. Safe to call repeatedly.
 */
export async function maybeAutoApplyBestHarnessCandidate(opts?: {
  tolerance?: number
  reason?: string
  /** If true, skip when Settings → `harnessAutoApplyBestCandidate` is off. Defaults to false (caller controls). */
  respectSettings?: boolean
}): Promise<AutoApplyBestCandidateResult> {
  const tolerance = opts?.tolerance ?? DEFAULT_AUTO_APPLY_REGRESSION_TOLERANCE
  if (opts?.respectSettings && !useSettingsStore.getState().harnessAutoApplyBestCandidate) {
    const prev = await readActiveHarnessCandidateFile()
    return {
      status: 'skipped_disabled',
      candidateId: null,
      previousCandidateId: prev?.candidateId ?? null,
      tolerance,
    }
  }
  const frontier = await computeHarnessParetoFrontier()
  const best = pickBestCandidateFromPareto(frontier)
  const prev = await readActiveHarnessCandidateFile()
  const previousCandidateId = prev?.candidateId ?? null
  if (!best) {
    return { status: 'skipped_no_candidate', candidateId: null, previousCandidateId, tolerance }
  }
  if (previousCandidateId === best) {
    return { status: 'skipped_same', candidateId: best, previousCandidateId, tolerance }
  }

  const candidatePass = frontier.points.find((p) => p.candidateId === best)?.passRate
  const baselinePass = previousCandidateId
    ? frontier.points.find((p) => p.candidateId === previousCandidateId)?.passRate
    : undefined

  if (!passesRegressionGate(candidatePass, baselinePass, tolerance)) {
    return {
      status: 'skipped_regression',
      candidateId: best,
      previousCandidateId,
      candidatePassRate: candidatePass,
      baselinePassRate: baselinePass,
      tolerance,
    }
  }

  if (prev) {
    try {
      await hcWriteFile(ACTIVE_CANDIDATE_BACKUP_REL, JSON.stringify(prev, null, 2) + '\n')
    } catch {
      /* best-effort backup; do not block the swap */
    }
  }
  await writeActiveHarnessCandidateFile(
    best,
    opts?.reason ?? 'auto-apply: best passRate / meanContextKTokens ratio (passed regression gate)'
  )
  return {
    status: 'applied',
    candidateId: best,
    previousCandidateId,
    candidatePassRate: candidatePass,
    baselinePassRate: baselinePass,
    tolerance,
  }
}

/** Restore the previous active candidate from `.agent-canvas/harness/active-candidate.prev.json`. */
export async function revertActiveHarnessCandidate(): Promise<
  { ok: true; candidateId: string } | { ok: false; reason: string }
> {
  try {
    const raw = await hcReadFile(ACTIVE_CANDIDATE_BACKUP_REL)
    const parsed = JSON.parse(raw) as ActiveHarnessCandidateFileV1
    if (parsed?.version !== 1 || typeof parsed.candidateId !== 'string') {
      return { ok: false, reason: 'invalid backup file' }
    }
    const current = await readActiveHarnessCandidateFile()
    if (current) {
      try {
        await hcWriteFile(ACTIVE_CANDIDATE_BACKUP_REL, JSON.stringify(current, null, 2) + '\n')
      } catch {
        /* best-effort */
      }
    }
    const restored: ActiveHarnessCandidateFileV1 = {
      ...parsed,
      appliedAt: Date.now(),
      reason: (parsed.reason ?? '') + ' (reverted)',
    }
    await hcWriteFile(ACTIVE_CANDIDATE_REL, JSON.stringify(restored, null, 2) + '\n')
    return { ok: true, candidateId: parsed.candidateId }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export async function readActiveHarnessCandidateFile(): Promise<ActiveHarnessCandidateFileV1 | null> {
  try {
    const raw = await hcReadFile(ACTIVE_CANDIDATE_REL)
    const j = JSON.parse(raw) as ActiveHarnessCandidateFileV1
    if (j?.version !== 1 || typeof j.candidateId !== 'string') return null
    return j
  } catch {
    return null
  }
}

/** Injected after long-term MEMORY when Settings → harness auto-apply is enabled. */
export async function buildActiveHarnessCandidatePromptBlock(): Promise<string> {
  if (!useSettingsStore.getState().harnessAutoApplyBestCandidate) return ''
  const f = await readActiveHarnessCandidateFile()
  if (!f) return ''
  return `\n\n### Active harness candidate\nMeta-Harness selection: **${f.candidateId}** (applied ${new Date(f.appliedAt).toISOString()}). ${f.reason ? String(f.reason) : 'Prefer tool patterns consistent with this candidate when ambiguous.'}\n`
}

export async function writeTraceRef(candidateId: string, traceSessionKey: string): Promise<void> {
  const id = sanitizeId(candidateId)
  const root = `${CANDIDATES_ROOT}/${id}/traces`
  await hcCreateDirectory(root)
  const sanitized = traceSessionKey.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'session'
  const tracesRelative = `.agent-canvas/harness/traces/${sanitized}.jsonl`
  await hcWriteFile(
    `${root}/session.ref.json`,
    JSON.stringify(
      {
        version: 1,
        traceSessionKey,
        tracesRelativeToWorkspace: tracesRelative,
      },
      null,
      2
    ) + '\n'
  )
  await hcWriteFile(
    `${root}/README.txt`,
    `Trace session key: ${traceSessionKey}\nWorkspace-relative JSONL: ${tracesRelative}\n`
  )
  await patchHarnessCandidateManifest(id, { lastTraceSessionKey: traceSessionKey, updatedAt: Date.now() })
}

async function patchHarnessCandidateManifest(
  candidateId: string,
  patch: Partial<HarnessCandidateManifestV1>
): Promise<void> {
  const path = `${CANDIDATES_ROOT}/${candidateId}/manifest.json`
  try {
    const raw = await hcReadFile(path)
    const cur = JSON.parse(raw) as HarnessCandidateManifestV1
    const next = { ...cur, ...patch, candidateId, version: 1 as const }
    await hcWriteFile(path, JSON.stringify(next, null, 2) + '\n')
  } catch {
    /* no manifest yet */
  }
}

export async function listHarnessCandidateIds(): Promise<string[]> {
  try {
    const entries = await hcReadDirectory(CANDIDATES_ROOT)
    return entries.filter((e) => e.is_directory).map((e) => e.name)
  } catch {
    return []
  }
}

/** True if `a` is at least as good on all objectives and strictly better on one (maximize passRate; minimize k-toks + latency). */
function dominates(
  a: { pass?: number; k?: number; lat?: number },
  b: { pass?: number; k?: number; lat?: number }
): boolean {
  const betterOrEqual =
    (a.pass ?? 0) >= (b.pass ?? 0) &&
    (a.k ?? Infinity) <= (b.k ?? Infinity) &&
    (a.lat ?? Infinity) <= (b.lat ?? Infinity)
  const strictly =
    (a.pass ?? 0) > (b.pass ?? 0) ||
    (a.k ?? Infinity) < (b.k ?? Infinity) ||
    (a.lat ?? Infinity) < (b.lat ?? Infinity)
  return betterOrEqual && strictly
}

/**
 * Reads each `scores.json` under candidates/, builds Pareto points (passRate ↑, context KTok ↓, latency ↓).
 */
export async function computeHarnessParetoFrontier(): Promise<HarnessParetoFrontierV1> {
  const ids = await listHarnessCandidateIds()
  const points: ParetoPointV1[] = []

  for (const id of ids) {
    try {
      const raw = await hcReadFile(`${CANDIDATES_ROOT}/${id}/scores.json`)
      const s = JSON.parse(raw) as HarnessCandidateScoresV1
      if (s.version !== 1 || !Array.isArray(s.tasks)) continue
      const agg = s.aggregates ?? {}
      points.push({
        candidateId: id,
        passRate: agg.passRate,
        meanContextKTokens: agg.meanContextKTokens,
        meanLatencyMs: agg.meanLatencyMs,
        dominated: false,
      })
    } catch {
      /* skip */
    }
  }

  const objs = points.map((p) => ({
    id: p.candidateId,
    pass: p.passRate ?? 0,
    k: p.meanContextKTokens,
    lat: p.meanLatencyMs,
  }))

  for (let i = 0; i < objs.length; i++) {
    for (let j = 0; j < objs.length; j++) {
      if (i === j) continue
      if (dominates(objs[j]!, objs[i]!)) {
        points[i]!.dominated = true
        break
      }
    }
  }

  const nonDominatedIds = points.filter((p) => !p.dominated).map((p) => p.candidateId)

  return {
    version: 1,
    generatedAt: Date.now(),
    points,
    nonDominatedIds,
  }
}

export async function exportHarnessParetoFrontierReport(): Promise<{
  jsonPath: string
  csvPath: string
  frontier: HarnessParetoFrontierV1
}> {
  await hcCreateDirectory(HARNESS_ROOT)
  const frontier = await computeHarnessParetoFrontier()
  const base = `${HARNESS_ROOT}/pareto_frontier`
  const jsonPath = `${base}.json`
  await hcWriteFile(jsonPath, JSON.stringify(frontier, null, 2) + '\n')

  const lines = [
    'candidate_id,pass_rate,mean_context_k_toks,mean_latency_ms,dominated',
    ...frontier.points.map(
      (p) =>
        `${p.candidateId},${p.passRate ?? ''},${p.meanContextKTokens ?? ''},${p.meanLatencyMs ?? ''},${p.dominated}`
    ),
  ]
  const csvPath = `${base}.csv`
  await hcWriteFile(csvPath, lines.join('\n') + '\n')

  return { jsonPath, csvPath, frontier }
}

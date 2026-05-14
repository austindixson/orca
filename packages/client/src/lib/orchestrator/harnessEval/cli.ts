/**
 * Run from repo root: `npm run harness:eval -- --candidate <id> --split search|test|memory|proactive|conformance`
 * Writes `.agent-canvas/harness/candidates/<id>/scores.json` via {@link writeHarnessCandidateScores}.
 *
 * **Memory split** runs twice: cold (empty harness signals file) then seeds duplicate distiller-shaped
 * rows and runs warm; `scores.json` includes `memoryEval` with passRate delta.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  setHarnessNodeWorkspaceRoot,
  writeHarnessCandidateScores,
  type HarnessCandidateScoresV1,
} from '../harnessCandidates'
import {
  checkHarnessTaskIntegrity,
  canonicalHarnessTaskFileForSplit,
  HARNESS_EVAL_TASK_FILE_BY_SPLIT,
  type HarnessEvalSplit,
} from './harnessTaskIntegrity'
import {
  buildMemoryEvalSeedContent,
  evaluateHarnessTaskList,
  MEMORY_EVAL_SIGNALS_REL,
  parseHarnessEvalFileStrict,
  resolveHarnessWorkspaceRoot,
  type HarnessEvalFileV1,
} from './evaluateHarnessSuite'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Monorepo root (…/orca): `packages/client/src/lib/orchestrator/harnessEval` → six levels up. */
const DEFAULT_WORKSPACE_ROOT = join(__dirname, '../../../../../../')

function parseArgs(argv: string[]): {
  candidateId: string
  split: HarnessEvalSplit
} {
  let candidateId = ''
  let split: HarnessEvalSplit = 'search'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--candidate' && argv[i + 1]) {
      candidateId = argv[i + 1]!
      i++
    } else if (argv[i] === '--split' && argv[i + 1]) {
      const s = argv[i + 1] as HarnessEvalSplit
      if (s in HARNESS_EVAL_TASK_FILE_BY_SPLIT) split = s
      i++
    }
  }
  if (!candidateId) {
    throw new Error('Usage: node .../cli.ts --candidate <id> [--split search|test|memory|proactive|conformance]')
  }
  return { candidateId, split }
}

function taskFileForSplit(split: HarnessEvalSplit): string {
  return HARNESS_EVAL_TASK_FILE_BY_SPLIT[split]
}

async function main(): Promise<void> {
  const { candidateId, split } = parseArgs(process.argv.slice(2))
  const taskFileName = taskFileForSplit(split)
  const taskFile = join(__dirname, taskFileName)
  const primaryRaw = await readFile(taskFile, 'utf8')
  const primaryIntegrity = checkHarnessTaskIntegrity(split, primaryRaw)

  let source = 'primary'
  let raw = primaryRaw
  if (!primaryIntegrity.ok) {
    const canonicalPath = join(__dirname, canonicalHarnessTaskFileForSplit(split))
    const canonicalRaw = await readFile(canonicalPath, 'utf8')
    const canonicalIntegrity = checkHarnessTaskIntegrity(split, canonicalRaw)
    if (!canonicalIntegrity.ok) {
      throw new Error(
        `Harness task integrity failure for ${taskFileName}: primary hash ${primaryIntegrity.actual} != ${primaryIntegrity.expected}; canonical hash ${canonicalIntegrity.actual} != ${canonicalIntegrity.expected}`
      )
    }
    source = 'canonical-fallback'
    raw = canonicalRaw
    console.warn(
      `[harness-eval] task integrity mismatch for ${taskFileName}; using canonical fallback (actual=${primaryIntegrity.actual.slice(0, 12)} expected=${primaryIntegrity.expected.slice(0, 12)})`
    )
  }

  const file: HarnessEvalFileV1 = parseHarnessEvalFileStrict(raw, split)

  const workspaceRoot = resolveHarnessWorkspaceRoot(process.env.ORCA_WORKSPACE_ROOT?.trim() || DEFAULT_WORKSPACE_ROOT)
  setHarnessNodeWorkspaceRoot(workspaceRoot)

  if (split === 'memory') {
    const signalsAbs = join(workspaceRoot, MEMORY_EVAL_SIGNALS_REL)
    await mkdir(dirname(signalsAbs), { recursive: true })
    await writeFile(signalsAbs, '', 'utf8')

    const cold = await evaluateHarnessTaskList(file, { workspaceRoot })
    const coldPass = cold.aggregates?.passRate ?? 0

    await writeFile(signalsAbs, buildMemoryEvalSeedContent(), 'utf8')

    const warm = await evaluateHarnessTaskList(file, { workspaceRoot })
    const warmPass = warm.aggregates?.passRate ?? 0

    const scores: HarnessCandidateScoresV1 = {
      ...warm,
      candidateId,
      evaluatedAt: Date.now(),
      split: 'memory',
      memoryEval: {
        coldPassRate: coldPass,
        warmPassRate: warmPass,
        passRateDelta: warmPass - coldPass,
        coldTasks: cold.tasks,
        warmTasks: warm.tasks,
      },
    }

    const rel = await writeHarnessCandidateScores(scores, { workspaceRootForNode: workspaceRoot })
    const outPath = join(workspaceRoot, rel)
    console.log(`Wrote ${outPath}`)
    console.log(`taskSource=${source}`)
    console.log(
      `memoryEval coldPassRate=${coldPass.toFixed(3)} warmPassRate=${warmPass.toFixed(3)} passRateDelta=${(warmPass - coldPass).toFixed(3)}`
    )
    console.log(
      `warm meanContextKTok=${scores.aggregates?.meanContextKTokens ?? 'n/a'}`
    )
    return
  }

  const partial = await evaluateHarnessTaskList(file, { workspaceRoot })
  const scores: HarnessCandidateScoresV1 = {
    ...partial,
    candidateId,
    evaluatedAt: Date.now(),
  }

  const rel = await writeHarnessCandidateScores(scores, { workspaceRootForNode: workspaceRoot })
  const outPath = join(workspaceRoot, rel)
  console.log(`Wrote ${outPath}`)
  console.log(`taskSource=${source}`)
  console.log(
    `passRate=${scores.aggregates?.passRate ?? 'n/a'} meanContextKTok=${scores.aggregates?.meanContextKTokens ?? 'n/a'} p0HardFail=${String(scores.aggregates?.p0HardFail ?? false)} overallPass=${String(scores.aggregates?.overallPass ?? true)}`
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})

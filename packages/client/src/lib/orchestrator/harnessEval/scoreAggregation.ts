import type { HarnessTaskResultV1 } from '../harnessCandidates'
import type { HarnessEvalTaskDef } from './evaluateHarnessSuite'

export type InvariantSeverity = 'p0' | 'p1' | 'p2' | 'unknown'
export type InvariantBucket =
  | 'termination'
  | 'final_response'
  | 'recovery'
  | 'safety'
  | 'cancellation'
  | 'queue_handoff'
  | 'proactive_hygiene'
  | 'observability'
  | 'other'

export interface InvariantBucketRollup {
  total: number
  passed: number
  failed: number
  passRate: number
  failedIds: string[]
}

export interface InvariantSeverityRollup {
  total: number
  passed: number
  failed: number
  passRate: number
}

export interface InvariantAggregation {
  buckets: Record<InvariantBucket, InvariantBucketRollup>
  severity: Record<InvariantSeverity, InvariantSeverityRollup>
  p0HardFail: boolean
  overallPass: boolean
}

const ALL_BUCKETS: InvariantBucket[] = [
  'termination',
  'final_response',
  'recovery',
  'safety',
  'cancellation',
  'queue_handoff',
  'proactive_hygiene',
  'observability',
  'other',
]

function emptyBucket(): InvariantBucketRollup {
  return { total: 0, passed: 0, failed: 0, passRate: 0, failedIds: [] }
}

function emptySeverity(): InvariantSeverityRollup {
  return { total: 0, passed: 0, failed: 0, passRate: 0 }
}

function classifySeverity(taskId: string): InvariantSeverity {
  const id = taskId.toLowerCase()
  if (id.startsWith('p0-')) return 'p0'
  if (id.startsWith('p1-')) return 'p1'
  if (id.startsWith('p2-')) return 'p2'
  return 'unknown'
}

function bucketForTaskKind(taskKind: HarnessEvalTaskDef['kind']): InvariantBucket {
  switch (taskKind) {
    case 'terminal_success_requires_non_empty_final':
      return 'final_response'
    case 'single_failure_requires_recovery_attempt':
    case 'error_first_recovery_branching':
    case 'file_mutation_sensitive_path_branching':
      return 'recovery'
    case 'safety_gate_blocks_destructive_shell':
    case 'parallel_tool_conflict_guard':
      return 'safety'
    case 'wait_for_sub_agent_cancellation_integrity':
      return 'cancellation'
    case 'interruption_answer_then_resume_offer':
    case 'exactly_once_resume_handoff_integrity':
      return 'queue_handoff'
    case 'prompt_flow_contract_present':
    case 'trace_phase_end_state_completeness':
      return 'observability'
    case 'iteration_cap_enforcement':
      return 'termination'
    case 'heartbeat_synthetic_tag_skip_hygiene':
      return 'proactive_hygiene'
    default:
      return 'other'
  }
}

export function aggregateInvariantScores(
  tasks: HarnessEvalTaskDef[],
  results: HarnessTaskResultV1[]
): InvariantAggregation {
  const byId = new Map<string, HarnessTaskResultV1>()
  for (const r of results) byId.set(r.id, r)

  const buckets = Object.fromEntries(ALL_BUCKETS.map((b) => [b, emptyBucket()])) as Record<
    InvariantBucket,
    InvariantBucketRollup
  >
  const severity: Record<InvariantSeverity, InvariantSeverityRollup> = {
    p0: emptySeverity(),
    p1: emptySeverity(),
    p2: emptySeverity(),
    unknown: emptySeverity(),
  }

  for (const task of tasks) {
    const res = byId.get(task.id)
    const pass = res?.pass === true
    const sev = classifySeverity(task.id)
    const bucket = bucketForTaskKind(task.kind)

    severity[sev].total += 1
    buckets[bucket].total += 1
    if (pass) {
      severity[sev].passed += 1
      buckets[bucket].passed += 1
    } else {
      severity[sev].failed += 1
      buckets[bucket].failed += 1
      buckets[bucket].failedIds.push(task.id)
    }
  }

  for (const s of Object.values(severity)) {
    s.passRate = s.total > 0 ? s.passed / s.total : 0
  }
  for (const b of Object.values(buckets)) {
    b.passRate = b.total > 0 ? b.passed / b.total : 0
  }

  const p0HardFail = severity.p0.failed > 0
  return {
    buckets,
    severity,
    p0HardFail,
    overallPass: !p0HardFail,
  }
}

/**
 * Append-only raw execution traces (JSON Lines) for harness optimization / debugging.
 * Prefer raw events over summaries — see harness engineering research notes (Meta-Harness, arXiv:2603.28052).
 */
import * as tauri from '../tauri'

const REL_DIR = '.agent-canvas/harness/traces'

/** Full line as written to disk (includes sessionKey on every row). */
export type HarnessTraceEvent =
  | {
      kind: 'run_start'
      sessionKey: string
      ts: number
      scopeLevel?: string
      attemptIndex?: number
      allowlistToolCount?: number
      allowlistToolsSorted?: string[]
      provider?: string
      model?: string
    }
  | { kind: 'llm_round'; sessionKey: string; ts: number; iteration: number }
  | {
      kind: 'llm_round_meta'
      sessionKey: string
      ts: number
      iteration: number
      provider: string
      model: string
      workingChars: number
      systemPreview: string
      lastUserPreview: string
      systemCharLen: number
      lastUserCharLen: number
    }
  | { kind: 'tool_batch'; sessionKey: string; ts: number; toolNames: string[] }
  | {
      kind: 'tool_call_detail'
      sessionKey: string
      ts: number
      iteration: number
      tool: string
      argsRedacted: string
      resultRedacted: string
      argsTruncated: boolean
      resultTruncated: boolean
      resultChars: number
    }
  | {
      kind: 'compaction'
      sessionKey: string
      ts: number
      label: string
      maxChars?: number
      minTailMessages?: number
    }
  | {
      kind: 'stagnation'
      sessionKey: string
      ts: number
      action: 'nudge' | 'halt'
      reason?: string
    }
  | { kind: 'run_end'; sessionKey: string; ts: number; ok: boolean; error?: string }
  | { kind: 'custom'; sessionKey: string; ts: number; label: string; payload: unknown }

/** Payload for {@link appendHarnessTraceLine} (sessionKey added by caller). */
export type HarnessTraceLineInput =
  | Omit<Extract<HarnessTraceEvent, { kind: 'run_start' }>, 'sessionKey'>
  | Omit<Extract<HarnessTraceEvent, { kind: 'llm_round' }>, 'sessionKey'>
  | Omit<Extract<HarnessTraceEvent, { kind: 'llm_round_meta' }>, 'sessionKey'>
  | Omit<Extract<HarnessTraceEvent, { kind: 'tool_batch' }>, 'sessionKey'>
  | Omit<Extract<HarnessTraceEvent, { kind: 'tool_call_detail' }>, 'sessionKey'>
  | Omit<Extract<HarnessTraceEvent, { kind: 'compaction' }>, 'sessionKey'>
  | Omit<Extract<HarnessTraceEvent, { kind: 'stagnation' }>, 'sessionKey'>
  | Omit<Extract<HarnessTraceEvent, { kind: 'run_end' }>, 'sessionKey'>
  | Omit<Extract<HarnessTraceEvent, { kind: 'custom' }>, 'sessionKey'>

function line(e: HarnessTraceEvent): string {
  return JSON.stringify(e)
}

export async function appendHarnessTraceLine(
  sessionKey: string,
  event: HarnessTraceLineInput
): Promise<void> {
  const full = { ...event, sessionKey } as HarnessTraceEvent
  const path = `${REL_DIR}/${sanitizeKey(sessionKey)}.jsonl`
  await tauri.createDirectory(REL_DIR)
  const prev = await readTailSafe(path)
  await tauri.writeFile(path, prev + line(full) + '\n')
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'session'
}

async function readTailSafe(path: string): Promise<string> {
  try {
    return await tauri.readFile(path)
  } catch {
    return ''
  }
}

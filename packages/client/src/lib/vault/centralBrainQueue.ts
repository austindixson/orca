/**
 * Queue failed central-brain writes under ~/.orca/central-brain-queue.jsonl (replay on success).
 */

import { invoke } from '@tauri-apps/api/core'

export type CentralBrainQueueEntry = {
  vaultRoot: string
  relPath: string
  content: string
  ts: string
}

const REL = 'central-brain-queue.jsonl'
const MAX_LINES = 200

async function readQueueRaw(): Promise<string> {
  try {
    const r = await invoke<string | null>('orca_read_file', { relative: REL })
    return r ?? ''
  } catch {
    return ''
  }
}

export async function enqueueCentralBrainFailure(entry: CentralBrainQueueEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`
  await invoke('orca_append_file', { relative: REL, line })
  const raw = await readQueueRaw()
  const lines = raw.split('\n').filter(Boolean)
  if (lines.length > MAX_LINES) {
    const tail = lines.slice(-MAX_LINES).join('\n') + '\n'
    await invoke('orca_write_file', { relative: REL, content: tail })
  }
}

export async function replayCentralBrainQueue(
  writer: (vaultRoot: string, relPath: string, content: string) => Promise<void>
): Promise<number> {
  const raw = await readQueueRaw()
  const lines = raw.split('\n').filter(Boolean)
  if (lines.length === 0) return 0
  let ok = 0
  const remaining: string[] = []
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as CentralBrainQueueEntry
      if (e.vaultRoot && e.relPath && typeof e.content === 'string') {
        await writer(e.vaultRoot, e.relPath, e.content)
        ok += 1
      } else {
        remaining.push(line)
      }
    } catch {
      remaining.push(line)
    }
  }
  const next = remaining.length > 0 ? `${remaining.join('\n')}\n` : ''
  await invoke('orca_write_file', { relative: REL, content: next })
  return ok
}

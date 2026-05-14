/**
 * Path-addressable harness state under `.agent-canvas/harness/` (workspace-relative).
 * Survives session trimming; optional companion to in-memory `sessionMessages`.
 */
import * as tauri from '../tauri'

const REL_DIR = '.agent-canvas/harness'
const STATE_FILE = `${REL_DIR}/state.json`

export interface HarnessFileStateV1 {
  version: 1
  updatedAt: number
  /** Arbitrary JSON-serializable blobs keyed by harness id. */
  entries: Record<string, unknown>
}

const emptyState = (): HarnessFileStateV1 => ({
  version: 1,
  updatedAt: Date.now(),
  entries: {},
})

export async function readHarnessFileState(): Promise<HarnessFileStateV1> {
  try {
    const raw = await tauri.readFile(STATE_FILE)
    const parsed = JSON.parse(raw) as HarnessFileStateV1
    if (parsed && parsed.version === 1 && typeof parsed.entries === 'object') {
      return parsed
    }
  } catch {
    /* missing or invalid */
  }
  return emptyState()
}

export async function writeHarnessFileState(next: HarnessFileStateV1): Promise<void> {
  next.updatedAt = Date.now()
  await tauri.createDirectory(REL_DIR)
  await tauri.writeFile(STATE_FILE, JSON.stringify(next, null, 2))
}

export async function patchHarnessFileState(
  key: string,
  value: unknown
): Promise<HarnessFileStateV1> {
  const cur = await readHarnessFileState()
  const entries = { ...cur.entries, [key]: value }
  const merged: HarnessFileStateV1 = { ...cur, entries }
  await writeHarnessFileState(merged)
  return merged
}

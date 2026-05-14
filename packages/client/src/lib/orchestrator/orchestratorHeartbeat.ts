/**
 * Proactive heartbeat: load HEARTBEAT.md (workspace + ~/.orca) and schedule synthetic orchestrator runs.
 */
import * as tauri from '../tauri'
import { useSettingsStore } from '../../store/settingsStore'

const WORKSPACE_HEARTBEAT_REL = [
  '.orca/HEARTBEAT.md',
  'HEARTBEAT.md',
] as const

/**
 * Read merged HEARTBEAT instructions (workspace files first, then user-global).
 */
export async function loadHeartbeatInstructionsMerged(): Promise<string> {
  const parts: string[] = []

  for (const rel of WORKSPACE_HEARTBEAT_REL) {
    try {
      const t = (await tauri.readFile(rel)).trim()
      if (t) parts.push(`#### Workspace (\`${rel}\`)\n\n${t}`)
    } catch {
      /* missing */
    }
  }

  if (tauri.isTauri()) {
    try {
      const u = await tauri.readOrcaDataFile('HEARTBEAT.md')
      const t = (u ?? '').trim()
      if (t) parts.push(`#### User global (\`~/.orca/HEARTBEAT.md\`)\n\n${t}`)
    } catch {
      /* missing */
    }
  }

  return parts.join('\n\n')
}

/**
 * Build the synthetic user message for a heartbeat-triggered run.
 * Returns empty string if there is nothing to do (no HEARTBEAT.md content).
 */
export function buildHeartbeatSyntheticUserMessage(
  heartbeatBody: string,
  isoTimestamp: string
): string {
  const body = heartbeatBody.trim()
  if (!body) return ''
  const clipped = body.length > 12_000 ? `${body.slice(0, 12_000)}\n\n…(truncated)` : body
  return (
    `[Orca heartbeat — ${isoTimestamp}]\n\n` +
    `This message was **scheduled** by the proactive harness (not typed by the user). ` +
    `Follow **HEARTBEAT.md** below plus the autonomy constitution. ` +
    `Prefer **small, high-value** actions: follow up loose ends, surface one useful insight, or update USER/MEMORY notes — avoid noisy chat.\n\n` +
    `### HEARTBEAT.md (merged)\n\n${clipped}`
  )
}

let heartbeatTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatSubscribed = false

function scheduleNextHeartbeatTick(): void {
  if (heartbeatTimer !== null) {
    clearTimeout(heartbeatTimer)
    heartbeatTimer = null
  }
  const s = useSettingsStore.getState()
  if (!s.orchestratorHeartbeatEnabled) return

  const minutes = Math.max(1, Math.min(24 * 60, s.orchestratorHeartbeatIntervalMinutes ?? 30))
  const ms = minutes * 60_000

  heartbeatTimer = setTimeout(() => {
    heartbeatTimer = null
    void runHeartbeatTick().finally(() => {
      scheduleNextHeartbeatTick()
    })
  }, ms)
}

async function runHeartbeatTick(): Promise<void> {
  const s = useSettingsStore.getState()
  if (!s.orchestratorHeartbeatEnabled) return

  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return
  }

  const instructions = await loadHeartbeatInstructionsMerged()
  if (!instructions.trim()) return

  const { useOrchestratorSessionStore } = await import('../../store/orchestratorSessionStore')
  const store = useOrchestratorSessionStore.getState()
  if (store.running || store.oneShotMode) return

  const text = buildHeartbeatSyntheticUserMessage(instructions, new Date().toISOString())
  if (!text.trim()) return

  await store.run({
    id: `heartbeat-${Date.now()}`,
    text,
    attachments: [],
    source: 'heartbeat',
  })
}

/**
 * Start the heartbeat chain (idempotent). Call from App mount.
 */
export function startOrchestratorHeartbeatScheduler(): void {
  if (typeof window === 'undefined') return

  if (!heartbeatSubscribed) {
    heartbeatSubscribed = true
    useSettingsStore.subscribe((state, prev) => {
      if (
        state.orchestratorHeartbeatEnabled !== prev.orchestratorHeartbeatEnabled ||
        state.orchestratorHeartbeatIntervalMinutes !== prev.orchestratorHeartbeatIntervalMinutes
      ) {
        scheduleNextHeartbeatTick()
      }
    })
  }

  scheduleNextHeartbeatTick()
}

/** Stop pending heartbeat (e.g. tests). */
export function stopOrchestratorHeartbeatScheduler(): void {
  if (heartbeatTimer !== null) {
    clearTimeout(heartbeatTimer)
    heartbeatTimer = null
  }
}

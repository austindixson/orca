/**
 * Terminal output ring buffer → ~/.orca/terminals/<ptyId>.log
 */

import * as tauri from '../tauri'
import { getOrcaSessionId } from './orcaSessionId'

export const MAX_TERMINAL_LINES = 10_000

const lineBuffers = new Map<string, string>()
const memoryLines = new Map<string, string[]>()
/** Browser timers are numeric ids; avoids NodeJS.Timeout vs number in DOM lib conflicts. */
const flushTimers = new Map<string, number>()
const FLUSH_MS = 400

function getStoreKey(ptyId: string): string {
  return ptyId
}

function pushLines(ptyId: string, lines: string[]): void {
  const key = getStoreKey(ptyId)
  const cur = memoryLines.get(key) ?? []
  const next = [...cur, ...lines]
  const trimmed =
    next.length > MAX_TERMINAL_LINES ? next.slice(next.length - MAX_TERMINAL_LINES) : next
  memoryLines.set(key, trimmed)
}

async function flushToDisk(ptyId: string): Promise<void> {
  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) return

  const lines = memoryLines.get(getStoreKey(ptyId))
  if (!lines?.length) return

  const body = lines.join('\n') + '\n'
  const rel = `terminals/${encodeURIComponent(ptyId)}.log`
  if (tauri.isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('orca_mkdir_p', { relative: 'terminals' })
      await invoke('orca_write_file', { relative: rel, content: body })
    } catch (e) {
      console.warn('[orca] terminal flush failed', e)
    }
    return
  }
  try {
    localStorage.setItem(`orca.term.${getOrcaSessionId()}.${ptyId}`, body)
  } catch {
    /* quota */
  }
}

function scheduleFlush(ptyId: string): void {
  const prev = flushTimers.get(ptyId)
  if (prev) clearTimeout(prev)
  const t = window.setTimeout(() => {
    flushTimers.delete(ptyId)
    void flushToDisk(ptyId)
  }, FLUSH_MS)
  flushTimers.set(ptyId, t)
}

/**
 * Append raw PTY output; splits on newlines and keeps a rolling buffer.
 */
export function appendTerminalOutput(ptyId: string, chunk: string): void {
  const pending = (lineBuffers.get(ptyId) ?? '') + chunk
  const parts = pending.split('\n')
  const carry = parts.pop() ?? ''
  lineBuffers.set(ptyId, carry)
  if (parts.length > 0) {
    pushLines(ptyId, parts)
    scheduleFlush(ptyId)
  }
}

/**
 * Last lines currently buffered for a PTY (memory + in-flight partial line).
 * Use this for orchestrator tools and debugging — works even when Orca session persistence is off.
 */
export function getTerminalTailLinesSync(ptyId: string, maxLines = 400): string[] {
  const key = getStoreKey(ptyId)
  const lines = [...(memoryLines.get(key) ?? [])]
  const pending = lineBuffers.get(key) ?? ''
  if (pending.length > 0) {
    lines.push(pending)
  }
  if (lines.length <= maxLines) return lines
  return lines.slice(lines.length - maxLines)
}

export async function loadTerminalHistory(ptyId: string, tailLines = 500): Promise<string[]> {
  const live = getTerminalTailLinesSync(ptyId, MAX_TERMINAL_LINES)
  const liveTail = live.slice(Math.max(0, live.length - tailLines))

  const { useSettingsStore } = await import('../../store/settingsStore')
  if (!useSettingsStore.getState().orcaPersistenceEnabled) {
    return liveTail
  }

  if (tauri.isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const rel = `terminals/${encodeURIComponent(ptyId)}.log`
      const raw = (await invoke<string | null>('orca_read_file', { relative: rel })) as string | null
      const diskLines = raw?.trim() ? raw.split('\n').filter(Boolean) : []
      return [...diskLines, ...live].slice(-tailLines)
    } catch {
      return liveTail
    }
  }
  try {
    const raw = localStorage.getItem(`orca.term.${getOrcaSessionId()}.${ptyId}`)
    const diskLines = raw?.trim() ? raw.split('\n').filter(Boolean) : []
    return [...diskLines, ...live].slice(-tailLines)
  } catch {
    return liveTail
  }
}

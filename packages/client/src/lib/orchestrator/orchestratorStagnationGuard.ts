import type { ToolCall } from './types'

export interface DirectoryStagnationState {
  consecutiveListDirectoryRounds: number
  repeatedSameSignatureStreak: number
  lastListDirectorySignature: string
  nudgesSent: number
}

export type DirectoryStagnationAction = 'none' | 'nudge' | 'halt'

export interface DirectoryStagnationDecision {
  action: DirectoryStagnationAction
  reason?: string
  nextState: DirectoryStagnationState
}

export const INITIAL_DIRECTORY_STAGNATION_STATE: DirectoryStagnationState = {
  consecutiveListDirectoryRounds: 0,
  repeatedSameSignatureStreak: 0,
  lastListDirectorySignature: '',
  nudgesSent: 0,
}

function parsePathFromArgs(raw: string): string {
  try {
    const o = JSON.parse(raw) as { path?: unknown }
    const p = typeof o.path === 'string' ? o.path.trim() : ''
    return p || '.'
  } catch {
    return '.'
  }
}

function listDirectorySignature(calls: ToolCall[]): string {
  const paths = calls
    .filter((c) => c.function?.name === 'list_directory')
    .map((c) => parsePathFromArgs(c.function.arguments))
    .sort()
  return paths.join('|')
}

/**
 * Detects path-crawl loops where the model repeatedly calls list_directory with little/no progress.
 */
export function evaluateDirectoryStagnation(
  calls: ToolCall[],
  state: DirectoryStagnationState
): DirectoryStagnationDecision {
  const hasCalls = calls.length > 0
  const listCalls = calls.filter((c) => c.function?.name === 'list_directory')
  const allListDirectory = hasCalls && listCalls.length === calls.length

  if (!allListDirectory) {
    return {
      action: 'none',
      nextState: {
        ...state,
        consecutiveListDirectoryRounds: 0,
        repeatedSameSignatureStreak: 0,
        lastListDirectorySignature: '',
      },
    }
  }

  const sig = listDirectorySignature(calls)
  const sameAsLast = sig.length > 0 && sig === state.lastListDirectorySignature
  const next: DirectoryStagnationState = {
    ...state,
    consecutiveListDirectoryRounds: state.consecutiveListDirectoryRounds + 1,
    repeatedSameSignatureStreak: sameAsLast ? state.repeatedSameSignatureStreak + 1 : 1,
    lastListDirectorySignature: sig,
  }

  const shouldHalt =
    next.repeatedSameSignatureStreak >= 9 ||
    (next.nudgesSent >= 1 &&
      (next.repeatedSameSignatureStreak >= 7 ||
        (next.consecutiveListDirectoryRounds >= 14 && next.repeatedSameSignatureStreak >= 3)))
  if (shouldHalt) {
    return {
      action: 'halt',
      reason:
        'Repeated list_directory loop detected with no progress. Re-plan by phase and delegate narrow tracks.',
      nextState: next,
    }
  }

  const shouldNudge =
    next.nudgesSent === 0 &&
    (next.repeatedSameSignatureStreak >= 4 ||
      (next.consecutiveListDirectoryRounds >= 8 && next.repeatedSameSignatureStreak >= 2))
  if (shouldNudge) {
    return {
      action: 'nudge',
      reason:
        'Directory crawl appears repetitive. Stop broad listing, read targeted files, and continue phase-by-phase.',
      nextState: { ...next, nudgesSent: next.nudgesSent + 1 },
    }
  }

  return { action: 'none', nextState: next }
}


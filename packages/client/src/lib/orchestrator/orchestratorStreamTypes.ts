import type { ChatMessage } from './types'

export type OrchestratorLoopPhase =
  | 'setup'
  | 'model'
  | 'error_recovery'
  | 'tools'
  | 'continuation'

/** Emitted during `runOrchestratorAgent` when `onStreamEvent` is set (live harness / generator). */
export type OrchestratorStreamEvent =
  | { type: 'phase'; phase: OrchestratorLoopPhase }
  | { type: 'done'; messages: ChatMessage[]; assistantText: string }

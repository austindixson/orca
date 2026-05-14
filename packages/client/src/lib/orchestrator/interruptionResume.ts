import type { ChatMessage } from './types'

export interface InterruptionCheckpoint {
  id: string
  interruptedRunGeneration: number
  interruptedTaskSummary: string
  interruptedByPreview: string
  createdAt: number
}

function compactSingleLine(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function clip(input: string, max: number): string {
  if (input.length <= max) return input
  return `${input.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function buildInterruptionCheckpoint(params: {
  id: string
  interruptedRunGeneration: number
  interruptedTaskSummary: string
  interruptedByText: string
  createdAt: number
}): InterruptionCheckpoint {
  const summary = compactSingleLine(params.interruptedTaskSummary) || 'the previous task'
  const by = compactSingleLine(params.interruptedByText) || 'the latest user interruption'
  return {
    id: params.id,
    interruptedRunGeneration: params.interruptedRunGeneration,
    interruptedTaskSummary: clip(summary, 220),
    interruptedByPreview: clip(by, 220),
    createdAt: params.createdAt,
  }
}

export function summarizeInterruptedTaskFromSession(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    const text = compactSingleLine(typeof msg.content === 'string' ? msg.content : '')
    if (!text) continue
    if (/^\[Sub-agent handoff\]/i.test(text)) continue
    if (/^\[Parallel sub-agent results\]/i.test(text)) continue
    if (/^\[Orca heartbeat/i.test(text)) continue
    return clip(text, 220)
  }
  return 'the previous task'
}

export function buildInterruptionResumeDirectivePrefix(checkpoint: InterruptionCheckpoint): string {
  return [
    '[Interruption protocol — runtime directive]',
    `Prior in-progress task checkpoint: ${checkpoint.interruptedTaskSummary}`,
    `Interruption message preview: ${checkpoint.interruptedByPreview}`,
    "Answer the user's new interruption first in direct terms.",
    'After answering, add exactly one sentence asking whether to continue from the previous checkpoint.',
    'If the user says continue later, resume from that checkpoint instead of restarting completed steps.',
  ].join('\n')
}

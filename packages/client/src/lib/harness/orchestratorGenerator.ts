/**
 * Async-generator shaped orchestrator events (streaming / cancellation / backpressure).
 * Polls `onStreamEvent` queue while `runOrchestratorAgent` runs so phase events surface mid-flight.
 */

import {
  runOrchestratorAgent,
  type RunOrchestratorOptions,
} from '../orchestrator/runOrchestrator'
import type { OrchestratorStreamEvent } from '../orchestrator/orchestratorStreamTypes'

export type { OrchestratorStreamEvent }

export type OrchestratorGeneratorEvent = OrchestratorStreamEvent | { type: 'error'; message: string }

export async function* runOrchestratorAsGenerator(
  params: RunOrchestratorOptions
): AsyncGenerator<OrchestratorGeneratorEvent> {
  const queue: OrchestratorStreamEvent[] = []
  const run = runOrchestratorAgent({
    ...params,
    onStreamEvent: (e) => {
      queue.push(e)
      params.onStreamEvent?.(e)
    },
  })

  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!
      }
      const hit = await Promise.race([
        run.then(() => 'done' as const),
        new Promise<'tick'>((r) => setTimeout(() => r('tick'), 12)),
      ])
      if (hit === 'done') break
    }
    await run
    while (queue.length > 0) {
      yield queue.shift()!
    }
  } catch (e) {
    while (queue.length > 0) {
      yield queue.shift()!
    }
    yield {
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    }
    throw e
  }
}

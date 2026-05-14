import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveTraceMetrics, extractWorkflowTraceSummary, summarizeHarnessTrace } from './orchestratorHarnessOptimizer'

describe('orchestratorHarnessOptimizer', () => {
  it('deriveTraceMetrics computes rates and median LLM gaps', () => {
    const raw = [
      JSON.stringify({
        kind: 'run_start',
        sessionKey: 'orch-1',
        ts: 1000,
      }),
      JSON.stringify({ kind: 'llm_round', sessionKey: 'orch-1', ts: 1100, iteration: 1 }),
      JSON.stringify({ kind: 'tool_batch', sessionKey: 'orch-1', ts: 1200, toolNames: ['read_file'] }),
      JSON.stringify({ kind: 'llm_round', sessionKey: 'orch-1', ts: 1500, iteration: 2 }),
      JSON.stringify({ kind: 'run_end', sessionKey: 'orch-1', ts: 1600, ok: true }),
    ].join('\n')

    const stats = summarizeHarnessTrace('orch-1', raw)
    assert.equal(stats.toolCallDetailRows, 0)
    assert.equal(stats.diagnosticMetaRows, 0)
    const m = deriveTraceMetrics(raw, stats)
    assert.equal(m.runEndOkRate, 1)
    assert.equal(m.toolBatchesPerRunEnd, 1)
    assert.equal(m.medianInterLlmRoundMs, 400)
    assert.equal(m.traceWallMs, 600)
  })

  it('extractWorkflowTraceSummary returns latest workflow auth-lane routes', () => {
    const raw = [
      JSON.stringify({ kind: 'run_start', sessionKey: 'orch-1', ts: 1000 }),
      JSON.stringify({
        kind: 'custom',
        label: 'workflow_trace_context',
        ts: 1100,
        payload: {
          requiredLanes: ['oauth'],
          workflows: [
            {
              commandRoutes: [
                { command: 'drive.upload', lane: 'oauth', laneReason: 'target_type:official_api' },
              ],
            },
          ],
        },
      }),
      JSON.stringify({
        kind: 'custom',
        label: 'workflow_trace_context',
        ts: 1200,
        payload: {
          requiredLanes: ['browser_session', 'oauth'],
          workflows: [
            {
              commandRoutes: [
                {
                  command: 'x.post',
                  lane: 'browser_session',
                  laneReason: 'command_prefix:x.',
                  authProfileId: 'x-session-default',
                },
              ],
            },
          ],
        },
      }),
    ].join('\n')

    const summary = extractWorkflowTraceSummary(raw)
    assert.equal(summary.present, true)
    assert.deepEqual(summary.requiredLanes, ['browser_session', 'oauth'])
    assert.equal(summary.routes.length, 1)
    assert.equal(summary.routes[0]?.command, 'x.post')
    assert.equal(summary.routes[0]?.lane, 'browser_session')
    assert.equal(summary.routes[0]?.laneReason, 'command_prefix:x.')
    assert.equal(summary.routes[0]?.authProfileId, 'x-session-default')
  })
})

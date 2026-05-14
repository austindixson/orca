import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildWorkflowTraceCustomEvent } from './runOrchestrator'

describe('buildWorkflowTraceCustomEvent', () => {
  it('returns a custom trace row when workflow context exists', () => {
    const event = buildWorkflowTraceCustomEvent(
      {
        source: 'one_shot_workflow_catalog',
        catalogId: 'hermes-any-app-workflows',
        workflows: [
          {
            workflowId: 'x-post-update',
            commandRoutes: [
              {
                command: 'x.tweet.send',
                lane: 'browser_session',
                laneReason: 'auth_profile:x-browser-session;match:pack',
                authProfileId: 'x-browser-session',
              },
            ],
          },
        ],
      },
      123456789
    )

    assert.ok(event)
    assert.equal(event?.kind, 'custom')
    if (event?.kind !== 'custom') return
    assert.equal(event.label, 'workflow_trace_context')
    assert.equal(event.ts, 123456789)
    const workflows = (event.payload as { workflows?: unknown[] }).workflows
    assert.ok(Array.isArray(workflows) && workflows.length === 1)
  })

  it('returns null for empty workflow context', () => {
    assert.equal(buildWorkflowTraceCustomEvent(null, 1), null)
    assert.equal(buildWorkflowTraceCustomEvent(undefined, 1), null)
  })
})

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWorkflowAuthTraceContext,
  renderWorkflowIntentContext,
  resolveWorkflowIntent,
} from './oneShotWorkflowResolver'

describe('resolveWorkflowIntent', () => {
  test('maps X posting prompts to x-social-ops commands', () => {
    const out = resolveWorkflowIntent('Post this on X about our release notes and publish the tweet now.')
    assert.ok(out.matchedWorkflows.length > 0)
    assert.equal(out.matchedWorkflows[0]?.pack, 'x-social-ops')
    assert.ok(out.combinedCommands.includes('x.tweet.send'))
    assert.ok(out.authLanePlan.requiredLanes.includes('browser_session'))
    const xFlow = out.authLanePlan.perWorkflow.find((row) => row.workflowId === out.matchedWorkflows[0]?.id)
    assert.ok(xFlow?.commandRoutes.some((route) => route.command === 'x.tweet.send' && route.lane === 'browser_session'))
    assert.ok(
      xFlow?.commandRoutes.some(
        (route) => route.command === 'x.tweet.send' && route.laneReason === 'command_prefix:x'
      )
    )
  })

  test('maps upload+delete phrasing to destructive Drive cleanup workflow', () => {
    const out = resolveWorkflowIntent('Upload these to Google Drive and delete local originals after verification.')
    assert.ok(out.matchedWorkflows.some((m) => m.id === 'drive-upload-then-clean-local'))
    const destructive = out.matchedWorkflows.find((m) => m.id === 'drive-upload-then-clean-local')
    assert.equal(destructive?.risk, 'destructive')
    assert.equal(destructive?.approvalRequired, true)
    assert.ok(out.combinedCommands.includes('local.delete_batch'))
    assert.ok(out.authLanePlan.requiredLanes.includes('oauth'))

    const driveFlow = out.authLanePlan.perWorkflow.find((row) => row.workflowId === 'drive-upload-then-clean-local')
    assert.ok(driveFlow?.commandRoutes.some((route) => route.command === 'gdrive.batch.upload' && route.lane === 'oauth'))
    assert.ok(driveFlow?.commandRoutes.some((route) => route.command === 'local.delete_batch' && route.lane === 'per_step'))
  })

  test('uses auth profile lane routing when workflow app profile exists', () => {
    const out = resolveWorkflowIntent('Take candidates.csv and create interview tasks in Linear.', {
      authProfiles: [
        {
          id: 'linear-browser-session',
          appId: 'hiring-ops',
          lane: 'browser_session',
          createdAt: '2026-04-22T00:00:00.000Z',
          updatedAt: '2026-04-22T00:00:00.000Z',
          browserSession: {
            sessionBundleRef: 'secret://linear/session',
            runtimeFingerprintRef: 'secret://linear/fp',
            domainBindings: ['linear.app'],
            healthState: 'healthy',
          },
        },
      ],
    })
    const hiring = out.authLanePlan.perWorkflow.find((row) => row.pack === 'hiring-ops')
    assert.ok(
      hiring?.commandRoutes.some(
        (route) =>
          route.command === 'linear.issue.create.batch' &&
          route.lane === 'browser_session' &&
          route.authProfileId === 'linear-browser-session' &&
          route.laneReason.includes('auth_profile:linear-browser-session')
      )
    )
  })

  test('buildWorkflowAuthTraceContext includes per-command lane reasons and profile ids', () => {
    const out = resolveWorkflowIntent('Post this on X about our release notes and publish the tweet now.', {
      authProfiles: [
        {
          id: 'x-browser-session',
          appId: 'x-social-ops',
          lane: 'browser_session',
          createdAt: '2026-04-22T00:00:00.000Z',
          updatedAt: '2026-04-22T00:00:00.000Z',
          browserSession: {
            sessionBundleRef: 'secret://x/session',
            runtimeFingerprintRef: 'secret://x/fingerprint',
            domainBindings: ['x.com'],
            healthState: 'healthy',
          },
        },
      ],
    })
    const trace = buildWorkflowAuthTraceContext(out)
    assert.ok(trace)
    const workflows = (trace as { workflows?: Array<{ commandRoutes?: Array<{ laneReason?: string; authProfileId?: string | null }> }> }).workflows
    assert.ok(workflows && workflows.length > 0)
    const firstRoute = workflows?.[0]?.commandRoutes?.[0]
    assert.ok(firstRoute?.laneReason?.includes('auth_profile:x-browser-session'))
    assert.equal(firstRoute?.authProfileId, 'x-browser-session')
  })

  test('buildWorkflowAuthTraceContext returns null for unmatched prompts', () => {
    const out = resolveWorkflowIntent('Write a haiku about sunsets and whales in deep oceans.')
    assert.equal(buildWorkflowAuthTraceContext(out), null)
  })

  test('returns empty when prompt has no meaningful catalog overlap', () => {
    const out = resolveWorkflowIntent('Write a haiku about sunsets and whales in deep oceans.')
    assert.equal(out.matchedWorkflows.length, 0)
    assert.equal(out.combinedCommands.length, 0)
    assert.equal(renderWorkflowIntentContext(out), '')
  })

  test('renders context rows for orchestrator prompt injection', () => {
    const out = resolveWorkflowIntent('Take candidates.csv and create interview tasks in Linear.')
    const context = renderWorkflowIntentContext(out)
    assert.ok(context.includes('Workflow catalog matches'))
    assert.ok(context.includes('hiring-ops'))
    assert.ok(context.includes('linear.issue.create.batch'))
    assert.ok(context.includes('Auth lanes required:'))
    assert.ok(context.includes('target_type:') || context.includes('command_prefix:'))
  })
})

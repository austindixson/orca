import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  __resetOrchestratorSessionRuntimeForTests,
  __setOrchestratorSessionRuntimeForTests,
  useOrchestratorSessionStore,
  type QueuedRun,
} from '../../store/orchestratorSessionStore'
import { useSettingsStore, HERMES_PROVIDER_MODEL_ID } from '../../store/settingsStore'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'

describe('queued interruption/resume path', () => {
  beforeEach(() => {
    __resetOrchestratorSessionRuntimeForTests()

    const settings = useSettingsStore.getState()
    useSettingsStore.setState({
      leadProfile: 'hermes',
      orchestratorLeadDelegationOnly: false,
      providers: {
        ...settings.providers,
        hermes: {
          ...settings.providers.hermes,
          enabled: true,
        },
      },
      selectedModel: HERMES_PROVIDER_MODEL_ID,
    })

    useOrchestratorSessionStore.setState({
      input: '',
      inputAttachments: [],
      running: false,
      oneShotMode: false,
      queuedInputs: [],
      sessionMessages: [],
      pendingSubAgentHandoffs: [],
      waitingForSubAgents: false,
      interruptionCheckpoint: null,
      abortController: null,
      runGeneration: 0,
      lastHarnessTraceSessionKey: null,
      stopLogged: false,
      planningDraft: null,
      lastRunOutcome: null,
      runLockedSelectedModelId: null,
    })

    useOrchestratorActivityStore.setState({
      activityFeed: [],
      toolFeed: [],
      running: false,
      runStartedAtMs: null,
    })
  })

  afterEach(() => {
    __resetOrchestratorSessionRuntimeForTests()
  })

  it('captures checkpoint, applies queued directive, and clears checkpoint after queued run', async () => {
    let orchestratorUserMessage = ''

    __setOrchestratorSessionRuntimeForTests({
      runOrchestratorLeadAware: async (params) => {
        orchestratorUserMessage = params.userMessage
        return {
          assistantText: 'Handled interruption.',
          messages: [
            ...params.messages,
            { role: 'user', content: params.userMessage },
            { role: 'assistant', content: 'Handled interruption.' },
          ],
        }
      },
    })

    useOrchestratorSessionStore.setState({
      running: true,
      runGeneration: 11,
      sessionMessages: [{ role: 'user', content: 'Implement auth middleware and run tests' }],
      input: 'What changed?',
      inputAttachments: [],
    })

    await useOrchestratorSessionStore.getState().run()

    const queuedState = useOrchestratorSessionStore.getState()
    assert.equal(queuedState.queuedInputs.length, 1)
    assert.ok(queuedState.interruptionCheckpoint)

    const queued = queuedState.queuedInputs[0] as QueuedRun
    assert.equal(queued.interruptionCheckpointId, queuedState.interruptionCheckpoint?.id)
    assert.match(queuedState.interruptionCheckpoint!.interruptedTaskSummary, /Implement auth middleware and run tests/i)
    assert.match(queuedState.interruptionCheckpoint!.interruptedByPreview, /What changed\?/i)

    useOrchestratorSessionStore.setState({ running: false, queuedInputs: [] })
    await useOrchestratorSessionStore.getState().run(queued)

    assert.match(orchestratorUserMessage, /^\[Interruption protocol — runtime directive\]/)
    assert.match(orchestratorUserMessage, /Prior in-progress task checkpoint: Implement auth middleware and run tests/i)
    assert.match(orchestratorUserMessage, /Interruption message preview: What changed\?/i)
    assert.match(orchestratorUserMessage, /\n\nWhat changed\?$/)
    assert.equal(useOrchestratorSessionStore.getState().interruptionCheckpoint, null)

    const hasDirectiveLog = useOrchestratorActivityStore
      .getState()
      .activityFeed.some((line) => line.includes('[Interrupt] Applying runtime interruption-resume directive'))
    assert.equal(hasDirectiveLog, true)
  })
})

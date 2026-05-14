import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ensureAgentBrowserSessionWithDeps,
  isAgentBrowserCliMissingErrorMessage,
  isAgentBrowserSessionTransportErrorMessage,
  isAgentBrowserPageClosedErrorMessage,
  isAgentBrowserTransientErrorMessage,
  isAgentBrowserStreamingAlreadyEnabledError,
  withAgentBrowserCliInstallHint,
} from './tauri'

describe('ensureAgentBrowserSessionWithDeps', () => {
  it('reuses an existing stream port without calling stream enable', async () => {
    let enableCalls = 0
    const result = await ensureAgentBrowserSessionWithDeps('orca-abc123', {
      enableStreaming: async () => {
        enableCalls += 1
      },
      getStreamPort: async () => 3210,
    })

    assert.equal(result.port, 3210)
    assert.equal(enableCalls, 0)
  })

  it('tolerates already-enabled errors and still resolves the stream port', async () => {
    let portReads = 0
    const result = await ensureAgentBrowserSessionWithDeps('orca-abc123', {
      enableStreaming: async () => {
        throw new Error('✗ Streaming is already enabled for this session')
      },
      getStreamPort: async () => {
        portReads += 1
        return portReads === 1 ? 0 : 4567
      },
    })

    assert.equal(result.port, 4567)
    assert.equal(portReads, 2)
  })

  it('rethrows unrelated stream enable failures', async () => {
    await assert.rejects(
      () =>
        ensureAgentBrowserSessionWithDeps('orca-abc123', {
          enableStreaming: async () => {
            throw new Error('agent-browser crashed')
          },
          getStreamPort: async () => 0,
        }),
      /agent-browser crashed/
    )
  })
})

describe('isAgentBrowserStreamingAlreadyEnabledError', () => {
  it('matches the agent-browser already-enabled message', () => {
    assert.equal(
      isAgentBrowserStreamingAlreadyEnabledError('✗ Streaming is already enabled for this session'),
      true
    )
  })

  it('ignores other errors', () => {
    assert.equal(isAgentBrowserStreamingAlreadyEnabledError('connection refused'), false)
  })
})

describe('agent-browser CLI dependency errors', () => {
  it('detects missing-cli stderr variants', () => {
    assert.equal(isAgentBrowserCliMissingErrorMessage('agent-browser CLI not found on PATH'), true)
    assert.equal(isAgentBrowserCliMissingErrorMessage('No such file or directory'), false)
    assert.equal(
      isAgentBrowserCliMissingErrorMessage('No such file or directory: agent-browser'),
      true
    )
    assert.equal(isAgentBrowserCliMissingErrorMessage('command not found: agent-browser'), true)
    assert.equal(isAgentBrowserCliMissingErrorMessage('session crashed'), false)
  })

  it('detects transient session transport temp-file races', () => {
    const err = "[Errno 2] No such file or directory: '/tmp/agent-browser-h_abc123/_stdout_open'"
    assert.equal(isAgentBrowserSessionTransportErrorMessage(err), true)
    assert.equal(isAgentBrowserCliMissingErrorMessage(err), false)
  })

  it('detects page/context-closed browser errors as transient', () => {
    const pageClosed = 'page.goto: Target page, context or browser has been closed'
    assert.equal(isAgentBrowserPageClosedErrorMessage(pageClosed), true)
    assert.equal(isAgentBrowserTransientErrorMessage(pageClosed), true)

    const notPageClosed = 'Navigation timeout of 30000 ms exceeded'
    assert.equal(isAgentBrowserPageClosedErrorMessage(notPageClosed), false)
  })

  it('classifies both transport races and page-closed failures as transient', () => {
    const transport = "[Errno 2] No such file or directory: '/tmp/agent-browser-h_abc123/_stdout_open'"
    const pageClosed = 'Target page, context or browser has been closed'
    assert.equal(isAgentBrowserTransientErrorMessage(transport), true)
    assert.equal(isAgentBrowserTransientErrorMessage(pageClosed), true)
    assert.equal(isAgentBrowserTransientErrorMessage('agent-browser CLI not found on PATH'), false)
  })

  it('appends install hint only when needed', () => {
    const hinted = withAgentBrowserCliInstallHint('agent-browser CLI not found on PATH')
    assert.match(hinted, /npm install -g agent-browser && agent-browser install/)

    const unchanged = withAgentBrowserCliInstallHint('unexpected timeout')
    assert.equal(unchanged, 'unexpected timeout')

    const transport = withAgentBrowserCliInstallHint(
      "[Errno 2] No such file or directory: '/tmp/agent-browser-h_abc123/_stdout_snapshot'"
    )
    assert.match(transport, /transient browser\/session race/i)
    assert.equal(/npm install -g agent-browser/i.test(transport), false)

    const alreadyHinted = withAgentBrowserCliInstallHint(
      'agent-browser CLI not found on PATH. Install the CLI: npm install -g agent-browser && agent-browser install'
    )
    assert.equal(alreadyHinted.match(/npm install -g agent-browser/g)?.length, 1)
  })
})

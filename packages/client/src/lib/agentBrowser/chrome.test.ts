import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_BROWSER_BASE_TITLE,
  AGENT_BROWSER_ERROR_TITLE,
  buildAgentBrowserErrorSubtitle,
} from './chrome'

describe('agent browser tile chrome helpers', () => {
  it('exports stable base/error titles', () => {
    assert.equal(AGENT_BROWSER_BASE_TITLE, 'Agent Browser')
    assert.equal(AGENT_BROWSER_ERROR_TITLE, 'Agent Browser · Error')
  })

  it('formats and truncates error subtitle', () => {
    assert.equal(buildAgentBrowserErrorSubtitle('missing cli'), 'Error: missing cli')
    const long = 'x'.repeat(300)
    assert.equal(buildAgentBrowserErrorSubtitle(long).length, 140)
  })

  it('falls back for empty message', () => {
    assert.equal(buildAgentBrowserErrorSubtitle('   '), 'Error')
  })
})

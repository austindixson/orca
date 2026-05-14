import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  executeOrchestratorTool,
  hermesNativeBrowserToolPolicyMessage,
  isHermesNativeBrowserToolName,
  requiresAgentBrowserCliPreflight,
} from './executeTools'
import { useSettingsStore } from '../../store/settingsStore'

describe('requiresAgentBrowserCliPreflight', () => {
  it('returns true for interactive agent-browser action tools', () => {
    const names = [
      'browser_snapshot',
      'browser_click',
      'browser_fill',
      'browser_press',
      'browser_screenshot',
      'browser_scroll',
      'browser_wait',
      'browser_get_text',
    ]
    for (const name of names) {
      assert.equal(requiresAgentBrowserCliPreflight(name), true, name)
    }
  })

  it('returns false for non-action tools and lifecycle helpers', () => {
    assert.equal(requiresAgentBrowserCliPreflight('browser_open'), false)
    assert.equal(requiresAgentBrowserCliPreflight('browser_close'), false)
    assert.equal(requiresAgentBrowserCliPreflight('read_file'), false)
  })
})

describe('Hermes-native browser tool guard', () => {
  const originalLeadProfile = useSettingsStore.getState().leadProfile

  afterEach(() => {
    useSettingsStore.setState({ leadProfile: originalLeadProfile })
  })

  it('detects Hermes-native browser tool names', () => {
    assert.equal(isHermesNativeBrowserToolName('browser_navigate'), true)
    assert.equal(isHermesNativeBrowserToolName('browser_console'), true)
    assert.equal(isHermesNativeBrowserToolName('browser_type'), true)
    assert.equal(isHermesNativeBrowserToolName('browser_get_images'), true)
    assert.equal(isHermesNativeBrowserToolName('browser_back'), true)
    assert.equal(isHermesNativeBrowserToolName('browser_open'), false)
  })

  it('produces lead-profile steering guidance in policy message', () => {
    const msg = hermesNativeBrowserToolPolicyMessage('browser_navigate')
    assert.match(msg, /disabled when lead profile is default/i)
    assert.match(msg, /Switch to Hermes Lead mode/i)
  })

  it('blocks Hermes-native browser tools when lead profile is default', async () => {
    useSettingsStore.setState({ leadProfile: 'default' })
    const raw = await executeOrchestratorTool('browser_navigate', '{"url":"https://example.com"}')
    const parsed = JSON.parse(raw) as { ok: boolean; error?: string }
    assert.equal(parsed.ok, false)
    assert.match(parsed.error ?? '', /Tool policy/i)
    assert.match(parsed.error ?? '', /Hermes Lead mode/i)
  })

  it('does not apply the browser policy block when lead profile is hermes', async () => {
    useSettingsStore.setState({ leadProfile: 'hermes' })
    const raw = await executeOrchestratorTool('browser_navigate', '{"url":"https://example.com"}')
    const parsed = JSON.parse(raw) as { ok: boolean; error?: string }
    assert.equal(parsed.ok, false)
    assert.doesNotMatch(parsed.error ?? '', /Tool policy/i)
    assert.match(parsed.error ?? '', /Unknown tool: browser_navigate/i)
  })
})

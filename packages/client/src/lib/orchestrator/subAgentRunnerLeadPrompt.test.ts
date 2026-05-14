import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildLeadDelegationPlaybook } from './subAgentRunner'

describe('buildLeadDelegationPlaybook', () => {
  it('returns empty string when nested delegation is off', () => {
    assert.equal(buildLeadDelegationPlaybook(false), '')
  })

  it('includes parallel delegation guidance when enabled', () => {
    const block = buildLeadDelegationPlaybook(true)
    assert.match(block, /Parallel delegation \(recommended/)
    assert.match(block, /spawn_sub_agent/)
    assert.match(block, /post_team_message/)
  })
})

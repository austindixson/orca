import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseMentions, type MentionAgentTeamStoreView } from './parseMentions'

const agentTeamStore: MentionAgentTeamStoreView = {
  membersByTileId: {
    'tile-mei': { tileId: 'tile-mei', displayName: 'Mei' },
    'tile-sora': { tileId: 'tile-sora', displayName: 'Sora' },
  },
}

describe('parseMentions', () => {
  it('resolves @all', () => {
    const result = parseMentions('hello @all please read', { agentTeamStore })
    assert.equal(result.length, 1)
    assert.equal(result[0]!.kind, 'all')
    assert.equal(result[0]!.raw, 'all')
  })

  it('resolves agent by display name', () => {
    const result = parseMentions('cc @Mei on the diff', { agentTeamStore })
    assert.equal(result[0]!.kind, 'agent')
    assert.equal(result[0]!.tileId, 'tile-mei')
  })

  it('resolves agent by tile id', () => {
    const result = parseMentions('see @tile-sora', { agentTeamStore })
    assert.equal(result[0]!.tileId, 'tile-sora')
  })

  it('dedupes identical agent mention', () => {
    const result = parseMentions('@Mei and @mei again', { agentTeamStore })
    assert.equal(result.length, 1)
  })
})

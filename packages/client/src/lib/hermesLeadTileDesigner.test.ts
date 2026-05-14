import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createHermesTileDesignerDraft,
  validateHermesTileDesignerDraft,
  type HermesTileDesignerDraft,
} from './hermesLeadTileDesigner'

describe('hermesLeadTileDesigner', () => {
  it('creates deterministic scaffolded draft from a brief', () => {
    const draft = createHermesTileDesignerDraft({
      name: 'Release Radar',
      description: 'Track release blockers and deployment status',
      requestedTools: ['read_file', 'search_files', 'terminal'],
    })

    assert.equal(draft.id, 'tile-release-radar')
    assert.equal(draft.componentKey, 'ReleaseRadarTile')
    assert.equal(draft.title, 'Release Radar')
    assert.deepEqual(draft.allowedTools, ['read_file', 'search_files', 'terminal'])
    assert.equal(draft.permissions.workspaceWrite, false)
    assert.equal(draft.permissions.network, false)
  })

  it('returns conformance errors for unsafe or incomplete drafts', () => {
    const bad: HermesTileDesignerDraft = {
      id: 'bad id',
      componentKey: 'bad-key',
      title: 'x',
      summary: '',
      allowedTools: [],
      permissions: {
        workspaceRead: false,
        workspaceWrite: true,
        network: true,
      },
    }

    const result = validateHermesTileDesignerDraft(bad)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.includes('id must match')))
    assert.ok(result.errors.some((e) => e.includes('componentKey must be PascalCase')))
    assert.ok(result.errors.some((e) => e.includes('title must be 3..60 characters')))
    assert.ok(result.errors.some((e) => e.includes('summary must be 8..240 characters')))
    assert.ok(result.errors.some((e) => e.includes('at least one allowed tool')))
    assert.ok(result.errors.some((e) => e.includes('workspaceRead permission is required')))
  })
})

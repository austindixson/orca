import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDesignExtractionPrompts,
  buildDesignExtractionSystemPrompt,
  buildDesignExtractionUserPrompt,
} from './promptTemplates'

describe('designExtraction/promptTemplates', () => {
  it('builds full extraction prompts', () => {
    const prompts = buildDesignExtractionPrompts({
      mode: 'full',
      sourceDesign: 'Modern apartment interior with natural wood and white walls.',
    })

    assert.ok(prompts.systemPrompt.includes('"mode": "full"'))
    assert.ok(prompts.systemPrompt.includes('Output ONLY strict JSON'))
    assert.ok(prompts.userPrompt.includes('Mode: full'))
    assert.ok(prompts.userPrompt.includes('Source design description'))
  })

  it('builds scoped system prompt with exact scope schema', () => {
    const systemPrompt = buildDesignExtractionSystemPrompt({
      mode: 'scoped',
      scope: 'weather_season',
    })

    assert.ok(systemPrompt.includes('Scoped extraction type: weather_season'))
    assert.ok(systemPrompt.includes('"scope": "weather_season"'))
  })

  it('builds scoped user prompt with edit request and context', () => {
    const userPrompt = buildDesignExtractionUserPrompt({
      mode: 'scoped',
      scope: 'additive_object',
      sourceDesign: 'Street portrait at dusk.',
      editRequest: 'Add a red umbrella near the subject.',
      additionalContext: 'Keep face and clothing unchanged.',
    })

    assert.ok(userPrompt.includes('Scope: additive_object'))
    assert.ok(userPrompt.includes('Requested edit'))
    assert.ok(userPrompt.includes('Additional context'))
  })
})

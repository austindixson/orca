import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runDesignExtraction, type DesignExtractionProvider } from './service'

describe('designExtraction/service', () => {
  it('runs full extraction with malformed JSON repair', async () => {
    const provider: DesignExtractionProvider = {
      async generate() {
        return "```json\n{version:1, mode:'full', rationale:'ok', data:{overallDescription:'Mountain cabin', visualStyle:['realistic'], colorPalette:['green'], composition:'Centered', lighting:'Golden hour', cameraAngle:'Eye-level', perspective:'Linear', weather:'Clear', season:'Autumn', keyElements:['cabin','trees'], negativeConstraints:['no people'],}}\n```"
      },
    }

    const result = await runDesignExtraction(
      {
        mode: 'full',
        sourceDesign: 'A mountain cabin at sunset in a forest.',
      },
      provider
    )

    assert.equal(result.value.mode, 'full')
    assert.equal(result.value.data.overallDescription, 'Mountain cabin')
    assert.equal(result.didRepair, true)
  })

  it('runs scoped extraction and repairs missing wrapper', async () => {
    let seenSystemPrompt = ''
    const provider: DesignExtractionProvider = {
      async generate(input) {
        seenSystemPrompt = input.systemPrompt
        return '{"weather":"stormy","season":"winter","preserve":["subject"]}'
      },
    }

    const result = await runDesignExtraction(
      {
        mode: 'scoped',
        scope: 'weather_season',
        sourceDesign: 'Portrait photo outdoors.',
        editRequest: 'Change environment to winter storm.',
      },
      provider
    )

    assert.ok(seenSystemPrompt.includes('weather_season'))
    assert.equal(result.value.mode, 'scoped')
    assert.equal(result.value.data.scope, 'weather_season')
    assert.equal(result.value.data.weather, 'stormy')
  })

  it('throws for irreparable schema mismatch', async () => {
    const provider: DesignExtractionProvider = {
      async generate() {
        return '{"version":1,"mode":"full","rationale":"x","data":{"overallDescription":"x"}}'
      },
    }

    await assert.rejects(
      () =>
        runDesignExtraction(
          {
            mode: 'full',
            sourceDesign: 'Minimal source text.',
          },
          provider
        ),
      /Invalid design extraction payload/
    )
  })
})

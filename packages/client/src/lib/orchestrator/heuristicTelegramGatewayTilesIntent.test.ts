import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { heuristicTelegramGatewayTilesIntent } from './heuristicTelegramGatewayTilesIntent'

describe('heuristicTelegramGatewayTilesIntent', () => {
  it('matches native Telegram phrasing', () => {
    assert.equal(heuristicTelegramGatewayTilesIntent('help me connect telegram to orca'), true)
    assert.equal(heuristicTelegramGatewayTilesIntent('native telegram gateway not working'), true)
  })

  it('matches gateway troubleshooting when Orca/Telegram context is present', () => {
    assert.equal(heuristicTelegramGatewayTilesIntent('gateway status for telegram'), true)
    assert.equal(heuristicTelegramGatewayTilesIntent('restart the telegram gateway'), true)
  })

  it('avoids unrelated gateway mentions', () => {
    assert.equal(heuristicTelegramGatewayTilesIntent('kubernetes gateway api'), false)
    assert.equal(heuristicTelegramGatewayTilesIntent('restart the gateway'), false)
  })

  it('does not fire on long Orca / battle-test text that only mentions "gateway" in a generic LLM-failure line', () => {
    const snippet = `**Orchestrator / model API:** errors mean the **chat completion** was not OpenAI-shaped (or gateway bug). It is not an agent_browser failure. Orca may retry.`
    assert.equal(heuristicTelegramGatewayTilesIntent(snippet), false)
  })

  it('still matches port / companion / native gateway help without the word "telegram" in the same line', () => {
    assert.equal(
      heuristicTelegramGatewayTilesIntent('companion on 3001 and my gateway is down'),
      true
    )
    assert.equal(
      heuristicTelegramGatewayTilesIntent('native gateway shows disconnected'),
      true
    )
  })
})

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { stripAssistantToolArtifacts } from './stripAssistantToolArtifacts'

describe('stripAssistantToolArtifacts', () => {
  test('removes inline tool_call /invoke fragment', () => {
    const s =
      "I'll check your canvas. <tool_call>canvas_list_modules/invoke"
    assert.equal(
      stripAssistantToolArtifacts(s).trim(),
      "I'll check your canvas."
    )
  })

  test('removes paired tool_call blocks', () => {
    const s = 'Hello.\n<tool_call>x</tool_call>\nDone.'
    assert.equal(stripAssistantToolArtifacts(s).trim(), 'Hello.\n\nDone.')
  })

  test('removes markdown-bold Step N: reasoning fragments', () => {
    const s =
      "I'll check the canvas.**Step 1: Check canvas state** Then tools run."
    assert.equal(
      stripAssistantToolArtifacts(s).trim(),
      "I'll check the canvas. Then tools run."
    )
  })

  test('removes fullwidth-bracket Step N: fragments', () => {
    const s = 'Ok.\u3010Step 1: List modules\u3011 Done.'
    assert.equal(stripAssistantToolArtifacts(s).trim(), 'Ok. Done.')
  })

  test('removes think / reasoning XML blocks', () => {
    const s = 'Hi.<redacted_thinking>I plan silently</redacted_thinking> There.'
    assert.equal(stripAssistantToolArtifacts(s).trim(), 'Hi. There.')
  })

  test('removes malformed redacted_thinking (closing tag before content)', () => {
    const s =
      "I'll set up a Hermes agent for you. First, let me check what's currently on the canvas, then I'll start the Hermes gateway and create an agent tile.</think>Step 1: Check canvas state</redacted_thinking>"
    assert.equal(
      stripAssistantToolArtifacts(s).trim(),
      "I'll set up a Hermes agent for you. First, let me check what's currently on the canvas, then I'll start the Hermes gateway and create an agent tile."
    )
  })

  test('removes GLM-style <function=name>…</function> pseudo tool blocks', () => {
    const s =
      'Fix the page.\n<function=write_file> <parameter=body> const x = 1 </parameter> <parameter=path> a.ts </parameter> </function>\nDone.'
    assert.equal(stripAssistantToolArtifacts(s).trim(), 'Fix the page.\n\nDone.')
  })

  test('removes bracket TOOL_CALL wrappers and payload', () => {
    const s =
      'Starting now.\n[TOOL_CALL]\n{tool => "canvas_list_modules", args => {}}\n[/TOOL_CALL]\nDone.'
    assert.equal(stripAssistantToolArtifacts(s).trim(), 'Starting now.\n\nDone.')
  })

  test('removes namespaced tool_call tags from minimax-style output', () => {
    const s = 'Spawning workers.\n</minimax:tool_call>\nAll set.'
    assert.equal(stripAssistantToolArtifacts(s).trim(), 'Spawning workers.\n\nAll set.')
  })
})

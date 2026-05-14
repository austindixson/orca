import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeAssistantBlocks, parseAgentOutputText } from './agentOutputParse'

test('parseAgentOutputText: user prompt and tool call', () => {
  const raw = `
> hello world

→ canvas_create_tile({"type":"terminal", "title": "Server", "x": 0, "y": 0})

← canvas_create_tile
`
  const blocks = mergeAssistantBlocks(parseAgentOutputText(raw))
  const kinds = blocks.map((b) => b.kind)
  assert.ok(kinds.includes('user'))
  assert.ok(kinds.includes('toolCall'))
  assert.ok(kinds.includes('toolResult'))
  const tc = blocks.find((b) => b.kind === 'toolCall') as { kind: 'toolCall'; name: string; args: string }
  assert.equal(tc.name, 'canvas_create_tile')
  assert.ok(tc.args.includes('terminal'))
})

test('parseAgentOutputText: system banner [Using model]', () => {
  const raw = '[Using model: GLM-4.7 (glm-4.7) — Z.AI]'
  const blocks = parseAgentOutputText(raw)
  assert.equal(blocks[0]?.kind, 'systemInfo')
})

test('parseAgentOutputText: still waiting heartbeat collapsed', () => {
  const raw = '[30s] Still waiting — Z.AI tool rounds return the full response (no stream)'
  const blocks = parseAgentOutputText(raw)
  assert.equal(blocks[0]?.kind, 'heartbeat')
})

test('parseAgentOutputText: fenced code and diff', () => {
  const raw = `Here is a patch.

\`\`\`diff
--- a/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
-old
+new
\`\`\`

Done.
`
  const blocks = parseAgentOutputText(raw)
  const diff = blocks.find((b) => b.kind === 'diff') as { kind: 'diff'; content: string } | undefined
  assert.ok(diff)
  assert.ok(diff.content.includes('--- a/foo.ts'))
  assert.equal(diff.streaming, false)
})

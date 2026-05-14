import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyUnifiedDiffLine,
  classifyWritePreviewLine,
  unifiedDiffRowClassNames,
} from './orchestratorDiffLineStyle'

test('classifyUnifiedDiffLine distinguishes hunks and +/-', () => {
  assert.equal(classifyUnifiedDiffLine('@@ -1,3 +1,3 @@'), 'header')
  assert.equal(classifyUnifiedDiffLine('--- a/foo'), 'header')
  assert.equal(classifyUnifiedDiffLine('+++ b/foo'), 'header')
  assert.equal(classifyUnifiedDiffLine('- old'), 'del')
  assert.equal(classifyUnifiedDiffLine('+ new'), 'add')
  assert.equal(classifyUnifiedDiffLine(' context'), 'context')
})

test('classifyWritePreviewLine uses "- " / "+ " prefix', () => {
  assert.equal(classifyWritePreviewLine('- rm'), 'del')
  assert.equal(classifyWritePreviewLine('+ add'), 'add')
  assert.equal(classifyWritePreviewLine('  ctx'), 'context')
})

test('unifiedDiffRowClassNames returns border-l for gutters', () => {
  assert.ok(unifiedDiffRowClassNames('del').includes('border-l-2'))
  assert.ok(unifiedDiffRowClassNames('add').includes('border-l-2'))
})

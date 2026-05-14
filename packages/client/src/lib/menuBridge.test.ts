import { describe, test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { clearActiveEditorRegistryForTests, setActiveEditor } from './activeEditorRegistry'
import { handleOrcaMenuPayloadForTest } from './menuBridge'

describe('menuBridge routing', () => {
  afterEach(() => {
    clearActiveEditorRegistryForTests()
  })

  test('file.save calls active editor save', async () => {
    const calls: string[] = []
    setActiveEditor({
      tileId: 't1',
      save: async () => {
        calls.push('save')
      },
      saveAs: async () => {},
      revert: async () => {},
      runMonacoAction: () => {},
      toggleWordWrap: () => {},
      isDirty: () => true,
      getBuffer: () => 'x',
      getFilePath: () => 'a.ts',
    })
    await handleOrcaMenuPayloadForTest({ id: 'file.save' })
    assert.deepEqual(calls, ['save'])
  })
})
